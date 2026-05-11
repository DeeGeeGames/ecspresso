# Built-in Plugins

| Plugin | Import | Default Phase | Description |
|--------|--------|---------------|-------------|
| **Input** | `ecspresso/plugins/input` | `preUpdate` | Frame-accurate keyboard/pointer input with action mapping |
| **Timers** | `ecspresso/plugins/timers` | `preUpdate` | ECS-native timers as pure data with named slots and caller-owned despawn |
| **Coroutine** | `ecspresso/plugins/coroutine` | `update` | Generator-based coroutines for sequenced logic |
| **State Machine** | `ecspresso/plugins/state-machine` | `update` | Per-entity finite state machines |
| **Tween** | `ecspresso/plugins/tween` | `update` | Declarative property animation with easing, sequences, and loops |
| **Physics2D** | `ecspresso/plugins/physics2D` | `fixedUpdate` | ECS-native 2D arcade physics |
| **Transform** | `ecspresso/plugins/transform` | `postUpdate` | Hierarchical transform propagation (local/world transforms) |
| **Bounds** | `ecspresso/plugins/bounds` | `postUpdate` | Screen bounds enforcement (destroy, clamp, wrap) |
| **Collision** | `ecspresso/plugins/collision` | `postUpdate` | Layer-based AABB/circle collision detection with events |
| **Spatial Index** | `ecspresso/plugins/spatial-index` | `fixedUpdate + postUpdate` | Spatial hashing for efficient proximity queries |
| **Camera** | `ecspresso/plugins/camera` | `postUpdate` | Camera follow, shake, and bounds |
| **Particles** | `ecspresso/plugins/particles` | `update + render` | Pooled particle system with PixiJS ParticleContainer rendering |
| **Sprite Animation** | `ecspresso/plugins/sprite-animation` | `update` | Frame-based sprite animation |
| **Audio** | `ecspresso/plugins/audio` | `update` | Howler.js audio integration |
| **Diagnostics** | `ecspresso/plugins/diagnostics` | `render` | Performance monitoring and debug overlay |
| **2D Renderer** | `ecspresso/plugins/renderers/renderer2D` | `render` | Automated PixiJS scene graph wiring |

Each plugin accepts a `phase` option to override its default.

## Input Plugin

The input plugin provides frame-accurate keyboard, pointer (mouse + touch via PointerEvent), gamepad, and named action mapping. It's a resource-only plugin — input is polled via the `inputState` resource. DOM events are accumulated between frames and snapshotted once per frame; gamepads are polled once per frame via `navigator.getGamepads()`. All systems see consistent state within a frame.

```typescript
import {
  createInputPlugin,
  gamepadButtonsOn, gamepadAxisOn,
  type InputResourceTypes, type KeyCode
} from 'ecspresso/plugins/input';

const world = ECSpresso.create()
  .withPlugin(createInputPlugin({
    actions: {
      jump: { keys: [' ', 'ArrowUp'], gamepadButtons: gamepadButtonsOn(0, 0) },
      shoot: { keys: ['z'], pointerButtons: [0], gamepadButtons: gamepadButtonsOn(0, 7) },
      moveLeft: { keys: ['a', 'ArrowLeft'], gamepadAxes: [gamepadAxisOn(0, 0, -1)] },
      moveRight: { keys: ['d', 'ArrowRight'], gamepadAxes: [gamepadAxisOn(0, 0, 1)] },
    },
  }))
  .build();

// In a system:
const input = ecs.getResource('inputState');
if (input.actions.justActivated('jump')) { /* ... */ }
if (input.keyboard.isDown('ArrowRight')) { /* ... */ }
if (input.pointer.justPressed(0)) { /* ... */ }
if (input.gamepads[0].isDown(0)) { /* raw pad 0 A-button */ }

// Runtime remapping — must include all configured actions
input.setActionMap({
  jump: { keys: ['w'] },
  shoot: { keys: ['z'], pointerButtons: [0] },
  moveLeft: { keys: ['a'] },
  moveRight: { keys: ['d'] },
});
```

Action names are type-safe — `isActive`, `justActivated`, `justDeactivated`, `setActionMap`, and `getActionMap` only accept action names from the config. The type parameter `A` is inferred from the `actions` object keys passed to `createInputPlugin`. Defaults to `string` when no actions are configured.

Key values use the `KeyCode` type — a union of all standard `KeyboardEvent.key` values — providing autocomplete and compile-time validation. Note that the space bar key is `' '` (a space character), not `'Space'`.

### Gamepad

`inputState.gamepads` is always length 4 (the standard Web Gamepad API slot count). Disconnected slots return `connected: false`, `id: null`, and zero for all reads — safe to read unconditionally. Button indices follow the standard mapping (0 = A/cross, 1 = B/circle, 7 = RT, etc). Axes 0,1 are the left stick; 2,3 are the right stick.

Stick pairs get a radial deadzone (default 0.15) — tuple magnitude below the deadzone reads as (0, 0), preserving stick direction above it. Raw values are available via `rawAxis(i)`. Triggers are buttons with analog values accessible via `buttonValue(i)`.

Actions bind to gamepad inputs via `gamepadButtons` (digital) and `gamepadAxes` (directional, threshold-based):

```typescript
actions: {
  jump: { gamepadButtons: [{ pad: 0, button: 0 }] },
  aim: { gamepadAxes: [{ pad: 0, axis: 2, direction: 1, threshold: 0.3 }] },
}
// Or via helpers:
actions: {
  jump: { gamepadButtons: gamepadButtonsOn(0, 0) },
  aim: { gamepadAxes: [gamepadAxisOn(0, 2, 1, 0.3)] },
}
```

To override the deadzone or inject a custom poll (for testing):

```typescript
createInputPlugin({
  gamepad: { deadzone: 0.2, poll: () => myMockGamepads },
})
```

### Multi-player action maps

Unified `inputState.actions` fires when *any* bound source does — ideal for menus or single-player-with-optional-pad. For local co-op, register per-player action maps that compute independently:

```typescript
createInputPlugin({
  actions: { pause: { keys: ['Escape'] } },        // unified — any source
  players: {
    p1: {
      jump: { keys: [' '] },
      shoot: { keys: ['z'] },
    },
    p2: {
      jump: { gamepadButtons: gamepadButtonsOn(0, 0) },
      shoot: { gamepadButtons: gamepadButtonsOn(0, 2) },
    },
  },
})

// In a system:
if (input.actions.justActivated('pause')) { /* menu */ }
if (input.player('p1')?.actions.isActive('jump')) { /* P1 jumps */ }
if (input.player('p2')?.actions.isActive('jump')) { /* P2 jumps */ }
```

Register a player at runtime with `input.definePlayer(id, map)`; remove with `input.removePlayer(id)`. Each player has its own `setActionMap` / `getActionMap` via `input.player(id)`. Per-player action states are fully isolated from the unified `actions`.

### Pointer coordinate conversion

By default `inputState.pointer.position` reports raw `clientX` / `clientY` from the DOM event — viewport-relative, not canvas-relative, and not aware of any renderer scaling. Pass `coordinateTransform` to convert pointer coordinates into whatever space your systems expect. The option is renderer-agnostic: wire it to `clientToLogical(...)` from renderer2D when using `screenScale`, or to an equivalent helper from another renderer.

```typescript
import { createInputPlugin } from 'ecspresso/plugins/input';
import {
  createRenderer2DPlugin, clientToLogical, type ViewportScale,
} from 'ecspresso/plugins/renderers/renderer2D';

// The renderer's canvas and viewportScale resource only exist after initialize().
// The closure captures these lazily — pointer events don't fire until after init.
let canvas: HTMLCanvasElement | null = null;
let viewport: ViewportScale | null = null;

const ecs = ECSpresso.create()
  .withPlugin(createRenderer2DPlugin({
    background: '#1a1a2e',
    screenScale: { width: 1920, height: 1080, mode: 'fit' },
  }))
  .withPlugin(createInputPlugin({
    coordinateTransform: (clientX, clientY) => {
      if (!canvas || !viewport) return { x: clientX, y: clientY };
      return clientToLogical(clientX, clientY, canvas, viewport);
    },
  }))
  .build();

await ecs.initialize();
canvas = ecs.getResource('pixiApp').canvas;
viewport = ecs.getResource('viewportScale');
```

After this wiring, `inputState.pointer.position` reports logical design-space coordinates, so gameplay code can ignore window size and viewport layout entirely.

### Suppressing browser defaults

Some keys and pointer buttons trigger browser behaviour that interferes with games — `Tab` moves focus, `Space` scrolls the page, right-click opens a context menu, left-click causes text selection. Pass `preventDefaultKeys` and/or `preventDefaultPointerButtons` to suppress these:

```typescript
createInputPlugin({
  preventDefaultKeys: ['Tab', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'],
  preventDefaultPointerButtons: [0, 2], // left and right mouse buttons
})
```

For full control, supply a `shouldPreventDefault` predicate instead. When provided it replaces the array logic entirely — the arrays are ignored:

```typescript
createInputPlugin({
  shouldPreventDefault: (e) => {
    // Suppress Tab everywhere; suppress left-click only outside form elements
    if (e instanceof KeyboardEvent) return e.key === 'Tab';
    const target = e.target as Element;
    return e.button === 0 && target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA';
  },
})
```

`preventDefault` is called on both the down and up events for the matched key or button.

## 2D Renderer Plugin

The 2D renderer plugin wires a PixiJS `Application` to the ECS scene graph: transforms propagate from ECS components to PixiJS display objects, entity hierarchy mirrors into the scene graph, and a render sync system updates visuals each frame. Full option surface lives in `src/plugins/renderers/renderer2D.ts`; this section covers screen scaling, which is what most examples need to opt into a fixed design resolution.

### Screen scaling

Set `screenScale` to pin a logical design resolution. The renderer wraps its root container in a scaled `viewportContainer` so all gameplay systems work in design coordinates while the visible canvas adapts to the window. Three modes:

- `fit` — letterbox: preserves aspect ratio, fits entirely inside the window, leaves gaps on the short axis
- `cover` — preserves aspect ratio, fills the window completely, crops on the long axis
- `stretch` — non-uniform scale, always fills, distorts aspect ratio

```typescript
import { createRenderer2DPlugin } from 'ecspresso/plugins/renderers/renderer2D';

const ecs = ECSpresso.create()
  .withPlugin(createRenderer2DPlugin({
    background: '#1a1a2e',
    screenScale: { width: 1920, height: 1080, mode: 'fit' },
  }))
  .build();
```

Managed-mode canvas sizing: the canvas is appended to `container` (defaults to `document.body`) and auto-resizes to match it. Pass top-level `width`/`height` for a fixed-size canvas — the resizeTo default is suppressed automatically. If you need the canvas to size to something other than its DOM parent, set `pixiInit.resizeTo` directly.

When `screenScale` is set, the plugin also installs a `viewportScale` resource carrying the current `scaleX` / `scaleY`, `offsetX` / `offsetY`, `physicalWidth` / `physicalHeight`, `mode`, and the original `designWidth` / `designHeight`. Systems that need to place screen-space overlays or convert coordinates can read from this resource.

### Pointer coordinate conversion

`clientToLogical(clientX, clientY, canvas, viewport)` converts a DOM `PointerEvent`'s client coordinates into design-resolution coordinates, accounting for the canvas's position in the viewport, CSS-pixel → physical-pixel scaling, and the letterbox / crop offsets introduced by the scale mode. Wire it into the input plugin's `coordinateTransform` option (see the Input Plugin section above) to make `inputState.pointer.position` report logical coordinates directly. See the `20-viewport-scaling` example for a complete demonstration.

### Runtime mode changes

The `mode` field on `viewportScale` is mutable. To switch modes at runtime, assign a new mode and call `reapplyViewportScale(pixiApp)` to recompute and apply immediately without waiting for a window resize:

```typescript
import { reapplyViewportScale } from 'ecspresso/plugins/renderers/renderer2D';

const viewport = ecs.getResource('viewportScale');
const pixiApp = ecs.getResource('pixiApp');

viewport.mode = 'cover';
reapplyViewportScale(pixiApp);
```

## Timer Plugin

The timer plugin provides ECS-native timers as pure data. Each entity carries a single `timers` component whose value is a map of named slots — one entity can host multiple independent phase clocks (e.g. a fighter's launch window, a carrier's shield-depletion lockout and hangar cycle on the same entity). The plugin's update system ticks every slot each frame and never touches entity lifecycle: react to `slot.justFinished` in a system or use the slot's `onComplete` callback, and despawn the host yourself if needed.

```typescript
import {
  createTimerPlugin, createTimer, createRepeatingTimer,
  type TimerComponentTypes, type TimerEventData
} from 'ecspresso/plugins/timers';

const world = ECSpresso
  .create()
  .withPlugin(createTimerPlugin())
  .withComponentTypes<{ fighter: true; carrier: true }>()
  .build();

// One slot per phase — `createTimer` / `createRepeatingTimer` return a bare
// `Timer` value that the caller drops into a named slot.
world.spawn({
  fighter: true,
  timers: { launch: createTimer(2.0) },
});

// Multiple independent slots on a single entity.
world.spawn({
  carrier: true,
  timers: {
    shieldDepletion: createTimer(8.0),
    hangarCycle: createRepeatingTimer(5.0),
  },
});

// onComplete receives `{ entityId, slot, duration, elapsed }`. The plugin
// does not despawn the host — if a slot's lifetime equals the entity's
// (vfx, blasts), do it yourself in the callback.
world.spawn({
  timers: {
    fade: createTimer(1.0, {
      onComplete: ({ entityId }) => world.commands.removeEntity(entityId),
    }),
  },
});
```

Reading slot state in a system uses bracket access (the default `timers` map is an index signature, so `noPropertyAccessFromIndexSignature` blocks dot syntax):

```typescript
world.addSystem('launch-on-finish')
  .addQuery('fighters', { with: ['timers', 'fighter'] })
  .setProcess(({ queries }) => {
    for (const { components } of queries.fighters) {
      if (components.timers['launch']?.justFinished) {
        // launch-window expired this frame
      }
    }
  });
```

Each `Timer` exposes `elapsed`, `duration`, `repeat`, `active`, `justFinished`, and optional `onComplete` for runtime control. Completed one-shot slots remain on the entity with `active = false` — they're idle data and cost nothing per frame, but the host keeps them until you remove the slot or despawn the entity.

### Typed slot names

`createTimerPlugin` accepts an optional string-union generic that names every slot the world is allowed to use. The component is then typed as `Partial<Record<Slots, Timer<Slots>>>`, so spawn sites reject typo slots, autocomplete works on slot access, and `slot` is narrowed to the union inside `onComplete`. Omitted, it defaults to `string` (any slot name) and the existing behavior is unchanged.

```typescript
const world = ECSpresso
  .create()
  .withPlugin(createTimerPlugin<'launch' | 'shieldDepletion' | 'hangarCycle'>())
  .build();

world.spawn({ timers: { launch: createTimer(2.0) } });        // ok
world.spawn({ timers: { typo:   createTimer(2.0) } });        // type error
```

The union is world-global, not per-archetype: any entity with a `timers` component sees every declared slot as a valid (optional) key. Type safety here means "no typos, autocomplete works," not "this slot only belongs on fighters."

Only one timer plugin can be installed per world (plugins are keyed by name), so feature plugins should re-export their slot union as a type and the app assembles them at install time:

```typescript
// fighter-plugin.ts
export type FighterTimerSlots = 'launch' | 'reload';

// carrier-plugin.ts
export type CarrierTimerSlots = 'shieldDepletion' | 'hangarCycle';

// main.ts
const world = ECSpresso
  .create()
  .withPlugin(createTimerPlugin<FighterTimerSlots | CarrierTimerSlots>())
  .withPlugin(fighterPlugin())
  .withPlugin(carrierPlugin())
  .build();
```

## Collision Plugin

The collision plugin detects overlaps between entities with `aabbCollider` or `circleCollider` components and publishes `collision` events. It's event-only — it never mutates position or velocity. Use it for gameplay hit detection; pair it with the physics2D plugin when you also want impulse response.

Collision pairs are filtered by layer. `defineCollisionLayers` declares the layer graph once and produces typed factory helpers plus a `Layer` type that flows through event subscribers and pair handlers.

```typescript
import {
  createCollisionPlugin,
  createAABBCollider, createCircleCollider,
  defineCollisionLayers, createCollisionPairHandler,
  type LayersOf,
} from 'ecspresso/plugins/collision';
import { createTransformPlugin, createTransform } from 'ecspresso/plugins/transform';

const layers = defineCollisionLayers({
  player: ['enemy', 'pickup'],
  enemy: ['player'],
  pickup: [],
});
type Layer = LayersOf<typeof layers>;

const ecs = ECSpresso.create()
  .withPlugin(createTransformPlugin())
  .withPlugin(createCollisionPlugin({ layers }))
  .build();

ecs.spawn({
  ...createTransform(100, 100),
  ...createAABBCollider(50, 50),
  ...layers.player(),
});

ecs.spawn({
  ...createTransform(120, 120),
  ...createCircleCollider(20),
  ...layers.enemy(),
});

// Route pairs to layer-specific handlers
type ECS = typeof ecs;
const onCollide = createCollisionPairHandler<ECS, Layer>({
  'player:enemy': (playerId, enemyId, world) => {
    world.commands.removeEntity(enemyId);
  },
  'player:pickup': (playerId, pickupId, world) => {
    world.commands.removeEntity(pickupId);
  },
});
ecs.eventBus.subscribe('collision', (data) => onCollide({ data, ecs }));
```

`collision` events carry `entityA`, `entityB`, `layerA`, `layerB`, and flat contact fields `normalX` / `normalY` / `depth`. The normal points from A toward B. Declaring `"a:b"` in a pair handler automatically also handles `(layerA=b, layerB=a)` with the entity arguments swapped so the declared key order holds.

Collider positions are read from `worldTransform`, so hierarchical parents and offsets work correctly. Optional `offsetX` / `offsetY` on the collider itself shifts the collision shape relative to the entity's transform.

Without a spatial index installed, the collision system uses O(N²) brute-force pair testing. Install `createSpatialIndexPlugin()` for broadphase acceleration — see the Spatial Index section below.

## Physics2D Plugin

The physics2D plugin provides ECS-native 2D arcade physics: gravity, forces, drag, semi-implicit Euler integration, and impulse-based collision response with restitution and friction. It reuses the collider types from the collision plugin and runs in `fixedUpdate` so timestep is deterministic.

```typescript
import {
  createPhysics2DPlugin, createRigidBody, applyForce, applyImpulse,
} from 'ecspresso/plugins/physics2D';
import {
  createAABBCollider, defineCollisionLayers,
} from 'ecspresso/plugins/collision';
import { createTransformPlugin, createTransform } from 'ecspresso/plugins/transform';

const layers = defineCollisionLayers({
  ball: ['ball', 'wall'],
  wall: ['ball'],
});

const ecs = ECSpresso.create()
  .withPlugin(createTransformPlugin())
  .withPlugin(createPhysics2DPlugin({ gravity: { x: 0, y: 980 }, layers }))
  .withFixedTimestep(1 / 60)
  .build();

// Dynamic body — gravity, forces, and collision response all apply
ecs.spawn({
  ...createTransform(100, 50),
  ...createRigidBody('dynamic', { mass: 1, restitution: 0.6, friction: 0.2 }),
  velocity: { x: 0, y: 0 },
  ...createAABBCollider(20, 20),
  ...layers.ball(),
});

// Static body — immovable, mass automatically set to Infinity
ecs.spawn({
  ...createTransform(400, 600),
  ...createRigidBody('static'),
  velocity: { x: 0, y: 0 },
  ...createAABBCollider(800, 20),
  ...layers.wall(),
});

// Accumulate a force inside a system:
applyForce(ecs, entityId, 0, -500);
// Or apply an instantaneous impulse:
applyImpulse(ecs, entityId, 100, 0);
```

Body types: `'dynamic'` (fully simulated), `'kinematic'` (moves via velocity only, ignores gravity and collision response), `'static'` (immovable). `rigidBody` auto-creates `velocity` and `force` components via required-component registration, so you only need to spread `createRigidBody(...)` plus an explicit `velocity` if you want a non-zero initial value.

`physicsCollision` events carry `entityA`, `entityB`, and flat contact fields `normalX` / `normalY` / `depth`. Collision response happens before the event fires, so subscribers observe post-impulse state.

The collision system can be placed in an additional group via `collisionSystemGroup`, which lets you toggle collision detection on/off independently of integration. Like the collision plugin, physics2D benefits from `createSpatialIndexPlugin()` for anything beyond a handful of bodies.

## Spatial Index Plugin

The spatial index plugin provides a uniform-grid spatial hash that accelerates collision detection and proximity queries. Installing it alongside `createCollisionPlugin()` or `createPhysics2DPlugin()` automatically switches them from O(N²) brute-force to a broadphase + narrowphase pipeline — no other code changes required.

```typescript
import { createSpatialIndexPlugin } from 'ecspresso/plugins/spatial-index';

const ecs = ECSpresso.create()
  .withPlugin(createTransformPlugin())
  .withPlugin(createCollisionPlugin({ layers }))
  .withPlugin(createSpatialIndexPlugin({ cellSize: 64 }))
  .withFixedTimestep(1 / 60)
  .build();

// Proximity queries from any system:
const si = ecs.getResource('spatialIndex');
const nearbyIds = si.queryRadius(playerX, playerY, 200);
const inRect = si.queryRect(minX, minY, maxX, maxY);
```

Options:

- `cellSize` (default `64`) — roughly 1–2× the size of a typical collider. Too small wastes memory on empty cells; too large collapses the broadphase back toward brute force.
- `phases` (default `['fixedUpdate', 'postUpdate']`) — when to rebuild the grid. `fixedUpdate` is required for physics2D; `postUpdate` is required for the collision plugin's default phase. Limit to one phase if you only use one plugin.
- `priority` (default `2000`) — runs before collision detection (priority `0`) so each consumer sees a freshly rebuilt grid.

Steady-state rebuilds allocate zero `SpatialEntry` objects and zero cell buckets — both are pooled in place across frames. Rebuild cost is proportional to the number of colliders, not the world size.

Besides accelerating collision, the `spatialIndex` resource exposes `queryRect`, `queryRadius`, and the out-parameter variants `queryRectInto` / `queryRadiusInto` (write into a caller-owned `Set<number>`, zero allocations per call) for game-logic proximity checks.
