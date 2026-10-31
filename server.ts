// bb-plugin-system-messages-tab - backend entry.
//
// The plugin has no backend behavior: everything runs in the app window
// (app.tsx). BB requires a server entry, so this one only logs its lifecycle.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");
  bb.onDispose(() => bb.log.info("disposed"));
}
