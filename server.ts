// bb-plugin-system-messages-tab - backend entry.
//
// The thread outline knows each entry's id, text and role, but not when it
// was sent, and it only knows the titles of sender threads the app has
// already loaded (others show as "Agent"). Both live in the thread's event
// log, so this backend reads the log and hands the frontend (app.tsx):
// - the time of every user turn, keyed by its event seq (user outline ids
//   end in ":user-seed:<seq>");
// - the start time of every agent message, keyed by its item id (assistant
//   outline ids contain "item:<itemId>");
// - the title of every thread that sent this thread a message.
// Reads are incremental per thread, so reopening the outline is cheap.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const outlineMetaSchema = z.object({
  /** Epoch ms of each user turn, keyed by its event seq. */
  userTimes: z.record(z.string(), z.number()),
  /** Epoch ms each agent message started, keyed by its item id. */
  itemTimes: z.record(z.string(), z.number()),
  /** Title of each thread that sent this thread a message, keyed by thread id. */
  senderTitles: z.record(z.string(), z.string()),
});
export type OutlineMeta = z.infer<typeof outlineMetaSchema>;

export const rpcContract = defineRpcContract({
  outline_meta: {
    input: z.object({ threadId: z.string().regex(/^thr_[a-z0-9]+$/) }),
    output: outlineMetaSchema,
  },
});

/** The largest page the thread events API returns. */
const PAGE_SIZE = 100;
const MAX_CACHED_THREADS = 20;

type ThreadMeta = {
  lastSeq: number;
  userTimes: Record<string, number>;
  itemTimes: Record<string, number>;
  senderIds: Set<string>;
};

export default async function plugin(bb: BbPluginApi) {
  const cache = new Map<string, ThreadMeta>();
  const titles = new Map<string, string | null>();
  // One read per thread at a time; concurrent callers share it.
  const inflight = new Map<string, Promise<ThreadMeta>>();

  async function refresh(threadId: string): Promise<ThreadMeta> {
    const meta = cache.get(threadId) ?? {
      lastSeq: 0,
      userTimes: {},
      itemTimes: {},
      senderIds: new Set<string>(),
    };
    for (;;) {
      const rows = await bb.sdk.threads.events.list({
        threadId,
        afterSeq: String(meta.lastSeq),
        limit: String(PAGE_SIZE),
        order: "asc",
        types: ["client/turn/requested", "item/started"],
      });
      for (const row of rows) {
        meta.lastSeq = Math.max(meta.lastSeq, row.seq);
        if (row.type === "client/turn/requested") {
          meta.userTimes[String(row.seq)] = row.createdAt;
          const sender = (row.data as { senderThreadId?: unknown }).senderThreadId;
          if (typeof sender === "string") meta.senderIds.add(sender);
        } else if (row.type === "item/started") {
          const item = (row.data as { item?: { type?: unknown; id?: unknown } }).item;
          if (item?.type === "agentMessage" && typeof item.id === "string") {
            meta.itemTimes[item.id] ??= row.createdAt;
          }
        }
      }
      if (rows.length < PAGE_SIZE) break;
    }
    cache.delete(threadId);
    cache.set(threadId, meta);
    while (cache.size > MAX_CACHED_THREADS) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
    return meta;
  }

  async function titleOf(threadId: string): Promise<string | null> {
    if (titles.has(threadId)) return titles.get(threadId) ?? null;
    let title: string | null = null;
    try {
      const thread = await bb.sdk.threads.get({ threadId });
      title = thread.title?.trim() ? thread.title : null;
    } catch {
      // Deleted or unreadable thread: keep BB's own "Agent" label.
    }
    titles.set(threadId, title);
    return title;
  }

  bb.rpc.register(rpcContract, {
    outline_meta: async ({ threadId }) => {
      let pending = inflight.get(threadId);
      if (!pending) {
        pending = refresh(threadId).finally(() => inflight.delete(threadId));
        inflight.set(threadId, pending);
      }
      const meta = await pending;
      const senderTitles: Record<string, string> = {};
      await Promise.all(
        Array.from(meta.senderIds, async (id) => {
          const title = await titleOf(id);
          if (title !== null) senderTitles[id] = title;
        }),
      );
      return { userTimes: meta.userTimes, itemTimes: meta.itemTimes, senderTitles };
    },
  });

  bb.log.info("loaded");
  bb.onDispose(() => bb.log.info("disposed"));
}
