import { describe, test, expect } from 'bun:test';
import {
	computeAABBvsAABB,
	computeCircleVsCircle,
	computeAABBvsCircle,
	computeContact,
	detectCollisions,
	createBroadphaseScratch,
	fillBaseColliderInfo,
	getLayerBit,
	getCollidesWithMask,
	AABB_SHAPE,
	CIRCLE_SHAPE,
	type Contact,
	type BaseColliderInfo,
} from './narrowphase';
import {
	createGrid,
	insertEntity,
	gridQueryRect,
	type SpatialIndex,
} from './spatial-hash';

// ==================== Helpers ====================

function makeAABB<L extends string>(
	entityId: number, x: number, y: number, layer: L, collidesWith: readonly L[],
	halfWidth: number, halfHeight: number,
): BaseColliderInfo<L> {
	return {
		entityId, x, y, layer, collidesWith,
		layerBit: getLayerBit(layer),
		collidesWithMask: getCollidesWithMask(collidesWith),
		shape: AABB_SHAPE,
		halfWidth, halfHeight,
		radius: 0,
	};
}

function makeCircle<L extends string>(
	entityId: number, x: number, y: number, layer: L, collidesWith: readonly L[],
	radius: number,
): BaseColliderInfo<L> {
	return {
		entityId, x, y, layer, collidesWith,
		layerBit: getLayerBit(layer),
		collidesWithMask: getCollidesWithMask(collidesWith),
		shape: CIRCLE_SHAPE,
		halfWidth: 0, halfHeight: 0,
		radius,
	};
}

// ==================== BaseColliderInfo generic layer type ====================

describe('BaseColliderInfo generic layer type', () => {
	test('BaseColliderInfo<L> preserves layer and collidesWith types', () => {
		type Layer = 'player' | 'enemy';
		const info = makeAABB<Layer>(1, 0, 0, 'player', ['enemy'], 10, 10);
		const _layer: Layer = info.layer;
		const _collidesWith: readonly Layer[] = info.collidesWith;
		void _layer;
		void _collidesWith;
		expect(info.layer).toBe('player');
	});

	test('BaseColliderInfo (bare) defaults to string', () => {
		const info = makeAABB(1, 0, 0, 'anything', ['whatever'], 5, 5);
		const _layer: string = info.layer;
		void _layer;
		expect(info.layer).toBe('anything');
	});

	test('detectCollisions callback receives narrow layer type via I', () => {
		type Layer = 'a' | 'b';
		const colliders: BaseColliderInfo<Layer>[] = [
			makeAABB<Layer>(1, 0, 0, 'a', ['b'], 10, 10),
			makeAABB<Layer>(2, 5, 0, 'b', ['a'], 10, 10),
		];

		const layers: Layer[] = [];
		detectCollisions(
			colliders,
			colliders.length,
			createBroadphaseScratch(),
			undefined,
			(a, b, _contact, ctx) => {
				// a.layer and b.layer should be Layer, not string
				const _aLayer: Layer = a.layer;
				const _bLayer: Layer = b.layer;
				void _aLayer;
				void _bLayer;
				ctx.push(a.layer, b.layer);
			},
			layers,
		);

		expect(layers).toEqual(['a', 'b']);
	});

	test('@ts-expect-error rejects invalid layer values', () => {
		type Layer = 'player' | 'enemy';
		const _info: BaseColliderInfo<Layer> = {
			entityId: 1, x: 0, y: 0,
			// @ts-expect-error — 'goblin' is not assignable to Layer
			layer: 'goblin',
			collidesWith: [],
			layerBit: 0, collidesWithMask: 0,
			shape: AABB_SHAPE,
			halfWidth: 0, halfHeight: 0, radius: 0,
		};
		void _info;
	});
});

// ==================== fillBaseColliderInfo ====================

describe('fillBaseColliderInfo', () => {
	function freshSlot<L extends string>(layer: L): BaseColliderInfo<L> {
		return {
			entityId: 0, x: 0, y: 0, layer, collidesWith: [],
			layerBit: 0, collidesWithMask: 0,
			shape: AABB_SHAPE, halfWidth: 0, halfHeight: 0, radius: 0,
		};
	}

	test('fills AABB shape', () => {
		const slot = freshSlot('a');
		const ok = fillBaseColliderInfo(
			slot, 1, 100, 200, 'a', ['b'],
			{ width: 40, height: 20 }, undefined,
		);
		expect(ok).toBe(true);
		expect(slot.shape).toBe(AABB_SHAPE);
		expect(slot.halfWidth).toBe(20);
		expect(slot.halfHeight).toBe(10);
		expect(slot.radius).toBe(0);
		expect(slot.x).toBe(100);
		expect(slot.y).toBe(200);
	});

	test('fills Circle shape', () => {
		const slot = freshSlot('a');
		const ok = fillBaseColliderInfo(
			slot, 1, 100, 200, 'a', ['b'],
			undefined, { radius: 15 },
		);
		expect(ok).toBe(true);
		expect(slot.shape).toBe(CIRCLE_SHAPE);
		expect(slot.halfWidth).toBe(0);
		expect(slot.halfHeight).toBe(0);
		expect(slot.radius).toBe(15);
	});

	test('applies AABB offset', () => {
		const slot = freshSlot('a');
		fillBaseColliderInfo(
			slot, 1, 100, 200, 'a', [],
			{ width: 10, height: 10, offsetX: 5, offsetY: -3 }, undefined,
		);
		expect(slot.x).toBe(105);
		expect(slot.y).toBe(197);
	});

	test('applies Circle offset', () => {
		const slot = freshSlot('a');
		fillBaseColliderInfo(
			slot, 1, 100, 200, 'a', [],
			undefined, { radius: 5, offsetX: 2, offsetY: 4 },
		);
		expect(slot.x).toBe(102);
		expect(slot.y).toBe(204);
	});

	test('prefers AABB when both are present', () => {
		const slot = freshSlot('a');
		fillBaseColliderInfo(
			slot, 1, 100, 200, 'a', [],
			{ width: 40, height: 40 }, { radius: 10 },
		);
		expect(slot.shape).toBe(AABB_SHAPE);
		expect(slot.halfWidth).toBe(20);
		expect(slot.radius).toBe(0);
	});

	test('returns false when neither collider is present', () => {
		const slot = freshSlot('a');
		const ok = fillBaseColliderInfo(slot, 1, 0, 0, 'a', [], undefined, undefined);
		expect(ok).toBe(false);
	});

	test('re-fill reuses the same slot object', () => {
		const slot = freshSlot('a');
		fillBaseColliderInfo(slot, 1, 0, 0, 'a', [], { width: 10, height: 10 }, undefined);
		fillBaseColliderInfo(slot, 2, 50, 50, 'a', [], undefined, { radius: 7 });
		expect(slot.entityId).toBe(2);
		expect(slot.shape).toBe(CIRCLE_SHAPE);
		expect(slot.radius).toBe(7);
		// Stale AABB fields are reset
		expect(slot.halfWidth).toBe(0);
		expect(slot.halfHeight).toBe(0);
	});
});

// Reusable Contact out-param for test call sites
function freshContact(): Contact {
	return { normalX: 0, normalY: 0, depth: 0 };
}

// ==================== AABB vs AABB ====================

describe('computeAABBvsAABB', () => {
	test('overlapping AABBs return contact with correct depth', () => {
		// Two 20x20 AABBs, 15 apart on x axis → overlap of 5 on x, 20 on y
		const out = freshContact();
		expect(computeAABBvsAABB(0, 0, 10, 10, 15, 0, 10, 10, out)).toBe(true);
		// Minimum penetration axis is x (5 < 20)
		expect(out.depth).toBeCloseTo(5);
		// Normal points from A toward B (positive x)
		expect(out.normalX).toBe(1);
		expect(out.normalY).toBe(0);
	});

	test('non-overlapping AABBs return false', () => {
		const out = freshContact();
		expect(computeAABBvsAABB(0, 0, 10, 10, 25, 0, 10, 10, out)).toBe(false);
	});

	test('touching edges (zero overlap) return false', () => {
		// Exact edge touch: halfWidths sum = distance
		const out = freshContact();
		expect(computeAABBvsAABB(0, 0, 10, 10, 20, 0, 10, 10, out)).toBe(false);
	});

	test('selects axis of least penetration', () => {
		// 10 overlap on x, 5 overlap on y → normal along y
		const out = freshContact();
		expect(computeAABBvsAABB(0, 0, 10, 10, 10, 15, 10, 10, out)).toBe(true);
		expect(out.normalX).toBe(0);
		expect(out.normalY).toBe(1);
		expect(out.depth).toBeCloseTo(5);
	});

	test('normal points A→B when B is left of A', () => {
		const out = freshContact();
		expect(computeAABBvsAABB(15, 0, 10, 10, 0, 0, 10, 10, out)).toBe(true);
		expect(out.normalX).toBe(-1);
		expect(out.normalY).toBe(0);
	});

	test('normal points A→B when B is above A', () => {
		const out = freshContact();
		expect(computeAABBvsAABB(0, 15, 10, 10, 0, 0, 10, 10, out)).toBe(true);
		expect(out.normalX).toBe(0);
		expect(out.normalY).toBe(-1);
	});

	test('out-parameter is reused across calls (no allocation per test)', () => {
		const out = freshContact();
		computeAABBvsAABB(0, 0, 10, 10, 15, 0, 10, 10, out);
		const firstRef = out;
		computeAABBvsAABB(0, 0, 10, 10, 10, 15, 10, 10, out);
		// Same object, fields updated in place
		expect(out).toBe(firstRef);
		expect(out.normalY).toBe(1);
	});
});

// ==================== Circle vs Circle ====================

describe('computeCircleVsCircle', () => {
	test('overlapping circles return contact', () => {
		// radius 10 each, 15 apart → overlap of 5
		const out = freshContact();
		expect(computeCircleVsCircle(0, 0, 10, 15, 0, 10, out)).toBe(true);
		expect(out.depth).toBeCloseTo(5);
		// Normal points from A toward B (positive x)
		expect(out.normalX).toBeCloseTo(1);
		expect(out.normalY).toBeCloseTo(0);
	});

	test('non-overlapping circles return false', () => {
		const out = freshContact();
		expect(computeCircleVsCircle(0, 0, 10, 25, 0, 10, out)).toBe(false);
	});

	test('touching circles (zero overlap) return false', () => {
		const out = freshContact();
		expect(computeCircleVsCircle(0, 0, 10, 20, 0, 10, out)).toBe(false);
	});

	test('coincident centers use arbitrary normal', () => {
		const out = freshContact();
		expect(computeCircleVsCircle(5, 5, 10, 5, 5, 10, out)).toBe(true);
		expect(out.depth).toBeCloseTo(20);
		// Arbitrary but deterministic: normalX=1, normalY=0
		expect(out.normalX).toBe(1);
		expect(out.normalY).toBe(0);
	});

	test('normal direction for diagonal separation', () => {
		// B is at (10, 10) from A at (0, 0), radius 15 each → overlap
		const out = freshContact();
		expect(computeCircleVsCircle(0, 0, 15, 10, 10, 15, out)).toBe(true);
		// Normal should point toward (10,10) direction, normalized
		const len = Math.sqrt(10 * 10 + 10 * 10);
		expect(out.normalX).toBeCloseTo(10 / len);
		expect(out.normalY).toBeCloseTo(10 / len);
	});
});

// ==================== AABB vs Circle ====================

describe('computeAABBvsCircle', () => {
	test('circle overlapping AABB edge returns contact', () => {
		// AABB at (0,0) half 10x10 → extends from -10 to 10
		// Circle at (12, 0) radius 5 → closest point on AABB is (10, 0), distance=2, overlap=3
		const out = freshContact();
		expect(computeAABBvsCircle(0, 0, 10, 10, 12, 0, 5, out)).toBe(true);
		expect(out.depth).toBeCloseTo(3);
		// Normal points from AABB toward circle (positive x)
		expect(out.normalX).toBeCloseTo(1);
		expect(out.normalY).toBeCloseTo(0);
	});

	test('non-overlapping AABB and circle return false', () => {
		const out = freshContact();
		expect(computeAABBvsCircle(0, 0, 10, 10, 20, 0, 5, out)).toBe(false);
	});

	test('circle center inside AABB pushes out along shortest axis', () => {
		// AABB at (0,0) half 20x20, circle at (18, 0) radius 5
		// Circle center is inside AABB. Push distances: right=2, left=38, up=20, down=20
		// Minimum push is right (2), depth = 2 + radius = 7
		const out = freshContact();
		expect(computeAABBvsCircle(0, 0, 20, 20, 18, 0, 5, out)).toBe(true);
		expect(out.normalX).toBe(1);
		expect(out.normalY).toBe(0);
		expect(out.depth).toBeCloseTo(7);
	});

	test('circle at corner of AABB', () => {
		// AABB at (0,0) half 10x10, circle at (12, 12) radius 5
		// Closest point is (10, 10), distance = sqrt(8) ≈ 2.83, depth = 5 - 2.83 ≈ 2.17
		const out = freshContact();
		expect(computeAABBvsCircle(0, 0, 10, 10, 12, 12, 5, out)).toBe(true);
		const expectedDist = Math.sqrt(4 + 4);
		expect(out.depth).toBeCloseTo(5 - expectedDist);
		// Normal from closest point toward circle center
		expect(out.normalX).toBeCloseTo(2 / expectedDist);
		expect(out.normalY).toBeCloseTo(2 / expectedDist);
	});
});

// ==================== computeContact dispatcher ====================

describe('computeContact', () => {
	test('routes AABB-AABB', () => {
		const a = makeAABB(1, 0, 0, 'a', ['b'], 10, 10);
		const b = makeAABB(2, 15, 0, 'b', ['a'], 10, 10);
		const out = freshContact();
		expect(computeContact(a, b, out)).toBe(true);
		expect(out.normalX).toBe(1);
	});

	test('routes Circle-Circle', () => {
		const a = makeCircle(1, 0, 0, 'a', ['b'], 10);
		const b = makeCircle(2, 15, 0, 'b', ['a'], 10);
		const out = freshContact();
		expect(computeContact(a, b, out)).toBe(true);
	});

	test('routes AABB-Circle', () => {
		const a = makeAABB(1, 0, 0, 'a', ['b'], 10, 10);
		const b = makeCircle(2, 12, 0, 'b', ['a'], 5);
		const out = freshContact();
		expect(computeContact(a, b, out)).toBe(true);
		// Normal should point from A (AABB) toward B (Circle)
		expect(out.normalX).toBeGreaterThan(0);
	});

	test('routes Circle-AABB and flips normal', () => {
		const a = makeCircle(1, 12, 0, 'a', ['b'], 5);
		const b = makeAABB(2, 0, 0, 'b', ['a'], 10, 10);
		const out = freshContact();
		expect(computeContact(a, b, out)).toBe(true);
		// Normal should point from A (Circle at x=12) toward B (AABB at x=0) → negative x
		expect(out.normalX).toBeLessThan(0);
	});
});

// ==================== detectCollisions ====================

describe('detectCollisions', () => {
	test('brute-force detects overlapping pair', () => {
		const colliders: BaseColliderInfo[] = [
			makeAABB(1, 0, 0, 'a', ['b'], 10, 10),
			makeAABB(2, 15, 0, 'b', ['a'], 10, 10),
		];

		const contacts: Array<{ a: number; b: number; contact: Contact }> = [];
		detectCollisions(
			colliders,
			colliders.length,
			createBroadphaseScratch(),
			undefined,
			(a, b, contact, ctx) => { ctx.push({ a: a.entityId, b: b.entityId, contact }); },
			contacts,
		);

		expect(contacts.length).toBe(1);
		expect(contacts[0]!.a).toBe(1);
		expect(contacts[0]!.b).toBe(2);
	});

	test('layer filtering excludes non-matching pairs', () => {
		const colliders: BaseColliderInfo[] = [
			makeAABB(1, 0, 0, 'a', ['a'], 10, 10),
			makeAABB(2, 5, 0, 'b', ['b'], 10, 10),
		];

		const contacts: Array<{ a: number; b: number }> = [];
		detectCollisions(
			colliders,
			colliders.length,
			createBroadphaseScratch(),
			undefined,
			(a, b, _contact, ctx) => { ctx.push({ a: a.entityId, b: b.entityId }); },
			contacts,
		);

		expect(contacts.length).toBe(0);
	});

	test('unidirectional layer match still triggers detection', () => {
		const colliders: BaseColliderInfo[] = [
			makeAABB(1, 0, 0, 'a', ['b'], 10, 10),
			makeAABB(2, 5, 0, 'b', [], 10, 10),
		];

		const contacts: Array<{ a: number; b: number }> = [];
		detectCollisions(
			colliders,
			colliders.length,
			createBroadphaseScratch(),
			undefined,
			(a, b, _contact, ctx) => { ctx.push({ a: a.entityId, b: b.entityId }); },
			contacts,
		);

		expect(contacts.length).toBe(1);
	});

	test('no duplicate pairs in brute-force (j = i+1 pattern)', () => {
		const colliders: BaseColliderInfo[] = [
			makeAABB(1, 0, 0, 'a', ['a'], 50, 50),
			makeAABB(2, 5, 0, 'a', ['a'], 50, 50),
			makeAABB(3, 10, 0, 'a', ['a'], 50, 50),
		];

		const contacts: Array<{ a: number; b: number }> = [];
		detectCollisions(
			colliders,
			colliders.length,
			createBroadphaseScratch(),
			undefined,
			(a, b, _contact, ctx) => { ctx.push({ a: a.entityId, b: b.entityId }); },
			contacts,
		);

		// 3 entities = 3 pairs: (1,2), (1,3), (2,3)
		expect(contacts.length).toBe(3);
		const pairKeys = contacts.map(c => `${c.a}:${c.b}`).sort();
		expect(pairKeys).toEqual(['1:2', '1:3', '2:3']);
	});

	test('context is forwarded to callback', () => {
		const colliders: BaseColliderInfo[] = [
			makeAABB(1, 0, 0, 'a', ['b'], 10, 10),
			makeAABB(2, 5, 0, 'b', ['a'], 10, 10),
		];

		const context = { called: false };
		detectCollisions(
			colliders,
			colliders.length,
			createBroadphaseScratch(),
			undefined,
			(_a, _b, _contact, ctx) => { ctx.called = true; },
			context,
		);

		expect(context.called).toBe(true);
	});

	test('empty colliders array produces no callbacks', () => {
		let called = false;
		detectCollisions(
			[],
			0,
			createBroadphaseScratch(),
			undefined,
			() => { called = true; },
			null,
		);
		expect(called).toBe(false);
	});

	test('single collider produces no callbacks', () => {
		let called = false;
		detectCollisions(
			[makeAABB(1, 0, 0, 'a', ['b'], 10, 10)],
			1,
			createBroadphaseScratch(),
			undefined,
			() => { called = true; },
			null,
		);
		expect(called).toBe(false);
	});

	test('count parameter limits iteration to prefix of grow-only pool', () => {
		// Pool has 5 slots, but only 2 are "live" this frame.
		// Slots 2..4 are stale from a previous frame and would cause false positives
		// if iterated — the count parameter must gate iteration.
		const pool: BaseColliderInfo[] = [
			makeAABB(1, 0, 0, 'a', ['a'], 10, 10),
			makeAABB(2, 5, 0, 'a', ['a'], 10, 10),
			// Stale slots — overlap the live ones but should not produce pairs
			makeAABB(99, 2, 0, 'a', ['a'], 10, 10),
			makeAABB(98, 3, 0, 'a', ['a'], 10, 10),
			makeAABB(97, 4, 0, 'a', ['a'], 10, 10),
		];

		const contacts: Array<{ a: number; b: number }> = [];
		detectCollisions(
			pool,
			2, // only first 2 are live
			createBroadphaseScratch(),
			undefined,
			(a, b, _c, ctx) => { ctx.push({ a: a.entityId, b: b.entityId }); },
			contacts,
		);

		expect(contacts.length).toBe(1);
		expect(contacts[0]!.a).toBe(1);
		expect(contacts[0]!.b).toBe(2);
	});

	test('broadphase isolates entries across calls (gen-stamp invalidates stale lookups)', () => {
		// Reuse one scratch across two calls so the gen-stamp invalidation is
		// the only thing keeping prior-call entries out of the current call.
		const grid = createGrid(64);
		const index: SpatialIndex = {
			grid,
			queryRect: () => [],
			queryRectInto: (minX, minY, maxX, maxY, result, minId) => gridQueryRect(grid, minX, minY, maxX, maxY, result, minId),
			queryRadius: () => [],
			queryRadiusInto: () => {},
			getEntry: (id) => grid.entries.get(id),
		};
		const scratch = createBroadphaseScratch<BaseColliderInfo>();

		const colliders: BaseColliderInfo[] = [
			makeAABB(1, 0, 0, 'a', ['a'], 10, 10),
			makeAABB(2, 15, 0, 'a', ['a'], 10, 10),
		];
		insertEntity(grid, 1, 0, 0, 10, 10);
		insertEntity(grid, 2, 15, 0, 10, 10);

		const contacts: Array<{ a: number; b: number }> = [];
		detectCollisions(
			colliders,
			colliders.length,
			scratch,
			index,
			(a, b, _c, ctx) => { ctx.push({ a: a.entityId, b: b.entityId }); },
			contacts,
		);
		expect(contacts.length).toBe(1);

		// Second call: only entity 10 is in `colliders2`, but the spatial grid
		// still surfaces ids 1 and 2 as candidates — the gen stamp must reject
		// them.
		const colliders2: BaseColliderInfo[] = [
			makeAABB(10, 0, 0, 'a', ['a'], 10, 10),
		];
		insertEntity(grid, 10, 0, 0, 10, 10);
		contacts.length = 0;
		detectCollisions(
			colliders2,
			colliders2.length,
			scratch,
			index,
			(a, b, _c, ctx) => { ctx.push({ a: a.entityId, b: b.entityId }); },
			contacts,
		);
		expect(contacts.length).toBe(0);
	});
});
