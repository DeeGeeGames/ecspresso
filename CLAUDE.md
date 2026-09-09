# ECSpresso

A type-safe ECS (Entity-Component-System) library for TypeScript. Uses Bun as runtime/test runner. Emphasizes strong typing, modular plugins, and fluent builder API.

Read `AGENTS.md` and `docs/maintainer-workflow.md` before changing this
repository. They are the canonical cross-agent instructions; this file retains
the architecture map and ECSpresso-specific background below.

## Source Structure

```
src/
├── ecspresso.ts       # Main ECS class, builder pattern entry point
├── entity-manager.ts  # Entity storage, component indexing, queries
├── hierarchy-manager.ts # Parent-child relationships, traversal
├── system-builder.ts  # Fluent builder for systems
├── plugin.ts          # Grouping systems/resources for modularity
├── event-bus.ts       # Pub/sub event system
├── resource-manager.ts # Global state, factory detection, lazy init, change subscriptions
├── command-buffer.ts  # Deferred structural changes (spawn, remove, etc.)
├── asset-manager.ts   # Asset loading, groups, progress tracking
├── asset-types.ts     # Asset type definitions
├── screen-manager.ts  # Screen/state transitions, overlay stack
├── screen-types.ts    # Screen type definitions
├── reactive-query-manager.ts # Reactive queries with enter/exit callbacks
├── types.ts           # Core type definitions
├── type-utils.ts      # WorldConfig, type extraction, plugin compatibility utilities
├── math.ts            # Vector2D type + pure vector math functions
├── index.ts           # Public API exports
└── plugins/
    ├── spatial/
    │   ├── transform.ts       # Hierarchical local/world transform propagation
    │   ├── transform3D.ts     # Hierarchical 3D transform propagation with quaternion composition
    │   ├── bounds.ts          # Screen bounds enforcement (destroy, clamp, wrap)
    │   ├── camera.ts          # Viewport, follow, shake, zoom
    │   ├── camera3D.ts        # Orbit/follow/shake controls for Three.js PerspectiveCamera
    │   ├── spatial-index.ts   # Uniform-grid spatial hash for broadphase/proximity queries
    │   └── spatial-index3D.ts # 3D uniform-grid spatial hash for broadphase/proximity queries
    ├── physics/
    │   ├── physics2D.ts     # ECS-native 2D arcade physics
    │   ├── physics3D.ts     # Gravity, forces, drag, Euler integration, impulse-based collision response
    │   ├── collision.ts     # Layer-based collision detection + pair handler routing
    │   ├── collision3D.ts   # Layer-based 3D collision detection with events (AABB3D + sphere)
    │   └── steering.ts      # Move-to-target with arrival detection
    ├── rendering/
    │   ├── renderer2D.ts    # PixiJS scene graph wiring
    │   ├── renderer3D.ts    # Three.js scene graph wiring
    │   ├── particles.ts     # Pooled particle system with PixiJS ParticleContainer rendering
    │   ├── sprite-animation.ts # Frame-based sprite animation
    │   └── tilemap.ts        # Tile-based world data, Tiled JSON / runtime ingestion, query API, opt-in collision strips
    ├── input/
    │   ├── input.ts         # Frame-accurate keyboard/pointer input with action mapping
    │   └── selection.ts     # Pointer-driven box/click selection with visual feedback
    ├── scripting/
    │   ├── coroutine.ts     # Generator-based multi-frame scripted sequences
    │   ├── timers.ts        # ECS-native timer components
    │   ├── state-machine.ts # Per-entity finite state machines
    │   └── tween.ts         # Declarative property animation with easing, sequences, and loops
    ├── ai/
    │   ├── detection.ts     # Proximity detection with spatial-index, sorted by distance
    │   ├── flocking.ts      # Boid flocking — separation, alignment, cohesion via force-based steering
    │   └── behavior-tree.ts # Composable priority-driven AI via behavior trees
    ├── isometric/
    │   ├── projection.ts    # Cartesian→isometric coordinate projection, iso camera sync
    │   └── depth-sort.ts    # Isometric z-ordering by world position
    ├── combat/
    │   ├── health.ts        # Health/damage/death lifecycle (event-driven)
    │   └── projectile.ts    # Homing + linear projectile movement, collision integration
    ├── audio/
    │   └── audio.ts         # Howler.js audio integration
    ├── debug/
    │   └── diagnostics.ts   # FPS, entity count, per-system timing overlay
    └── ui/
        └── ui.ts            # Screen-space HUD primitives — label, panel, progress bar, anchored positioning, button hit-testing + hover/press events
```

## Core Concepts

- **Components**: Data-only objects stored on entities
- **Systems**: Process entities matching queries, use builder pattern
- **Resources**: Global singleton state accessible to systems
- **Events**: Decoupled pub/sub for inter-system communication
- **Plugins**: Group related systems/resources for reusability
- **Command Buffer**: Deferred structural changes executed between phases
- **System Phases**: `preUpdate` → `fixedUpdate` → `update` → `postUpdate` → `render` with per-phase command buffer playback
- **Assets**: Eager/lazy loaded resources with groups and progress tracking
- **Screens**: Game state management with transitions and overlay stack
- **Entity Hierarchy**: Parent-child relationships with traversal and cascade deletion

## Key Patterns

### WorldConfig & Type Threading
`WorldConfig` is the single config object `{ components, events, resources, assets, screens }` that parameterizes all core classes. `WorldConfigFrom<C, E, R, A, S>` constructs one from individual type dimensions (all default to `{}`). `EmptyConfig` is the all-defaults alias.

### Callback Parameter Convention
**1 param = positional, 2+ params = named object.** All multi-param callbacks use a single destructured object parameter. Read source for specific callback signatures.

### Builder & Type Inference
Prefer the builder chain (`.withPlugin()`, `.withComponentTypes<T>()`, `.withEventTypes<T>()`, `.withResource()`) over explicit type params. The builder accumulates types into a `WorldConfig` via `MergeConfigs`. Derive the full world type with `type ECS = typeof ecs`.

## Commands

- `bun test` - Run tests
- `bun run check:types` - Type check
- Examples in `examples/` directory

## File Sync Requirements

When adding or renaming examples, these files must stay in sync:
- `examples/serve-examples.ts` — dev server routes
- `scripts/build-examples.ts` — the `examples` array (route, dir, html, entry)
- `examples/index.html` — landing-page `<ul>` listing shown at `/`
- Example dirs use flat names (e.g. `movement`, `camera-zoom`) — no numbered prefixes

When adding, renaming, or moving plugin source files, update:
- `typedoc.json` `entryPoints` — must reflect actual paths under `src/plugins/<category>/<name>.ts`
- `package.json` `exports` — required for npm consumers (see Plugin Exports section above)

## Plugin Exports

Each plugin is a distinct entry point in `package.json` `exports` (e.g. `ecspresso/plugins/spatial/transform`). This lets consumers import only the plugins they use, keeping bundles lean. **Any new plugin file must have a corresponding export entry added to `package.json` before it can be used as an npm package import.**

## Skill: `skills/ecspresso/`

A Claude Code skill that teaches correct ECSpresso usage. It tracks:

- **`SKILL.md`** — Mental model, builder API, system builder chain, query definitions, callback conventions, initialization sequence, common mistakes
- **`api-reference.md`** — Entity/component CRUD signatures, resource API, event API, hierarchy API, command buffer API
- **`plugins.md`** — Plugin definition patterns (fluent builder + factory), required components, and the **built-in plugin catalog table** (name, import path, default phase, description)

**When to update the skill:** Adding/removing/renaming a plugin, changing a public API signature, changing the system builder chain, changing callback conventions, or changing the initialization sequence. The built-in plugin table in `plugins.md` must stay in sync with `package.json` exports and the source structure above.

## Design Principles

- Enable a developer to express game logic and structure with as little boilerplate and framework drag as possible.
- Provide great developer experience enabled by maximum type awareness with minimum manual type annotations from the developer.
- Keep as strongly typed as possible. Never use "!". Avoid casting in general, and with "any" in particular. Only resort to casting or "any" when absolutely necessary. Watch for redundant casts that TypeScript can already infer from generic constraints.
- Avoid excessive object creation and allocation in hot paths. Pre-allocate and reuse objects where possible. Prefer synchronous function calls over promises.
- Avoid excessive use of "as const". Use it where it's important for deepening type-awareness.
