# ECSpresso

*(pronounced "ex-presso")*

A type-safe, modular, and extensible Entity Component System (ECS) framework for TypeScript and JavaScript.

See [CHANGELOG.md](./CHANGELOG.md) for recent changes, including breaking changes.

## Features

- **Type-Safe**: Full TypeScript support with component, event, and resource type inference
- **Modular**: Plugin-based architecture for organizing features
- **Developer-Friendly**: Clean, fluent API with method chaining
- **Event-Driven**: Integrated event system for decoupled communication
- **Resource Management**: Global state management with lazy loading
- **Asset Management**: Eager/lazy asset loading with groups and progress tracking
- **Screen Management**: Game state/screen transitions with overlay support
- **Entity Hierarchy**: Parent-child relationships with traversal and cascade deletion
- **Query System**: Powerful entity filtering with helper type utilities
- **System Phases**: Named execution phases with fixed-timestep simulation
- **Change Detection**: Per-system monotonic sequence change tracking with `changed` query filters
- **Reactive Queries**: Enter/exit callbacks when entities match or unmatch queries
- **Command Buffer**: Deferred structural changes for safe entity/component operations during systems

## Installation

```sh
npm install ecspresso
```

## Quick Start

```typescript
import ECSpresso from 'ecspresso';

// 1. Define your component types
interface Components {
  position: { x: number; y: number };
  velocity: { x: number; y: number };
  health: { value: number };
}

// 2. Create a world using the builder — types are inferred automatically
const world = ECSpresso.create()
  .withComponentTypes<Components>()
  .build();

// 3. Add a movement system
world.addSystem('movement')
  .setProcessEach({ with: ['position', 'velocity'] }, ({ entity, dt }) => {
    entity.components.position.x += entity.components.velocity.x * dt;
    entity.components.position.y += entity.components.velocity.y * dt;
  });

// 4. Create entities
const player = world.spawn({
  position: { x: 0, y: 0 },
  velocity: { x: 10, y: 5 },
  health: { value: 100 }
});

// 5. Run the game loop
world.update(1/60);
```

## Documentation

- [Getting Started](./docs/getting-started.md)
- [Core Concepts](./docs/core-concepts.md) — entities, components, systems, resources
- [Systems](./docs/systems.md) — phases, priority, groups, lifecycle
- [Queries](./docs/queries.md) — type utilities, reactive queries
- [Events](./docs/events.md) — pub/sub, built-in events
- [Entity Hierarchy](./docs/hierarchy.md) — parent-child, traversal, cascade deletion
- [Change Detection](./docs/change-detection.md) — marking, sequence timing
- [Command Buffer](./docs/command-buffer.md) — deferred structural changes
- [Plugins](./docs/plugins.md) — definePlugin, pluginFactory, required components
- [Asset Management](./docs/assets.md) — loading, groups, progress
- [Screen Management](./docs/screens.md) — transitions, scoped systems, overlays
- [Built-in Plugins](./docs/built-in-plugins.md) — input, timers, physics, rendering
- [Type Safety](./docs/type-safety.md) — type threading, error handling
- [Performance](./docs/performance.md) — optimization tips

## Claude Code Skill

ECSpresso ships with a [Claude Code](https://claude.com/claude-code) plugin that installs a skill teaching the assistant the library's patterns, APIs, and built-in plugins. Install it to get ECSpresso-aware assistance when working on projects that use the library:

```
/plugin marketplace add DeeGeeGames/ecspresso
/plugin install ecspresso@ecspresso
```

The skill sources live under [`skills/ecspresso/`](./skills/ecspresso/); plugin and marketplace metadata are in [`.claude-plugin/`](./.claude-plugin/).

## License

MIT
