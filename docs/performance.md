# Performance Tips

- Use `changed` query filters to skip unchanged entities in render sync, transform propagation, and similar systems
- Call `markChanged` after in-place mutations so downstream systems can detect the change
- If your world has zero `changed:` filters anywhere (e.g. headless simulations, benches), call `.disableChangeTracking()` on the builder to skip the per-mark sequence stamp entirely. Worlds with at least one `changed:` filter get the same skip automatically for any component nothing consumes — no opt-in needed
- Extract business logic into testable helper functions using query type utilities
- Group related systems into plugins for better organization and reusability
- Use system phases to separate concerns (physics in `fixedUpdate`, rendering in `render`) and priorities for ordering within a phase
- Use resource factories for expensive initialization (textures, audio, etc.)
- Consider component callbacks for immediate reactions to state changes
- Minimize the number of components in queries when possible to leverage indexing
- Install `createSpatialIndexPlugin()` alongside `createCollisionPlugin()` or `createPhysics2DPlugin()` whenever you have more than a handful of colliders — without it, collision detection falls back to O(N²) brute-force pair testing (the library will log a warn-once above ~50 colliders)
