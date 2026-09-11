# Events

Use events for decoupled system communication. Events work across all features — hierarchy changes, asset loading, timer completion, and custom game events all use the same system.

```typescript
interface Events {
  playerDied: { playerId: number };
  levelComplete: { score: number };
  // Hierarchy events (if using entity hierarchy)
  hierarchyChanged: {
    entityId: number;
    oldParent: number | null;
    newParent: number | null;
  };
}

const world = ECSpresso.create()
  .withComponentTypes<Components>()
  .withEventTypes<Events>()
  .build();

// Subscribe - returns unsubscribe function
const unsubscribe = world.on('playerDied', (data) => {
  console.log(`Player ${data.playerId} died`);
});
unsubscribe();

// Or unsubscribe by callback reference
const handler = (data) => console.log(`Score: ${data.score}`);
world.on('levelComplete', handler);
world.off('levelComplete', handler);

// Handle events in systems
world.addSystem('gameLogic')
  .setEventHandlers({
    playerDied: ({ data, ecs }) => {
      // Respawn logic
    }
  });

// Publish events from anywhere
world.eventBus.publish('playerDied', { playerId: 1 });
```

System event handlers use the same live activation rules as system processing.
An event-only system (one without `setProcess`) is valid. At publication time,
the handler is skipped when any of its groups is disabled, when its
`inScreens` list does not contain the current screen (including no current
screen), when its `excludeScreens` list contains the current screen, or when a
required asset is not loaded. A skipped event is dropped; it is not replayed
when the system becomes active again.

These gates are evaluated when the event is published, so changing a group,
screen, or asset status does not create duplicate subscriptions. `world.on()`
subscriptions remain independent of system gates. Event delivery is
synchronous, and removing a system or unsubscribing during publication is safe:
the removed handler does not receive a later callback in that publication and
other live subscribers are not skipped.

`await world.dispose()` closes the event bus and detaches all system handlers.
Events published during or after disposal do no work; direct subscriptions
should still be explicitly disposed when their external owner needs an earlier
lifetime boundary.

## Built-in Events

- `hierarchyChanged` — entity parent changes
- `assetLoaded` / `assetFailed` / `assetGroupProgress` / `assetGroupLoaded` — asset loading
- Timer `onComplete` events — see [Built-in Plugins](./built-in-plugins.md)
