# Changelog

All notable changes to ECSpresso are documented here. Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## 0.17.0

No breaking changes from 0.16.3.

### Added

- **`builder.disableChangeTracking()`** — opt out of change tracking entirely for worlds with zero `changed:` filters (e.g. benchmarks). Auto-subscription from plugins still grows the bitmap correctly if a plugin with a `changed:` filter is added afterwards.
- **Auto-derived change-tracking subscriptions.** The framework walks `changed:` declarations during `_registerSystem` and subscribes only the components something actually consumes. Unsubscribed components skip the mark walk entirely.

### Performance

- Spatial-index `postUpdate` rebuild auto-skips in flat-hierarchy scenes when the `fixedUpdate` rebuild already ran (2D: −5.7%, 3D: −9.6% ms/frame in the physics bench).
- `EventBus.publish` switched from a conditional-tuple rest signature to two named overloads — empty fast-path is ~7× faster (5.7 → 0.8 ns/call); end-to-end bench −7–10% ms/frame.
- `markChanged` resolves component indices once and uses a flat `Uint32Array` for the per-component change generation.
- Query `_changedIdx` and `_mutatesIdx` are pre-resolved at system registration, removing per-frame name→idx Map lookups.
- Collision and spatial-index plugins replaced per-entity `getComponent` calls with split queries.

### Internal

- Added `bench/ecs-physics3D.bench.ts` and shared `mulberry32` PRNG with the 2D bench.
- Stress-test example gained Phaser and Bevy comparison modes; Bevy wasm builds in docs CI.
