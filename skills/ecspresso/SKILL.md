---
name: ecspresso
description: Guide for using the ECSpresso ECS library in TypeScript projects
---

# ECSpresso — ECS Library Skill

ECSpresso is a type-safe Entity-Component-System library for TypeScript. This skill provides the essential patterns and signatures needed to write correct ECSpresso code.

For full API details, see [api-reference.md](api-reference.md).
For plugin definition and built-in plugin catalog, see [plugins.md](plugins.md).
For deeper reference on any topic, see the `docs/` directory in the ECSpresso package.

## Mental Model

- **Entities** are numeric IDs with attached components.
- **Components** are plain data objects (no behavior). Defined as TypeScript interfaces.
- **Systems** run each frame, processing entities that match component queries.
- **Resources** are global singletons accessible to any system.
- **Events** provide decoupled pub/sub between systems.
- **Plugins** group related systems, resources, and component types for reuse.
- **Command Buffer** queues structural changes (spawn, remove, add component) for safe execution between phases.

### Frame Lifecycle

```
preUpdate -> fixedUpdate (0..N times) -> update -> postUpdate -> render
```

Command buffers are flushed between each phase. Entities spawned in `preUpdate` are visible to `fixedUpdate`, etc.

## World Setup — Builder Pattern

The builder accumulates types automatically. Never pass explicit type params when the builder can infer them.

```typescript
import ECSpresso from 'ecspresso';

const ecs = ECSpresso.create()
  .withPlugin(somePlugin)                        // merge plugin types
  .withComponentTypes<{                          // type-level only, no runtime cost
    position: { x: number; y: number };
    velocity: { x: number; y: number };
    health: number;
  }>()
  .withEventTypes<{
    playerDied: { playerId: number };
  }>()
  .withResourceTypes<{                           // declare types for resources added later
    score: { value: number };
  }>()
  .withResource('score', { value: 0 })           // add resource with value
  .withResource('config', () => loadConfig())    // or with factory
  .withFixedTimestep(1 / 60)                     // optional, default is 1/60
  .build();

// Derive the world type for use elsewhere
type ECS = typeof ecs;
```

### Builder Methods

| Method | Purpose |
|--------|---------|
| `.withPlugin(plugin)` | Install a plugin, merge its types |
| `.withComponentTypes<T>()` | Declare component types (type-level only) |
| `.withEventTypes<T>()` | Declare event types (type-level only) |
| `.withResourceTypes<T>()` | Declare resource types (type-level only) |
| `.withResource(key, value \| factory)` | Add a resource with value or factory |
| `.withRequired(trigger, required, factory)` | Auto-add component when trigger is present |
| `.withDispose(componentName, callback)` | Register cleanup on component removal |
| `.withAssets(configurator)` | Configure asset loading |
| `.withScreens(configurator)` | Configure screen/state management |
| `.withFixedTimestep(dt)` | Set fixed timestep interval |
| `.build()` | Create the ECSpresso instance |

### Scaling the type registry

The single inline `withComponentTypes<{...}>()` block above is fine for small projects and examples. For a real game where features keep introducing new components, decide *now* whether feature plugins will contribute their own types — that choice has cascading consequences and is hard to reverse later. See [plugins.md — Choosing between the two](plugins.md#choosing-between-the-two) before committing.

When keeping a central registry (i.e., not using canonical `definePlugin` per feature), prefer per-feature interface files aggregated at the builder, rather than declaring everything inline:

```typescript
// src/turrets/types.ts
export interface TurretComponents {
  turret: TurretComponent;
  beamTurret: BeamTurretComponent;
}
export interface TurretEvents { 'turret:fired': { id: number } }

// src/types.ts
import type { TurretComponents, TurretEvents } from './turrets/types';
import type { HangarComponents } from './hangar/types';

export const builder = ECSpresso.create()
  .withComponentTypes<TurretComponents & HangarComponents & /* ... */>()
  .withEventTypes<TurretEvents & /* ... */>();
```

This keeps `types.ts` a thin aggregator and lets features own their interfaces.

## Systems

Systems use a fluent builder API. They are automatically registered — no explicit termination call needed.

### Process Callback Signature

**The callback receives a single destructured context object**, not positional arguments:

```typescript
ecs.addSystem('movement')
  .addQuery('moving', { with: ['position', 'velocity'] })
  .setProcess(({ queries, dt, ecs }) => {
    for (const entity of queries.moving) {
      entity.components.position.x += entity.components.velocity.x * dt;
      entity.components.position.y += entity.components.velocity.y * dt;
    }
  });
```

Context fields: `{ queries, dt, ecs }`. When `.withResources()` is used, `resources` is also available:

```typescript
ecs.addSystem('scoring')
  .withResources(['score', 'config'])
  .setProcess(({ resources: { score, config } }) => {
    // resources are resolved once on first call, then cached
  });
```

### Single-Query Shorthand: `setProcessEach`

For single-query, per-entity iteration — the most common case — use `setProcessEach` to inline the query and the callback in one step. Callback context is `{ entity, dt, ecs }` plus `resources` when declared:

```typescript
ecs.addSystem('movement')
  .setProcessEach({ with: ['position', 'velocity'] }, ({ entity, dt }) => {
    entity.components.position.x += entity.components.velocity.x * dt;
    entity.components.position.y += entity.components.velocity.y * dt;
  });

ecs.addSystem('bounce')
  .withResources(['bounds'])
  .setProcessEach(
    { with: ['position', 'velocity', 'radius'] },
    ({ entity, dt, resources: { bounds } }) => { /* ... */ },
  );
```

`setProcessEach` accepts the full query shape (`with`, `without`, `optional`, `changed`, `parentHas`, `mutates`). It's valid only on a builder with no prior `addQuery` / `setProcess` / `setProcessEach` call — TypeScript blocks the misuse and a runtime guard backs it up. For multi-query systems, keep using `addQuery` + `setProcess`.

When the query declares `mutates`, the callback may `return false` to skip the auto-mark for a specific entity (useful when the iteration body decides mid-flight that nothing changed). Returning `true`, `undefined`, or any other value stamps all components listed in `mutates`. Example:

```typescript
ecs.addSystem('propagate-transforms')
  .setProcessEach(
    { with: ['localTransform', 'worldTransform'], mutates: ['worldTransform'] },
    ({ entity }) => {
      // copyTransform returns true iff the destination actually changed
      return copyTransform(entity.components.localTransform, entity.components.worldTransform);
    },
  );
```

### Query Definitions

```typescript
.addQuery('name', {
  with: ['comp1', 'comp2'],       // required components (guaranteed on entity)
  without: ['comp3'],             // exclude entities with these
  changed: ['comp1'],             // only entities where comp1 changed this tick
  optional: ['comp4'],            // included if present, not guaranteed
  parentHas: ['parentComp'],      // filter by parent's components
  mutates: ['comp1'],             // auto-markChanged these on every iterated entity
})
```

Entities in query results have their `with` components guaranteed on `entity.components`. Other components on the entity are `Partial`.

#### `mutates` — auto-mark + readonly narrowing

`mutates` declares which components the system writes to. It does two things:

1. **Runtime**: after `process()` returns, every iterated entity gets `markChanged(id, comp)` called automatically for each listed component. Eliminates repeated `ecs.markChanged(entity.id, 'localTransform')` boilerplate.
2. **Types**: components in `with` but absent from `mutates` are narrowed to `Readonly<T>` on the iteration entity. Accidentally mutating an undeclared component is a compile error.

```typescript
ecs.addSystem('movement')
  .addQuery('movers', {
    with: ['position', 'velocity'],
    mutates: ['position'],         // declares: this system writes position
  })
  .setProcess(({ queries, dt }) => {
    for (const entity of queries.movers) {
      entity.components.position.x += entity.components.velocity.x * dt;
      entity.components.velocity.x  *= 0.99;  // Type error — velocity is Readonly
      // No ecs.markChanged needed — position gets auto-stamped.
    }
  });
```

Over-marking semantics: all iterated entities get stamped regardless of whether the body actually mutated them. For most producers (e.g., physics integration feeding transform propagation) this is fine — downstream value-diff checks absorb the false positives. For producers feeding a bare `changed:` consumer where per-entity precision matters, use `setProcessEach` with a boolean return (see above) or skip `mutates` and keep manual `ecs.markChanged` calls.

### Singleton Queries

`addSingleton(name, definition)` is a named query that yields a single `FilteredEntity | undefined` instead of an array. Definition shape is identical to `addQuery`; the result surfaces on `queries[name]` alongside regular queries.

```typescript
ecs.addSystem('hud')
  .addSingleton('flagship', { with: ['commandVessel', 'kinematic'] })
  .addQuery('ships', { with: ['ship'] })
  .setProcess(({ queries }) => {
    if (!queries.flagship) return;            // FilteredEntity | undefined
    const { kinematic } = queries.flagship.components;
    for (const ship of queries.ships) { /* ... */ }
  });
```

When multiple entities match, the first is returned (no error). Use the instance-level `ecs.getSingleton(...)` / `ecs.tryGetSingleton(...)` if you need strict enforcement. A singleton-only system is skipped when the singleton is absent unless `.runWhenEmpty()` is set, matching regular query gating.

### System Builder Chain

```typescript
ecs.addSystem('label')
  .addQuery('name', { with: [...] })         // add named query (array result)
  .addSingleton('name', { with: [...] })     // add singleton query (entity | undefined)
  .withResources(['key1', 'key2'])           // declare resource dependencies
  .inPhase('fixedUpdate')                    // default: 'update'
  .setPriority(100)                          // higher runs first within phase
  .inGroup('groupName')                      // can call multiple times
  .inScreens(['gameplay'])                   // only run in these screens
  .excludeScreens(['pause'])                 // skip in these screens
  .requiresAssets(['texture1'])              // skip until assets loaded
  .runWhenEmpty()                            // run even with 0 matching entities
  .setOnEntityEnter('queryName', ({ entity, ecs }) => { ... })
  .setOnInitialize(async (ecs) => { ... })   // runs during ecs.initialize()
  .setOnDetach((ecs) => { ... })             // runs on system removal
  .setEventHandlers({
    playerDied: ({ data, ecs }) => { ... },  // auto-subscribed event handlers
  })
  .setProcess(({ queries, dt, ecs }) => { ... })
  // --- OR, for single-query systems, replace addQuery + setProcess with: ---
  .setProcessEach({ with: [...] }, ({ entity, dt, ecs }) => { ... });
```

### Callback Convention

**1 parameter = positional. 2+ parameters = single destructured object.**

All multi-param callbacks use `({ param1, param2 })` style, not `(param1, param2)`.

## Initialization Sequence

```typescript
const ecs = ECSpresso.create()
  .withPlugin(...)
  .withComponentTypes<...>()
  .build();

// Add systems (can be before or after initialize)
ecs.addSystem('movement').addQuery(...).setProcess(...);

// Initialize resources, plugins, system hooks
await ecs.initialize();

// Now safe to spawn entities and run the loop
ecs.spawn({ ... });

// Game loop
function loop(time: number) {
  ecs.update(dt);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
```

## Lifecycle Hooks

### Screens

```typescript
ecs.onScreenEnter('playing', ({ config, ecs }) => { ... });  // multi-handler; fires on setScreen + pushScreen
ecs.onScreenExit('playing', ({ ecs }) => { ... });           // fires on setScreen-away + popScreen
const off = ecs.onScreenEnter('title', () => { ... });
off();  // returned disposer unregisters the handler
```

Prefer these over `eventBus.subscribe('screenEnter', ...)` + a manual `if (screen !== 'x') return` filter.

### Screen-Scoped Entities

```typescript
ecs.spawn({ enemy: { hp: 10 } }, { scope: 'playing' });
// ↑ removed automatically when 'playing' exits
```

Also available on `spawnChild`, `commands.spawn`, `commands.spawnChild`. Replaces hand-maintained teardown lists.

### Plugin Cleanup

`install` receives `(world, onCleanup)`. Register disposers; they run when the plugin is uninstalled.

```typescript
definePlugin('legend').install((world, onCleanup) => {
  onCleanup(world.onScreenEnter('title', () => { ... }));
  const onKey = (e: KeyboardEvent) => { ... };
  window.addEventListener('keydown', onKey);
  onCleanup(() => window.removeEventListener('keydown', onKey));
});

ecs.uninstallPlugin('legend');  // reverse-order cleanup
ecs.dispose();                   // uninstalls all plugins
```

## Common Mistakes

1. **Old positional callback style.** Always use `({ queries, dt, ecs })`, not `(queries, dt, ecs)`.

2. **Mutating entities during iteration without command buffer.** Use `ecs.commands.spawn()` / `ecs.commands.removeEntity()` inside `setProcess`, not `ecs.spawn()` / `ecs.removeEntity()` directly.

3. **Forgetting `markChanged` after in-place mutation.** If you mutate a component's properties directly, call `ecs.markChanged(entityId, 'componentName')` so downstream `changed` queries detect it — or declare `mutates: [...]` on the query to auto-stamp every iterated entity.

4. **Adding explicit type parameters when the builder infers them.** The builder chain accumulates types automatically. Derive the world type with `type ECS = typeof ecs`.

5. **Using `ecs.getResource` in resource-heavy systems instead of `.withResources()`.** Declare resource deps on the system builder — they're resolved once and cached.

6. **Spawning entities before `initialize()`.** Call `await ecs.initialize()` first to set up plugin resources and run system `onInitialize` hooks.

## Further Reference

- `docs/getting-started.md` — Quick start and installation
- `docs/core-concepts.md` — Entities, components, systems, resources
- `docs/systems.md` — Phases, priorities, groups, lifecycle hooks
- `docs/queries.md` — Query type utilities, reactive queries
- `docs/plugins.md` — Plugin definition, factory pattern, required components
- `docs/built-in-plugins.md` — Input, timers, physics, collision, rendering, etc.
- `docs/events.md` — Event system and built-in events
- `docs/command-buffer.md` — Deferred structural changes
- `docs/change-detection.md` — Change tracking and sequence system
- `docs/hierarchy.md` — Parent-child relationships and traversal
- `docs/assets.md` — Asset loading, groups, progress tracking
- `docs/screens.md` — Screen/state management with transitions
- `docs/type-safety.md` — Type system details and error messages
- `docs/performance.md` — Performance tips
- `examples/` — Working examples from simple movement to full games
