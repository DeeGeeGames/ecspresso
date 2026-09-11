# Systems

## Method Chaining

Systems use a fluent builder API: `world.addSystem().addQuery().setProcess()` — systems are automatically registered via deferred finalization. No explicit termination call is needed.

```typescript
world.addSystem('physics')
  .addQuery('moving', { with: ['position', 'velocity'] })
  .setProcess(({ queries, dt }) => {
    // Physics logic
  });

world.addSystem('rendering')
  .addQuery('visible', { with: ['position', 'sprite'] })
  .setProcess(({ queries }) => {
    // Rendering logic
  });
```

## Application Registration Modules

Use `SystemRegistrarOf<W>` when a module only needs to register systems against
an application's final built world:

```typescript
import type { SystemRegistrarOf } from 'ecspresso';

type GameSystems = SystemRegistrarOf<typeof game>;

export function registerMovement(systems: GameSystems): void {
  systems.addSystem('movement')
    .addQuery('moving', { with: ['position', 'velocity'] })
    .setProcess(({ queries, dt }) => {
      queries.moving.forEach(entity => {
        entity.components.position.x += entity.components.velocity.x * dt;
      });
    });
}

registerMovement(game);
```

The full world structurally satisfies this narrow type. When several
application systems share defaults, create a registrar with snapshotted
defaults:

```typescript
const gameplaySystems = game.systemScope({
  inScreens: ['playing'],
  phase: 'update',
});

registerMovement(gameplaySystems);
registerCombat(gameplaySystems);
```

`systemScope()` snapshots its defaults, including copies of screen arrays.
Direct `game.addSystem()` calls and separate registrars are unaffected.
Per-system fluent calls override captured defaults; `.inScreens([])` clears an
inherited screen gate.

The registrar exposes only `addSystem()`. Pass the full world separately for
reactive queries, resources, entities, navigation, or other initialization.
This keeps application organization distinct from reusable plugin identity and
lifecycle.

## Single-Query Shorthand: `setProcessEach`

For the common case of one query iterated entity-by-entity, `setProcessEach` collapses the query definition, callback wiring, and outer `for…of` into a single chain step:

```typescript
world.addSystem('movement')
  .setProcessEach({ with: ['position', 'velocity'] }, ({ entity, dt }) => {
    entity.components.position.x += entity.components.velocity.x * dt;
    entity.components.position.y += entity.components.velocity.y * dt;
  });
```

The callback receives `{ entity, dt, ecs }`, plus `resources` when `.withResources()` is chained:

```typescript
world.addSystem('bounce')
  .withResources(['bounds'])
  .setProcessEach(
    { with: ['position', 'velocity', 'radius'] },
    ({ entity, dt, resources: { bounds } }) => { /* ... */ },
  );
```

`setProcessEach` is valid only on a builder with zero prior queries or process function — TypeScript narrows `this` to `never` otherwise, and a runtime guard throws for untyped callers. For multi-query systems, keep using `addQuery` + `setProcess`.

The inline query definition accepts the full query shape (`with`, `without`, `optional`, `changed`, `parentHas`). Phase / priority / group / lifecycle chains still compose around it.

## Extracted System Callbacks

Use `SystemProcessFn` and `SystemLifecycleFn` when system callbacks are extracted into named helpers:

```typescript
import type { ConfigOf, QueryDefinition, SystemLifecycleFn, SystemProcessFn } from 'ecspresso';

type GameConfig = ConfigOf<typeof game>;
type MovementQueries = {
  moving: QueryDefinition<GameConfig['components'], 'position' | 'velocity'>;
};

const processMovement: SystemProcessFn<GameConfig, MovementQueries> = function processMovement({ queries, dt }) {
  queries.moving.forEach(entity => {
    entity.components.position.x += entity.components.velocity.x * dt;
  });
};

const initializeMovement: SystemLifecycleFn<GameConfig> = function initializeMovement(ecs) {
  ecs.updateResource('systemStatus', current => ({
    ...current,
    movementReady: true,
  }));
};

game.addSystem('movement')
  .addQuery('moving', { with: ['position', 'velocity'], mutates: ['position'] })
  .setOnInitialize(initializeMovement)
  .setProcess(processMovement);
```

### Keep Processing Dependencies Explicit

Use the `ecs`, `queries`, and `resources` supplied to a system callback. Avoid
importing the application's built world into processing modules to access
components, commands, assets, resources, or screens. Singleton reach-through
hides dependencies and ties otherwise reusable logic to one world instance.

Pass the callback's `ecs` into extracted helpers:

```typescript
type Game = typeof game;

function removeExpiredProjectile(ecs: Game, entityId: number): void {
  ecs.commands.removeEntity(entityId);
}

game.addSystem('projectile-expiry')
  .addQuery('projectiles', { with: ['projectile'] })
  .setProcess(({ ecs, queries }) => {
    queries.projectiles
      .filter(entity => entity.components.projectile.expired)
      .forEach(entity => removeExpiredProjectile(ecs, entity.id));
  });
```

Use `.withResources()` for declared resource dependencies and named queries for
entity dependencies. Injected resource values are refreshed before each process
call, while the containing `resources` object is reused. Direct instance methods
remain appropriate in composition and bootstrap code where the built world
itself is intentionally the subject.

## System Phases

Systems are organized into named execution phases that run in a fixed order:

```
preUpdate → fixedUpdate → update → postUpdate → render
```

Each phase's command buffer is played back before the next phase begins, so entities spawned in `preUpdate` are visible to `fixedUpdate`, and so on. Systems without `.inPhase()` default to `update`.

```typescript
world.addSystem('input')
  .inPhase('preUpdate')
  .setProcess(({ queries, dt, ecs }) => { /* Read input, update timers */ });

world.addSystem('physics')
  .inPhase('fixedUpdate')
  .setProcess(({ queries, dt, ecs }) => {
    // dt is always fixedDt here (e.g. 1/60)
    // Runs 0..N times per frame based on accumulated time
  });

world.addSystem('gameplay')
  .inPhase('update')  // default phase
  .setProcess(({ queries, dt, ecs }) => { /* Game logic, AI */ });

world.addSystem('transform-sync')
  .inPhase('postUpdate')
  .setProcess(({ queries, dt, ecs }) => { /* Transform propagation */ });

world.addSystem('renderer')
  .inPhase('render')
  .setProcess(({ queries, dt, ecs }) => { /* Visual output */ });
```

### Fixed Timestep

The `fixedUpdate` phase uses a time accumulator for deterministic simulation. A spiral-of-death cap (8 steps) prevents runaway accumulation.

```typescript
const world = ECSpresso.create()
  .withComponentTypes<Components>()
  .withEventTypes<Events>()
  .withResourceTypes<Resources>()
  .withFixedTimestep(1 / 60)  // 60Hz physics (default)
  .build();
```

### Interpolation

Use `ecs.interpolationAlpha` (0..1) in the render phase to smooth between fixed steps.

### Runtime Phase Changes

Move systems between phases at runtime with `world.updateSystemPhase('debug-overlay', 'render')`.

## System Priority

Within each phase, systems execute in priority order (higher numbers first). Systems with the same priority execute in registration order:

```typescript
world.addSystem('physics')
  .inPhase('fixedUpdate')
  .setPriority(100) // Runs first within fixedUpdate
  .setProcess(() => { /* physics */ });

world.addSystem('constraints')
  .inPhase('fixedUpdate')
  .setPriority(50)  // Runs second within fixedUpdate
  .setProcess(() => { /* constraints */ });
```

## System Groups

Organize systems into groups that can be enabled/disabled at runtime:

```typescript
world.addSystem('renderSprites')
  .inGroup('rendering')
  .addQuery('sprites', { with: ['position', 'sprite'] })
  .setProcess(({ queries }) => { /* ... */ });

world.addSystem('renderParticles')
  .inGroup('rendering')
  .inGroup('effects')  // Systems can belong to multiple groups
  .setProcess(() => { /* ... */ });

world.disableSystemGroup('rendering');              // All rendering systems skip
world.enableSystemGroup('rendering');               // Resume rendering
world.isSystemGroupEnabled('rendering');            // true/false
world.getSystemsInGroup('rendering');               // ['renderSprites', 'renderParticles']

// If a system belongs to multiple groups, disabling ANY group skips the system
```

Screen gating and group disabling solve different problems. `.inScreens()`
controls a system according to the current screen. Groups coordinate systems
that may come from several plugins or phases, such as gameplay clocks that must
all freeze during pause. Pushing an overlay does not disable groups
automatically; wire that policy through screen enter/resume hooks.

## System Lifecycle

Systems can have initialization, cleanup, and post-update hooks:

```typescript
world.addSystem('gameSystem')
  .setOnInitialize(async (ecs) => {
    console.log('System starting...');
  })
  .setOnDetach((ecs) => {
    console.log('System shutting down...');
  });

await world.initialize();
```

`onDetach` may be asynchronous. Removing one system starts its detach hook
and logs a rejected promise; `await world.dispose()` detaches every
registered system and waits for all asynchronous detach hooks before it
resolves. System event handlers are also removed as part of detachment.
Systems that only declare event handlers are still attached and receive events
whenever their live group, screen, and asset gates allow it; see
[Events](./events.md).

### Entity Enter Callbacks

Register a callback that fires when an entity first matches a query:

```typescript
world.addSystem('onSpawn')
  .addQuery('enemies', { with: ['enemy', 'health'] })
  .setOnEntityEnter('enemies', ({ entity, ecs }) => {
    console.log(`Enemy ${entity.id} entered query`);
  })
  .setProcess(({ queries }) => { /* ... */ });
```

### Post-Update Hooks

Register callbacks that run between the `postUpdate` and `render` phases:

```typescript
// Returns unsubscribe function; multiple hooks run in registration order
const unsubscribe = world.onPostUpdate(({ ecs, dt }) => {
  console.log(`Frame completed in ${dt}s`);
});

unsubscribe();
```
