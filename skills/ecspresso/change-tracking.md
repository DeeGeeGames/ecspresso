# Change tracking and mutation declarations

Read this reference when a feature mutates component data or relies on a
`changed` query.

## Marks and consumers

`spawn`, `addComponent`, and `addComponents` mark affected components
automatically. Mark in-place writes explicitly when the owning query does not
declare `mutates`:

```typescript
position.x += 10;
ecs.markChanged(entityId, 'position');
```

`changed` includes an entity when any listed component was marked since that
system last ran. Each system consumes marks independently. Marks from an earlier
system or phase are visible to later systems in the same frame; marks from a
lower-priority system are seen on the consumer's next run.

A `changed` declaration subscribes its components at registration. When at
least one subscription exists, marks for unsubscribed components are discarded.
With no `changed` consumers, tracking defaults to all components so direct
changed queries remain usable. A world with no change consumers can opt out
through `.disableChangeTracking()`.

## Declarative writes

Declare ordinary query-based writes with `mutates`:

```typescript
ecs.addSystem('movement')
  .addQuery('movers', {
    with: ['position', 'velocity'],
    mutates: ['position'],
  })
  .setProcess(({ queries, dt }) => {
    for (const entity of queries.movers) {
      entity.components.position.x += entity.components.velocity.x * dt;
    }
  });
```

After processing, every iterated entity is marked for every listed component.
Required `with` components absent from `mutates` are shallowly `Readonly`.
Use `mutates: []` to make a read-only required-component contract explicit.

Omitting `mutates` preserves the manual-mark contract and leaves all required
components writable. Optional and otherwise visible components are outside the
readonly narrowing, and the callback's world reference can perform additional
writes. Treat `mutates` as a bounded declaration, not a complete effect system.

## Precise per-entity marking

For a single query, `setProcessEach` may suppress an entity's automatic mark by
returning `false`:

```typescript
ecs.addSystem('propagate')
  .setProcessEach(
    { with: ['localTransform', 'worldTransform'], mutates: ['worldTransform'] },
    ({ entity }) => {
      return copyTransform(
        entity.components.localTransform,
        entity.components.worldTransform,
      );
    },
  );
```

Returning `false` suppresses marking only; it does not undo mutations. Return it
only when no declared component changed. Without `mutates`, the return value has
no marking effect.

For multi-query systems where per-entity precision matters, omit `mutates` and
call `markChanged` only for entities that actually changed. Do not broaden
`mutates` to fix a type error until confirming that the write belongs in the
system.
