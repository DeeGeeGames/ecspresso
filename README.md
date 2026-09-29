# ECSpresso

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./assets/brand/ecspresso-master-dark-transparent.svg">
  <source media="(prefers-color-scheme: light)" srcset="./assets/brand/ecspresso-master-light-transparent.svg">
  <img src="./assets/brand/ecspresso-master-light-transparent.svg" alt="ECSpresso logo: a coffee cup with ECS in the steam and the preso wordmark" width="360">
</picture>

*(pronounced "ex-presso")*

A type-safe, modular, and extensible Entity Component System (ECS) framework for TypeScript and JavaScript.

See [CHANGELOG.md](./CHANGELOG.md) for recent changes, including breaking changes.

## Features

- **Type-Safe**: Full TypeScript support with component, event, and resource type inference
- **Modular**: Reusable plugins plus narrow, type-safe application system registration
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
- [Plugins](./docs/plugins.md) — reusable features, requirements, cleanup
- [Asset Management](./docs/assets.md) — loading, groups, progress
- [Screen Management](./docs/screens.md) — transitions, scoped systems, overlays
- [Built-in Plugins](./docs/built-in-plugins.md) — input, timers, physics, rendering
- [Type Safety](./docs/type-safety.md) — type threading, error handling
- [Performance](./docs/performance.md) — optimization tips

## AI coding assistant skills

ECSpresso ships a consumer skill that teaches supported coding assistants the
library's application patterns, APIs, and built-in plugins. Install the plugin
to get ECSpresso-aware assistance in projects that use the library:

```
/plugin marketplace add DeeGeeGames/ecspresso
/plugin install ecspresso@ecspresso
```

The consumer skill sources live under
[`skills/ecspresso/`](./skills/ecspresso/); plugin and marketplace metadata are
in [`.claude-plugin/`](./.claude-plugin/) and
[`.codex-plugin/`](./.codex-plugin/). ECSpresso repository contributors should
instead follow [`AGENTS.md`](./AGENTS.md),
[`docs/maintainer-workflow.md`](./docs/maintainer-workflow.md), and the
repository-local `ecspresso-maintainer` skill.

## Brand assets

The [brand pack](./assets/brand/) includes the full logo, the cup with ECS steam,
and the cup icon in SVG and PNG formats, with light, dark, and transparent
versions. See the [brand notes](./assets/brand/BRAND.md) for palettes and usage
details, or the [contact sheet](./assets/brand/contact-sheet.png) to preview all
marks.

## License

MIT
