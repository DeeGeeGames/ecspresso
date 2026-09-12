# ECSpresso Plugins

## Defining Plugins

Plugins group reusable systems, resources, and component types. Canonical
`definePlugin()` is the only plugin definition API. Application modules that
only organize system registration should use `SystemRegistrarOf<W>` and
`world.systemScope(defaults)` instead.

### Canonical `definePlugin`

```typescript
import { definePlugin } from 'ecspresso';

interface MyComponents {
  position: { x: number; y: number };
  velocity: { x: number; y: number };
}

interface MyResources {
  gravity: { value: number };
}

const physicsPlugin = definePlugin('physics')
  .withComponentTypes<MyComponents>()
  .withResourceTypes<MyResources>()
  .install((world, onCleanup) => {
    world.addResource('gravity', { value: 9.8 });

    // Register any long-lived subscriptions or listeners with onCleanup so
    // they tear down when the plugin is uninstalled or the world disposed.
    onCleanup(world.onScreenExit('playing', ({ ecs }) => { /* ... */ }));

    world.addSystem('applyVelocity')
      .addQuery('moving', {
        with: ['position', 'velocity'],
        mutates: ['position'],
      })
      .setProcess(({ queries, dt }) => {
        for (const entity of queries.moving) {
          entity.components.position.x += entity.components.velocity.x * dt;
          entity.components.position.y += entity.components.velocity.y * dt;
        }
      });
  });
```

`install` receives `(world, onCleanup)`. `onCleanup(fn)` registers a
sync or async disposer that runs (in reverse order) when
`world.uninstallPlugin(id)` or `world.dispose()` is called. Declaring just
`(world) => { ... }` is still valid — the second parameter is optional.
Each disposer receives a `CleanupControl`; use `cleanup.requestDisposal()` if
the disposer itself must initiate world teardown.

`world.uninstallPlugin(id)` is synchronous and only runs that plugin's
registered cleanup callbacks; it does not remove systems or other registrations
made by the plugin. `await world.dispose()` performs complete asynchronous
world teardown and waits for registered async cleanup, system detachment, and
initialized resource disposal.
This includes asynchronous cleanup already started by standalone uninstall;
its failures are retained for the world-disposal result.

The builder mirrors `ECSpresso.create()`:
- `.withComponentTypes<T>()`, `.withEventTypes<T>()`, `.withResourceTypes<T>()`, `.withAssetTypes<T>()`, `.withScreenTypes<T>()` — declare types this plugin provides
- `.withLabels<L>()`, `.withGroups<G>()`, `.withReactiveQueryNames<N>()` — declare system labels, groups, and reactive query names
- `.requires<W>()` — declare dependency on another plugin's `WorldConfig` type (e.g., `TransformWorldConfig`)
- `.setSystemDefaults({ phase?, priority?, inScreens?, excludeScreens? })` — defaults applied to every `world.addSystem(...)` called inside `install`. Per-system builder calls (`.inPhase`, `.setPriority`, `.inScreens`, `.excludeScreens`) override. Calling again replaces wholesale.
- `.install(fn)` — terminal, returns the finalized `Plugin` object

Requirements are checked for mutual compatibility across components, events,
resources, assets, and screens because the world passed to `install` is
writable. If a dependency varies by an application's union (such as collision
layers or input action names), make the plugin factory generic and pass the
same union to the provider and consumer instead of widening the requirement.

### Plugin-level system defaults

When every system in a plugin shares the same gating, hoist it onto the plugin instead of repeating it per system:

```typescript
const combat = definePlugin('combat')
  .withScreenTypes<{ playing: { initialState: () => {} } }>()
  .setSystemDefaults({ inScreens: ['playing'], phase: 'update' })
  .install((world) => {
    // Both systems inherit inScreens: ['playing'] and phase: 'update'
    world.addSystem('projectile-integrate').setPriority(300)
      .addQuery('projectiles', { with: ['projectile'], mutates: [] })
      .setProcess(() => { /* ... */ });

    // Per-system calls override the default for that system only
    world.addSystem('damage-numbers-hud').inPhase('render')
      .setProcess(() => { /* runs in render phase, still gated to 'playing' */ });
  });
```

To *opt out* of a default screen gate on a single system, pass an empty array: `.inScreens([])` runs the system regardless of active screen.

#### Screen gates do not pause other plugin groups

`setSystemDefaults({ inScreens: ['playing'] })` applies only to systems added
inside that plugin's `install` callback. It does not suspend systems installed
by other plugins. A pause overlay will stop the gated combat systems below, but
a separately installed timer, tween, coroutine, physics, or animation plugin
continues to advance unless its group is disabled.

Use screen lifecycle hooks to suspend only the shared simulation groups that
belong to gameplay. Keep input and overlay-navigation groups enabled:

```typescript
const PAUSED_GROUPS = ['timers', 'tweens', 'coroutines'] as const;

game.onScreenEnter('pause', ({ ecs }) => {
  PAUSED_GROUPS.forEach(group => ecs.disableSystemGroup(group));
});

game.onScreenEnter('playing', ({ ecs }) => {
  PAUSED_GROUPS.forEach(group => ecs.enableSystemGroup(group));
});

game.onScreenResume('playing', ({ ecs }) => {
  PAUSED_GROUPS.forEach(group => ecs.enableSystemGroup(group));
});
```

Audit every registered system and installed plugin when defining pause
semantics. Being visually hidden or underneath a screen stack does not stop a
system by itself.

#### Spawns inside gated systems are auto-scoped

When a system has `inScreens([X])` set (either directly or via `setSystemDefaults`), any `spawn` / `spawnChild` / `commands.spawn` / `commands.spawnChild` call issued *inside that system's `process` tick* without an explicit `scope` is automatically tagged with the active screen. The entity is removed when that screen exits.

```typescript
// Plugin-internal spawns no longer need { scope: 'playing' } at every site.
.setSystemDefaults({ inScreens: ['playing'] })
.install((world) => {
  world.addSystem('wave-spawner').setProcess(({ ecs }) => {
    ecs.spawn({ enemy: {...} });                    // auto-scoped to 'playing'
    ecs.commands.spawn({ projectile: {...} });       // also auto-scoped
  });
});
```

For plugins that ship gated systems (waves, summon, projectile, vfx, pickup, etc.): drop manual `{ scope: ... }` tags from internal spawns. Keep them only for entities that should outlive the screen, in which case use `{ scope: null }` to opt out explicitly. Auto-scoping does **not** apply to spawns from `onInitialize` / `onDetach`, plugin `install` bodies, or systems that use only `excludeScreens` — those still need explicit scopes.

## Application System Registration

Use `SystemRegistrarOf<W>` for application modules that only register systems
against the final built world:

```typescript
import type { SystemRegistrarOf } from 'ecspresso';

type GameSystems = SystemRegistrarOf<typeof game>;

function registerMovement(systems: GameSystems): void {
  systems.addSystem('movement')
    .addQuery('moving', {
      with: ['position', 'velocity'],
      mutates: ['position'],
    })
    .setProcess(({ queries, dt }) => { /* ... */ });
}

registerMovement(game);

const gameplaySystems = game.systemScope({
  inScreens: ['playing'],
});
registerMovement(gameplaySystems);
```

The full world structurally satisfies the registrar type. A scoped registrar
captures copied phase, priority, `inScreens`, and `excludeScreens` defaults.
Per-system fluent calls override them. It exposes only `addSystem()`; reactive
queries and other non-system initialization require an explicit full-world
dependency.

| Need | API |
|---|---|
| Reusable feature contributing or requiring types | `definePlugin()` |
| Application system with no shared defaults | Registration function receiving `SystemRegistrarOf<W>`; pass `world` |
| Application systems sharing defaults | `world.systemScope(defaults)` |
| Non-system world initialization | Explicit full-world dependency |

## Using Plugins

```typescript
const ecs = ECSpresso.create()
  .withPlugin(physicsPlugin)
  .withPlugin(renderPlugin)
  .build();
```

Types from plugins merge automatically. Conflicting types (same key, different shape) produce compile errors.

## Required Components

Plugins can declare that one component auto-adds another when present:

```typescript
world.registerRequired('localTransform', 'worldTransform', () => ({
  x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1,
}));
```

Or via the builder: `.withRequired('rigidBody', 'velocity', () => ({ x: 0, y: 0 }))`.

Behavior:
- Enforced at insertion time (`spawn`, `addComponent`, `addComponents`, `spawnChild`, command buffer)
- Transitive: A requires B, B requires C -> all three added
- Circular dependencies detected and rejected at registration time
- Explicit values always win over auto-added defaults

## Built-in Plugins

All are created via factory functions (for example,
`createInputPlugin(options)`). Most system-based plugins accept a `phase`
option for their primary system; inspect the installed version's option type
when a plugin registers multiple systems or is event-driven.

| Plugin | Import Path | Default Phase | Description |
|--------|-------------|---------------|-------------|
| Input | `ecspresso/plugins/input/input` | `preUpdate` | Frame-accurate keyboard/pointer/gamepad input with action mapping; unified actions + per-player maps for local co-op |
| Selection | `ecspresso/plugins/input/selection` | `preUpdate + render` | Pointer-driven click and box selection with renderer-aware visual feedback |
| Timers | `ecspresso/plugins/scripting/timers` | `preUpdate` | ECS-native timers as pure data. One entity carries a named slot map (`timers: { launch: Timer, hangarCycle: Timer, ... }`) so multiple independent phase clocks can coexist. Caller owns despawn — react to `slot.justFinished` or use `onComplete`; the plugin never touches entity lifecycle. Slot names can be typed by passing a string-union generic: `createTimerPlugin<'launch' \| 'hangarCycle'>()` narrows the component to `Partial<Record<Slots, Timer>>`, rejects typo slots at spawn sites, and narrows `slot` in `onComplete`. Defaults to `string` (any slot name) when omitted. Plugins compose: each feature plugin can re-export its slot union and the app assembles them as `createTimerPlugin<FighterSlots \| CarrierSlots>()` |
| Coroutine | `ecspresso/plugins/scripting/coroutine` | `update` | Generator-based coroutines for sequenced logic |
| State Machine | `ecspresso/plugins/scripting/state-machine` | `update` | Per-entity finite state machines |
| Tween | `ecspresso/plugins/scripting/tween` | `update` | Declarative property animation with easing, sequences, loops |
| Physics2D | `ecspresso/plugins/physics/physics2D` | `fixedUpdate` | ECS-native 2D arcade physics |
| Steering | `ecspresso/plugins/physics/steering` | `update` | Move-to-target behavior with arrival detection |
| Transform | `ecspresso/plugins/spatial/transform` | `postUpdate` | Hierarchical 2D transform propagation (local/world) |
| Transform 3D | `ecspresso/plugins/spatial/transform3D` | `postUpdate` | Hierarchical 3D transform propagation with quaternion composition |
| Bounds | `ecspresso/plugins/spatial/bounds` | `postUpdate` | Screen bounds enforcement (destroy, clamp, wrap) |
| Collision | `ecspresso/plugins/physics/collision` | `postUpdate` | Layer-based AABB/circle collision detection with events |
| Collision 3D | `ecspresso/plugins/physics/collision3D` | `postUpdate` | Layer-based AABB3D/sphere collision detection with events |
| Spatial Index | `ecspresso/plugins/spatial/spatial-index` | `fixedUpdate + postUpdate` | Spatial hashing for efficient proximity queries |
| Spatial Index 3D | `ecspresso/plugins/spatial/spatial-index3D` | `fixedUpdate + postUpdate` | 3D spatial hashing for efficient proximity queries and broadphase acceleration |
| Camera | `ecspresso/plugins/spatial/camera` | `postUpdate` | Camera follow, shake, and bounds |
| Camera 3D | `ecspresso/plugins/spatial/camera3D` | `postUpdate` | Orbit/follow/shake controls for a Three.js PerspectiveCamera or OrthographicCamera (`projection: 'perspective' \| 'orthographic'`; state is a discriminated union with `fov`/`setFov` vs `zoom`/`setZoom`; orthographic `minZoom`/`maxZoom` clamp wheel and `setZoom`; `wheelMode`: `'auto'`, `'distance'`, `'zoom'`, `'disabled'`) |
| Physics 3D | `ecspresso/plugins/physics/physics3D` | `fixedUpdate` | Gravity, forces, drag, Euler integration, impulse-based collision response |
| Particles | `ecspresso/plugins/rendering/particles` | `update + render` | Pooled particle system with PixiJS ParticleContainer |
| Sprite Animation | `ecspresso/plugins/rendering/sprite-animation` | `update` | Frame-based sprite animation. Clip + animation set helpers (`defineSpriteAnimation`, `defineSpriteAnimations`) accept any pre-built texture array. **Spritesheet helpers** for PixiJS atlases: `spritesheetLoader<S>(url)` returns an `AssetConfigurator`-compatible loader that resolves to a parsed `Spritesheet<S>` (performs a runtime shape check — non-atlas URLs error at load time, not deep in clipFromSheet); `clipFromSheet(sheet, name, options?)` and `animationSetFromSheet(id, sheet, options?)` build clips/sets directly from the loaded sheet (animation-name union is inferred when the sheet is typed as `Spritesheet<MyAtlasData>`; both throw on empty-frame animations). `clipFromGrid({ source, frameWidth, frameHeight, columns, rows?, count?, indices?, spacing?, margin?, ... })` slices a grid-arranged image without atlas JSON — **async** because pixi.js is imported lazily (keeps the static module graph pixi-free for consumers who only use the sheet helpers); validates inputs (exactly one of `rows`/`count`/`indices` required, indices bounds-checked against `gridTotal` when `rows` is given). **Typed-sheet caveat:** to get literal animation-name inference, declare a concrete `interface MyData extends SpritesheetData { animations: { idle: string[]; walk: string[] } }` and pass it as the `<S>` parameter to `spritesheetLoader` / `Spritesheet<MyData>`. Intersecting inline (`SpritesheetData & { animations: {...} }`) re-widens keys back to `string` because `SpritesheetData.animations` is `Dict<string[]>` — its string index signature dominates the intersection. |
| Tilemap | `ecspresso/plugins/rendering/tilemap` | `render` | Tile-based world data with Tiled JSON loading, runtime construction, query API (`isSolid`/`isOpaque`/`isWalkable`/`buildNavGrid`), and opt-in collision strip generation |
| Audio | `ecspresso/plugins/audio/audio` | `update` | Howler.js audio integration |
| Detection | `ecspresso/plugins/ai/detection` | `update` | Proximity detection with spatial-index, sorted by distance |
| Flocking | `ecspresso/plugins/ai/flocking` | `update` | Boid flocking — separation, alignment, cohesion via force-based steering |
| Behavior Tree | `ecspresso/plugins/ai/behavior-tree` | `update` | Composable priority-driven AI via behavior trees with hybrid traversal. Top-level helpers are blackboard-only; use `ecs.getHelpers(createBehaviorTreeHelpers)` after `.build()` when leaves need app-specific ECS component/resource/event types |
| Pathfinding | `ecspresso/plugins/ai/pathfinding` | `update` | A* on a weighted nav grid; produces waypoints consumed by steering |
| Health | `ecspresso/plugins/combat/health` | (event-driven) | Health/damage/death lifecycle |
| Projectile | `ecspresso/plugins/combat/projectile` | `update` | Homing + linear projectile movement, collision integration |
| Iso Projection | `ecspresso/plugins/isometric/projection` | `render` | Cartesian→isometric coordinate projection, iso camera sync |
| Iso Depth Sort | `ecspresso/plugins/isometric/depth-sort` | `render` | Isometric z-ordering by world position |
| Diagnostics | `ecspresso/plugins/debug/diagnostics` | `render` | Performance monitoring and debug overlay |
| 2D Renderer | `ecspresso/plugins/rendering/renderer2D` | `render` | Automated PixiJS scene graph wiring |
| 3D Renderer | `ecspresso/plugins/rendering/renderer3D` | `render` | Automated Three.js scene graph wiring |
| UI / HUD | `ecspresso/plugins/ui/ui` | `preUpdate + render` | Screen-space HUD primitives — anchored `uiElement`, `uiLabel`, `uiPanel`, `uiProgressBar`, plus `uiButton` / `uiInteractive` / `uiInteraction` / `uiDisabled` with AABB hit-testing and `uiButtonPressed` / `uiButtonHovered` events; `uiMessageLog` rolling buffer of mixed-color `LogFragment[]` lines mutated via the top-level `appendLogLine(ecs, entityId, line)` helper, which publishes `uiLogAppended`. Requires `bounds` from renderer2D and `inputState` from the input plugin; place on a `screenSpaceLayers: ['ui']` layer |

For plugin-specific options, inspect the exported types for the application's
installed ECSpresso version. Repository documentation may describe a newer
release.
