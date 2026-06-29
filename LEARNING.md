# base-box — Learning checklist

Track understanding before/while building. Goal: deeply understand **why**, not just what/how.

## 1. The problem
- [ ] Why run a playground fully in the browser with **no backend**? (cost, sharing, instant boot)
- [ ] Why is "native ESM + import maps" different from "bundling in the browser"?
- [ ] Why does native ESM alone fail on JSX/TS/CJS? (browsers only run plain JS modules)
- [ ] What does "Node module resolution" actually mean, and which parts are hard?

## 2. The solution
- [ ] Why is the Service Worker acting as a "dev server"? What does it buy us?
- [ ] Why esbuild `transform()` (per-file) and not `build()` (bundle)?
- [ ] Why delegate npm resolution to esm.sh in v1 instead of self-resolving?
- [ ] How do relative-import rewriting and the import map split responsibilities?
- [ ] How does `?files=base64` make sharing stateless?

## 3. Edge cases & design decisions
- [ ] Extension/dir resolution order for user files.
- [ ] Why one inline import map, injected before any module?
- [ ] CJS→ESM interop: where does it happen (esm.sh) and why not us yet?

## 4. Safari (hard requirement)
- [ ] Why blob-URL modules were rejected (relative resolution from `blob:`).
- [ ] Import map rules in Safari (single, inline, before first module).
- [ ] SW first-navigation flakiness → why iframe waits for SW `active`.

## 5. Broader context
- [ ] What this unlocks (shareable repros, docs, teaching, embeds).
- [ ] What the v1→v2 path (self-resolver) changes and why it's swappable.
