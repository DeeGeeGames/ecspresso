# Documentation site maintenance

The homepage is a static, interactive introduction to ECSpresso. Chrome is the
current browser acceptance target.

```sh
bun run docs:serve
# http://localhost:3220/ecspresso/
```

`bun run docs` builds the library, packages the showcase, renders TypeDoc and
examples, and generates the homepage. GitHub Pages publishes the `docs/` tree.
Generated `docs/api`, `docs/examples`, `docs/showcase`, and `docs/brand` are
ignored and excluded from source typechecking. TypeDoc uses the source-only
`tsconfig.docs.json`.

## Source ownership

- `scripts/docs-showcase/index.html` and `site.css`: homepage and theme.
- `game.ts`: the actual editable game, including movement and collection.
- `main.ts`: rendering, controls, theme, and automatic editor loading.
- `editor.ts`: real library declarations, TypeScript diagnostics, and activities.
- `runner.ts`, `sandbox.ts`, `simulation.ts`: execution and lifecycle.
- `scripts/build-docs-showcase.ts`: runtime/declaration packaging and workers.
- `scripts/build-docs-index.ts`: homepage version, code excerpt, and brand assets.

The game loads independently of Monaco. Page initialization automatically loads
the editor, its CSS, generated declaration graph, and TypeScript worker. The code
becomes editable when initialization completes, without an activation click or
automatically taking keyboard focus. Failed loads offer a retry button. The
editor uses Monaco 0.55.1's TypeScript 5.9.3 worker; the tested compiler baseline
is TypeScript 6. Both check the actual game without callback type annotations.
Completions, hovers, and diagnostics use the real declarations. Unqueried
components remain optional, `without` excludes them, and readonly mutation
checking is shallow.

Edited code runs in a dedicated classic worker created inside an opaque
sandboxed iframe. The parent owns drawing and input. A heartbeat timeout
terminates stalled execution; normal restart disposes registered worlds, then
terminates the worker and removes the iframe. Compile errors preserve the last
working game. Network access from the simulation is blocked by the frame CSP.
This isolates the page and permits termination; it does not impose a hard
browser memory limit.

Serve over HTTPS (localhost also supports the required APIs). HTTP on a LAN
address displays an HTTPS requirement instead of attempting to run unverified
assets. Any deployment
CSP must permit Monaco module workers, the inline sandbox bootstrap, and blob
workers/modules. Deploy the generated directory together; runtime and
declaration checksums reject mismatched assets.

## Validation

After building and starting the preview:

```sh
bun run check
bunx playwright install chromium
bun run docs:check:browser
```

Set `DOCS_URL` for another preview URL and `DOCS_CHROME` for a Chrome/Chromium
executable. Browser checks save screenshots and results to the ignored
`docs-showcase-evidence.local/` directory. They cover actual movement changes,
completion/type behaviour, error recovery, disposal, runaway-code termination,
light/dark layouts, native browser touch events, and local navigation. Desktop
checks require the game canvas and Play/Run buttons above the fold at 1366×768,
1440×900, and 1920×1080. Twelve type-parity cases compare diagnostics,
completion sets, and hovers from the Monaco worker against the repository
compiler, using the generated declarations. An insecure browser origin also checks the HTTPS message
and that the page remains usable.
Phone emulation does not prove physical soft-keyboard ergonomics or hardware
performance. Safari is outside the current acceptance scope.
