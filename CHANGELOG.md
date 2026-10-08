# Changelog

All notable changes to ECSpresso are documented here. Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## 0.24.1

### Changed

- Consumer skill guidance connects requested outcomes to bounded source
  inspection, contextual recipes, and separate simulation, rendering, and play
  evidence. Runnable health/combat examples demonstrate synchronous events and
  deferred command visibility.
- Examples declare query writes, use singleton reads and screen scopes, and
  separate scene presentation from ECS lessons. The gallery groups introductory
  lessons, focused features, games, and diagnostics, including new behavior-tree
  basics and mutation/change-tracking lessons.

### Fixed

- Example pointer conversion respects camera projection and canvas scaling.
  Starter bounces clamp overshoot and wall-hit marks remain bounded.
- Turret-shooter scheduling, pause groups, startup callbacks, listeners, and
  explosions have explicit ownership. Sprite-animation indicators reuse text
  objects and release owned assets; React health milestones log crossings once.
- Screens example pause/resume preserves inactive timer slots and elapsed values.

## 0.24.0

### Added

- Opaque `defineSystemRef()` identities and system `.withRef()`, `.before()` and
  `.after()` declarations. Explicit processing edges precede priority, retain
  fixed phases, and validate missing references, duplicate bindings and cycles.
- Configurable built-in processing plugins export stable system references and
  accept primary-system ordering options. Spatial indexes accept phase-specific
  rebuild ordering. The turret-defense example now declares its detection and
  aiming dependencies directly.
- The public tween entry point now exports the standard easing functions and
  `EasingFn` type.
- An interactive documentation homepage with an editable game, Monaco
  completions and type diagnostics from the library declarations, isolated
  execution, and recovery from compile errors or stalled code.
- ECSpresso cup and bean branding across the README, documentation, and examples.

### Changed

- System removal and phase changes validate the resulting graph before side
  effects. Invalid registrations block processing until repaired; disposal
  still cleans up invalid graphs. Updates pin their phase schedules, so runtime
  priority/phase changes apply on the next update and removals take effect
  immediately, including later fixed steps.
- Examples now use published package entry points and validate against the
  built package. Behavior-tree guidance clarifies that blackboard defaults are
  shallow-copied and require fresh nested values for independent mutable state.

### Fixed

- Resource subscriptions registered before initialization now establish a
  baseline when the first value becomes available. This repairs silent
  `$screen` and lazy-resource subscriptions without sending an initialization
  callback with an undefined previous value.
- Reusing a built-in plugin object across worlds now creates independent runtime
  state per installation. This includes both spatial indexes, input, detection,
  audio, diagnostics, coroutines, flocking, particles, UI, and renderer caches
  and cleanup hooks. Caller-supplied resources retain their existing ownership.
- Renderer plugins now remove their loops, listeners, and plugin-created scene
  containers during world disposal. Renderers created by the plugins are
  disposed with the world; supplied renderers and ECS-provided GPU assets remain
  caller-owned.
- The Screen Manager example now renders menu and game-over UI when no gameplay
  clock exists. The audio example uses deployment-relative asset URLs and runs
  the world update loop required for playback processing.
- Engine benchmark switches now await teardown, recover from failed starts,
  isolate Bevy in an iframe, and disable Bevy when its generated files are absent.

## 0.23.0

### Changed

- World disposal now joins asynchronous plugin cleanup already started by
  standalone uninstall and retains its failures until teardown observes them.
- Screen teardown waits for in-flight enter/resume/exit hooks before releasing
  dependencies, and does not repeat an exit already underway.
- Entity removal continues through observer failures, including remaining
  components and descendants, then throws an aggregate error after removal.

- Refocused the bundled application-development skill around system ownership,
  explicit mutation declarations, dependency timing, and proportional
  validation, with focused change-tracking, lifecycle, and testing references.
- Corrected the built-in plugin catalog to match every published package export.
- System event handlers now apply live group, screen, and asset activation
  gates, and are detached when their system is removed.
- Plugin compatibility checks now reject conflicting overlapping types and
  validate required value types across components, events, resources, assets,
  and screens, including the first builder plugin.
- Plugin requirements now use mutual compatibility for writable shared values;
  plugins with application-specific collision layers or input action unions
  can carry those types through their factory generics.
- `await world.dispose()` is now the complete asynchronous world teardown
  operation. It stops new work, detaches systems, removes entities, runs async
  plugin/resource cleanup, and reports failures after cleanup continues.
  Callers that previously ignored `dispose()` may continue doing so, but code
  that needs teardown completion should await it.
- Plugin cleanup, system detach, and resource disposal callbacks now receive a
  browser-portable `CleanupControl`. Call `cleanup.requestDisposal()` when a
  callback must initiate owner teardown without waiting on itself; normal
  `await world.dispose()` calls remain the complete external barrier. Resource
  teardown joins active partial/bulk work, preserves dependencies, and reports
  initiating cleanup failures after remaining disposal completes.
- `SystemDetachFn<Cfg>` now names the two-argument `.setOnDetach(...)` callback
  shape; `SystemLifecycleFn<Cfg>` remains the initialization callback shape.
- Pending system builders now run asynchronous `onDetach` cleanup during world
  disposal without being initialized or registered for processing.

### Internal

- Added cross-agent repository guidance, a repository-local maintainer skill,
  and automated checks for consumer-skill references, mirrors, and plugin paths.

## 0.22.0

### Fixed

- Replaced the obsolete GitHub Packages release job with an npmjs workflow
  that creates the version commit and tag before publishing.

## 0.21.0

### Breaking

- Removed `ECSpressoBuilder.pluginFactory()` and `ECSpresso.pluginFactory()`.
  Reusable features must use canonical `definePlugin()`. Application-owned
  system modules should accept `SystemRegistrarOf<W>` and receive either the
  full built world or a scoped registrar.

### Added

- Added `world.systemScope(defaults)`, which returns a narrow, system-only
  registration capability with snapshotted phase, priority, and screen defaults.
- Added the public `SystemDefaults`, `SystemRegistrar`, and
  `SystemRegistrarOf` types.

### Internal

- Aligned the development TypeScript version with TypeDoc's supported 6.x
  range so the generated documentation pipeline remains reproducible.

## 0.20.0

### Changed

- **Live `withResources()` dependencies**: Declared resource values are refreshed before every system process call, so `setResource()` and `updateResource()` replacements are visible regardless of `onResourceChange()` subscribers. Systems that intentionally relied on first-call snapshots now receive the currently registered value; the injected `resources` object is still reused.
- **Optional dependency metadata**: TypeScript is now a development dependency rather than a peer dependency, and the unused `react-dom` peer requirement has been removed. Runtime integrations continue to declare only their optional package peers.

### Added

- **Installation guidance**: The getting-started guide now documents the optional packages required by the 2D, 3D, audio, and React entry points, along with the recommended TypeScript version.
- **System and screen ownership guidance**: The systems, plugins, screens, and mirrored AI skill documentation now cover explicit callback dependencies, plugin-wide system defaults, authoritative screen navigation, and pause/overlay group behavior.

## 0.19.2

### Added

- **Orthographic zoom bounds on `camera3D`**:
  - `createCamera3DPlugin({ projection: 'orthographic', minZoom?, maxZoom? })` clamps `camera3DState.setZoom`, initial zoom, camera sync at init, and built-in wheel zoom (defaults `0.1`–`10`, matching the 2D camera plugin wheel limits).

## 0.19.1

### Added

- **Projection-aware `camera3D` wheel input**:
  - Orthographic cameras now use wheel input to update `camera3DState.zoom` by default.
  - `createCamera3DPlugin({ wheelMode })` supports `'auto'`, `'distance'`, `'zoom'`, and `'disabled'`.

## 0.19.0

### Breaking

- `addReactiveQuery(...)` callbacks now receive context objects:
  - `onEnter({ entity, ecs })` instead of `onEnter(entity)`.
  - `onExit({ entityId, ecs })` instead of `onExit(entityId)`.

### Added

- **Screen resume lifecycle hooks** for overlay stacks:
  - `ScreenDefinition.onResume({ config, state, ecs })` runs after `popScreen()` restores a stacked screen as current.
  - `screenResume` events and `game.onScreenResume(screen, handler)` expose the same resume point to centralized screen wiring.

## 0.18.0

### Breaking

ScreenDefinition<Config> now defaults State to Config instead of Record<string, never>.

That means code like this may now fail typecheck:

type Screens = {
playing: ScreenDefinition<{ level: number }>;
};

const playing: Screens['playing'] = {
initialState: () => ({}),
};

Before, omitted State meant empty state. Now omitted State means state mirrors config, so initialState must return { level: number }.

### Added

- **System callback helper types** for extracted system callbacks:
  - `SystemProcessFn<Cfg, Queries, ResourceKeys?, Singletons?>` names the `.setProcess(...)` callback shape.
  - `SystemLifecycleFn<Cfg>` names the `.setOnInitialize(...)` / `.setOnDetach(...)` callback shape.
- **Configurator callback helper types** for extracting builder callbacks:
  - `AssetConfiguratorFn<Assets, AssetGroups?>` names the `.withAssets(...)` callback shape.
  - `ScreenConfiguratorFn<Screens>` names the `.withScreens(...)` callback shape.
- **Slot-specific `WorldConfig` helper types** for plugin requirements:
  - `ComponentsConfig<T>`, `EventsConfig<T>`, `ResourcesConfig<T>`, `AssetsConfig<T>`, and `ScreensConfig<T>` build single-slot configs without spelling empty `WorldConfigFrom` parameters.
- **Screen definitions now default state to config** when the state type parameter is omitted, reducing boilerplate for screens whose mutable state mirrors the entry config.
- **Spritesheet helpers in `ecspresso/plugins/rendering/sprite-animation`** for PixiJS atlases:
  - `spritesheetLoader<S>(url)` — `AssetConfigurator`-compatible loader; lazy-loads `pixi.js` and runtime-shape-checks the resolved value so non-atlas URLs error at load time instead of deep in the play loop.
  - `clipFromSheet(sheet, name, options?)` and `animationSetFromSheet(id, sheet, options?)` — build clips/sets from a loaded `Spritesheet<S>`. Animation-name union is inferred when `S` is declared as an `interface ... extends SpritesheetData`. Both throw on zero-frame animations.
  - `clipFromGrid({ source, frameWidth, frameHeight, columns, rows?, count?, indices?, ... })` — slice a grid-arranged image without atlas JSON. **Async** (lazy-loads pixi) and validates inputs: exactly one of `rows`/`count`/`indices` is required, indices are integer- and bounds-checked when `rows` is given.
  - New exported types: `SheetClipOverrides<A>`, `SheetAnimationKeys<S>`.

### Internal

- Materialized the Codex plugin wrapper files in-repo and included their plugin manifests in version sync.

## 0.17.0

No breaking changes from 0.16.3.

### Added

- **`builder.disableChangeTracking()`** — opt out of change tracking entirely for worlds with zero `changed:` filters (e.g. benchmarks). Auto-subscription from plugins still grows the bitmap correctly if a plugin with a `changed:` filter is added afterwards.
- **Auto-derived change-tracking subscriptions.** The framework walks `changed:` declarations during `_registerSystem` and subscribes only the components something actually consumes. Unsubscribed components skip the mark walk entirely.

### Performance

- Spatial-index `postUpdate` rebuild auto-skips in flat-hierarchy scenes when the `fixedUpdate` rebuild already ran (2D: −5.7%, 3D: −9.6% ms/frame in the physics bench).
- `EventBus.publish` switched from a conditional-tuple rest signature to two named overloads — empty fast-path is ~7× faster (5.7 → 0.8 ns/call); end-to-end bench −7–10% ms/frame.
- `markChanged` resolves component indices once and uses a flat `Uint32Array` for the per-component change generation.
- Query `_changedIdx` and `_mutatesIdx` are pre-resolved at system registration, removing per-frame name→idx Map lookups.
- Collision and spatial-index plugins replaced per-entity `getComponent` calls with split queries.

### Internal

- Added `bench/ecs-physics3D.bench.ts` and shared `mulberry32` PRNG with the 2D bench.
- Stress-test example gained Phaser and Bevy comparison modes; Bevy wasm builds in docs CI.
