import { describe, test, expect } from 'bun:test';
import ECSpresso from '../../ecspresso';
import {
	createGrid3D,
	clearGrid3D,
	insertEntity3D,
	hashCell3D,
	gridQueryBox3D,
	gridQueryRadius3D,
	getLiveEntry3D,
	liveEntryCount3D,
	type SpatialHashGrid3D,
	type SpatialIndex3D,
} from '../../utils/spatial-hash3D';
import {
	createSpatialIndex3DPlugin,
} from './spatial-index3D';
import {
	createTransform3DPlugin,
	createTransform3D,
} from './transform3D';

// ==================== Grid Data Structure ====================

describe('Spatial Hash Grid 3D — Data Structure', () => {
	test('hashCell3D produces distinct values for distinct coordinates', () => {
		const hashes = new Set([
			hashCell3D(0, 0, 0),
			hashCell3D(1, 0, 0),
			hashCell3D(0, 1, 0),
			hashCell3D(0, 0, 1),
			hashCell3D(1, 1, 0),
			hashCell3D(1, 0, 1),
			hashCell3D(0, 1, 1),
			hashCell3D(1, 1, 1),
		]);
		expect(hashes.size).toBe(8);
	});

	test('hashCell3D is deterministic', () => {
		expect(hashCell3D(5, 10, 15)).toBe(hashCell3D(5, 10, 15));
		expect(hashCell3D(-3, 7, -2)).toBe(hashCell3D(-3, 7, -2));
	});

	test('createGrid3D returns empty grid with correct cellSize', () => {
		const grid = createGrid3D(64);
		expect(grid.cellSize).toBe(64);
		expect(grid.invCellSize).toBeCloseTo(1 / 64, 10);
		expect(grid.cells.size).toBe(0);
		expect(liveEntryCount3D(grid)).toBe(0);
	});

	test('insertEntity3D places entity in correct cell', () => {
		const grid = createGrid3D(100);
		insertEntity3D(grid, 1, 50, 50, 50, 10, 10, 10);
		expect(getLiveEntry3D(grid, 1)).toBeDefined();
		expect(grid.cells.size).toBeGreaterThan(0);

		const entry = getLiveEntry3D(grid, 1);
		expect(entry).toBeDefined();
		expect(entry!.entityId).toBe(1);
		expect(entry!.x).toBe(50);
		expect(entry!.y).toBe(50);
		expect(entry!.z).toBe(50);
	});

	test('entity spanning multiple cells appears in all overlapping cells', () => {
		const grid = createGrid3D(50);
		// Entity at (50,50,50) with half-extents 30 spans [20,80]^3
		// At cellSize=50 that touches 2×2×2 = 8 cells
		insertEntity3D(grid, 1, 50, 50, 50, 30, 30, 30);

		let cellCount = 0;
		for (const entries of grid.cells.values()) {
			if (entries.some(e => e.entityId === 1)) cellCount++;
		}
		expect(cellCount).toBe(8);
	});

	test('clearGrid3D drops all entries and empties cell buckets', () => {
		const grid = createGrid3D(64);
		insertEntity3D(grid, 1, 50, 50, 50, 10, 10, 10);
		insertEntity3D(grid, 2, 200, 200, 200, 10, 10, 10);

		expect(liveEntryCount3D(grid)).toBe(2);
		expect(grid.cells.size).toBeGreaterThan(0);

		clearGrid3D(grid);

		expect(liveEntryCount3D(grid)).toBe(0);
		for (const bucket of grid.cells.values()) {
			expect(bucket.length).toBe(0);
		}

		const result = [] as number[];
		gridQueryBox3D(grid, 0, 0, 0, 500, 500, 500, result);
		expect(result.length).toBe(0);
	});

	test('clearGrid3D + rebuild reuses SpatialEntry3D objects in place for persistent ids', () => {
		const grid = createGrid3D(64);
		insertEntity3D(grid, 1, 50, 50, 50, 10, 10, 10);
		const originalEntry = getLiveEntry3D(grid, 1);
		expect(originalEntry).toBeDefined();

		clearGrid3D(grid);
		insertEntity3D(grid, 1, 120, 75, 30, 10, 10, 10);

		const rebuiltEntry = getLiveEntry3D(grid, 1);
		// Same object identity — fields updated in place
		expect(rebuiltEntry).toBe(originalEntry);
		expect(rebuiltEntry!.x).toBe(120);
		expect(rebuiltEntry!.y).toBe(75);
		expect(rebuiltEntry!.z).toBe(30);
	});

	test('entries removed from the rebuild are not resurrected', () => {
		const grid = createGrid3D(64);
		insertEntity3D(grid, 1, 50, 50, 50, 10, 10, 10);
		insertEntity3D(grid, 2, 200, 200, 200, 10, 10, 10);

		clearGrid3D(grid);
		insertEntity3D(grid, 1, 55, 55, 55, 10, 10, 10);
		// Entity 2 deliberately not re-inserted

		expect(getLiveEntry3D(grid, 1)).toBeDefined();
		expect(getLiveEntry3D(grid, 2)).toBeUndefined();

		const result = [] as number[];
		gridQueryBox3D(grid, 150, 150, 150, 250, 250, 250, result);
		expect(result.includes(2)).toBe(false);
	});
});

// ==================== Query Functions ====================

describe('Spatial Hash Grid 3D — Queries', () => {
	function buildTestGrid(): SpatialHashGrid3D {
		const grid = createGrid3D(50);
		// Entity 1 at (25,25,25), half-extents 10
		insertEntity3D(grid, 1, 25, 25, 25, 10, 10, 10);
		// Entity 2 at (75,25,25), half-extents 10
		insertEntity3D(grid, 2, 75, 25, 25, 10, 10, 10);
		// Entity 3 at (200,200,200) — far away
		insertEntity3D(grid, 3, 200, 200, 200, 10, 10, 10);
		return grid;
	}

	test('gridQueryBox3D returns entities overlapping the box', () => {
		const grid = buildTestGrid();
		const result = [] as number[];
		gridQueryBox3D(grid, 0, 0, 0, 100, 50, 50, result);

		expect(result.includes(1)).toBe(true);
		expect(result.includes(2)).toBe(true);
	});

	test('gridQueryBox3D excludes entities outside the box', () => {
		const grid = buildTestGrid();
		const result = [] as number[];
		gridQueryBox3D(grid, 0, 0, 0, 100, 50, 50, result);

		expect(result.includes(3)).toBe(false);
	});

	test('gridQueryBox3D with tight bounds only returns matching entities', () => {
		const grid = buildTestGrid();
		const result = [] as number[];
		gridQueryBox3D(grid, 0, 0, 0, 40, 40, 40, result);

		expect(result.includes(1)).toBe(true);
		expect(result.includes(2)).toBe(false);
		expect(result.includes(3)).toBe(false);
	});

	test('gridQueryRadius3D returns entities within the sphere', () => {
		const grid = buildTestGrid();
		const result = [] as number[];
		// Center at (25,25,25) with radius 60 — reaches entity 2 at (75,25,25), dist=50
		gridQueryRadius3D(grid, 25, 25, 25, 60, result);

		expect(result.includes(1)).toBe(true);
		expect(result.includes(2)).toBe(true);
	});

	test('gridQueryRadius3D excludes entities outside the sphere', () => {
		const grid = createGrid3D(50);
		insertEntity3D(grid, 1, 50, 50, 50, 5, 5, 5);
		// Distance from (50,50,50) to (190,50,50) = 140 — outside radius 100
		insertEntity3D(grid, 2, 190, 50, 50, 5, 5, 5);

		const result = [] as number[];
		gridQueryRadius3D(grid, 50, 50, 50, 100, result);

		expect(result.includes(1)).toBe(true);
		expect(result.includes(2)).toBe(false);
	});

	test('gridQueryRadius3D corner case: entity at exact sphere boundary is included', () => {
		const grid = createGrid3D(50);
		insertEntity3D(grid, 1, 50, 50, 50, 5, 5, 5);
		// Closest point on AABB to (50,50,50) is (95,50,50), dist=45 < 50
		insertEntity3D(grid, 2, 100, 50, 50, 5, 5, 5);

		const result = [] as number[];
		gridQueryRadius3D(grid, 50, 50, 50, 50, result);

		expect(result.includes(2)).toBe(true);
	});

	test('queries work correctly after clear + rebuild', () => {
		const grid = createGrid3D(50);
		insertEntity3D(grid, 1, 25, 25, 25, 10, 10, 10);

		const r1 = [] as number[];
		gridQueryBox3D(grid, 0, 0, 0, 50, 50, 50, r1);
		expect(r1.includes(1)).toBe(true);

		clearGrid3D(grid);

		const r2 = [] as number[];
		gridQueryBox3D(grid, 0, 0, 0, 50, 50, 50, r2);
		expect(r2.includes(1)).toBe(false);

		insertEntity3D(grid, 2, 300, 300, 300, 10, 10, 10);

		const r3 = [] as number[];
		gridQueryBox3D(grid, 280, 280, 280, 320, 320, 320, r3);
		expect(r3.includes(2)).toBe(true);
	});
});

// ==================== Plugin Integration ====================

describe('Spatial Index 3D Plugin — Integration', () => {
	function buildEcs() {
		return ECSpresso
			.create()
			.withPlugin(createTransform3DPlugin())
			.withPlugin(createSpatialIndex3DPlugin())
			.withFixedTimestep(1 / 60)
			.build();
	}

	test('installs spatialIndex3D resource', () => {
		const ecs = buildEcs();
		expect(ecs.hasResource('spatialIndex3D')).toBe(true);
	});

	test('rebuild populates grid from entities with AABB3D colliders', () => {
		const ecs = buildEcs();

		ecs.spawn({
			...createTransform3D(100, 100, 100),
			aabb3DCollider: { width: 50, height: 50, depth: 50 },
		});

		ecs.spawn({
			...createTransform3D(200, 200, 200),
			aabb3DCollider: { width: 30, height: 30, depth: 30 },
		});

		ecs.update(1 / 60);

		const si = ecs.getResource('spatialIndex3D') as SpatialIndex3D;
		expect(liveEntryCount3D(si.grid)).toBe(2);
	});

	test('rebuild populates grid from entities with sphere colliders', () => {
		const ecs = buildEcs();

		ecs.spawn({
			...createTransform3D(100, 100, 100),
			sphereCollider: { radius: 25 },
		});

		ecs.update(1 / 60);

		const si = ecs.getResource('spatialIndex3D') as SpatialIndex3D;
		expect(liveEntryCount3D(si.grid)).toBe(1);
	});

	test('entities without colliders are not inserted', () => {
		const ecs = buildEcs();

		ecs.spawn({
			...createTransform3D(100, 100, 100),
			aabb3DCollider: { width: 50, height: 50, depth: 50 },
		});

		// Entity with no collider
		ecs.spawn({
			...createTransform3D(200, 200, 200),
		});

		ecs.update(1 / 60);

		const si = ecs.getResource('spatialIndex3D') as SpatialIndex3D;
		expect(liveEntryCount3D(si.grid)).toBe(1);
	});

	test('AABB3D collider stores correct half-extents', () => {
		const ecs = buildEcs();

		const entity = ecs.spawn({
			...createTransform3D(0, 0, 0),
			aabb3DCollider: { width: 40, height: 60, depth: 80 },
		});

		ecs.update(1 / 60);

		const si = ecs.getResource('spatialIndex3D') as SpatialIndex3D;
		const entry = si.getEntry(entity.id);
		expect(entry).toBeDefined();
		expect(entry!.halfW).toBe(20);
		expect(entry!.halfH).toBe(30);
		expect(entry!.halfD).toBe(40);
	});

	test('sphere collider uses radius as half-extent in all three dimensions', () => {
		const ecs = buildEcs();

		const entity = ecs.spawn({
			...createTransform3D(0, 0, 0),
			sphereCollider: { radius: 30 },
		});

		ecs.update(1 / 60);

		const si = ecs.getResource('spatialIndex3D') as SpatialIndex3D;
		const entry = si.getEntry(entity.id);
		expect(entry).toBeDefined();
		expect(entry!.halfW).toBe(30);
		expect(entry!.halfH).toBe(30);
		expect(entry!.halfD).toBe(30);
	});

	test('AABB3D offsets are applied to grid position', () => {
		const ecs = buildEcs();

		const entity = ecs.spawn({
			...createTransform3D(100, 100, 100),
			aabb3DCollider: { width: 40, height: 40, depth: 40, offsetX: 10, offsetY: 20, offsetZ: 30 },
		});

		ecs.update(1 / 60);

		const si = ecs.getResource('spatialIndex3D') as SpatialIndex3D;
		const entry = si.getEntry(entity.id);
		expect(entry).toBeDefined();
		expect(entry!.x).toBe(110); // 100 + 10
		expect(entry!.y).toBe(120); // 100 + 20
		expect(entry!.z).toBe(130); // 100 + 30
	});

	test('sphere offsets are applied to grid position', () => {
		const ecs = buildEcs();

		const entity = ecs.spawn({
			...createTransform3D(100, 100, 100),
			sphereCollider: { radius: 20, offsetX: -5, offsetY: 0, offsetZ: 15 },
		});

		ecs.update(1 / 60);

		const si = ecs.getResource('spatialIndex3D') as SpatialIndex3D;
		const entry = si.getEntry(entity.id);
		expect(entry).toBeDefined();
		expect(entry!.x).toBe(95);  // 100 + -5
		expect(entry!.y).toBe(100); // 100 + 0
		expect(entry!.z).toBe(115); // 100 + 15
	});

	test('when entity has both AABB3D and sphere, AABB3D wins for position and half-extents', () => {
		const ecs = buildEcs();

		const entity = ecs.spawn({
			...createTransform3D(100, 100, 100),
			aabb3DCollider: { width: 40, height: 40, depth: 40 },
			sphereCollider: { radius: 5 },
		});

		ecs.update(1 / 60);

		const si = ecs.getResource('spatialIndex3D') as SpatialIndex3D;
		const entry = si.getEntry(entity.id);
		expect(entry).toBeDefined();
		// AABB half-extents = 20, sphere radius = 5 → Math.max(20, 5) = 20
		expect(entry!.halfW).toBe(20);
		expect(entry!.halfH).toBe(20);
		expect(entry!.halfD).toBe(20);
	});

	test('grid clears between frames (no stale entries from removed entities)', () => {
		const ecs = buildEcs();

		const entity = ecs.spawn({
			...createTransform3D(100, 100, 100),
			aabb3DCollider: { width: 50, height: 50, depth: 50 },
		});

		ecs.update(1 / 60);

		const si = ecs.getResource('spatialIndex3D') as SpatialIndex3D;
		expect(liveEntryCount3D(si.grid)).toBe(1);

		ecs.removeEntity(entity.id);
		ecs.update(1 / 60); // removal buffered; entity still present in this rebuild
		ecs.update(1 / 60); // entity gone; grid should be empty

		expect(liveEntryCount3D(si.grid)).toBe(0);
	});

	test('custom cellSize is passed to the grid', () => {
		const ecs = ECSpresso
			.create()
			.withPlugin(createTransform3DPlugin())
			.withPlugin(createSpatialIndex3DPlugin({ cellSize: 128 }))
			.withFixedTimestep(1 / 60)
			.build();

		const si = ecs.getResource('spatialIndex3D') as SpatialIndex3D;
		expect(si.grid.cellSize).toBe(128);
	});

	test('custom phases option limits rebuild to specified phases', () => {
		const ecs = ECSpresso
			.create()
			.withPlugin(createTransform3DPlugin())
			.withPlugin(createSpatialIndex3DPlugin({ phases: ['postUpdate'] }))
			.withFixedTimestep(1 / 60)
			.build();

		ecs.spawn({
			...createTransform3D(100, 100, 100),
			aabb3DCollider: { width: 50, height: 50, depth: 50 },
		});

		ecs.update(1 / 60);

		const si = ecs.getResource('spatialIndex3D') as SpatialIndex3D;
		expect(liveEntryCount3D(si.grid)).toBe(1);
	});
});

// ==================== Resource Query API ====================

describe('Spatial Index 3D — Resource Query API', () => {
	function buildEcsWithEntities() {
		const ecs = ECSpresso
			.create()
			.withPlugin(createTransform3DPlugin())
			.withPlugin(createSpatialIndex3DPlugin())
			.withFixedTimestep(1 / 60)
			.build();

		const e1 = ecs.spawn({
			...createTransform3D(100, 100, 100),
			aabb3DCollider: { width: 50, height: 50, depth: 50 },
		});

		const e2 = ecs.spawn({
			...createTransform3D(500, 500, 500),
			aabb3DCollider: { width: 50, height: 50, depth: 50 },
		});

		ecs.update(1 / 60);
		return { ecs, e1, e2 };
	}

	test('queryBox returns entity IDs overlapping the box', () => {
		const { ecs, e1 } = buildEcsWithEntities();
		const si = ecs.getResource('spatialIndex3D') as SpatialIndex3D;

		const nearby = si.queryBox(50, 50, 50, 150, 150, 150);
		expect(nearby.length).toBe(1);
		expect(nearby[0]).toBe(e1.id);
	});

	test('queryBox excludes distant entities', () => {
		const { ecs, e2 } = buildEcsWithEntities();
		const si = ecs.getResource('spatialIndex3D') as SpatialIndex3D;

		const nearby = si.queryBox(50, 50, 50, 150, 150, 150);
		expect(nearby).not.toContain(e2.id);
	});

	test('queryBoxInto writes results into the provided set', () => {
		const { ecs, e1 } = buildEcsWithEntities();
		const si = ecs.getResource('spatialIndex3D') as SpatialIndex3D;

		const result = [] as number[];
		si.queryBoxInto(50, 50, 50, 150, 150, 150, result);
		expect(result.includes(e1.id)).toBe(true);
	});

	test('queryRadius returns entity IDs within the sphere', () => {
		const { ecs, e1 } = buildEcsWithEntities();
		const si = ecs.getResource('spatialIndex3D') as SpatialIndex3D;

		const nearby = si.queryRadius(100, 100, 100, 50);
		expect(nearby.length).toBe(1);
		expect(nearby[0]).toBe(e1.id);
	});

	test('queryRadius excludes distant entities', () => {
		const { ecs, e2 } = buildEcsWithEntities();
		const si = ecs.getResource('spatialIndex3D') as SpatialIndex3D;

		const nearby = si.queryRadius(100, 100, 100, 50);
		expect(nearby).not.toContain(e2.id);
	});

	test('queryRadiusInto writes results into the provided set', () => {
		const { ecs, e1 } = buildEcsWithEntities();
		const si = ecs.getResource('spatialIndex3D') as SpatialIndex3D;

		const result = [] as number[];
		si.queryRadiusInto(100, 100, 100, 50, result);
		expect(result.includes(e1.id)).toBe(true);
	});

	test('getEntry returns the spatial entry for a known entity', () => {
		const { ecs, e1 } = buildEcsWithEntities();
		const si = ecs.getResource('spatialIndex3D') as SpatialIndex3D;

		const entry = si.getEntry(e1.id);
		expect(entry).toBeDefined();
		expect(entry!.entityId).toBe(e1.id);
		expect(entry!.x).toBe(100);
		expect(entry!.y).toBe(100);
		expect(entry!.z).toBe(100);
	});

	test('getEntry returns undefined for an entity not in the grid', () => {
		const { ecs } = buildEcsWithEntities();
		const si = ecs.getResource('spatialIndex3D') as SpatialIndex3D;

		expect(si.getEntry(99999)).toBeUndefined();
	});

	test('grid property is accessible on the resource', () => {
		const { ecs } = buildEcsWithEntities();
		const si = ecs.getResource('spatialIndex3D') as SpatialIndex3D;

		expect(si.grid).toBeDefined();
		expect(si.grid.entries).toBeDefined();
	});
});

// ==================== Performance Smoke Test ====================

describe('Spatial Index 3D — Performance', () => {
	test('500 entities completes update without timeout', () => {
		const ecs = ECSpresso
			.create()
			.withPlugin(createTransform3DPlugin())
			.withPlugin(createSpatialIndex3DPlugin())
			.build();

		for (let i = 0; i < 500; i++) {
			ecs.spawn({
				...createTransform3D(i * 20, (i % 50) * 20, (i % 25) * 20),
				aabb3DCollider: { width: 15, height: 15, depth: 15 },
			});
		}

		const start = performance.now();
		ecs.update(0.016);
		const elapsed = performance.now() - start;

		expect(elapsed).toBeLessThan(1000);
	});
});
