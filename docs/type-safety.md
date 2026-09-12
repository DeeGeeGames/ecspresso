# Type Safety

ECSpresso provides comprehensive TypeScript support:

```typescript
// ✅ Valid
world.entityManager.addComponent(entity.id, 'position', { x: 0, y: 0 });

// ❌ TypeScript error - invalid component name
world.entityManager.addComponent(entity.id, 'invalid', { data: 'bad' });

// ❌ TypeScript error - wrong component shape
world.entityManager.addComponent(entity.id, 'position', { x: 0 }); // missing y

// Query type safety - TypeScript knows which components exist
world.addSystem('example')
  .addQuery('moving', { with: ['position', 'velocity'] })
  .setProcess(({ queries }) => {
    for (const entity of queries.moving) {
      entity.components.position.x;   // ✅ guaranteed
      entity.components.health.value; // ❌ not in query
    }
  });

// Plugin type compatibility - conflicting types error at compile time
const plugin1 = definePlugin('p1')
  .withComponentTypes<{ position: { x: number; y: number } }>()
  .install(() => {});
const plugin2 = definePlugin('p2')
  .withComponentTypes<{ velocity: { x: number; y: number } }>()
  .install(() => {});
// Builder merges plugin types automatically — no manual type params needed
const world = ECSpresso.create()
  .withPlugin(plugin1)
  .withPlugin(plugin2)
  .build();
```

Plugin compatibility is checked for all five configuration slots:
components, events, resources, assets, and screens. Every overlapping
provided key must have the same type, so one compatible property cannot hide a
second conflict. Plugin requirements check both key presence and value type;
the check applies to the first plugin in a builder chain, later plugins, and
direct `world.installPlugin()` calls. Invalid programs should be kept in
compile-time tests with `@ts-expect-error`; they should not be executed.

Provided overlaps and required values are checked mutually because plugin
install callbacks receive a writable world and may replace shared values.
Consequently, a narrower concrete value (such as a literal collision layer)
does not satisfy a broader `string` requirement. When a dependency varies by
application, expose that variation as a generic contract and instantiate both
the provider and consumer with the same type.

## Error Handling

ECSpresso provides clear, contextual error messages:

```typescript
world.getResource('nonexistent');
// → "Resource 'nonexistent' not found. Available resources: [config, score, settings]"

world.entityManager.addComponent(999, 'position', { x: 0, y: 0 });
// → "Cannot add component 'position': Entity with ID 999 does not exist"

// Component not found returns undefined (no throw)
world.entityManager.getComponent(123, 'position'); // undefined
```
