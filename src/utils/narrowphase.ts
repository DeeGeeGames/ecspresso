/**
 * Shared Narrowphase Module
 *
 * Provides contact-computing narrowphase tests and a generic collision
 * iteration pipeline used by both the collision plugin (event-only) and
 * the physics2D plugin (impulse response).
 */

import type { SpatialIndex } from './spatial-hash';

// ==================== Contact ====================

/**
 * Contact result from a narrowphase test. Normal points from A toward B.
 *
 * Narrowphase functions use this as an out-parameter: the caller owns the
 * struct, the function writes fields in place and returns `true` on hit.
 * The `onContact` callback in `detectCollisions` receives a shared module-
 * level instance — **subscribers must consume it synchronously and must not
 * retain the reference across frames**.
 */
export interface Contact {
	normalX: number;
	normalY: number;
	/** Penetration depth (positive = overlapping) */
	depth: number;
}

/**
 * Module-level reusable Contact passed down from `detectCollisions` into
 * narrowphase tests and forwarded to the `onContact` callback. Reused across
 * every pair in every frame — zero allocation in the narrowphase hot path.
 */
const _sharedContact: Contact = { normalX: 0, normalY: 0, depth: 0 };

// ==================== BaseColliderInfo ====================

/** Collider shape discriminator for the flattened BaseColliderInfo layout. */
export const AABB_SHAPE = 0;
export const CIRCLE_SHAPE = 1;
export type ColliderShape = typeof AABB_SHAPE | typeof CIRCLE_SHAPE;

/**
 * Minimum collider data shared by collision and physics bundles.
 *
 * Flat layout (no nested `aabb` / `circle` sub-objects): the `shape`
 * discriminator tells you whether to read `halfWidth`/`halfHeight`
 * (AABB) or `radius` (Circle). Unused fields are set to 0.
 *
 * This shape is pool-friendly — all fields are assigned in place each
 * frame without allocating nested objects.
 */
export interface BaseColliderInfo<L extends string = string> {
	entityId: number;
	x: number;
	y: number;
	layer: L;
	collidesWith: readonly L[];
	shape: ColliderShape;
	halfWidth: number;
	halfHeight: number;
	radius: number;
}

// ==================== Collider Construction ====================

/**
 * Populate a `BaseColliderInfo` slot in place from raw component data.
 * Returns `true` if the slot was filled, `false` if the entity has no
 * collider (caller should skip it).
 *
 * If an entity has both AABB and circle colliders, AABB wins and only
 * the AABB offset is applied. This matches the dispatch precedence in
 * `computeContact`; the previous implementation stacked both offsets,
 * which was a bug.
 */
export function fillBaseColliderInfo<L extends string>(
	info: BaseColliderInfo<L>,
	entityId: number,
	x: number,
	y: number,
	layer: L,
	collidesWith: readonly L[],
	aabb: { width: number; height: number; offsetX?: number; offsetY?: number } | undefined,
	circle: { radius: number; offsetX?: number; offsetY?: number } | undefined,
): boolean {
	info.entityId = entityId;
	info.layer = layer;
	info.collidesWith = collidesWith;

	if (aabb) {
		info.x = x + (aabb.offsetX ?? 0);
		info.y = y + (aabb.offsetY ?? 0);
		info.shape = AABB_SHAPE;
		info.halfWidth = aabb.width / 2;
		info.halfHeight = aabb.height / 2;
		info.radius = 0;
		return true;
	}

	if (circle) {
		info.x = x + (circle.offsetX ?? 0);
		info.y = y + (circle.offsetY ?? 0);
		info.shape = CIRCLE_SHAPE;
		info.halfWidth = 0;
		info.halfHeight = 0;
		info.radius = circle.radius;
		return true;
	}

	return false;
}

// ==================== Spatial Index Lookup ====================

/**
 * Retrieve the optional spatialIndex resource, returning undefined when absent.
 * Centralizes the cross-plugin typed lookup so individual plugins don't each
 * need to import SpatialIndex or repeat the tryGetResource pattern.
 */
export function tryGetSpatialIndex(
	tryGetResource: <T>(key: string) => T | undefined,
): SpatialIndex | undefined {
	return tryGetResource<SpatialIndex>('spatialIndex');
}

// ==================== Narrowphase Tests ====================

/**
 * Write an AABB-AABB contact into `out`. Returns `true` if the shapes
 * overlap (out was filled), `false` otherwise.
 */
export function computeAABBvsAABB(
	ax: number, ay: number, ahw: number, ahh: number,
	bx: number, by: number, bhw: number, bhh: number,
	out: Contact,
): boolean {
	const dx = bx - ax;
	const dy = by - ay;
	const overlapX = (ahw + bhw) - Math.abs(dx);
	const overlapY = (ahh + bhh) - Math.abs(dy);

	if (overlapX <= 0 || overlapY <= 0) return false;

	if (overlapX < overlapY) {
		out.normalX = dx >= 0 ? 1 : -1;
		out.normalY = 0;
		out.depth = overlapX;
		return true;
	}
	out.normalX = 0;
	out.normalY = dy >= 0 ? 1 : -1;
	out.depth = overlapY;
	return true;
}

export function computeCircleVsCircle(
	ax: number, ay: number, ar: number,
	bx: number, by: number, br: number,
	out: Contact,
): boolean {
	const dx = bx - ax;
	const dy = by - ay;
	const distSq = dx * dx + dy * dy;
	const radiusSum = ar + br;

	if (distSq >= radiusSum * radiusSum) return false;

	const dist = Math.sqrt(distSq);
	if (dist === 0) {
		out.normalX = 1;
		out.normalY = 0;
		out.depth = radiusSum;
		return true;
	}
	out.normalX = dx / dist;
	out.normalY = dy / dist;
	out.depth = radiusSum - dist;
	return true;
}

export function computeAABBvsCircle(
	aabbX: number, aabbY: number, ahw: number, ahh: number,
	circleX: number, circleY: number, radius: number,
	out: Contact,
): boolean {
	const closestX = Math.max(aabbX - ahw, Math.min(circleX, aabbX + ahw));
	const closestY = Math.max(aabbY - ahh, Math.min(circleY, aabbY + ahh));

	const dx = circleX - closestX;
	const dy = circleY - closestY;
	const distSq = dx * dx + dy * dy;

	if (distSq >= radius * radius) return false;

	// Circle center inside AABB
	if (distSq === 0) {
		const pushLeft = (circleX - (aabbX - ahw));
		const pushRight = ((aabbX + ahw) - circleX);
		const pushUp = (circleY - (aabbY - ahh));
		const pushDown = ((aabbY + ahh) - circleY);
		const minPush = Math.min(pushLeft, pushRight, pushUp, pushDown);

		if (minPush === pushRight) {
			out.normalX = 1; out.normalY = 0; out.depth = pushRight + radius;
			return true;
		}
		if (minPush === pushLeft) {
			out.normalX = -1; out.normalY = 0; out.depth = pushLeft + radius;
			return true;
		}
		if (minPush === pushDown) {
			out.normalX = 0; out.normalY = 1; out.depth = pushDown + radius;
			return true;
		}
		out.normalX = 0; out.normalY = -1; out.depth = pushUp + radius;
		return true;
	}

	const dist = Math.sqrt(distSq);
	out.normalX = dx / dist;
	out.normalY = dy / dist;
	out.depth = radius - dist;
	return true;
}

// ==================== Contact Dispatcher ====================

/**
 * Dispatch to the correct narrowphase function for the given pair and
 * write the contact into `out`. Returns `true` if the pair overlaps.
 */
export function computeContact(a: BaseColliderInfo, b: BaseColliderInfo, out: Contact): boolean {
	if (a.shape === AABB_SHAPE && b.shape === AABB_SHAPE) {
		return computeAABBvsAABB(
			a.x, a.y, a.halfWidth, a.halfHeight,
			b.x, b.y, b.halfWidth, b.halfHeight,
			out,
		);
	}

	if (a.shape === CIRCLE_SHAPE && b.shape === CIRCLE_SHAPE) {
		return computeCircleVsCircle(
			a.x, a.y, a.radius,
			b.x, b.y, b.radius,
			out,
		);
	}

	if (a.shape === AABB_SHAPE && b.shape === CIRCLE_SHAPE) {
		return computeAABBvsCircle(
			a.x, a.y, a.halfWidth, a.halfHeight,
			b.x, b.y, b.radius,
			out,
		);
	}

	// a is Circle, b is AABB — compute as AABB-vs-Circle, then flip normal in place
	if (!computeAABBvsCircle(
		b.x, b.y, b.halfWidth, b.halfHeight,
		a.x, a.y, a.radius,
		out,
	)) return false;
	out.normalX = -out.normalX;
	out.normalY = -out.normalY;
	return true;
}

// ==================== Collision Iteration ====================

/** Module-level reusable set for broadphase candidates. */
const _broadphaseCandidates = new Set<number>();

let _bruteForceWarned = false;
const BRUTE_FORCE_WARN_THRESHOLD = 50;

/**
 * Generic collision detection pipeline: brute-force or broadphase,
 * with layer filtering and contact computation.
 *
 * `count` is the number of live entries at the front of `colliders`.
 * The array itself may be a grow-only pool — only indices `[0, count)`
 * are iterated, so trailing pool slots are ignored.
 *
 * `workingMap` is a caller-owned `Map<number, I>` used by the broadphase
 * path as an entityId → collider lookup. It is cleared and repopulated on
 * each call; callers should allocate it once and pass the same instance
 * every frame. Unused by the brute-force path but still required so that
 * typed reuse is the default, not an opt-in.
 *
 * Uses a context parameter forwarded to the callback to avoid
 * per-frame closure allocation.
 */
export function detectCollisions<I extends BaseColliderInfo, C>(
	colliders: I[],
	count: number,
	workingMap: Map<number, I>,
	spatialIndex: SpatialIndex | undefined,
	onContact: (a: I, b: I, contact: Contact, context: C) => void,
	context: C,
): void {
	if (spatialIndex) {
		broadphaseDetect(colliders, count, workingMap, spatialIndex, onContact, context);
	} else {
		bruteForceDetect(colliders, count, onContact, context);
	}
}

function bruteForceDetect<I extends BaseColliderInfo, C>(
	colliders: I[],
	count: number,
	onContact: (a: I, b: I, contact: Contact, context: C) => void,
	context: C,
): void {
	if (!_bruteForceWarned && count >= BRUTE_FORCE_WARN_THRESHOLD) {
		_bruteForceWarned = true;
		console.warn(
			`[ecspresso] Collision detection is using O(n²) brute force with ${count} colliders. ` +
			`For better performance, install createSpatialIndexPlugin() alongside your collision or physics2D plugin.`,
		);
	}

	for (let i = 0; i < count; i++) {
		const a = colliders[i];
		if (!a) continue;

		for (let j = i + 1; j < count; j++) {
			const b = colliders[j];
			if (!b) continue;

			if (!a.collidesWith.includes(b.layer) && !b.collidesWith.includes(a.layer)) continue;

			if (!computeContact(a, b, _sharedContact)) continue;

			onContact(a, b, _sharedContact, context);
		}
	}
}

function broadphaseDetect<I extends BaseColliderInfo, C>(
	colliders: I[],
	count: number,
	colliderMap: Map<number, I>,
	spatialIndex: SpatialIndex,
	onContact: (a: I, b: I, contact: Contact, context: C) => void,
	context: C,
): void {
	colliderMap.clear();
	for (let i = 0; i < count; i++) {
		const c = colliders[i];
		if (!c) continue;
		colliderMap.set(c.entityId, c);
	}

	for (let i = 0; i < count; i++) {
		const a = colliders[i];
		if (!a) continue;

		const aHalfW = a.shape === AABB_SHAPE ? a.halfWidth : a.radius;
		const aHalfH = a.shape === AABB_SHAPE ? a.halfHeight : a.radius;

		_broadphaseCandidates.clear();
		spatialIndex.queryRectInto(
			a.x - aHalfW, a.y - aHalfH,
			a.x + aHalfW, a.y + aHalfH,
			_broadphaseCandidates,
			a.entityId,
		);

		for (const bId of _broadphaseCandidates) {
			const b = colliderMap.get(bId);
			if (!b) continue;

			if (!a.collidesWith.includes(b.layer) && !b.collidesWith.includes(a.layer)) continue;

			if (!computeContact(a, b, _sharedContact)) continue;

			onContact(a, b, _sharedContact, context);
		}
	}
}
