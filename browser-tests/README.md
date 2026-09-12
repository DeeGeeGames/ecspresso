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
