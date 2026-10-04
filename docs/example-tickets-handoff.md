# Example correctness, current idioms, and teaching structure

Implements [#16](https://github.com/DeeGeeGames/ecspresso/issues/16),
[#17](https://github.com/DeeGeeGames/ecspresso/issues/17), and
[#18](https://github.com/DeeGeeGames/ecspresso/issues/18) as one examples change.
The owner authorized implementation of the three latest tickets. Their dependent,
overlapping scopes were delivered together; existing routes, controls, and advanced
showcase features are retained. No public library contract or package version changed.

## Correctness and ownership

- Cartesian pointer input normalizes canvas offsets and CSS scale into renderer
  pixels. Isometric input preserves the client-space canvas center expected by
  `screenToIsoWorld` and cursor zoom while normalizing scale. Isometric examples
  synchronize the camera viewport because they disable the renderer's camera mode.
- The bouncing plugin provides its velocity/radius/event types and requires external
  transforms and bounds. Type fixtures reject missing and incompatible dependencies.
  Bounce clamps overshoot and reflects outward velocity; events/plugins retain at
  most 64 wall marks and dispose removed Graphics.
- Turret uses the renderer-managed update loop. Firing, aiming, startup, UI message
  countdowns, simulation time, and explosion updates are ECS systems. Gameplay,
  timer, collision, and spatial-index processing freeze together, while UI timing
  stays independent. Delayed destruction resumes without losing `justFinished`.
  Input and page listeners detach; disposal stops the renderer, releases explosion
  assets, removes generated UI, and hides/pauses the static radar. Geometry and
  materials belonging to the caller retain the existing renderer ownership contract.
- Sprite labels retain Text objects. Local scene ownership releases temporary
  Graphics, unique frame textures, display objects, and click listeners explicitly.
  Shared frame textures are destroyed once, after display objects detach.
- React milestone messages use downward crossings of 75/50/25, including large
  steps, rather than repeatedly logging rounded values.

## Current ECS idioms and teaching changes

Representative query writers declare `mutates`, with `return false` for applicable
no-write paths. Simple loops use `setProcessEach`; aggregate collisions and orders
remain aggregate. Singleton reads handle absence and are documented as first-match
reads, without a uniqueness guarantee. Screens share a playing registration scope
and pause the timer group rather than rewriting timer slots. React imports the
published binding directly; redundant plugin component registrations are removed.
Particle updates explicitly follow transform propagation so a newly spawned local
transform supplies the correct first-burst position.

The advanced behavior-tree entry retains flee/eat/gather/explore/idle behavior, fog, indicators,
runtime blackboard validation, and freshly allocated exploration memory per villager.
Scene/config extraction reduces its entry from 656 to 535 lines. Sprite animation
reduces from 424 to 299, and tilemap from 370 to 221; drawing, static data, and asset
ownership move to local helpers while ECS composition and systems stay visible.

`behavior-tree-basics` demonstrates selector/sequence with flee and patrol, and
links to the advanced simulation. `change-tracking` demonstrates a declared write
observed by a following changed-filtered consumer and a no-op that skips marking.
The same gallery source serves development and generated docs, grouped into
introduction, focused features, complete games, and diagnostics. All 33 prior
routes and both new routes are included. Events describes wallHit communication;
benchmarks and physical gamepad diagnostics have distinct descriptions.

## Validation

- `bun run check`: 2,053 passing tests, no failures, including example regressions.
- `bun run check:examples:consumer`: package build and published-entry typecheck pass.
- `bun scripts/build-examples.ts`: all 35 examples build.
- `bun run docs`: package, showcase, TypeDoc, examples, changelog and homepage build.
- Independent reviews cross-checked the owned areas. Findings repaired particle
  ordering and static radar disposal; affected checks were rerun.
- `scripts/check-examples-browser.mjs` exercises actual browser journeys and writes
  screenshots plus `observations.json`. It passes against development and the
  generated documentation deployment path, with no uncaught page errors.

Browser evidence includes the gallery, write/no-op counter (1/1), patrol → flee →
patrol, navigation to the advanced simulation, a stable paused screens canvas,
resume and repeated overlays, game-over and restart, repeated sprite animation/pause
clicks, tilemap movement against geometry, isometric rendering, radar start/pause/resume, keyboard
firing, and turret disposal during gameplay and startup. Disposal leaves zero
pending animation frames and subsequent input dispatch produces no callback errors. A real initialized
Pixi/camera probe maps the offset/scaled canvas center to (5,5), a zoomed pointer
to (6,5), and the resized CSS center back to (5,5).

The focused simulations separately verify immediate mutation visibility, no-op
marks, timer state preservation, firing cooldown without catch-up, delayed
explosion destruction, asset teardown, initial particle positioning, and health
crossings. Browser screenshots were inspected for the screens journey and retained
showcases. Headless pointer-lock requests are not physical mouse acceptance;
physical gamepad and full gameplay/device acceptance remain unverified.

## Reproduce browser evidence

Start `bun run examples`, then run:

```sh
bun scripts/check-examples-browser.mjs
```

The script uses Playwright Chromium. Install its matching browser with
`bunx playwright install chromium`, or supply `EXAMPLE_BROWSER_PATH` for an
existing Chromium executable. This run used the existing Chromium 1234 executable
because the cached browser expected by Playwright 1.58 was incomplete.

For generated docs, first run `bun run docs` and `bun scripts/serve-docs.ts`, then:

```sh
EXAMPLE_BASE_URL=http://localhost:3220/ecspresso/examples \
EXAMPLE_EVIDENCE_DIR=/tmp/ecspresso-example-evidence-production \
bun scripts/check-examples-browser.mjs
```

The script's default evidence directory is `/tmp/ecspresso-example-evidence`.
Artifacts are local review evidence, not published package assets. The collaborative
T3 preview initially verified the change-tracking controls but screenshot capture
failed and its automation host disconnected. Playwright then completed the browser
checks and screenshots.
