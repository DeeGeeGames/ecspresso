# ECSpresso Plugins

## Defining Plugins

Plugins group related systems, resources, and component types. Two approaches: **canonical `definePlugin`** (the default — each plugin declares the types it contributes) and **`pluginFactory()`** (a lighter-weight variant for plugins that only *consume* existing world state). The choice is per-plugin and largely irreversible — read [Choosing between the two](#choosing-between-the-two) before picking.

### 1. Canonical `definePlugin` (the default)

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
      .addQuery('moving', { with: ['position', 'velocity'] })
      .setProcess(({ queries, dt }) => {
        for (const entity of queries.moving) {
          entity.components.position.x += entity.components.velocity.x * dt;
          entity.components.position.y += entity.components.velocity.y * dt;
        }
      });
  });
```

`install` receives `(world, onCleanup)`. `onCleanup(fn)` registers a disposer that runs (in reverse order) when `world.uninstallPlugin(id)` or `world.dispose()` is called. Declaring just `(world) => { ... }` is still valid — the second parameter is optional.

The builder mirrors `ECSpresso.create()`:
- `.withComponentTypes<T>()`, `.withEventTypes<T>()`, `.withResourceTypes<T>()`, `.withAssetTypes<T>()`, `.withScreenTypes<T>()` — declare types this plugin provides
- `.withLabels<L>()`, `.withGroups<G>()`, `.withReactiveQueryNames<N>()` — declare system labels, groups, and reactive query names
- `.requires<W>()` — declare dependency on another plugin's `WorldConfig` type (e.g., `TransformWorldConfig`)
- `.setSystemDefaults({ phase?, priority?, inScreens?, excludeScreens? })` — defaults applied to every `world.addSystem(...)` called inside `install`. Per-system builder calls (`.inPhase`, `.setPriority`, `.inScreens`, `.excludeScreens`) override. Calling again replaces wholesale.
- `.install(fn)` — terminal, returns the finalized `Plugin` object

### Plugin-level system defaults

When every system in a plugin shares the same gating, hoist it onto the plugin instead of repeating it per system:

```typescript
const combat = definePlugin('combat')
  .withScreenTypes<{ playing: { initialState: () => {} } }>()
  .setSystemDefaults({ inScreens: ['playing'], phase: 'update' })
  .install((world) => {
    // Both systems inherit inScreens: ['playing'] and phase: 'update'
    world.addSystem('projectile-integrate').setPriority(300)
      .addQuery('projectiles', { with: ['projectile'] })
      .setProcess(() => { /* ... */ });

    // Per-system calls override the default for that system only
    world.addSystem('damage-numbers-hud').inPhase('render')
      .setProcess(() => { /* runs in render phase, still gated to 'playing' */ });
  });
```

To *opt out* of a default screen gate on a single system, pass an empty array: `.inScreens([])` runs the system regardless of active screen.

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

### 2. `pluginFactory()` (lighter-weight, type-frozen)

`builder.pluginFactory()` returns a `definePlugin` that closes over the builder's accumulated world types, so plugins authored with it skip the per-plugin `.withComponentTypes<>()` ceremony and `world` is already typed inside `install`. **The cost: plugins authored this way cannot contribute new component / event / resource types** — every new type must land back in the central builder.

```typescript
// types.ts
export const builder = ECSpresso.create()
  .withPlugin(createPhysicsPlugin())
  .withComponentTypes<{ player: boolean; enemy: EnemyData }>()
  .withResourceTypes<{ score: number }>();

export const definePlugin = builder.pluginFactory();

// movement-plugin.ts
import { definePlugin } from './types';

export const movementPlugin = definePlugin({
  id: 'movement',
  install(world) {
    world.addSystem('movement')
      .addQuery('moving', { with: ['position', 'velocity'] })
      .setProcess(({ queries, dt }) => { /* ... */ });
  },
});
```

### Choosing between the two

**Heuristic:**

- **Use canonical `definePlugin`** if the plugin's existence implies new state — turrets, shields, hangars, physics, anything where adopting the plugin means new components / events / resources exist in the world. This is the right default for real games and apps where features keep landing.
- **Use `pluginFactory()`** only for plugins that purely *consume* existing world state — UI overlays, debug huds, glue code, demo scaffolding. Or for small projects / examples where the full type set is known up front and won't grow.

The two patterns are mutually exclusive **per plugin** — there is no variant of `pluginFactory` that both closes over the world type *and* lets the plugin contribute new types. A project can mix both styles across different plugins, but a single plugin commits to one.

| | Canonical `definePlugin('id').withComponentTypes<>()…` | `builder.pluginFactory()` |
|---|---|---|
| Plugin can add new components / events / resources | Yes — types merge into the world via `withPlugin` | **No** — world config is frozen at factory creation |
| `world` is pre-typed inside `install` | Only with the types the plugin declared (+ `requires<>()`) | Yes, full world type already available |
| Where new component/event types must land | Inside the plugin file | Back in the central `types.ts` builder chain |
| Best for | Feature plugins that introduce state | Consumer plugins (UI/debug/glue), demos, fixed-scope apps |

**The trap (irreversible-ish):** adopting `pluginFactory()` for ergonomics and *then* trying to add a new component from inside a plugin will silently force you back into the central types file. As the project grows, `types.ts` becomes the contention point for every new feature. Migrating later means rewriting every feature plugin's signature. If you're unsure, default to canonical `definePlugin` — the per-plugin `.withComponentTypes<>()` ceremony is a small cost, and you can mix in `pluginFactory()` later for genuine consumer plugins.

If you've already committed to `pluginFactory()` and `types.ts` is bloating, the cheapest mitigation is to split component / event / resource interfaces into per-feature files and aggregate them at the central builder via `&` — see [SKILL.md — Scaling the type registry](SKILL.md#scaling-the-type-registry).

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

All are created via factory functions (e.g., `createInputPlugin(options)`). Each accepts a `phase` option to override the default.

| Plugin | Import Path | Default Phase | Description |
|--------|-------------|---------------|-------------|
| Input | `ecspresso/plugins/input` | `preUpdate` | Frame-accurate keyboard/pointer/gamepad input with action mapping; unified actions + per-player maps for local co-op |
| Timers | `ecspresso/plugins/timers` | `preUpdate` | ECS-native timers as pure data. One entity carries a named slot map (`timers: { launch: Timer, hangarCycle: Timer, ... }`) so multiple independent phase clocks can coexist. Caller owns despawn — react to `slot.justFinished` or use `onComplete`; the plugin never touches entity lifecycle |
| Coroutine | `ecspresso/plugins/coroutine` | `update` | Generator-based coroutines for sequenced logic |
| State Machine | `ecspresso/plugins/state-machine` | `update` | Per-entity finite state machines |
| Tween | `ecspresso/plugins/tween` | `update` | Declarative property animation with easing, sequences, loops |
| Physics2D | `ecspresso/plugins/physics2D` | `fixedUpdate` | ECS-native 2D arcade physics |
| Transform | `ecspresso/plugins/transform` | `postUpdate` | Hierarchical 2D transform propagation (local/world) |
| Transform 3D | `ecspresso/plugins/spatial/transform3D` | `postUpdate` | Hierarchical 3D transform propagation with quaternion composition |
| Bounds | `ecspresso/plugins/bounds` | `postUpdate` | Screen bounds enforcement (destroy, clamp, wrap) |
| Collision | `ecspresso/plugins/collision` | `postUpdate` | Layer-based AABB/circle collision detection with events |
| Collision 3D | `ecspresso/plugins/physics/collision3D` | `postUpdate` | Layer-based AABB3D/sphere collision detection with events |
| Spatial Index | `ecspresso/plugins/spatial-index` | `fixedUpdate + postUpdate` | Spatial hashing for efficient proximity queries |
| Spatial Index 3D | `ecspresso/plugins/spatial/spatial-index3D` | `fixedUpdate + postUpdate` | 3D spatial hashing for efficient proximity queries and broadphase acceleration |
| Camera | `ecspresso/plugins/camera` | `postUpdate` | Camera follow, shake, and bounds |
| Camera 3D | `ecspresso/plugins/spatial/camera3D` | `postUpdate` | Orbit/follow/shake controls for a Three.js PerspectiveCamera or OrthographicCamera (`projection: 'perspective' \| 'orthographic'`; state is a discriminated union with `fov`/`setFov` vs `zoom`/`setZoom`) |
| Physics 3D | `ecspresso/plugins/physics/physics3D` | `fixedUpdate` | Gravity, forces, drag, Euler integration, impulse-based collision response |
| Particles | `ecspresso/plugins/particles` | `update + render` | Pooled particle system with PixiJS ParticleContainer |
| Sprite Animation | `ecspresso/plugins/sprite-animation` | `update` | Frame-based sprite animation |
| Tilemap | `ecspresso/plugins/rendering/tilemap` | `render` | Tile-based world data with Tiled JSON loading, runtime construction, query API (`isSolid`/`isOpaque`/`isWalkable`/`buildNavGrid`), and opt-in collision strip generation |
| Audio | `ecspresso/plugins/audio` | `update` | Howler.js audio integration |
| Detection | `ecspresso/plugins/ai/detection` | `update` | Proximity detection with spatial-index, sorted by distance |
| Flocking | `ecspresso/plugins/ai/flocking` | `update` | Boid flocking — separation, alignment, cohesion via force-based steering |
| Behavior Tree | `ecspresso/plugins/ai/behavior-tree` | `update` | Composable priority-driven AI via behavior trees with hybrid traversal |
| Pathfinding | `ecspresso/plugins/ai/pathfinding` | `update` | A* on a weighted nav grid; produces waypoints consumed by steering |
| Health | `ecspresso/plugins/combat/health` | (event-driven) | Health/damage/death lifecycle |
| Projectile | `ecspresso/plugins/combat/projectile` | `update` | Homing + linear projectile movement, collision integration |
| Iso Projection | `ecspresso/plugins/isometric/projection` | `render` | Cartesian→isometric coordinate projection, iso camera sync |
| Iso Depth Sort | `ecspresso/plugins/isometric/depth-sort` | `render` | Isometric z-ordering by world position |
| Diagnostics | `ecspresso/plugins/diagnostics` | `render` | Performance monitoring and debug overlay |
| 2D Renderer | `ecspresso/plugins/renderers/renderer2D` | `render` | Automated PixiJS scene graph wiring |
| 3D Renderer | `ecspresso/plugins/rendering/renderer3D` | `render` | Automated Three.js scene graph wiring |
| UI / HUD | `ecspresso/plugins/ui/ui` | `preUpdate + render` | Screen-space HUD primitives — anchored `uiElement`, `uiLabel`, `uiPanel`, `uiProgressBar`, plus `uiButton` / `uiInteractive` / `uiInteraction` / `uiDisabled` with AABB hit-testing and `uiButtonPressed` / `uiButtonHovered` events; `uiMessageLog` rolling buffer of mixed-color `LogFragment[]` lines mutated via the top-level `appendLogLine(ecs, entityId, line)` helper, which publishes `uiLogAppended`. Requires `bounds` from renderer2D and `inputState` from the input plugin; place on a `screenSpaceLayers: ['ui']` layer |

For plugin-specific options and API details, see `docs/built-in-plugins.md`.
