---
name: ecspresso
description: Build or change TypeScript applications that consume the ECSpresso ECS library. Use for application systems, queries, resources, events, screens, and built-in plugins; do not use for maintaining the ECSpresso library repository itself.
---

# ECSpresso — ECS Library Skill

ECSpresso is a type-safe Entity-Component-System library for TypeScript. This
skill covers application development against its published API. When changing
ECSpresso itself, use the repository's `ecspresso-maintainer` skill instead.

- For entity, resource, event, hierarchy, asset, and screen APIs, read
  [api-reference.md](api-reference.md).
- For plugin definition and exact built-in import paths, read
  [plugins.md](plugins.md).
- For `changed`, `mutates`, and marking semantics, read
  [change-tracking.md](change-tracking.md).
- For screens, pause, scoping, and plugin cleanup, read
  [lifecycle.md](lifecycle.md).
- For behavioral validation, read [testing.md](testing.md).

Before assuming current behavior, identify the installed ECSpresso version and
read its `CHANGELOG.md` when upgrading, encountering an API mismatch, or working
against an unfamiliar version. The npm package does not include the repository's
`docs/` directory.

## Working on an existing feature

Use systems as the initial inspection boundary without assuming all behavior
belongs inside a system callback:

1. Translate the requested behavior into relevant components, resources,
   events, screens, groups, assets, and presentation adapters.
2. Locate systems that query or write those values. Include defaults inherited
   from `definePlugin().setSystemDefaults(...)` and `world.systemScope(...)`.
3. Inspect immediate producers and consumers, including pure helpers, event
   publishers and handlers, command-buffer operations, and renderer adapters.
4. Extend the system that owns the responsibility. Add a system only when the
   behavior has a distinct phase, lifecycle, gate, or testable responsibility.
5. Update queries, mutation declarations, resources, phase, priority, screens,
   groups, assets, and event handlers alongside the implementation.
6. Validate the behavior and directly affected interactions. Expand farther
   only when observed dependencies warrant it.

Do not widen `mutates` merely to silence a type error. First determine whether
the write belongs in that system.

### Task routing

| Task | Inspect first |
|---|---|
| Change movement, steering, collision, or transforms | Owning system plus immediate physics/spatial producers and consumers; then [plugins.md](plugins.md) |
| Change query or component mutation behavior | Query declarations and downstream `changed` consumers; then [change-tracking.md](change-tracking.md) |
| Fix pause, overlays, or screen-owned entities | [lifecycle.md](lifecycle.md) |
| Change a built-in plugin integration or import | [plugins.md](plugins.md) |
| Add regression coverage | [testing.md](testing.md) |

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

The single inline `withComponentTypes<{...}>()` block above is fine for small
projects and examples. For a real game, let canonical `definePlugin()` features
contribute their own types. Application-only registration modules should
consume the final built-world type through `SystemRegistrarOf<W>` instead of
becoming plugins. See [plugins.md](plugins.md).

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

### Application registration scopes

Use a narrow registrar for modules that only add systems:

```typescript
import type { SystemRegistrarOf } from 'ecspresso';

type GameSystems = SystemRegistrarOf<typeof ecs>;

function registerMovement(systems: GameSystems): void {
  systems.addSystem('movement')
    .addQuery('moving', {
      with: ['position', 'velocity'],
      mutates: ['position'],
    })
    .setProcess(({ queries, dt }) => { /* ... */ });
}

registerMovement(ecs);

const gameplaySystems = ecs.systemScope({
  inScreens: ['playing'],
});
registerMovement(gameplaySystems);
```

The full world and a scoped registrar both satisfy `SystemRegistrarOf<W>`.
`systemScope()` captures copied defaults for later `addSystem()` calls;
per-system fluent calls override them. The registrar exposes only
`addSystem()`. Keep reactive queries and other non-system setup as explicit
full-world dependencies.

### Process Callback Signature

**The callback receives a single destructured context object**, not positional arguments:

```typescript
ecs.addSystem('movement')
  .addQuery('moving', {
    with: ['position', 'velocity'],
    mutates: ['position'],
  })
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
    // values are refreshed before each call; the resources object is reused
  });
```

Treat the callback's `ecs`, `queries`, and declared `resources` as the system's
dependencies. Do not import the application's built world into a system module
just to reach resources, components, commands, assets, or screen methods. Pass
`ecs` into extracted helpers instead:

```typescript
type Game = typeof ecs;

function completeLevel(world: Game): void {
  world.setScreen('results', {});
}

ecs.addSystem('level-completion')
  .setProcess(({ ecs: world }) => {
    if (isLevelComplete(world)) completeLevel(world);
  });
```

The built world may still be the composition root used to register systems.
The problem is singleton reach-through from processing code, which hides
dependencies and makes systems harder to reuse and test.

### Single-Query Shorthand: `setProcessEach`

For single-query, per-entity iteration — the most common case — use `setProcessEach` to inline the query and the callback in one step. Callback context is `{ entity, dt, ecs }` plus `resources` when declared:

```typescript
ecs.addSystem('movement')
  .setProcessEach(
    { with: ['position', 'velocity'], mutates: ['position'] },
    ({ entity, dt }) => {
      entity.components.position.x += entity.components.velocity.x * dt;
      entity.components.position.y += entity.components.velocity.y * dt;
    },
  );

ecs.addSystem('bounce')
  .withResources(['bounds'])
  .setProcessEach(
    { with: ['position', 'velocity', 'radius'], mutates: ['velocity'] },
    ({ entity, dt, resources: { bounds } }) => { /* ... */ },
  );
```

`setProcessEach` accepts the full query shape (`with`, `without`, `optional`, `changed`, `parentHas`, `mutates`). It's valid only on a builder with no prior `addQuery` / `setProcess` / `setProcessEach` call — TypeScript blocks the misuse and a runtime guard backs it up. For multi-query systems, keep using `addQuery` + `setProcess`.

When the query declares `mutates`, the callback may `return false` to skip the
auto-mark for a specific entity. It does not undo mutations already performed;
return `false` only when no declared component changed. Returning `true`,
`undefined`, or any other value stamps all components listed in `mutates`.
Example:

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

### Reading system declarations

| Declaration | Reasoning use |
|---|---|
| `with`, `optional`, `changed` | Component values the query may consume |
| `without`, `parentHas` | Membership and hierarchy dependencies |
| `mutates` | Writes to required components and automatic change publication |
| Phase and priority | When other systems can observe effects |
| `.withResources(...)` | Shared-state access; it does not distinguish reads from writes |
| Event handlers and publication | Synchronous behavior propagation outside query flow |
| Screens, groups, and assets | Conditions under which processing runs |

These declarations narrow inspection but are not a complete dependency graph.
Without `mutates`, required components remain writable. Readonly narrowing is
shallow; optional and otherwise visible components may still be accessed; and
the callback's `ecs` can reach beyond declared queries and resources. Inspect
the callback and its immediate helpers as well as its declarations.

Within a phase, higher-priority systems run first. Component mutations and
synchronous event handlers can affect later systems immediately. Structural
commands play back FIFO between phases, so their effects become visible after
that boundary. Screens, groups, and required assets can prevent a correctly
ordered system from running at all.

#### `mutates` — auto-mark + readonly narrowing

`mutates` declares which components the system writes to. It does two things:

1. **Runtime**: after `process()` returns, every iterated entity gets `markChanged(id, comp)` called automatically for each listed component. Eliminates repeated `ecs.markChanged(entity.id, 'localTransform')` boilerplate.
2. **Types**: components in `with` but absent from `mutates` are narrowed to `Readonly<T>` on the iteration entity. Accidentally mutating an undeclared component is a compile error.

Use `mutates: []` on read-only queries when making the contract explicit. This
readonly protection applies only to the top level of required `with`
components; it is not deep immutability or a complete write inventory.

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
  .addSingleton('flagship', {
    with: ['commandVessel', 'kinematic'],
    mutates: [],
  })
  .addQuery('ships', { with: ['ship'], mutates: [] })
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
  .addQuery('name', { with: [...], mutates: [] })     // named read-only query (array result)
  .addSingleton('name', { with: [...], mutates: [] }) // named read-only singleton
  .withResources(['key1', 'key2'])           // declare resource dependencies
  .inPhase('fixedUpdate')                    // default: 'update'
  .setPriority(100)                          // higher runs first within phase
  .inGroup('groupName')                      // can call multiple times
  .inScreens(['gameplay'])                   // only run in these screens; spawns inside process auto-scope to current screen
  .excludeScreens(['pause'])                 // skip in these screens
  .requiresAssets(['texture1'])              // skip until assets loaded
  .runWhenEmpty()                            // run even with 0 matching entities
  .setOnEntityEnter('queryName', ({ entity, ecs }) => { ... })
  .setOnInitialize(async (ecs) => { ... })   // awaited during initialize(); late async hooks are tracked until disposal
  .setOnDetach((ecs, cleanup) => { ... })    // cleanup.requestDisposal() can initiate teardown
  .setEventHandlers({
    playerDied: ({ data, ecs }) => { ... },  // live group/screen/asset gates; auto-subscribed
  })
  .setProcess(({ queries, dt, ecs }) => { ... })
  // --- OR, for single-query systems, replace addQuery + setProcess with: ---
  .setProcessEach({ with: [...], mutates: [] }, ({ entity, dt, ecs }) => { ... });
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

For screens, pause behavior, screen-scoped entities, and plugin cleanup, read
[lifecycle.md](lifecycle.md).

## Common Mistakes

1. **Old positional callback style.** Always use `({ queries, dt, ecs })`, not `(queries, dt, ecs)`.

2. **Using immediate structural changes accidentally.** Prefer
   `ecs.commands.spawn()` / `ecs.commands.removeEntity()` during processing so
   changes play back FIFO at the next phase boundary. Direct structural methods
   are supported, but use them only when immediate visibility to later systems
   is intentional and the current iteration cannot be invalidated.

3. **Forgetting `markChanged` after in-place mutation.** If you mutate a component's properties directly, call `ecs.markChanged(entityId, 'componentName')` so downstream `changed` queries detect it — or declare `mutates: [...]` on the query to auto-stamp every iterated entity.

4. **Adding explicit type parameters when the builder infers them.** The builder chain accumulates types automatically. Derive the world type with `type ECS = typeof ecs`.

5. **Using `ecs.getResource` in resource-heavy systems instead of `.withResources()`.** Declare resource deps on the system builder so values stay current and dependencies remain explicit.

6. **Spawning entities before `initialize()`.** Call `await ecs.initialize()` first to set up plugin resources and run system `onInitialize` hooks.

7. **Importing the built world inside system processing.** Use the callback's
   `ecs`, declared `resources`, and registered queries. Pass `ecs` into helpers
   instead of reaching through an application singleton.

8. **Assuming a pause overlay freezes every system.** Screen gates only skip
   systems configured for those screens. Explicitly suspend shared timer,
   tween, coroutine, physics, or other simulation groups when pause semantics
   require it.

9. **Maintaining a second UI screen router.** Keep ECSpresso screens
   authoritative and make DOM/canvas views respond to screen lifecycle hooks.

## Reference boundary

Use only the bundled references linked near the beginning of this skill for
version-specific work. Repository documentation and examples may describe a
newer version than the application has installed.
