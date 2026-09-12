# Core Concepts

## Entities and Components

Entities are containers for components. Use `spawn()` to create entities with initial components:

```typescript
// Create entity with components
const entity = world.spawn({
  position: { x: 10, y: 20 },
  health: { value: 100 }
});

// Look up an entity by ID
const found = world.getEntity(entity.id); // Entity | undefined

// Add components later
world.addComponent(entity.id, 'velocity', { x: 5, y: 0 });

// Get component data (returns undefined if not found)
const position = world.getComponent(entity.id, 'position');

// Remove components or entities
world.removeComponent(entity.id, 'velocity');
world.removeEntity(entity.id);
```

### Component Callbacks

React to component additions and removals. Both methods return an unsubscribe function:

```typescript
const unsubAdd = world.onComponentAdded('health', ({ value, entity }) => {
  console.log(`Health added to entity ${entity.id}:`, value);
});

const unsubRemove = world.onComponentRemoved('health', ({ value, entity }) => {
  console.log(`Health removed from entity ${entity.id}:`, value);
});

// Unsubscribe when done
unsubAdd();
unsubRemove();
```

Also available on `world.entityManager.onComponentAdded()` / `onComponentRemoved()`.

## Systems and Queries

Systems process entities that match specific component patterns:

```typescript
world.addSystem('combat')
  .addQuery('fighters', {
    with: ['position', 'health'],
    without: ['dead']
  })
  .addQuery('projectiles', {
    with: ['position', 'damage']
  })
  .setProcess(({ queries }) => {
    for (const fighter of queries.fighters) {
      for (const projectile of queries.projectiles) {
        // Combat logic here
      }
    }
  });
```

For more on systems, see [Systems](./systems.md).

## Resources

Resources provide global state accessible to all systems.

```typescript
interface Resources {
  score: { value: number };
  settings: { difficulty: 'easy' | 'hard' };
}

const world = ECSpresso.create()
  .withComponentTypes<Components>()
  .withResourceTypes<Resources>()
  .withResource('score', { value: 0 })
  .build();

// Sync or async factories (lazy initialization)
world.addResource('config', () => ({ difficulty: 'normal', soundEnabled: true }));
world.addResource('database', async () => await connectToDatabase());

// Factory with dependencies (initialized after dependencies are ready)
world.addResource('cache', {
  dependsOn: ['database'],
  factory: (ecs) => ({ db: ecs.getResource('database') })
});

// Initialize all resources (respects dependency order, detects circular deps)
await world.initializeResources();

// Use in systems
world.addSystem('scoring')
  .setProcess(({ ecs }) => {
    const score = ecs.getResource('score');
    score.value += 10;
  });
```

### Reading & Writing Resources

```typescript
// Get a resource (throws if not found)
const score = world.getResource('score');

// Get a resource (returns undefined if not found)
const score = world.tryGetResource('score');

// Set a resource to a plain value
world.setResource('score', { value: 42 });

// Update a resource using a function (when new value depends on old)
world.updateResource('score', (prev) => ({ value: prev.value + 1 }));
```

### Change Subscriptions

Subscribe to resource changes for reactive integrations (e.g., React's `useSyncExternalStore`). Returns an unsubscribe function. Notifications only fire when the value actually changes (`Object.is` comparison).

```typescript
const unsubscribe = world.onResourceChange('score', (newValue, oldValue) => {
  console.log(`Score changed from ${oldValue.value} to ${newValue.value}`);
});

// Stop listening
unsubscribe();
```

Resources also chain naturally with plugins in the builder:

```typescript
const world = ECSpresso.create()
  .withPlugin(physicsPlugin)
  .withResource('config', { debug: true, maxEntities: 1000 })
  .withResource('score', () => ({ value: 0 }))
  .withResource('cache', {
    dependsOn: ['database'],
    factory: (ecs) => createCache(ecs.getResource('database'))
  })
  .build();
```

### Disposal

Resources can define cleanup logic with `onDispose` callbacks:

```typescript
world.addResource('keyboard', {
  factory: () => {
    const handler = (e: KeyboardEvent) => { /* ... */ };
    window.addEventListener('keydown', handler);
    return { handler };
  },
  onDispose: (resource) => {
    window.removeEventListener('keydown', resource.handler);
  }
});

await world.disposeResource('keyboard');     // Dispose a single resource
await world.disposeResources();              // All, in reverse dependency order
```

`onDispose` receives the resource value, the ECSpresso instance, and a
`CleanupControl`. It supports sync and async callbacks, and only initialized
resources have their `onDispose` called. If a disposer needs to initiate world
teardown, call `cleanup.requestDisposal()` through that third argument;
awaiting `world.dispose()` inside a callback would wait on the callback itself.
`removeResource()` still exists for removal without disposal.

For complete teardown, use the single idempotent world operation:

```typescript
await world.dispose();
```

It stops updates and new registrations immediately, detaches systems, removes
entities and their components, discards queued commands, runs plugin cleanups,
exits active screens, and disposes initialized resources in reverse dependency
order. Lazy resources are not created just to dispose them. Cleanup continues
after independent disposer failures; the returned promise rejects after the
remaining cleanup completes. External concurrent calls made while teardown is
active wait on the same completion barrier, while calls made after teardown
are no-ops. Cleanup callbacks receive a portable `CleanupControl` and may call
`cleanup.requestDisposal()` without joining their own completion barrier.
External `world.dispose()` calls remain responsible for the complete teardown
result. Resource bulk disposal also waits for already-started partial disposal
and preserves dependencies until each callback finishes. `disposeResource()`
and `disposeResources()` remain available for partial resource teardown before
the world is disposed.

World teardown also joins cleanup started by standalone plugin uninstall and
waits for in-flight screen lifecycle hooks before running screen exits and
releasing resource dependencies. A transition interrupted by disposal rejects
instead of activating another screen. An exit already underway is not repeated.
If an entity-removal observer throws, remaining observers, component cleanup,
and descendant removal still run; removal then reports an aggregate error.
