# bb-plugin-system-messages-tab

A BB plugin that adds a **System** tab to the thread outline (the rail on the
right of a thread) and moves BB's `[bb system]` notices there, out of
**Your messages**.

## Install

```
bb plugin install git:https://github.com/FlowGoCrazy/bb-plugin-system-messages-tab.git
```

## How it works

BB delivers its own notices (child thread finished, failed or was interrupted)
to the agent as user turns whose text starts with `[bb system]`, so the outline
lists them under **Your messages**. The Plugin SDK has no slot for the outline,
so `app.tsx` registers a content script that:

- appends a **System** button to the outline's tab row,
- hides list entries with a `data-smt-hidden` attribute: notices under
  **Your messages**, everything else under **System**,
- repaints BB's **Your messages** button as unselected while **System** is in
  view (the System tab filters BB's own "Your messages" list).

Disposal removes every node, attribute, class change, listener and style it
added. If a BB update changes the outline's markup, the script finds nothing to
change and the outline keeps working unmodified.

`lib/classify.ts` holds the rule for what counts as a system notice.

## Develop

```
npm install
npm test
npm run typecheck
bb plugin build .
bb plugin install . --yes
bb plugin reload system-messages-tab
```

Commit `dist/` with each release: git installs use the built bundle.

## License

MIT
