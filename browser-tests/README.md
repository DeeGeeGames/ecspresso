# Browser disposal regression

Build the browser-only harness with:

```sh
bun run test:browser:build
```

Serve the repository root over HTTP and open
`browser-tests/disposal-regression.html` in a browser. The page must report seven
passing cases and set `document.body.dataset.status` to `passed`. The harness
uses the browser bundle directly and does not inject Node, Bun, or async-context
globals.

Build renderer ownership regressions with `bun run test:browser:renderers:build`
and open `browser-tests/renderer-lifecycle.html`. Its status must become
`passed`. It checks managed canvas/renderer disposal, supplied renderer survival,
Pixi ticker detachment, and preservation of caller-owned display objects and
GPU assets for both PixiJS and Three.js.

After building Bevy (`bun run examples:build:bevy`), run `bun run examples` and
open `/stress-test/lifecycle.html`. Its status must become `passed`. This uses
all three real engine adapters to check queued transitions, canvas cleanup, and
destruction of Bevy iframe timers even while the parent retains a reference.
