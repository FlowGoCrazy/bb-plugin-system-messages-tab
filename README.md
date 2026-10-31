# bb-plugin-system-messages-tab

A BB plugin for the thread outline (the rail on the right of a thread). It:

- adds a **System messages** tab and moves BB's `[bb system]` notices and
  messages from other agent threads there, out of **Your messages**;
- puts a date-and-time line above every outline entry, in all three tabs;
- shows the real sender thread title where the outline would show a bare
  **Agent** chip.

## Install

```
bb plugin install git:https://github.com/FlowGoCrazy/bb-plugin-system-messages-tab.git
```

## How it works

BB delivers its own notices (child thread finished, failed or was interrupted)
and messages from other threads (`bb thread tell`) to the agent as user turns,
whose text starts with `[bb system]` or `[bb message from thread:<id>]`, so the
outline lists them under **Your messages**. The outline also carries no times,
and it names a sender thread only if the app has already loaded it.

The Plugin SDK has no slot for the outline, so the frontend registers a content
script that works on the rendered popover:

- it appends a **System messages** button to the tab row and widens the
  popover so the three tabs fit;
- it hides entries with a `data-smt-hidden` attribute: system entries under
  **Your messages**, everything else under **System messages**. That tab
  filters BB's own "Your messages" list, and BB's **Your messages** button is
  repainted as unselected while it is in view;
- it writes each entry's time into a `data-smt-time` attribute, which a
  stylesheet renders above the entry;
- it renames **Agent** sender chips to the thread's title.

Each entry's id and full label come from React's props, because the outline
replaces a thread message's header with the sender chip. Disposal removes every
node, attribute, class change, listener and style the plugin added. If a BB
update changes the outline's markup, the script finds nothing to change and the
outline keeps working unmodified.

Times and titles come from the backend's single RPC, `outline_meta`, which
reads the thread's event log incrementally: `client/turn/requested` events give
user-turn times (keyed by seq), agent-message `item/started` events give agent
message times (keyed by item id), and sender ids resolve to thread titles. A
small `experimental_appOverlay` component hands the RPC client to the content
script.

| File                 | Role                                               |
| -------------------- | -------------------------------------------------- |
| `app.tsx`            | Content script and RPC bridge                      |
| `server.ts`          | `outline_meta` RPC over the thread event log       |
| `lib/outline-dom.ts` | Reading and adjusting BB's outline markup          |
| `lib/classify.ts`    | What counts as a system message                    |
| `lib/format.ts`      | Time labels, outline id parsing, sender thread ids |

## Develop

```
npm install
npm test
npm run typecheck
npm run format
bb plugin build .
bb plugin install . --yes
```

Commit `dist/` with each release: git installs use the built bundle.

## License

MIT
