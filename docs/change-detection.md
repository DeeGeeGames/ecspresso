# Change Detection

ECSpresso tracks component changes using a per-system monotonic sequence. Each *recorded* `markChanged` call increments a global counter and stamps the component with a unique sequence number. Each system tracks the highest sequence it has seen; on its next execution, it only processes marks with a sequence greater than its last-seen value. This means each mark is processed exactly once per system, and marks expire after a single update cycle.

## Subscription Model (Auto-Derived)

`markChanged` is only recorded for components that something subscribes to. Subscriptions are derived automatically: any system whose query declares `changed: ['foo', 'bar']` auto-subscribes `foo` and `bar` at registration time. Marks for components nothing consumes become no-ops, avoiding the per-call sequence stamp and array allocation.

Two defaults:
- **No `changed:` filter declared anywhere** → track all (every mark recorded). Safe default for tests and apps that use direct `getEntitiesWithQuery(..., changed: [...])` calls without going through a system.
- **At least one `changed:` filter declared** → track only the union of subscribed components. Plugin marks for unrelated components (e.g. `velocity` when no system has `changed: ['velocity']`) become no-ops.

For worlds with zero `changed:` consumers (benches, headless simulations), opt out of tracking entirely on the builder:

```typescript
const ecs = ECSpresso.create()
  .withComponentTypes<MyComponents>()
  .disableChangeTracking()
  .build();
```

This installs an empty subscription bitmap. Plugin systems that declare `changed:` still auto-subscribe on top, so legitimate consumers keep working.

## Marking Changes

Components are automatically marked as changed when added via `spawn()`, `addComponent()`, or `addComponents()`. For in-place mutations, call `markChanged` explicitly:

```typescript
const position = world.entityManager.getComponent(entity.id, 'position');
if (position) {
  position.x += 10;
  world.markChanged(entity.id, 'position');
}
```

## Changed Query Filter

Add `changed` to a query definition to filter entities to only those whose specified components changed since the system last ran:

```typescript
world.addSystem('render-sync')
  .addQuery('moved', {
    with: ['position', 'sprite'],
    changed: ['position'],  // Only entities whose position changed this tick
  })
  .setProcess(({ queries }) => {
    for (const entity of queries.moved) {
      syncSpritePosition(entity);
    }
  });
```

When multiple components are listed in `changed`, entities matching **any** of them are included (OR semantics).

## Sequence Timing

- Marks made between updates are visible to all systems on the next update
- Spawn auto-marks are visible on the first update
- Marks from earlier phases are visible to later phases within the same frame
- Within a phase, a higher-priority system's marks are visible to lower-priority systems
- Each mark is processed exactly once per system (single-update expiry)

For manual change detection outside of system queries:

```typescript
const em = ecs.entityManager;
if (em.getChangeSeq(entity.id, 'localTransform') > ecs.changeThreshold) {
  // Component changed since last system execution (or since last update if between updates)
}
```

**Deferred marking**: `ecs.commands.markChanged(entity.id, 'position')` queues a mark for command buffer playback.

**Built-in plugin usage**: Movement marks `localTransform` (fixedUpdate) → Transform propagation reads `localTransform` changed, writes+marks `worldTransform` (postUpdate) → Renderer reads `worldTransform` changed (render).
