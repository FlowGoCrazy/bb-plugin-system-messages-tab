Keep "Your messages" for the messages you actually wrote.

When an agent starts child threads, BB tells it about each one finishing,
failing or being interrupted with a `[bb system]` notice. BB delivers those
notices as user turns, so the thread outline (the rail on the right of a
thread) lists them under **Your messages**. In an orchestrator thread they can
outnumber your own prompts many times over.

## What you get

- A third **System** tab in the thread outline, next to **Agent messages** and
  **Your messages**, holding every `[bb system]` notice.
- **Your messages** shows only what you wrote.
- Clicking an entry in **System** jumps to it, like any other outline entry.
- The tab only appears in threads that have system notices, and remembers
  your choice while the outline closes and reopens.

## How it works

The Plugin SDK has no slot for the thread outline, so the plugin works on the
rendered outline: it adds one tab button and hides entries in the list. It
does not change messages and sends nothing anywhere. Disabling the plugin
restores the outline exactly as BB ships it.

Messages from other agent threads (`[bb message from thread:…]`) stay under
**Your messages**; BB already marks them with the sender thread.

A future BB update can change the outline's internal layout. The **System**
tab may then disappear until the plugin is updated; the outline itself keeps
working.
