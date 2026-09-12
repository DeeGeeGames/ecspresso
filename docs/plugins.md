# Plugins

Organize related systems and resources into reusable plugins:

```typescript
import ECSpresso, { definePlugin } from 'ecspresso';

interface PhysicsComponents {
  position: { x: number; y: number };
  velocity: { x: number; y: number };
}

interface PhysicsResources {
  gravity: { value: number };
}

const physicsPlugin = definePlugin('physics')
  .withComponentTypes<PhysicsComponents>()
  .withResourceTypes<PhysicsResources>()
  .install((world) => {
    world.addSystem('applyVelocity')
      .addQuery('moving', { with: ['position', 'velocity'] })
      .setProcess(({ queries, dt }) => {
        for (const entity of queries.moving) {
          entity.components.position.x += entity.components.velocity.x * dt;
          entity.components.position.y += entity.components.velocity.y * dt;
        }
      });

    world.addSystem('applyGravity')
      .addQuery('falling', { with: ['velocity'] })
      .setProcess(({ queries, dt, ecs }) => {
        const gravity = ecs.getResource('gravity');
        for (const entity of queries.falling) {
          entity.components.velocity.y += gravity.value * dt;
        }
      });

    world.addResource('gravity', { value: 9.8 });
  });

// Register plugins with the world — types merge automatically
const game = ECSpresso.create()
  .withPlugin(physicsPlugin)
  .build();
```

## Plugin System Defaults

When every system installed by a plugin shares a phase, priority, or screen
gate, declare it once with `setSystemDefaults`:

```typescript
const visualEffectsPlugin = definePlugin('visual-effects')
  .setSystemDefaults({ phase: 'render', priority: -100 })
  .install((world) => {
    world.addSystem('update-particles').setProcess(() => { /* ... */ });
    world.addSystem('update-trails').setProcess(() => { /* ... */ });
  });
```

Defaults apply only to `addSystem` calls made inside that plugin's `install`
callback. They do not affect systems registered elsewhere or systems installed
by other plugins. Per-system builder calls override a default.

For application-owned modules that only group system registration, use
[`SystemRegistrarOf<W>` and `world.systemScope(defaults)`](./systems.md#application-registration-modules)
instead of creating a plugin. Plugins are for reusable features that contribute
or require types, need installation identity, or own cleanup.

This distinction matters for pause screens. Gating application systems through
a `playing` registrar does not pause separately installed timer, tween,
coroutine, physics, or animation plugins. If those clocks must freeze, disable
their system groups from screen lifecycle hooks and enable them again when
gameplay enters or resumes. Keep input and overlay-navigation groups enabled.

## Plugin Cleanup

The `install` function receives a second argument, `onCleanup`, for registering disposers that run when the plugin is uninstalled or the world is torn down. Use it to remove event listeners, cancel timers, or release any external resources the plugin acquired.

```typescript
const inputPlugin = definePlugin('input')
  .install((world, onCleanup) => {
    const handler = (e: KeyboardEvent) => { /* ... */ };
    window.addEventListener('keydown', handler);
    onCleanup(() => window.removeEventListener('keydown', handler));

    const off = world.on('someEvent', () => { /* ... */ });
    onCleanup(off);
  });
```

Disposers run in reverse registration order. They may be synchronous or
return a promise. A failing disposer does not prevent later cleanup from
running; `await world.dispose()` rejects after the remaining world teardown is
complete. A cleanup callback may call `await world.dispose()` again, including
after an asynchronous suspension; that nested call resolves immediately so it
does not wait on the callback that the outer disposal is already awaiting.
Calls made outside cleanup remain pending on the complete world-teardown
barrier.

### Uninstalling plugins at runtime

```typescript
world.uninstallPlugin('input');  // runs cleanup disposers, returns true if found
await world.dispose();           // full, asynchronous world teardown
```

`uninstallPlugin()` remains a synchronous plugin-cleanup operation and does
not remove systems or other registrations that the plugin installed. An async
cleanup started by standalone `uninstallPlugin()` is observed and reported by
the library but is not awaited by that boolean-returning API. World disposal
does await registered async plugin cleanups and detaches every remaining
system; automatic per-plugin ownership and uninstall-time removal of every
registration is a separate feature.

## Choosing Plugins or Application Registration

| Need | API |
|---|---|
| Reusable feature contributing or requiring types | `definePlugin()` |
| Application system with no shared defaults | Function receiving `SystemRegistrarOf<W>`; pass the world |
| Application systems sharing defaults | `world.systemScope(defaults)` |
| Non-system world initialization | Explicit full-world dependency |

Canonical plugins are the only plugin category. Application registration
functions operate against the final built-world schema without taking on
plugin identity, duplicate-install protection, or cleanup semantics.

## Plugin Requirements

Use slot-specific config helpers when a plugin requires existing world types but does not provide them itself. This avoids spelling empty `WorldConfigFrom` slots just to reach resources, assets, events, or screens.

```typescript
import {
  definePlugin,
  type ComponentsConfig,
  type ResourcesConfig,
  type ScreensConfig,
  type ScreenDefinition,
} from 'ecspresso';

type TransformComponents = {
  worldTransform: { x: number; y: number };
};

type InputResources = {
  input: { isPressed(action: string): boolean };
};

type RequiredScreens = {
  playing: ScreenDefinition<{ level: number }>;
};

type MovementRequires =
  ComponentsConfig<TransformComponents>
  & ResourcesConfig<InputResources>
  & ScreensConfig<RequiredScreens>;

export const movementPlugin = definePlugin('movement')
  .requires<MovementRequires>()
  .install((world) => {
    world.addSystem('movement')
      .inScreens(['playing'])
      .setProcess(({ ecs }) => {
        const input = ecs.getResource('input');
        if (!input.isPressed('right')) return;
      });
  });
```

Available helpers are `ComponentsConfig<T>`, `EventsConfig<T>`,
`ResourcesConfig<T>`, `AssetsConfig<T>`, and `ScreensConfig<T>`. Requirement
values are checked for mutual compatibility across all five slots because the
world passed to `install` is writable. If a dependency has an application-
specific union (for example, collision layers or input action names), make
the plugin factory generic and pass the same union to the provider and
consumer rather than widening the requirement. Use `WorldConfigFrom` directly
when a type naturally spans several slots and the positional form is still
clearer.

## Required Components

Plugins can declare that certain components depend on others. When an entity gains a trigger component, any required components that aren't already present are auto-added with default values:

```typescript
const transformPlugin = definePlugin('transform')
  .withComponentTypes<TransformComponents>()
  .install((world) => {
    world.registerRequired('localTransform', 'worldTransform', () => ({
      x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1,
    }));
  });

const world = ECSpresso.create()
  .withPlugin(transformPlugin)
  .build();

// worldTransform is auto-added with defaults
const entity = world.spawn({
  localTransform: { x: 100, y: 200, rotation: 0, scaleX: 1, scaleY: 1 },
});

// Explicit values always win — no auto-add if already provided
const entity2 = world.spawn({
  localTransform: { x: 100, y: 200, rotation: 0, scaleX: 1, scaleY: 1 },
  worldTransform: { x: 50, y: 50, rotation: 0, scaleX: 2, scaleY: 2 }, // used as-is
});
```

Requirements can also be registered via the builder or at runtime:

```typescript
// Builder
const world = ECSpresso.create()
  .withComponentTypes<Components>()
  .withRequired('rigidBody', 'velocity', () => ({ x: 0, y: 0 }))
  .withRequired('rigidBody', 'force', () => ({ x: 0, y: 0 }))
  .build();

// Runtime
world.registerRequired('position', 'velocity', () => ({ x: 0, y: 0 }));
```

### Behavior

- Enforced at insertion time (`spawn`, `addComponent`, `addComponents`, `spawnChild`, command buffer)
- Removal is unrestricted — removing a required component does not cascade
- Transitive requirements resolve automatically (A requires B, B requires C → all three added)
- Circular dependencies are detected and rejected at registration time
- Auto-added components are marked as changed and trigger reactive queries
- Component names and factory return types are fully type-checked

### Built-in Requirements

The Transform plugin registers `localTransform` → `worldTransform`. The Physics 2D plugin registers `rigidBody` → `velocity` and `rigidBody` → `force`.
