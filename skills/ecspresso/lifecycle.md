# Screens and lifecycle

Read this reference when changing navigation, pause behavior, screen-owned
entities, or plugin cleanup.

## Screen hooks and ownership

```typescript
ecs.onScreenEnter('playing', ({ config, ecs }) => { ... });
ecs.onScreenExit('playing', ({ ecs }) => { ... });
const off = ecs.onScreenEnter('title', () => { ... });
off();
```

Prefer screen hooks over subscribing to a generic screen event and filtering it
manually. Use ECSpresso screens as authoritative navigation state when a view
affects active systems, input routing, or back navigation.

A renderer adapter may cache view objects and own presentation-only state such
as focus targets and transitions. It should not maintain a second navigation
stack or bypass `setScreen`, `pushScreen`, and `popScreen`.

## Pause and overlays

Pushing an overlay changes the current screen, so systems gated with
`.inScreens(['playing'])` stop. It does not pause unrelated systems or globally
installed plugins. Disable the shared simulation groups that must freeze while
leaving input and overlay navigation active.

```typescript
const GAMEPLAY_CLOCK_GROUPS = ['timers', 'tweens', 'coroutines'] as const;

function pauseGameplay(ecs: typeof game): void {
  GAMEPLAY_CLOCK_GROUPS.forEach(group => ecs.disableSystemGroup(group));
}

function resumeGameplay(ecs: typeof game): void {
  GAMEPLAY_CLOCK_GROUPS.forEach(group => ecs.enableSystemGroup(group));
}

game.onScreenEnter('pause', ({ ecs }) => pauseGameplay(ecs));
game.onScreenEnter('playing', ({ ecs }) => resumeGameplay(ecs));
game.onScreenResume('playing', ({ ecs }) => resumeGameplay(ecs));
```

Screen stacks preserve underlying screen state; they do not imply a global
simulation-clock pause.

## Screen-scoped entities

```typescript
ecs.spawn({ enemy: { hp: 10 } }, { scope: 'playing' });
```

`spawnChild`, `commands.spawn`, and `commands.spawnChild` also accept a scope.
Entities are removed automatically when their scope exits.

Inside the process tick of a system with `.inScreens([X])`, unscoped direct and
command-buffer spawns inherit the active screen:

```typescript
world.addSystem('wave-spawner')
  .inScreens(['playing'])
  .setProcess(({ ecs }) => {
    ecs.commands.spawn({ enemy: { hp: 10 } });
  });
```

Explicit scope values override the hint. Use `{ scope: null }` for an entity
that must outlive the screen. Auto-scoping does not apply to initialization or
detach hooks, handlers fired outside a system tick, direct calls from main code,
or systems with only `excludeScreens`.

Prefer command-buffer structural changes during query processing. Direct
spawning is supported and receives the same scope hint, but it becomes visible
to later systems immediately rather than at the next phase boundary.

## Plugin cleanup

Register long-lived subscriptions and external listeners with `onCleanup`:

```typescript
definePlugin('legend').install((world, onCleanup) => {
  onCleanup(world.onScreenEnter('title', () => { ... }));
  const onKey = (event: KeyboardEvent) => handleKey(event);
  window.addEventListener('keydown', onKey);
  onCleanup(() => window.removeEventListener('keydown', onKey));
});
```

Cleanup runs in reverse registration order when uninstalling the plugin or
disposing the world. Cleanup functions may return promises. `await ecs.dispose()`
waits for them and for system/resource teardown. Standalone
`ecs.uninstallPlugin(id)` remains synchronous and does not remove systems or
other registrations made by that plugin. A cleanup callback may call
`await ecs.dispose()` reentrantly, including after an asynchronous suspension; that
nested call resolves immediately so the callback can finish instead of waiting
on itself. External concurrent calls remain pending until the complete teardown
barrier resolves. Pending system builders are detached without initialization,
and their asynchronous `onDetach` callbacks are awaited.
