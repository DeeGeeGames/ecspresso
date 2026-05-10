import { describe, test, expect } from 'bun:test';
import {
	computeAABB3DvsAABB3D,
	computeSphereVsSphere,
	computeAABB3DvsSphere,
	computeContact3D,
	detectCollisions3D,
	fillBaseColliderInfo3D,
	AABB3D_SHAPE,
	SPHERE_SHAPE,
	type Contact3D,
	type BaseColliderInfo3D,
} from './narrowphase3D';
import {
	createGrid3D,
	insertEntity3D,
	gridQueryBox3D,
	type SpatialIndex3D,
	type SpatialHashGrid3D,
} from './spatial-hash3D';

// ==================== Helpers ====================

function makeAABB3D<L extends string>(
	entityId: number, x: number, y: number, z: number, layer: L, collidesWith: readonly L[],
	halfWidth: number, halfHeight: number, halfDepth: number,
): BaseColliderInfo3D<L> {
	return {
		entityId, x, y, z, layer, collidesWith,
		shape: AABB3D_SHAPE,
		halfWidth, halfHeight, halfDepth,
		radius: 0,
	};
}

function makeSphere<L extends string>(
	entityId: number, x: number, y: number, z: number, layer: L, collidesWith: readonly L[],
	radius: number,
): BaseColliderInfo3D<L> {
	return {
		entityId, x, y, z, layer, collidesWith,
		shape: SPHERE_SHAPE,
		halfWidth: 0, halfHeight: 0, halfDepth: 0,
		radius,
	};
}

function freshContact(): Contact3D {
	return { normalX: 0, normalY: 0, normalZ: 0, depth: 0 };
}

function stubSpatialIndex3D(grid: SpatialHashGrid3D): SpatialIndex3D {
	return {
		grid,
		queryBox: () => [],
		queryBoxInto: (minX, minY, minZ, maxX, maxY, maxZ, result, minId) =>
			gridQueryBox3D(grid, minX, minY, minZ, maxX, maxY, maxZ, result, minId),
		queryRadius: () => [],
		queryRadiusInto: () => {},
		getEntry: (id) => grid.entries.get(id),
	};
}

// ==================== fillBaseColliderInfo3D ====================

describe('fillBaseColliderInfo3D', () => {
	function freshSlot<L extends string>(layer: L): BaseColliderInfo3D<L> {
		return {
			entityId: 0, x: 0, y: 0, z: 0, layer, collidesWith: [],
			shape: AABB3D_SHAPE, halfWidth: 0, halfHeight: 0, halfDepth: 0, radius: 0,
		};
	}

	test('fills AABB3D shape', () => {
		const slot = freshSlot('a');
		const ok = fillBaseColliderInfo3D(
			slot, 1, 100, 200, 300, 'a', ['b'],
			{ width: 40, height: 20, depth: 10 }, undefined,
		);
		expect(ok).toBe(true);
		expect(slot.shape).toBe(AABB3D_SHAPE);
		expect(slot.halfWidth).toBe(20);
		expect(slot.halfHeight).toBe(10);
		expect(slot.halfDepth).toBe(5);
		expect(slot.radius).toBe(0);
		expect(slot.x).toBe(100);
		expect(slot.y).toBe(200);
		expect(slot.z).toBe(300);
	});

	test('fills sphere shape', () => {
		const slot = freshSlot('a');
		const ok = fillBaseColliderInfo3D(
			slot, 1, 100, 200, 300, 'a', ['b'],
			undefined, { radius: 15 },
		);
		expect(ok).toBe(true);
		expect(slot.shape).toBe(SPHERE_SHAPE);
		expect(slot.halfWidth).toBe(0);
		expect(slot.halfHeight).toBe(0);
		expect(slot.halfDepth).toBe(0);
		expect(slot.radius).toBe(15);
	});

	test('applies AABB3D offset', () => {
		const slot = freshSlot('a');
		fillBaseColliderInfo3D(
			slot, 1, 100, 200, 300, 'a', [],
			{ width: 10, height: 10, depth: 10, offsetX: 5, offsetY: -3, offsetZ: 7 }, undefined,
		);
		expect(slot.x).toBe(105);
		expect(slot.y).toBe(197);
		expect(slot.z).toBe(307);
	});

	test('applies sphere offset', () => {
		const slot = freshSlot('a');
		fillBaseColliderInfo3D(
			slot, 1, 100, 200, 300, 'a', [],
			undefined, { radius: 5, offsetX: 2, offsetY: 4, offsetZ: -1 },
		);
		expect(slot.x).toBe(102);
		expect(slot.y).toBe(204);
		expect(slot.z).toBe(299);
	});

	test('prefers AABB3D when both are present', () => {
		const slot = freshSlot('a');
		fillBaseColliderInfo3D(
			slot, 1, 100, 200, 300, 'a', [],
			{ width: 40, height: 40, depth: 40 }, { radius: 10 },
		);
		expect(slot.shape).toBe(AABB3D_SHAPE);
		expect(slot.halfWidth).toBe(20);
		expect(slot.radius).toBe(0);
	});

	test('returns false when neither collider is present', () => {
		const slot = freshSlot('a');
		const ok = fillBaseColliderInfo3D(slot, 1, 0, 0, 0, 'a', [], undefined, undefined);
		expect(ok).toBe(false);
	});

	test('re-fill reuses the same slot object', () => {
		const slot = freshSlot('a');
		fillBaseColliderInfo3D(slot, 1, 0, 0, 0, 'a', [], { width: 10, height: 10, depth: 10 }, undefined);
		fillBaseColliderInfo3D(slot, 2, 50, 50, 50, 'a', [], undefined, { radius: 7 });
		expect(slot.entityId).toBe(2);
		expect(slot.shape).toBe(SPHERE_SHAPE);
		expect(slot.radius).toBe(7);
		expect(slot.halfWidth).toBe(0);
		expect(slot.halfHeight).toBe(0);
		expect(slot.halfDepth).toBe(0);
	});
});

// ==================== AABB3D vs AABB3D ====================

describe('computeAABB3DvsAABB3D', () => {
	test('overlapping AABBs return contact with correct depth', () => {
		// Two 20x20x20 AABBs, 15 apart on x → overlap of 5 on x, 20 on y, 20 on z
		const out = freshContact();
		expect(computeAABB3DvsAABB3D(0, 0, 0, 10, 10, 10, 15, 0, 0, 10, 10, 10, out)).toBe(true);
		expect(out.depth).toBeCloseTo(5);
		expect(out.normalX).toBe(1);
		expect(out.normalY).toBe(0);
		expect(out.normalZ).toBe(0);
	});

	test('non-overlapping AABBs return false', () => {
		const out = freshContact();
		expect(computeAABB3DvsAABB3D(0, 0, 0, 10, 10, 10, 25, 0, 0, 10, 10, 10, out)).toBe(false);
	});

	test('touching edges (zero overlap) return false', () => {
		const out = freshContact();
		expect(computeAABB3DvsAABB3D(0, 0, 0, 10, 10, 10, 20, 0, 0, 10, 10, 10, out)).toBe(false);
	});

	test('selects X axis when X has least penetration', () => {
		const out = freshContact();
		// 5 overlap on x, 20 on y, 20 on z
		expect(computeAABB3DvsAABB3D(0, 0, 0, 10, 10, 10, 15, 0, 0, 10, 10, 10, out)).toBe(true);
		expect(out.normalX).toBe(1);
		expect(out.normalY).toBe(0);
		expect(out.normalZ).toBe(0);
		expect(out.depth).toBeCloseTo(5);
	});

	test('selects Y axis when Y has least penetration', () => {
		const out = freshContact();
		// 20 overlap on x, 5 overlap on y, 20 on z
		expect(computeAABB3DvsAABB3D(0, 0, 0, 10, 10, 10, 0, 15, 0, 10, 10, 10, out)).toBe(true);
		expect(out.normalX).toBe(0);
		expect(out.normalY).toBe(1);
		expect(out.normalZ).toBe(0);
		expect(out.depth).toBeCloseTo(5);
	});

	test('selects Z axis when Z has least penetration', () => {
		const out = freshContact();
		// 20 overlap on x, 20 on y, 5 overlap on z
		expect(computeAABB3DvsAABB3D(0, 0, 0, 10, 10, 10, 0, 0, 15, 10, 10, 10, out)).toBe(true);
		expect(out.normalX).toBe(0);
		expect(out.normalY).toBe(0);
		expect(out.normalZ).toBe(1);
		expect(out.depth).toBeCloseTo(5);
	});

	test('normal points A→B when B is in negative direction', () => {
		const out = freshContact();
		// B is behind A on x
		expect(computeAABB3DvsAABB3D(15, 0, 0, 10, 10, 10, 0, 0, 0, 10, 10, 10, out)).toBe(true);
		expect(out.normalX).toBe(-1);

		// B is below A on y
		expect(computeAABB3DvsAABB3D(0, 15, 0, 10, 10, 10, 0, 0, 0, 10, 10, 10, out)).toBe(true);
		expect(out.normalY).toBe(-1);

		// B is behind A on z
		expect(computeAABB3DvsAABB3D(0, 0, 15, 10, 10, 10, 0, 0, 0, 10, 10, 10, out)).toBe(true);
		expect(out.normalZ).toBe(-1);
	});

	test('separation on any single axis prevents overlap', () => {
		const out = freshContact();
		// Overlaps on X and Y, but separated on Z
		expect(computeAABB3DvsAABB3D(0, 0, 0, 10, 10, 10, 5, 5, 25, 10, 10, 10, out)).toBe(false);
	});

	test('out-parameter is reused across calls', () => {
		const out = freshContact();
		computeAABB3DvsAABB3D(0, 0, 0, 10, 10, 10, 15, 0, 0, 10, 10, 10, out);
		const firstRef = out;
		computeAABB3DvsAABB3D(0, 0, 0, 10, 10, 10, 0, 0, 15, 10, 10, 10, out);
		expect(out).toBe(firstRef);
		expect(out.normalZ).toBe(1);
	});
});

// ==================== Sphere vs Sphere ====================

describe('computeSphereVsSphere', () => {
	test('overlapping spheres return contact', () => {
		// radius 10 each, 15 apart on x → overlap of 5
		const out = freshContact();
		expect(computeSphereVsSphere(0, 0, 0, 10, 15, 0, 0, 10, out)).toBe(true);
		expect(out.depth).toBeCloseTo(5);
		expect(out.normalX).toBeCloseTo(1);
		expect(out.normalY).toBeCloseTo(0);
		expect(out.normalZ).toBeCloseTo(0);
	});

	test('non-overlapping spheres return false', () => {
		const out = freshContact();
		expect(computeSphereVsSphere(0, 0, 0, 10, 25, 0, 0, 10, out)).toBe(false);
	});

	test('touching spheres (zero overlap) return false', () => {
		const out = freshContact();
		expect(computeSphereVsSphere(0, 0, 0, 10, 20, 0, 0, 10, out)).toBe(false);
	});

	test('coincident centers use arbitrary normal', () => {
		const out = freshContact();
		expect(computeSphereVsSphere(5, 5, 5, 10, 5, 5, 5, 10, out)).toBe(true);
		expect(out.depth).toBeCloseTo(20);
		expect(out.normalX).toBe(1);
		expect(out.normalY).toBe(0);
		expect(out.normalZ).toBe(0);
	});

	test('normal direction for 3D diagonal separation', () => {
		// B is at (10, 10, 10) from A at origin, radius 20 each
		const out = freshContact();
		expect(computeSphereVsSphere(0, 0, 0, 20, 10, 10, 10, 20, out)).toBe(true);
		const len = Math.sqrt(300);
		expect(out.normalX).toBeCloseTo(10 / len);
		expect(out.normalY).toBeCloseTo(10 / len);
		expect(out.normalZ).toBeCloseTo(10 / len);
	});

	test('separation along Z axis', () => {
		const out = freshContact();
		// radius 10 each, 15 apart on z
		expect(computeSphereVsSphere(0, 0, 0, 10, 0, 0, 15, 10, out)).toBe(true);
		expect(out.depth).toBeCloseTo(5);
		expect(out.normalX).toBeCloseTo(0);
		expect(out.normalY).toBeCloseTo(0);
		expect(out.normalZ).toBeCloseTo(1);
	});
});

// ==================== AABB3D vs Sphere ====================

describe('computeAABB3DvsSphere', () => {
	test('sphere overlapping AABB edge returns contact', () => {
		// AABB at origin, half 10x10x10 → extends ±10
		// Sphere at (12, 0, 0) radius 5 → closest point on AABB is (10, 0, 0), dist=2, overlap=3
		const out = freshContact();
		expect(computeAABB3DvsSphere(0, 0, 0, 10, 10, 10, 12, 0, 0, 5, out)).toBe(true);
		expect(out.depth).toBeCloseTo(3);
		expect(out.normalX).toBeCloseTo(1);
		expect(out.normalY).toBeCloseTo(0);
		expect(out.normalZ).toBeCloseTo(0);
	});

	test('non-overlapping AABB and sphere return false', () => {
		const out = freshContact();
		expect(computeAABB3DvsSphere(0, 0, 0, 10, 10, 10, 20, 0, 0, 5, out)).toBe(false);
	});

	test('sphere center inside AABB pushes out along shortest axis', () => {
		// AABB at origin half 20x20x20, sphere at (18, 0, 0) radius 5
		// Push distances: right=2, left=38, up=20, down=20, front=20, back=20
		// Minimum push is right (2), depth = 2 + 5 = 7
		const out = freshContact();
		expect(computeAABB3DvsSphere(0, 0, 0, 20, 20, 20, 18, 0, 0, 5, out)).toBe(true);
		expect(out.normalX).toBe(1);
		expect(out.normalY).toBe(0);
		expect(out.normalZ).toBe(0);
		expect(out.depth).toBeCloseTo(7);
	});

	test('sphere center inside AABB resolves along Z when Z push is smallest', () => {
		// AABB at origin half 20x20x20, sphere at (0, 0, 18) radius 5
		// Push back (Z+) = 2, everything else >= 20
		const out = freshContact();
		expect(computeAABB3DvsSphere(0, 0, 0, 20, 20, 20, 0, 0, 18, 5, out)).toBe(true);
		expect(out.normalX).toBe(0);
		expect(out.normalY).toBe(0);
		expect(out.normalZ).toBe(1);
		expect(out.depth).toBeCloseTo(7);
	});

	test('sphere center inside AABB resolves along negative Z', () => {
		// sphere at (0, 0, -18), pushFront = 2
		const out = freshContact();
		expect(computeAABB3DvsSphere(0, 0, 0, 20, 20, 20, 0, 0, -18, 5, out)).toBe(true);
		expect(out.normalX).toBe(0);
		expect(out.normalY).toBe(0);
		expect(out.normalZ).toBe(-1);
		expect(out.depth).toBeCloseTo(7);
	});

	test('sphere at corner of AABB', () => {
		// AABB at origin half 10x10x10, sphere at (12, 12, 12) radius 10
		// Closest point is (10, 10, 10), distance = sqrt(12), depth = 10 - sqrt(12)
		const out = freshContact();
		expect(computeAABB3DvsSphere(0, 0, 0, 10, 10, 10, 12, 12, 12, 10, out)).toBe(true);
		const expectedDist = Math.sqrt(4 + 4 + 4);
		expect(out.depth).toBeCloseTo(10 - expectedDist);
		expect(out.normalX).toBeCloseTo(2 / expectedDist);
		expect(out.normalY).toBeCloseTo(2 / expectedDist);
		expect(out.normalZ).toBeCloseTo(2 / expectedDist);
	});

	test('sphere along Z edge of AABB', () => {
		// AABB at origin half 10x10x10, sphere at (0, 0, 12) radius 5
		// Closest point (0, 0, 10), dist=2, depth=3
		const out = freshContact();
		expect(computeAABB3DvsSphere(0, 0, 0, 10, 10, 10, 0, 0, 12, 5, out)).toBe(true);
		expect(out.depth).toBeCloseTo(3);
		expect(out.normalX).toBeCloseTo(0);
		expect(out.normalY).toBeCloseTo(0);
		expect(out.normalZ).toBeCloseTo(1);
	});
});

// ==================== computeContact3D dispatcher ====================

describe('computeContact3D', () => {
	test('routes AABB3D-AABB3D', () => {
		const a = makeAABB3D(1, 0, 0, 0, 'a', ['b'], 10, 10, 10);
		const b = makeAABB3D(2, 15, 0, 0, 'b', ['a'], 10, 10, 10);
		const out = freshContact();
		expect(computeContact3D(a, b, out)).toBe(true);
		expect(out.normalX).toBe(1);
	});

	test('routes Sphere-Sphere', () => {
		const a = makeSphere(1, 0, 0, 0, 'a', ['b'], 10);
		const b = makeSphere(2, 15, 0, 0, 'b', ['a'], 10);
		const out = freshContact();
		expect(computeContact3D(a, b, out)).toBe(true);
		expect(out.normalX).toBeGreaterThan(0);
	});

	test('routes AABB3D-Sphere', () => {
		const a = makeAABB3D(1, 0, 0, 0, 'a', ['b'], 10, 10, 10);
		const b = makeSphere(2, 12, 0, 0, 'b', ['a'], 5);
		const out = freshContact();
		expect(computeContact3D(a, b, out)).toBe(true);
		expect(out.normalX).toBeGreaterThan(0);
	});

	test('routes Sphere-AABB3D and flips normal', () => {
		const a = makeSphere(1, 12, 0, 0, 'a', ['b'], 5);
		const b = makeAABB3D(2, 0, 0, 0, 'b', ['a'], 10, 10, 10);
		const out = freshContact();
		expect(computeContact3D(a, b, out)).toBe(true);
		// Normal should point from A (Sphere at x=12) toward B (AABB at x=0) → negative x
		expect(out.normalX).toBeLessThan(0);
	});

	test('Sphere-AABB3D flips all three normal components', () => {
		// Sphere at (12, 12, 12), AABB at origin half 10x10x10
		const a = makeSphere(1, 12, 12, 12, 'a', ['b'], 10);
		const b = makeAABB3D(2, 0, 0, 0, 'b', ['a'], 10, 10, 10);
		const out = freshContact();
		expect(computeContact3D(a, b, out)).toBe(true);
		// Normal from A toward B means all components should be negative
		expect(out.normalX).toBeLessThan(0);
		expect(out.normalY).toBeLessThan(0);
		expect(out.normalZ).toBeLessThan(0);
	});
});

// ==================== detectCollisions3D ====================

describe('detectCollisions3D', () => {
	test('brute-force detects overlapping pair', () => {
		const colliders: BaseColliderInfo3D[] = [
			makeAABB3D(1, 0, 0, 0, 'a', ['b'], 10, 10, 10),
			makeAABB3D(2, 15, 0, 0, 'b', ['a'], 10, 10, 10),
		];

		const contacts: Array<{ a: number; b: number }> = [];
		detectCollisions3D(
			colliders, colliders.length, new Map(), undefined,
			(a, b, _contact, ctx) => { ctx.push({ a: a.entityId, b: b.entityId }); },
			contacts,
		);

		expect(contacts.length).toBe(1);
		expect(contacts[0]!.a).toBe(1);
		expect(contacts[0]!.b).toBe(2);
	});

	test('layer filtering excludes non-matching pairs', () => {
		const colliders: BaseColliderInfo3D[] = [
			makeAABB3D(1, 0, 0, 0, 'a', ['a'], 10, 10, 10),
			makeAABB3D(2, 5, 0, 0, 'b', ['b'], 10, 10, 10),
		];

		const contacts: Array<{ a: number; b: number }> = [];
		detectCollisions3D(
			colliders, colliders.length, new Map(), undefined,
			(a, b, _contact, ctx) => { ctx.push({ a: a.entityId, b: b.entityId }); },
			contacts,
		);

		expect(contacts.length).toBe(0);
	});

	test('unidirectional layer match still triggers detection', () => {
		const colliders: BaseColliderInfo3D[] = [
			makeAABB3D(1, 0, 0, 0, 'a', ['b'], 10, 10, 10),
			makeAABB3D(2, 5, 0, 0, 'b', [], 10, 10, 10),
		];

		const contacts: Array<{ a: number; b: number }> = [];
		detectCollisions3D(
			colliders, colliders.length, new Map(), undefined,
			(a, b, _contact, ctx) => { ctx.push({ a: a.entityId, b: b.entityId }); },
			contacts,
		);

		expect(contacts.length).toBe(1);
	});

	test('no duplicate pairs in brute-force', () => {
		const colliders: BaseColliderInfo3D[] = [
			makeAABB3D(1, 0, 0, 0, 'a', ['a'], 50, 50, 50),
			makeAABB3D(2, 5, 0, 0, 'a', ['a'], 50, 50, 50),
			makeAABB3D(3, 10, 0, 0, 'a', ['a'], 50, 50, 50),
		];

		const contacts: Array<{ a: number; b: number }> = [];
		detectCollisions3D(
			colliders, colliders.length, new Map(), undefined,
			(a, b, _contact, ctx) => { ctx.push({ a: a.entityId, b: b.entityId }); },
			contacts,
		);

		expect(contacts.length).toBe(3);
		const pairKeys = contacts.map(c => `${c.a}:${c.b}`).sort();
		expect(pairKeys).toEqual(['1:2', '1:3', '2:3']);
	});

	test('context is forwarded to callback', () => {
		const colliders: BaseColliderInfo3D[] = [
			makeAABB3D(1, 0, 0, 0, 'a', ['b'], 10, 10, 10),
			makeAABB3D(2, 5, 0, 0, 'b', ['a'], 10, 10, 10),
		];

		const context = { called: false };
		detectCollisions3D(
			colliders, colliders.length, new Map(), undefined,
			(_a, _b, _contact, ctx) => { ctx.called = true; },
			context,
		);

		expect(context.called).toBe(true);
	});

	test('empty colliders array produces no callbacks', () => {
		let called = false;
		detectCollisions3D([], 0, new Map(), undefined, () => { called = true; }, null);
		expect(called).toBe(false);
	});

	test('single collider produces no callbacks', () => {
		let called = false;
		detectCollisions3D(
			[makeAABB3D(1, 0, 0, 0, 'a', ['b'], 10, 10, 10)],
			1, new Map(), undefined, () => { called = true; }, null,
		);
		expect(called).toBe(false);
	});

	test('count parameter limits iteration to prefix of grow-only pool', () => {
		const pool: BaseColliderInfo3D[] = [
			makeAABB3D(1, 0, 0, 0, 'a', ['a'], 10, 10, 10),
			makeAABB3D(2, 5, 0, 0, 'a', ['a'], 10, 10, 10),
			// Stale slots
			makeAABB3D(99, 2, 0, 0, 'a', ['a'], 10, 10, 10),
			makeAABB3D(98, 3, 0, 0, 'a', ['a'], 10, 10, 10),
		];

		const contacts: Array<{ a: number; b: number }> = [];
		detectCollisions3D(
			pool, 2, new Map(), undefined,
			(a, b, _c, ctx) => { ctx.push({ a: a.entityId, b: b.entityId }); },
			contacts,
		);

		expect(contacts.length).toBe(1);
		expect(contacts[0]!.a).toBe(1);
		expect(contacts[0]!.b).toBe(2);
	});

	test('broadphase uses caller-provided workingMap', () => {
		const grid = createGrid3D(64);
		const index = stubSpatialIndex3D(grid);

		const colliders: BaseColliderInfo3D[] = [
			makeAABB3D(1, 0, 0, 0, 'a', ['a'], 10, 10, 10),
			makeAABB3D(2, 15, 0, 0, 'a', ['a'], 10, 10, 10),
		];
		insertEntity3D(grid, 1, 0, 0, 0, 10, 10, 10);
		insertEntity3D(grid, 2, 15, 0, 0, 10, 10, 10);

		// Pre-populate with stale garbage
		const workingMap = new Map<number, BaseColliderInfo3D>();
		workingMap.set(99, makeAABB3D(99, 0, 0, 0, 'a', [], 0, 0, 0));

		const contacts: Array<{ a: number; b: number }> = [];
		detectCollisions3D(
			colliders, colliders.length, workingMap, index,
			(a, b, _c, ctx) => { ctx.push({ a: a.entityId, b: b.entityId }); },
			contacts,
		);

		expect(contacts.length).toBe(1);
		expect(workingMap.has(99)).toBe(false);
		expect(workingMap.has(1)).toBe(true);
		expect(workingMap.has(2)).toBe(true);
	});

	test('broadphase detects Z-axis overlap', () => {
		const grid = createGrid3D(64);
		const index = stubSpatialIndex3D(grid);

		// Two AABBs overlapping only because of Z proximity
		const colliders: BaseColliderInfo3D[] = [
			makeAABB3D(1, 0, 0, 0, 'a', ['a'], 10, 10, 10),
			makeAABB3D(2, 0, 0, 15, 'a', ['a'], 10, 10, 10),
		];
		insertEntity3D(grid, 1, 0, 0, 0, 10, 10, 10);
		insertEntity3D(grid, 2, 0, 0, 15, 10, 10, 10);

		const contacts: Array<{ a: number; b: number }> = [];
		detectCollisions3D(
			colliders, colliders.length, new Map(), index,
			(a, b, _c, ctx) => { ctx.push({ a: a.entityId, b: b.entityId }); },
			contacts,
		);

		expect(contacts.length).toBe(1);
		expect(contacts[0]!.a).toBe(1);
		expect(contacts[0]!.b).toBe(2);
	});
});
