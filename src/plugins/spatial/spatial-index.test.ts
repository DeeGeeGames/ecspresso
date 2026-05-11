import { describe, test, expect } from 'bun:test';
import ECSpresso from '../../ecspresso';
import {
	createGrid,
	clearGrid,
	insertEntity,
	hashCell,
	gridQueryRect,
	gridQueryRadius,
	getLiveEntry,
	liveEntryCount,
	type SpatialHashGrid,
	type SpatialIndex,
} from '../../utils/spatial-hash';
import {
	createSpatialIndexPlugin,
} from './spatial-index';
import { createTransformPlugin, createTransform } from './transform';
import {
	createCollisionPlugin,
	createAABBCollider,
	createCircleCollider,
	createCollisionLayer,
	defineCollisionLayers,
	type CollisionEvent,
} from '../physics/collision';
import {
	createPhysics2DPlugin,
	createRigidBody,
	type Physics2DCollisionEvent,
} from '../physics/physics2D';

// ==================== Grid Data Structure ====================

describe('Spatial Hash Grid — Data Structure', () => {
	test('hashCell produces distinct values for distinct coordinates', () => {
		const h1 = hashCell(0, 0);
		const h2 = hashCell(1, 0);
		const h3 = hashCell(0, 1);
		const h4 = hashCell(1, 1);
		const hashes = new Set([h1, h2, h3, h4]);
		expect(hashes.size).toBe(4);
	});

	test('hashCell is deterministic', () => {
		expect(hashCell(5, 10)).toBe(hashCell(5, 10));
		expect(hashCell(-3, 7)).toBe(hashCell(-3, 7));
	});

	test('createGrid returns empty grid with correct cellSize', () => {
		const grid = createGrid(64);
		expect(grid.cellSize).toBe(64);
		expect(grid.invCellSize).toBeCloseTo(1 / 64, 10);
		expect(grid.cells.size).toBe(0);
		expect(liveEntryCount(grid)).toBe(0);
	});

	test('insertEntity places entity in correct cell', () => {
		const grid = createGrid(100);
		insertEntity(grid, 1, 50, 50, 10, 10);
		expect(getLiveEntry(grid, 1)).toBeDefined();
		expect(grid.cells.size).toBeGreaterThan(0);

		// Entity at (50,50) with halfW=10, halfH=10 spans [40,60]x[40,60]
		// At cellSize=100, all corners map to cell (0,0)
		const entry = getLiveEntry(grid, 1);
		expect(entry).toBeDefined();
		expect(entry!.entityId).toBe(1);
		expect(entry!.x).toBe(50);
		expect(entry!.y).toBe(50);
	});

	test('entity spanning multiple cells appears in all overlapping cells', () => {
		const grid = createGrid(50);
		// Entity at (50,50) with halfW=30, halfH=30 spans [20,80]x[20,80]
		// At cellSize=50, this touches cells (0,0), (1,0), (0,1), (1,1)
		insertEntity(grid, 1, 50, 50, 30, 30);

		// Count how many cells reference entity 1
		let cellCount = 0;
		for (const entries of grid.cells.values()) {
			if (entries.some(e => e.entityId === 1)) cellCount++;
		}
		expect(cellCount).toBe(4);
	});

	test('clearGrid drops all entries and hides stale bucket contents from queries', () => {
		const grid = createGrid(64);
		insertEntity(grid, 1, 50, 50, 10, 10);
		insertEntity(grid, 2, 200, 200, 10, 10);

		expect(liveEntryCount(grid)).toBe(2);
		expect(grid.cells.size).toBeGreaterThan(0);

		clearGrid(grid);

		expect(liveEntryCount(grid)).toBe(0);
		// Buckets retain their arrays for reuse — clearing is lazy at the bucket
		// level, but queries must observe the grid as empty.
		const result: number[] = [];
		gridQueryRect(grid, 0, 0, 500, 500, result);
		expect(result.length).toBe(0);
	});

	test('clearGrid + rebuild reuses SpatialEntry objects in place for persistent ids', () => {
		const grid = createGrid(64);
		insertEntity(grid, 1, 50, 50, 10, 10);
		const originalEntry = getLiveEntry(grid, 1);
		expect(originalEntry).toBeDefined();

		clearGrid(grid);
		insertEntity(grid, 1, 120, 75, 10, 10);

		const rebuiltEntry = getLiveEntry(grid, 1);
		// Same object identity — fields updated in place
		expect(rebuiltEntry).toBe(originalEntry);
		expect(rebuiltEntry!.x).toBe(120);
		expect(rebuiltEntry!.y).toBe(75);
	});

	test('entries removed from the rebuild are not resurrected', () => {
		const grid = createGrid(64);
		insertEntity(grid, 1, 50, 50, 10, 10);
		insertEntity(grid, 2, 200, 200, 10, 10);

		clearGrid(grid);
		insertEntity(grid, 1, 55, 55, 10, 10);
		// Entity 2 deliberately not re-inserted

		expect(getLiveEntry(grid, 1)).toBeDefined();
		expect(getLiveEntry(grid, 2)).toBeUndefined();

		const result: number[] = [];
		gridQueryRect(grid, 150, 150, 250, 250, result);
		expect(result.includes(2)).toBe(false);
	});
});

// ==================== Query Functions ====================

describe('Spatial Hash Grid — Queries', () => {
	function buildTestGrid(): SpatialHashGrid {
		const grid = createGrid(50);
		// Entity 1 at (25, 25), size 20x20
		insertEntity(grid, 1, 25, 25, 10, 10);
		// Entity 2 at (75, 25), size 20x20
		insertEntity(grid, 2, 75, 25, 10, 10);
		// Entity 3 at (200, 200), size 20x20 — far away
		insertEntity(grid, 3, 200, 200, 10, 10);
		return grid;
	}

	test('gridQueryRect returns entities overlapping the rectangle', () => {
		const grid = buildTestGrid();
		const result: number[] = [];
		gridQueryRect(grid, 0, 0, 100, 50, result);

		expect(result.includes(1)).toBe(true);
		expect(result.includes(2)).toBe(true);
	});

	test('gridQueryRect excludes entities outside the rectangle', () => {
		const grid = buildTestGrid();
		const result: number[] = [];
		gridQueryRect(grid, 0, 0, 100, 50, result);

		expect(result.includes(3)).toBe(false);
	});

	test('gridQueryRect with tight bounds only returns matching entities', () => {
		const grid = buildTestGrid();
		const result: number[] = [];
		// Only query area around entity 1
		gridQueryRect(grid, 0, 0, 40, 40, result);

		expect(result.includes(1)).toBe(true);
		expect(result.includes(2)).toBe(false);
		expect(result.includes(3)).toBe(false);
	});

	test('gridQueryRadius returns entities within the circle', () => {
		const grid = buildTestGrid();
		const result: number[] = [];
		// Center at (25, 25) with radius 60 — should reach entity 2 at (75,25), dist=50
		gridQueryRadius(grid, 25, 25, 60, result);

		expect(result.includes(1)).toBe(true);
		expect(result.includes(2)).toBe(true);
	});

	test('gridQueryRadius excludes entities outside circle but inside bounding square', () => {
		const grid = createGrid(50);
		// Entity at (50, 50) — center of query
		insertEntity(grid, 1, 50, 50, 5, 5);
		// Entity at (110, 110) — inside bounding square of radius=100 from (50,50)
		// but actual distance = sqrt(60^2+60^2) ≈ 84.85 which IS within r=100
		// Use a tighter case: entity at corner of bounding box
		insertEntity(grid, 2, 120, 120, 5, 5);
		// distance from (50,50) to (120,120) = sqrt(70^2+70^2) ≈ 98.99 < 100 still in
		// Need to place further
		insertEntity(grid, 3, 140, 140, 5, 5);
		// distance from (50,50) to (140,140) = sqrt(90^2+90^2) ≈ 127.28 > 100

		const result: number[] = [];
		gridQueryRadius(grid, 50, 50, 100, result);

		expect(result.includes(1)).toBe(true);
		expect(result.includes(2)).toBe(true);
		expect(result.includes(3)).toBe(false);
	});

	test('queries work correctly after clear + rebuild', () => {
		const grid = createGrid(50);
		insertEntity(grid, 1, 25, 25, 10, 10);

		const result1: number[] = [];
		gridQueryRect(grid, 0, 0, 50, 50, result1);
		expect(result1.includes(1)).toBe(true);

		clearGrid(grid);

		// Entity 1 is gone
		const result2: number[] = [];
		gridQueryRect(grid, 0, 0, 50, 50, result2);
		expect(result2.includes(1)).toBe(false);

		// Re-insert at different position
		insertEntity(grid, 2, 300, 300, 10, 10);

		const result3: number[] = [];
		gridQueryRect(grid, 280, 280, 320, 320, result3);
		expect(result3.includes(2)).toBe(true);
	});
});

// ==================== Plugin Integration ====================

describe('Spatial Index Plugin — Integration', () => {
	const layers = defineCollisionLayers({ player: ['enemy'], enemy: ['player'] });

	test('createSpatialIndexPlugin installs spatialIndex resource', () => {
		const ecs = ECSpresso
			.create()
			.withPlugin(createTransformPlugin())
			.withPlugin(createCollisionPlugin({ layers }))
			.withPlugin(createSpatialIndexPlugin())
			.withFixedTimestep(1 / 60)
			.build();

		expect(ecs.hasResource('spatialIndex')).toBe(true);
	});

	test('rebuild system populates grid from entities with colliders', () => {
		const ecs = ECSpresso
			.create()
			.withPlugin(createTransformPlugin())
			.withPlugin(createCollisionPlugin({ layers }))
			.withPlugin(createSpatialIndexPlugin())
			.withFixedTimestep(1 / 60)
			.build();

		ecs.spawn({
			...createTransform(100, 100),
			...createAABBCollider(50, 50),
			...createCollisionLayer('player', ['enemy']),
		});

		ecs.spawn({
			...createTransform(200, 200),
			...createCircleCollider(25),
			...createCollisionLayer('enemy', ['player']),
		});

		ecs.update(1 / 60);

		const si = ecs.getResource('spatialIndex') as SpatialIndex;
		// Both entities should be in the grid
		expect(liveEntryCount(si.grid)).toBe(2);
	});

	test('entities without colliders are not inserted', () => {
		const ecs = ECSpresso
			.create()
			.withPlugin(createTransformPlugin())
			.withPlugin(createCollisionPlugin({ layers }))
			.withPlugin(createSpatialIndexPlugin())
			.withFixedTimestep(1 / 60)
			.build();

		// Entity with collider
		ecs.spawn({
			...createTransform(100, 100),
			...createAABBCollider(50, 50),
			...createCollisionLayer('player', ['enemy']),
		});

		// Entity without collider
		ecs.spawn({
			...createTransform(200, 200),
		});

		ecs.update(1 / 60);

		const si = ecs.getResource('spatialIndex') as SpatialIndex;
		expect(liveEntryCount(si.grid)).toBe(1);
	});

	test('circle collider uses radius as half-extents', () => {
		const ecs = ECSpresso
			.create()
			.withPlugin(createTransformPlugin())
			.withPlugin(createCollisionPlugin({ layers }))
			.withPlugin(createSpatialIndexPlugin())
			.withFixedTimestep(1 / 60)
			.build();

		const entity = ecs.spawn({
			...createTransform(100, 100),
			...createCircleCollider(30),
			...createCollisionLayer('player', ['enemy']),
		});

		ecs.update(1 / 60);

		const si = ecs.getResource('spatialIndex') as SpatialIndex;
		const entry = si.getEntry(entity.id);
		expect(entry).toBeDefined();
		expect(entry!.halfW).toBe(30);
		expect(entry!.halfH).toBe(30);
	});

	test('AABB collider uses width/height as half-extents', () => {
		const ecs = ECSpresso
			.create()
			.withPlugin(createTransformPlugin())
			.withPlugin(createCollisionPlugin({ layers }))
			.withPlugin(createSpatialIndexPlugin())
			.withFixedTimestep(1 / 60)
			.build();

		const entity = ecs.spawn({
			...createTransform(100, 100),
			...createAABBCollider(40, 60),
			...createCollisionLayer('player', ['enemy']),
		});

		ecs.update(1 / 60);

		const si = ecs.getResource('spatialIndex') as SpatialIndex;
		const entry = si.getEntry(entity.id);
		expect(entry).toBeDefined();
		expect(entry!.halfW).toBe(20);
		expect(entry!.halfH).toBe(30);
	});

	test('collider offsets are applied to grid position', () => {
		const ecs = ECSpresso
			.create()
			.withPlugin(createTransformPlugin())
			.withPlugin(createCollisionPlugin({ layers }))
			.withPlugin(createSpatialIndexPlugin())
			.withFixedTimestep(1 / 60)
			.build();

		const entity = ecs.spawn({
			...createTransform(100, 100),
			...createAABBCollider(40, 40, 10, 20), // offsetX=10, offsetY=20
			...createCollisionLayer('player', ['enemy']),
		});

		ecs.update(1 / 60);

		const si = ecs.getResource('spatialIndex') as SpatialIndex;
		const entry = si.getEntry(entity.id);
		expect(entry).toBeDefined();
		expect(entry!.x).toBe(110); // 100 + 10
		expect(entry!.y).toBe(120); // 100 + 20
	});

	test('default phases register both fixedUpdate and postUpdate systems', () => {
		const ecs = ECSpresso
			.create()
			.withPlugin(createTransformPlugin())
			.withPlugin(createCollisionPlugin({ layers }))
			.withPlugin(createSpatialIndexPlugin())
			.withFixedTimestep(1 / 60)
			.build();

		// Verify grid is populated after update (systems ran)
		ecs.spawn({
			...createTransform(100, 100),
			...createAABBCollider(50, 50),
			...createCollisionLayer('player', ['enemy']),
		});

		ecs.update(1 / 60);

		const si = ecs.getResource('spatialIndex') as SpatialIndex;
		expect(liveEntryCount(si.grid)).toBe(1);
	});

	test('custom phases option limits to specified phases', () => {
		const ecs = ECSpresso
			.create()
			.withPlugin(createTransformPlugin())
			.withPlugin(createCollisionPlugin({ layers }))
			.withPlugin(createSpatialIndexPlugin({ phases: ['postUpdate'] }))
			.withFixedTimestep(1 / 60)
			.build();

		ecs.spawn({
			...createTransform(100, 100),
			...createAABBCollider(50, 50),
			...createCollisionLayer('player', ['enemy']),
		});

		ecs.update(1 / 60);

		// Grid should still be populated from postUpdate rebuild
		const si = ecs.getResource('spatialIndex') as SpatialIndex;
		expect(liveEntryCount(si.grid)).toBe(1);
	});

	test('SpatialIndex queryRect returns correct entity IDs', () => {
		const ecs = ECSpresso
			.create()
			.withPlugin(createTransformPlugin())
			.withPlugin(createCollisionPlugin({ layers }))
			.withPlugin(createSpatialIndexPlugin())
			.withFixedTimestep(1 / 60)
			.build();

		ecs.spawn({
			...createTransform(100, 100),
			...createAABBCollider(50, 50),
			...createCollisionLayer('player', ['enemy']),
		});

		ecs.spawn({
			...createTransform(500, 500),
			...createAABBCollider(50, 50),
			...createCollisionLayer('enemy', ['player']),
		});

		ecs.update(1 / 60);

		const si = ecs.getResource('spatialIndex') as SpatialIndex;
		const nearby = si.queryRect(50, 50, 150, 150);
		expect(nearby.length).toBe(1);
	});

	test('SpatialIndex queryRadius returns correct entity IDs', () => {
		const ecs = ECSpresso
			.create()
			.withPlugin(createTransformPlugin())
			.withPlugin(createCollisionPlugin({ layers }))
			.withPlugin(createSpatialIndexPlugin())
			.withFixedTimestep(1 / 60)
			.build();

		const e1 = ecs.spawn({
			...createTransform(100, 100),
			...createAABBCollider(50, 50),
			...createCollisionLayer('player', ['enemy']),
		});

		ecs.spawn({
			...createTransform(500, 500),
			...createAABBCollider(50, 50),
			...createCollisionLayer('enemy', ['player']),
		});

		ecs.update(1 / 60);

		const si = ecs.getResource('spatialIndex') as SpatialIndex;
		const nearby = si.queryRadius(100, 100, 50);
		expect(nearby.length).toBe(1);
		expect(nearby[0]).toBe(e1.id);
	});
});

// ==================== Collision Integration ====================

describe('Spatial Index — Collision Plugin Integration', () => {
	const layers = defineCollisionLayers({ player: ['enemy'], enemy: ['player'] });

	test('collision plugin with spatial index produces same events as without', () => {
		// Without spatial index
		const ecsWithout = ECSpresso
			.create()
			.withPlugin(createTransformPlugin())
			.withPlugin(createCollisionPlugin({ layers }))
			.build();

		const collisionsWithout: CollisionEvent<string>[] = [];
		ecsWithout.eventBus.subscribe('collision', (e) => collisionsWithout.push(e));

		ecsWithout.spawn({
			...createTransform(100, 100),
			...createAABBCollider(50, 50),
			...createCollisionLayer('player', ['enemy']),
		});
		ecsWithout.spawn({
			...createTransform(120, 120),
			...createAABBCollider(50, 50),
			...createCollisionLayer('enemy', ['player']),
		});
		ecsWithout.spawn({
			...createTransform(500, 500),
			...createAABBCollider(50, 50),
			...createCollisionLayer('enemy', ['player']),
		});

		ecsWithout.update(0.016);

		// With spatial index
		const ecsWith = ECSpresso
			.create()
			.withPlugin(createTransformPlugin())
			.withPlugin(createCollisionPlugin({ layers }))
			.withPlugin(createSpatialIndexPlugin())
			.build();

		const collisionsWith: CollisionEvent<string>[] = [];
		ecsWith.eventBus.subscribe('collision', (e) => collisionsWith.push(e));

		ecsWith.spawn({
			...createTransform(100, 100),
			...createAABBCollider(50, 50),
			...createCollisionLayer('player', ['enemy']),
		});
		ecsWith.spawn({
			...createTransform(120, 120),
			...createAABBCollider(50, 50),
			...createCollisionLayer('enemy', ['player']),
		});
		ecsWith.spawn({
			...createTransform(500, 500),
			...createAABBCollider(50, 50),
			...createCollisionLayer('enemy', ['player']),
		});

		ecsWith.update(0.016);

		// Same number of collision events
		expect(collisionsWith.length).toBe(collisionsWithout.length);
		expect(collisionsWith.length).toBe(1);

		// Same collision pairs (compare entity pairs, not exact order)
		const pairsWithout = collisionsWithout.map(c =>
			[c.entityA, c.entityB].sort().join(',')
		).sort();
		const pairsWith = collisionsWith.map(c =>
			[c.entityA, c.entityB].sort().join(',')
		).sort();
		expect(pairsWith).toEqual(pairsWithout);
	});

	test('collision plugin without spatial index still works (brute-force fallback)', () => {
		const ecs = ECSpresso
			.create()
			.withPlugin(createTransformPlugin())
			.withPlugin(createCollisionPlugin({ layers }))
			// No spatial index plugin
			.build();

		const collisions: CollisionEvent<string>[] = [];
		ecs.eventBus.subscribe('collision', (e) => collisions.push(e));

		ecs.spawn({
			...createTransform(100, 100),
			...createAABBCollider(50, 50),
			...createCollisionLayer('player', ['enemy']),
		});
		ecs.spawn({
			...createTransform(120, 120),
			...createAABBCollider(50, 50),
			...createCollisionLayer('enemy', ['player']),
		});

		ecs.update(0.016);
		expect(collisions.length).toBe(1);
	});

	test('physics2D with spatial index produces same collision response as without', () => {
		const FIXED_DT = 1 / 60;
		const physicsLayers = defineCollisionLayers({ default: ['default'] });

		// Without spatial index
		const ecsWithout = ECSpresso
			.create()
			.withPlugin(createTransformPlugin())
			.withPlugin(createPhysics2DPlugin({ gravity: { x: 0, y: 0 }, layers: physicsLayers }))
			.withFixedTimestep(FIXED_DT)
			.build();

		const physColWithout: Physics2DCollisionEvent[] = [];
		ecsWithout.eventBus.subscribe('physicsCollision', (e) => physColWithout.push(e));

		ecsWithout.spawn({
			...createTransform(0, 0),
			...createRigidBody('dynamic'),
			velocity: { x: 0, y: 0 },
			...createAABBCollider(20, 20),
			...physicsLayers.default(),
		});
		ecsWithout.spawn({
			...createTransform(15, 0),
			...createRigidBody('dynamic'),
			velocity: { x: 0, y: 0 },
			...createAABBCollider(20, 20),
			...physicsLayers.default(),
		});

		ecsWithout.update(FIXED_DT);

		// With spatial index
		const ecsWith = ECSpresso
			.create()
			.withPlugin(createTransformPlugin())
			.withPlugin(createPhysics2DPlugin({ gravity: { x: 0, y: 0 }, layers: physicsLayers }))
			.withPlugin(createSpatialIndexPlugin())
			.withFixedTimestep(FIXED_DT)
			.build();

		const physColWith: Physics2DCollisionEvent[] = [];
		ecsWith.eventBus.subscribe('physicsCollision', (e) => physColWith.push(e));

		ecsWith.spawn({
			...createTransform(0, 0),
			...createRigidBody('dynamic'),
			velocity: { x: 0, y: 0 },
			...createAABBCollider(20, 20),
			...physicsLayers.default(),
		});
		ecsWith.spawn({
			...createTransform(15, 0),
			...createRigidBody('dynamic'),
			velocity: { x: 0, y: 0 },
			...createAABBCollider(20, 20),
			...physicsLayers.default(),
		});

		ecsWith.update(FIXED_DT);

		expect(physColWith.length).toBe(physColWithout.length);
		expect(physColWith.length).toBe(1);
	});

	test('spatial index with circle colliders detects collisions correctly', () => {
		const ecs = ECSpresso
			.create()
			.withPlugin(createTransformPlugin())
			.withPlugin(createCollisionPlugin({ layers }))
			.withPlugin(createSpatialIndexPlugin())
			.build();

		const collisions: CollisionEvent<string>[] = [];
		ecs.eventBus.subscribe('collision', (e) => collisions.push(e));

		ecs.spawn({
			...createTransform(100, 100),
			...createCircleCollider(30),
			...createCollisionLayer('player', ['enemy']),
		});

		ecs.spawn({
			...createTransform(140, 100),
			...createCircleCollider(30),
			...createCollisionLayer('enemy', ['player']),
		});

		ecs.update(0.016);
		expect(collisions.length).toBe(1);
	});

	test('spatial index with mixed AABB/circle colliders works', () => {
		const ecs = ECSpresso
			.create()
			.withPlugin(createTransformPlugin())
			.withPlugin(createCollisionPlugin({ layers }))
			.withPlugin(createSpatialIndexPlugin())
			.build();

		const collisions: CollisionEvent<string>[] = [];
		ecs.eventBus.subscribe('collision', (e) => collisions.push(e));

		ecs.spawn({
			...createTransform(100, 100),
			...createAABBCollider(50, 50),
			...createCollisionLayer('player', ['enemy']),
		});

		ecs.spawn({
			...createTransform(130, 100),
			...createCircleCollider(20),
			...createCollisionLayer('enemy', ['player']),
		});

		ecs.update(0.016);
		expect(collisions.length).toBe(1);
	});

	test('spatial index correctly skips distant non-colliding entities', () => {
		const ecs = ECSpresso
			.create()
			.withPlugin(createTransformPlugin())
			.withPlugin(createCollisionPlugin({ layers }))
			.withPlugin(createSpatialIndexPlugin())
			.build();

		const collisions: CollisionEvent<string>[] = [];
		ecs.eventBus.subscribe('collision', (e) => collisions.push(e));

		ecs.spawn({
			...createTransform(0, 0),
			...createAABBCollider(10, 10),
			...createCollisionLayer('player', ['enemy']),
		});

		ecs.spawn({
			...createTransform(1000, 1000),
			...createAABBCollider(10, 10),
			...createCollisionLayer('enemy', ['player']),
		});

		ecs.update(0.016);
		expect(collisions.length).toBe(0);
	});
});

// ==================== Performance Smoke Test ====================

describe('Spatial Index — Performance', () => {
	test('500 entities with spatial index completes update without timeout', () => {
		const layers = defineCollisionLayers({ a: ['b'], b: ['a'] });
		const ecs = ECSpresso
			.create()
			.withPlugin(createTransformPlugin())
			.withPlugin(createCollisionPlugin({ layers }))
			.withPlugin(createSpatialIndexPlugin())
			.build();

		// Spawn 500 entities spread across a large area
		for (let i = 0; i < 250; i++) {
			ecs.spawn({
				...createTransform(i * 20, i * 10),
				...createAABBCollider(15, 15),
				...createCollisionLayer('a', ['b']),
			});
		}
		for (let i = 0; i < 250; i++) {
			ecs.spawn({
				...createTransform(i * 20 + 5, i * 10 + 5),
				...createAABBCollider(15, 15),
				...createCollisionLayer('b', ['a']),
			});
		}

		const start = performance.now();
		ecs.update(0.016);
		const elapsed = performance.now() - start;

		// Should complete well within a reasonable time (generous threshold)
		expect(elapsed).toBeLessThan(1000);
	});
});
