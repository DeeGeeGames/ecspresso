/**
 * Shared Narrowphase Module — 3D
 *
 * Provides contact-computing narrowphase tests and a generic collision
 * iteration pipeline for 3D collider pairs (AABB3D + Sphere).
 *
 * Mirrors the 2D narrowphase (`narrowphase.ts`) with an added Z axis.
 */

import type { SpatialIndex3D } from './spatial-hash3D';
import { createLayerBitRegistry } from './layer-bit-registry';

// ==================== Contact3D ====================

/**
 * Contact result from a 3D narrowphase test. Normal points from A toward B.
 *
 * Narrowphase functions use this as an out-parameter: the caller owns the
 * struct, the function writes fields in place and returns `true` on hit.
 * The `onContact` callback in `detectCollisions3D` receives a shared module-
 * level instance — **subscribers must consume it synchronously and must not
 * retain the reference across frames**.
 */
export interface Contact3D {
	normalX: number;
	normalY: number;
	normalZ: number;
	/** Penetration depth (positive = overlapping) */
	depth: number;
}

/**
 * Module-level reusable Contact3D passed down from `detectCollisions3D` into
 * narrowphase tests and forwarded to the `onContact` callback. Reused across
 * every pair in every frame — zero allocation in the narrowphase hot path.
 */
const _sharedContact: Contact3D = { normalX: 0, normalY: 0, normalZ: 0, depth: 0 };

// ==================== BaseColliderInfo3D ====================

/** Collider shape discriminator for the flattened BaseColliderInfo3D layout. */
export const AABB3D_SHAPE = 0;
export const SPHERE_SHAPE = 1;
export type ColliderShape3D = typeof AABB3D_SHAPE | typeof SPHERE_SHAPE;

/**
 * Minimum collider data shared by 3D collision and physics bundles.
 *
 * Flat layout (no nested sub-objects): the `shape` discriminator tells you
 * whether to read `halfWidth`/`halfHeight`/`halfDepth` (AABB3D) or `radius`
 * (Sphere). Unused fields are set to 0.
 *
 * Pool-friendly — all fields are assigned in place each frame.
 */
export interface BaseColliderInfo3D<L extends string = string> {
	entityId: number;
	x: number;
	y: number;
	z: number;
	layer: L;
	collidesWith: readonly L[];
	/**
	 * Bit assigned to `layer` from the lazy layer registry. Populated by
	 * `fillBaseColliderInfo3D`. Used together with `collidesWithMask` to
	 * replace per-pair `Array.includes` layer checks with a single AND.
	 */
	layerBit: number;
	/** OR of `getLayerBit3D` for every entry in `collidesWith`. */
	collidesWithMask: number;
	shape: ColliderShape3D;
	halfWidth: number;
	halfHeight: number;
	halfDepth: number;
	radius: number;
}

// ==================== Layer Bit Registry ====================

// Independent from the 2D registry: 2D and 3D layer namespaces are
// defined separately by user code, so bits should not collide.
const _layerRegistry = createLayerBitRegistry('3D collision');
export const getLayerBit3D = _layerRegistry.getLayerBit;
export const getCollidesWithMask3D = _layerRegistry.getCollidesWithMask;

// ==================== Collider Construction ====================

/**
 * Populate a `BaseColliderInfo3D` slot in place from raw component data.
 * Returns `true` if the slot was filled, `false` if the entity has no
 * collider (caller should skip it).
 *
 * If an entity has both AABB3D and sphere colliders, AABB3D wins and only
 * the AABB3D offset is applied.
 */
export function fillBaseColliderInfo3D<L extends string>(
	info: BaseColliderInfo3D<L>,
	entityId: number,
	x: number,
	y: number,
	z: number,
	layer: L,
	collidesWith: readonly L[],
	aabb3D: { width: number; height: number; depth: number; offsetX?: number; offsetY?: number; offsetZ?: number } | undefined,
	sphere: { radius: number; offsetX?: number; offsetY?: number; offsetZ?: number } | undefined,
): boolean {
	info.entityId = entityId;
	info.layer = layer;
	info.collidesWith = collidesWith;
	info.layerBit = getLayerBit3D(layer);
	info.collidesWithMask = getCollidesWithMask3D(collidesWith);

	if (aabb3D) {
		info.x = x + (aabb3D.offsetX ?? 0);
		info.y = y + (aabb3D.offsetY ?? 0);
		info.z = z + (aabb3D.offsetZ ?? 0);
		info.shape = AABB3D_SHAPE;
		info.halfWidth = aabb3D.width / 2;
		info.halfHeight = aabb3D.height / 2;
		info.halfDepth = aabb3D.depth / 2;
		info.radius = 0;
		return true;
	}

	if (sphere) {
		info.x = x + (sphere.offsetX ?? 0);
		info.y = y + (sphere.offsetY ?? 0);
		info.z = z + (sphere.offsetZ ?? 0);
		info.shape = SPHERE_SHAPE;
		info.halfWidth = 0;
		info.halfHeight = 0;
		info.halfDepth = 0;
		info.radius = sphere.radius;
		return true;
	}

	return false;
}

// ==================== Spatial Index Lookup ====================

/**
 * Retrieve the optional spatialIndex3D resource, returning undefined when absent.
 * Centralizes the cross-plugin typed lookup so individual plugins don't each
 * need to import SpatialIndex3D or repeat the tryGetResource pattern.
 */
export function tryGetSpatialIndex3D(
	tryGetResource: <T>(key: string) => T | undefined,
): SpatialIndex3D | undefined {
	return tryGetResource<SpatialIndex3D>('spatialIndex3D');
}

// ==================== Narrowphase Tests ====================

/**
 * Write an AABB3D-vs-AABB3D contact into `out`. Returns `true` if the
 * shapes overlap (out was filled), `false` otherwise.
 *
 * Resolves along the axis with minimum penetration depth.
 */
export function computeAABB3DvsAABB3D(
	ax: number, ay: number, az: number, ahw: number, ahh: number, ahd: number,
	bx: number, by: number, bz: number, bhw: number, bhh: number, bhd: number,
	out: Contact3D,
): boolean {
	const dx = bx - ax;
	const dy = by - ay;
	const dz = bz - az;
	const overlapX = (ahw + bhw) - Math.abs(dx);
	const overlapY = (ahh + bhh) - Math.abs(dy);
	const overlapZ = (ahd + bhd) - Math.abs(dz);

	if (overlapX <= 0 || overlapY <= 0 || overlapZ <= 0) return false;

	if (overlapX <= overlapY && overlapX <= overlapZ) {
		out.normalX = dx >= 0 ? 1 : -1;
		out.normalY = 0;
		out.normalZ = 0;
		out.depth = overlapX;
		return true;
	}

	if (overlapY <= overlapZ) {
		out.normalX = 0;
		out.normalY = dy >= 0 ? 1 : -1;
		out.normalZ = 0;
		out.depth = overlapY;
		return true;
	}

	out.normalX = 0;
	out.normalY = 0;
	out.normalZ = dz >= 0 ? 1 : -1;
	out.depth = overlapZ;
	return true;
}

/**
 * Write a sphere-vs-sphere contact into `out`. Returns `true` if the
 * spheres overlap.
 */
export function computeSphereVsSphere(
	ax: number, ay: number, az: number, ar: number,
	bx: number, by: number, bz: number, br: number,
	out: Contact3D,
): boolean {
	const dx = bx - ax;
	const dy = by - ay;
	const dz = bz - az;
	const distSq = dx * dx + dy * dy + dz * dz;
	const radiusSum = ar + br;

	if (distSq >= radiusSum * radiusSum) return false;

	const dist = Math.sqrt(distSq);
	if (dist === 0) {
		out.normalX = 1;
		out.normalY = 0;
		out.normalZ = 0;
		out.depth = radiusSum;
		return true;
	}
	out.normalX = dx / dist;
	out.normalY = dy / dist;
	out.normalZ = dz / dist;
	out.depth = radiusSum - dist;
	return true;
}

/**
 * Write an AABB3D-vs-sphere contact into `out`. Returns `true` if the
 * shapes overlap.
 *
 * Uses closest-point-on-AABB to sphere center. When the sphere center
 * is inside the AABB, resolves along the axis with minimum push distance.
 */
export function computeAABB3DvsSphere(
	aabbX: number, aabbY: number, aabbZ: number, ahw: number, ahh: number, ahd: number,
	sphereX: number, sphereY: number, sphereZ: number, radius: number,
	out: Contact3D,
): boolean {
	const closestX = Math.max(aabbX - ahw, Math.min(sphereX, aabbX + ahw));
	const closestY = Math.max(aabbY - ahh, Math.min(sphereY, aabbY + ahh));
	const closestZ = Math.max(aabbZ - ahd, Math.min(sphereZ, aabbZ + ahd));

	const dx = sphereX - closestX;
	const dy = sphereY - closestY;
	const dz = sphereZ - closestZ;
	const distSq = dx * dx + dy * dy + dz * dz;

	if (distSq >= radius * radius) return false;

	// Sphere center inside AABB — resolve along minimum push axis
	if (distSq === 0) {
		const pushLeft = (sphereX - (aabbX - ahw));
		const pushRight = ((aabbX + ahw) - sphereX);
		const pushUp = (sphereY - (aabbY - ahh));
		const pushDown = ((aabbY + ahh) - sphereY);
		const pushFront = (sphereZ - (aabbZ - ahd));
		const pushBack = ((aabbZ + ahd) - sphereZ);
		const minPush = Math.min(pushLeft, pushRight, pushUp, pushDown, pushFront, pushBack);

		if (minPush === pushRight) {
			out.normalX = 1; out.normalY = 0; out.normalZ = 0; out.depth = pushRight + radius;
			return true;
		}
		if (minPush === pushLeft) {
			out.normalX = -1; out.normalY = 0; out.normalZ = 0; out.depth = pushLeft + radius;
			return true;
		}
		if (minPush === pushDown) {
			out.normalX = 0; out.normalY = 1; out.normalZ = 0; out.depth = pushDown + radius;
			return true;
		}
		if (minPush === pushUp) {
			out.normalX = 0; out.normalY = -1; out.normalZ = 0; out.depth = pushUp + radius;
			return true;
		}
		if (minPush === pushBack) {
			out.normalX = 0; out.normalY = 0; out.normalZ = 1; out.depth = pushBack + radius;
			return true;
		}
		out.normalX = 0; out.normalY = 0; out.normalZ = -1; out.depth = pushFront + radius;
		return true;
	}

	const dist = Math.sqrt(distSq);
	out.normalX = dx / dist;
	out.normalY = dy / dist;
	out.normalZ = dz / dist;
	out.depth = radius - dist;
	return true;
}

// ==================== Contact Dispatcher ====================

/**
 * Dispatch to the correct narrowphase function for the given pair and
 * write the contact into `out`. Returns `true` if the pair overlaps.
 */
export function computeContact3D(a: BaseColliderInfo3D, b: BaseColliderInfo3D, out: Contact3D): boolean {
	if (a.shape === AABB3D_SHAPE && b.shape === AABB3D_SHAPE) {
		return computeAABB3DvsAABB3D(
			a.x, a.y, a.z, a.halfWidth, a.halfHeight, a.halfDepth,
			b.x, b.y, b.z, b.halfWidth, b.halfHeight, b.halfDepth,
			out,
		);
	}

	if (a.shape === SPHERE_SHAPE && b.shape === SPHERE_SHAPE) {
		return computeSphereVsSphere(
			a.x, a.y, a.z, a.radius,
			b.x, b.y, b.z, b.radius,
			out,
		);
	}

	if (a.shape === AABB3D_SHAPE && b.shape === SPHERE_SHAPE) {
		return computeAABB3DvsSphere(
			a.x, a.y, a.z, a.halfWidth, a.halfHeight, a.halfDepth,
			b.x, b.y, b.z, b.radius,
			out,
		);
	}

	// a is Sphere, b is AABB3D — compute as AABB3D-vs-Sphere, then flip normal
	if (!computeAABB3DvsSphere(
		b.x, b.y, b.z, b.halfWidth, b.halfHeight, b.halfDepth,
		a.x, a.y, a.z, a.radius,
		out,
	)) return false;
	out.normalX = -out.normalX;
	out.normalY = -out.normalY;
	out.normalZ = -out.normalZ;
	return true;
}

// ==================== Collision Iteration ====================

/** Module-level reusable set for broadphase candidates. */
const _broadphaseCandidates: number[] = [];

let _bruteForceWarned = false;
const BRUTE_FORCE_WARN_THRESHOLD = 50;

/**
 * Generic 3D collision detection pipeline: brute-force or broadphase,
 * with layer filtering and contact computation.
 *
 * `count` is the number of live entries at the front of `colliders`.
 * The array itself may be a grow-only pool — only indices `[0, count)`
 * are iterated, so trailing pool slots are ignored.
 *
 * `workingMap` is a caller-owned `Map<number, I>` used by the broadphase
 * path as an entityId → collider lookup. It is cleared and repopulated on
 * each call; callers should allocate it once and pass the same instance
 * every frame.
 *
 * Uses a context parameter forwarded to the callback to avoid
 * per-frame closure allocation.
 */
export function detectCollisions3D<I extends BaseColliderInfo3D, C>(
	colliders: I[],
	count: number,
	workingMap: Map<number, I>,
	spatialIndex: SpatialIndex3D | undefined,
	onContact: (a: I, b: I, contact: Contact3D, context: C) => void,
	context: C,
): void {
	if (spatialIndex) {
		broadphaseDetect(colliders, count, workingMap, spatialIndex, onContact, context);
	} else {
		bruteForceDetect(colliders, count, onContact, context);
	}
}

function bruteForceDetect<I extends BaseColliderInfo3D, C>(
	colliders: I[],
	count: number,
	onContact: (a: I, b: I, contact: Contact3D, context: C) => void,
	context: C,
): void {
	if (!_bruteForceWarned && count >= BRUTE_FORCE_WARN_THRESHOLD) {
		_bruteForceWarned = true;
		console.warn(
			`[ecspresso] 3D collision detection is using O(n²) brute force with ${count} colliders. ` +
			`For better performance, install createSpatialIndex3DPlugin() alongside your collision or physics3D plugin.`,
		);
	}

	for (let i = 0; i < count; i++) {
		const a = colliders[i];
		if (!a) continue;

		for (let j = i + 1; j < count; j++) {
			const b = colliders[j];
			if (!b) continue;

			if (((a.collidesWithMask & b.layerBit) | (b.collidesWithMask & a.layerBit)) === 0) continue;

			if (!computeContact3D(a, b, _sharedContact)) continue;

			onContact(a, b, _sharedContact, context);
		}
	}
}

function broadphaseDetect<I extends BaseColliderInfo3D, C>(
	colliders: I[],
	count: number,
	colliderMap: Map<number, I>,
	spatialIndex: SpatialIndex3D,
	onContact: (a: I, b: I, contact: Contact3D, context: C) => void,
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

		const aHalfW = a.shape === AABB3D_SHAPE ? a.halfWidth : a.radius;
		const aHalfH = a.shape === AABB3D_SHAPE ? a.halfHeight : a.radius;
		const aHalfD = a.shape === AABB3D_SHAPE ? a.halfDepth : a.radius;

		_broadphaseCandidates.length = 0;
		spatialIndex.queryBoxInto(
			a.x - aHalfW, a.y - aHalfH, a.z - aHalfD,
			a.x + aHalfW, a.y + aHalfH, a.z + aHalfD,
			_broadphaseCandidates,
			a.entityId,
		);

		for (const bId of _broadphaseCandidates) {
			const b = colliderMap.get(bId);
			if (!b) continue;

			if (((a.collidesWithMask & b.layerBit) | (b.collidesWithMask & a.layerBit)) === 0) continue;

			if (!computeContact3D(a, b, _sharedContact)) continue;

			onContact(a, b, _sharedContact, context);
		}
	}
}
