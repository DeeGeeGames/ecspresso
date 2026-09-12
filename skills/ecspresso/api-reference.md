# ECSpresso API Reference

## Entities and Components

```typescript
// Spawn with components
const entity = ecs.spawn({ position: { x: 0, y: 0 }, health: 100 });

// Spawn scoped to a screen — removed automatically on that screen's exit
const enemy = ecs.spawn({ enemy: { hp: 10 } }, { scope: 'playing' });

// Spawn as child
const child = ecs.spawnChild(parentId, { position: { x: 10, y: 0 } });
const scopedChild = ecs.spawnChild(parentId, { enemy: { hp: 3 } }, { scope: 'playing' });

// Modify components
ecs.addComponent(entityId, 'velocity', { x: 5, y: 0 });
ecs.addComponents(entityId, { velocity: { x: 5, y: 0 }, health: 100 });
ecs.removeComponent(entityId, 'velocity');
ecs.removeEntity(entityId);                    // cascades to children by default
ecs.removeEntity(entityId, { cascade: false }); // orphan children instead

// Read
const pos = ecs.getComponent(entityId, 'position');      // T | undefined
const entity = ecs.getEntity(entityId);                   // Entity | undefined
```

### Component Callbacks

```typescript
// React to additions/removals — returns unsubscribe function
const unsub = ecs.onComponentAdded('health', ({ value, entity }) => { ... });
const unsub = ecs.onComponentRemoved('health', ({ value, entity }) => { ... });
```

### Change Detection

Read [change-tracking.md](change-tracking.md) for `changed`, `mutates`, manual
marking, subscription behavior, and system-ordering semantics.


## Command Buffer

Use inside `setProcess` to defer structural changes (safe during iteration):

```typescript
ecs.commands.spawn({ position: { x: 0, y: 0 } });
ecs.commands.spawn({ enemy: { hp: 1 } }, { scope: 'playing' });
ecs.commands.spawnChild(parentId, { ... });
ecs.commands.spawnChild(parentId, { ... }, { scope: 'playing' });
ecs.commands.removeEntity(entityId);
ecs.commands.removeEntity(entityId, { cascade: false });
ecs.commands.addComponent(entityId, 'tag', true);
ecs.commands.addComponents(entityId, { ... });
ecs.commands.removeComponent(entityId, 'tag');
ecs.commands.mutateComponent(entityId, 'position', (pos) => { pos.x += 10; });
ecs.commands.markChanged(entityId, 'position');
ecs.commands.setParent(childId, parentId);
ecs.commands.removeParent(childId);
ecs.commands.length;   // number of queued commands
ecs.commands.clear();  // discard all queued commands
```

Commands execute in FIFO order between phases. Failed commands log a warning and continue.

## Resources

```typescript
// Get (throws if not found, message lists available resources)
const score = ecs.getResource('score');

// Get (returns undefined if not found)
const score = ecs.tryGetResource('score');

// Set / update
ecs.setResource('score', { value: 42 });
ecs.updateResource('score', (prev) => ({ value: prev.value + 1 }));

// Subscribe to changes (fires only when value actually changes via Object.is)
const unsub = ecs.onResourceChange('score', (newVal, oldVal) => { ... });
```

### Resource Factories with Dependencies

```typescript
ecs.addResource('cache', {
  dependsOn: ['database'],
  factory: (ecs) => createCache(ecs.getResource('database')),
  onDispose: (resource) => resource.close(),
});

// Initialize all resources (respects dependency order, detects circular deps)
await ecs.initializeResources();

// Disposal
await ecs.disposeResource('cache');   // single resource
await ecs.disposeResources();          // all, in reverse dependency order
```

Bulk disposal waits for already-started partial resource disposal, including
async callbacks, before removing dependencies. External concurrent callers wait
on the active teardown; a callback reentering disposal returns immediately so
it cannot wait on itself. Failures are surfaced after remaining resource
cleanup completes.

## Events

```typescript
// Subscribe — returns unsubscribe function
const unsub = ecs.on('playerDied', (data) => { ... });
unsub();

// Or unsubscribe by reference
const handler = (data) => { ... };
ecs.on('levelComplete', handler);
ecs.off('levelComplete', handler);

// Publish
ecs.eventBus.publish('playerDied', { playerId: 1 });

// In-system handlers (auto-subscribed, use context object)
.setEventHandlers({
  playerDied: ({ data, ecs }) => { ... },
})
```

### Built-in Events

- `hierarchyChanged` — entity parent changes
- `assetLoaded` / `assetFailed` / `assetGroupProgress` / `assetGroupLoaded` — asset loading

## Entity Hierarchy

```typescript
// Create relationships
const weapon = ecs.spawnChild(player.id, { position: { x: 10, y: 0 } });
ecs.setParent(shield.id, player.id);
ecs.removeParent(shield.id);

// Traversal
ecs.getParent(id);              // number | null
ecs.getChildren(id);            // number[]
ecs.getAncestors(id);           // number[] (up to root)
ecs.getDescendants(id);         // number[] (depth-first)
ecs.getRoot(id);                // number
ecs.getSiblings(id);            // number[]
ecs.getRootEntities();          // number[]
ecs.isDescendantOf(id, ancestorId);  // boolean
ecs.isAncestorOf(id, descendantId);  // boolean

// Parent-first iteration (guaranteed parent before children)
ecs.forEachInHierarchy((entityId, parentId, depth) => { ... });
ecs.forEachInHierarchy(callback, { roots: [root.id] });

// Generator-based (supports early termination)
for (const { entityId, parentId, depth } of ecs.hierarchyIterator()) { ... }
```

Cascade deletion is the default. Use `{ cascade: false }` to orphan children instead.

## Reactive Queries

Push-based notifications when entities enter/exit a query match:

```typescript
ecs.addReactiveQuery('enemies', {
  with: ['position', 'enemy'],
  without: ['dead'],
  onEnter: ({ entity, ecs }) => { ... },
  onExit: ({ entityId, ecs }) => { ... },  // receives ID since entity may be removed
});

ecs.removeReactiveQuery('enemies');
```

## Singletons

Two ways to express "one matching entity" — system-builder style and instance style.

### System-builder: `addSingleton`

```typescript
ecs.addSystem('hud')
  .addSingleton('flagship', {
    with: ['commandVessel', 'kinematic'],
    mutates: [],
  })
  .setProcess(({ queries }) => {
    if (!queries.flagship) return;                 // FilteredEntity | undefined
    const { kinematic } = queries.flagship.components;
  });
```

Definition shape matches `addQuery` (`with` / `without` / `changed` / `optional` / `parentHas` / `mutates`). Returns the first match silently if multiple exist. `queries[name]` is typed as `FilteredEntity<...> | undefined`. Regular `addQuery` names still return arrays on the same `queries` object.

### Instance helpers

```typescript
ecs.getSingleton(['player']);                      // throws if 0 or >1 matches
ecs.tryGetSingleton(['player']);                   // undefined on 0, throws on >1
```

Both accept an optional `withoutComponents` array as the second argument. Use these when you need strict enforcement; use `addSingleton` when the zero-match case is expected (e.g., flagship destroyed mid-game).

## Application System Registration

Use `SystemRegistrarOf<W>` when an application module only needs to add systems
against the final built-world schema:

```typescript
import type { SystemRegistrarOf } from 'ecspresso';

type GameSystems = SystemRegistrarOf<typeof game>;

function registerMovement(systems: GameSystems): void {
  systems.addSystem('movement')
    .setProcessEach(
      { with: ['position', 'velocity'], mutates: ['position'] },
      ({ entity, dt }) => {
        entity.components.position.x += entity.components.velocity.x * dt;
      },
    );
}

registerMovement(game); // the full world satisfies the narrow capability

const gameplaySystems = game.systemScope({
  inScreens: ['playing'],
  phase: 'update',
  priority: 100,
});
registerMovement(gameplaySystems);
```

`systemScope()` snapshots its `phase`, `priority`, `inScreens`, and
`excludeScreens` defaults, including copies of screen arrays. Per-system
builder calls override captured defaults. Direct registration and other
registrars are unaffected.

The public types are `SystemDefaults<Cfg>`, `SystemRegistrar<Cfg>`, and
`SystemRegistrarOf<W>`. A registrar exposes only `addSystem()`; pass the full
world separately for reactive queries, resources, entities, navigation,
plugin lifecycle, or other initialization.

## System Groups

```typescript
ecs.disableSystemGroup('rendering');
ecs.enableSystemGroup('rendering');
ecs.isSystemGroupEnabled('rendering');
ecs.getSystemsInGroup('rendering');
```

If a system belongs to multiple groups, disabling **any** group skips the system.

## Assets

```typescript
const ecs = ECSpresso.create()
  .withAssets(assets => assets
    .add('playerTexture', async () => ({ data: await loadImage('player.png') }))
    .addGroup('level1', {
      music: async () => ({ buffer: await loadAudio('level1.mp3') }),
    })
  )
  .build();

await ecs.initialize();                          // loads eager assets
const tex = ecs.getAsset('playerTexture');
await ecs.loadAssetGroup('level1');              // load group on demand
ecs.getAssetGroupProgress('level1');             // 0-1
ecs.isAssetGroupLoaded('level1');
```

Systems can declare `.requiresAssets(['playerTexture'])` to skip until loaded.

## Screens

```typescript
const ecs = ECSpresso.create()
  .withScreens(screens => screens
    .add('menu', {
      initialState: () => ({ selectedOption: 0 }),
      onEnter: () => { ... },
      onExit: () => { ... },
    })
    .add('gameplay', {
      initialState: () => ({ score: 0 }),
      requiredAssetGroups: ['level1'],
    })
  )
  .build();

await ecs.setScreen('menu', {});
await ecs.setScreen('gameplay', { difficulty: 'hard' });
await ecs.pushScreen('pause', {});        // overlay
await ecs.popScreen();

ecs.getCurrentScreen();
ecs.getScreenConfig();
ecs.getScreenState();
ecs.updateScreenState({ score: 100 });
```

Screen-scoped systems: `.inScreens(['gameplay'])` or `.excludeScreens(['pause'])`.

Access via `$screen` resource: `ecs.getResource('$screen')` with `.current`, `.config`, `.state`, `.isOverlay`, `.stackDepth`, `.isCurrent(name)`, `.isActive(name)`.

### Screen Hooks

Multi-handler lifecycle hooks per screen name. Return a disposer.

```typescript
const off = ecs.onScreenEnter('playing', ({ config, ecs }) => { /* ... */ });
ecs.onScreenExit('playing', ({ ecs }) => { /* ... */ });
off();  // unsubscribe
```

`onScreenEnter` fires for both `setScreen` and `pushScreen`. `onScreenExit` fires for both `setScreen`-away and `popScreen`.

### Screen-Scoped Entity Lifetimes

Pass `{ scope: screenName }` on `spawn` / `spawnChild` / `commands.spawn` / `commands.spawnChild`. The entity is removed automatically when that screen exits.

```typescript
ecs.spawn({ enemy: { hp: 10 } }, { scope: 'playing' });
ecs.commands.spawn({ projectile: {...} }, { scope: 'playing' });
```

Manually removing a scoped entity drains the tracking set (no zombie ids).

**Auto-scoping inside `inScreens` systems.** Spawns issued during the `process` tick of a system declared with `.inScreens([X, ...])` are auto-scoped to the currently-active screen when no explicit `scope` is provided. `commands.spawn` / `commands.spawnChild` capture the hint at queue time — playback after the tick still applies the captured scope. To opt out and keep an entity beyond the screen's lifetime, pass `{ scope: null }` explicitly. Auto-scoping is **not** applied for: `excludeScreens`-only systems, `onInitialize` / `onDetach` hooks, or spawns from outside any system tick.

```typescript
world.addSystem('spawner').inScreens(['playing']).setProcess(({ ecs }) => {
  ecs.spawn({ enemy: {...} });                     // auto-scoped to 'playing'
  ecs.spawn({ hud: {...} }, { scope: null });      // unscoped (opts out)
  ecs.spawn({ menu: {...} }, { scope: 'title' });  // explicit override
});
```

## Plugin Lifecycle

`install` receives `(world, onCleanup)` — register synchronous or asynchronous
disposers that run on uninstall or world disposal.

```typescript
definePlugin('legend').install((world, onCleanup) => {
  onCleanup(world.onScreenEnter('title', (...) => { ... }));
  const onKey = (e: KeyboardEvent) => { ... };
  window.addEventListener('keydown', onKey);
  onCleanup(() => window.removeEventListener('keydown', onKey));
});

ecs.uninstallPlugin('legend');  // runs registered cleanups in reverse order
await ecs.dispose();             // complete asynchronous world teardown
```

`uninstallPlugin()` remains synchronous and only runs that plugin's registered
cleanup callbacks; it does not remove systems or other registrations made by
the plugin. If a standalone uninstall callback is asynchronous, the library
observes and reports its rejection but the boolean-returning API does not wait
for it. `await dispose()` runs all plugin cleanups, detaches all systems,
including pending builders without initializing them, removes entities and
commands, exits active screens, and disposes initialized resources in reverse
dependency order. Lazy resources are not created for disposal. The promise
rejects after remaining cleanup finishes if a disposer fails. During active
teardown, external concurrent calls share the completion barrier; a cleanup
callback may reenter `await dispose()` after suspension and receives an
immediate no-op result so it can finish. Calls after teardown are no-ops.
