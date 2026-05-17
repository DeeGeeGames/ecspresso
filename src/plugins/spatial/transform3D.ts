/**
 * 3D Transform Plugin for ECSpresso
 *
 * Provides hierarchical 3D transform propagation following Bevy's Transform/GlobalTransform pattern.
 * LocalTransform3D is modified by user code; WorldTransform3D is computed automatically.
 *
 * Rotation is stored as Euler angles (radians, XYZ intrinsic order matching Three.js defaults).
 * Hierarchical composition converts to quaternions internally for correct rotation composition,
 * then converts back to Euler for storage.
 */

import { definePlugin, type BasePluginOptions } from 'ecspresso';
import type ECSpresso from 'ecspresso';
import type { WorldConfigFrom } from '../../type-utils';

// ==================== Component Types ====================

/**
 * 3D local transform relative to parent (or world if no parent).
 * This is the transform you modify directly.
 *
 * Rotation is in radians, using XYZ intrinsic Euler order (Three.js default).
 */
export interface LocalTransform3D {
	x: number;
	y: number;
	z: number;
	rx: number;
	ry: number;
	rz: number;
	sx: number;
	sy: number;
	sz: number;
}

/**
 * Computed 3D world transform (accumulated from parent chain).
 * Read-only — managed by the transform propagation system.
 */
export interface WorldTransform3D {
	x: number;
	y: number;
	z: number;
	rx: number;
	ry: number;
	rz: number;
	sx: number;
	sy: number;
	sz: number;
}

/**
 * Component types provided by the 3D transform plugin.
 * Included automatically via `.withPlugin(createTransform3DPlugin())`.
 */
export interface Transform3DComponentTypes {
	localTransform3D: LocalTransform3D;
	worldTransform3D: WorldTransform3D;
}

/**
 * WorldConfig representing the 3D transform plugin's provided components.
 * Used as the `Requires` type parameter by plugins that depend on transform3D.
 */
export type Transform3DWorldConfig = WorldConfigFrom<Transform3DComponentTypes>;

// ==================== Plugin Options ====================

/**
 * Configuration options for the 3D transform plugin.
 */
export interface Transform3DPluginOptions<G extends string = 'transform3d'> extends BasePluginOptions<G> {}

// ==================== Default Values ====================

/**
 * Default local 3D transform values.
 */
export const DEFAULT_LOCAL_TRANSFORM_3D: Readonly<LocalTransform3D> = {
	x: 0, y: 0, z: 0,
	rx: 0, ry: 0, rz: 0,
	sx: 1, sy: 1, sz: 1,
};

/**
 * Default world 3D transform values.
 */
export const DEFAULT_WORLD_TRANSFORM_3D: Readonly<WorldTransform3D> = {
	x: 0, y: 0, z: 0,
	rx: 0, ry: 0, rz: 0,
	sx: 1, sy: 1, sz: 1,
};

// ==================== Helper Functions ====================

/**
 * Create a local 3D transform component with position only.
 * Uses default rotation (0, 0, 0) and scale (1, 1, 1).
 *
 * @example
 * ```typescript
 * ecs.spawn({
 *   ...createLocalTransform3D(10, 5, -20),
 *   mesh: myMesh,
 * });
 * ```
 */
export function createLocalTransform3D(
	x: number,
	y: number,
	z: number,
): Pick<Transform3DComponentTypes, 'localTransform3D'> {
	return {
		localTransform3D: { x, y, z, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 },
	};
}

/**
 * Create a world 3D transform component with position only.
 * Typically used alongside createLocalTransform3D for initial state.
 */
export function createWorldTransform3D(
	x: number,
	y: number,
	z: number,
): Pick<Transform3DComponentTypes, 'worldTransform3D'> {
	return {
		worldTransform3D: { x, y, z, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 },
	};
}

/**
 * Options for creating a full 3D transform.
 */
export interface Transform3DOptions {
	rotation?: { x?: number; y?: number; z?: number };
	scaleX?: number;
	scaleY?: number;
	scaleZ?: number;
	/** Uniform scale (overrides scaleX/scaleY/scaleZ if provided) */
	scale?: number;
}

/**
 * Create both local and world 3D transform components.
 * World transform is initialized to match local transform.
 *
 * @example
 * ```typescript
 * ecs.spawn({
 *   ...createTransform3D(10, 5, -20),
 *   mesh: myMesh,
 * });
 *
 * // With rotation and scale
 * ecs.spawn({
 *   ...createTransform3D(10, 5, -20, {
 *     rotation: { y: Math.PI / 4 },
 *     scale: 2,
 *   }),
 *   mesh: myMesh,
 * });
 * ```
 */
export function createTransform3D(
	x: number,
	y: number,
	z: number,
	options?: Transform3DOptions,
): Transform3DComponentTypes {
	const sx = options?.scale ?? options?.scaleX ?? 1;
	const sy = options?.scale ?? options?.scaleY ?? 1;
	const sz = options?.scale ?? options?.scaleZ ?? 1;
	const rx = options?.rotation?.x ?? 0;
	const ry = options?.rotation?.y ?? 0;
	const rz = options?.rotation?.z ?? 0;

	const transform = { x, y, z, rx, ry, rz, sx, sy, sz };

	return {
		localTransform3D: { ...transform },
		worldTransform3D: { ...transform },
	};
}

// ==================== Quaternion Math (Internal) ====================
// Inlined quaternion operations to avoid Three.js dependency in the transform plugin.
// Uses XYZ intrinsic Euler order to match Three.js Object3D.rotation defaults.
// Pre-allocated scratch arrays avoid GC pressure in the hot path.

// Scratch quaternion struct to avoid allocation in hot path
interface Quat { x: number; y: number; z: number; w: number }
const qP: Quat = { x: 0, y: 0, z: 0, w: 1 }; // parent
const qL: Quat = { x: 0, y: 0, z: 0, w: 1 }; // local
const qW: Quat = { x: 0, y: 0, z: 0, w: 1 }; // world (result)

/**
 * Convert Euler angles (XYZ intrinsic order) to quaternion.
 * Writes result into the `out` object.
 */
function eulerToQuat(rx: number, ry: number, rz: number, out: Quat): void {
	const cx = Math.cos(rx * 0.5);
	const srx = Math.sin(rx * 0.5);
	const cy = Math.cos(ry * 0.5);
	const sy = Math.sin(ry * 0.5);
	const cz = Math.cos(rz * 0.5);
	const sz = Math.sin(rz * 0.5);

	// XYZ intrinsic = ZYX extrinsic
	out.x = srx * cy * cz + cx * sy * sz;
	out.y = cx * sy * cz - srx * cy * sz;
	out.z = cx * cy * sz + srx * sy * cz;
	out.w = cx * cy * cz - srx * sy * sz;
}

/**
 * Multiply two quaternions: out = a * b
 */
function quatMultiply(a: Quat, b: Quat, out: Quat): void {
	out.x = a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y;
	out.y = a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x;
	out.z = a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w;
	out.w = a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z;
}

// Scratch vec3 for quatRotateVec to avoid per-call allocation
interface Vec3 { x: number; y: number; z: number }
const vecOut: Vec3 = { x: 0, y: 0, z: 0 };

// Scratch euler for quatToEuler to avoid per-call allocation
interface Euler3 { rx: number; ry: number; rz: number }
const eulerOut: Euler3 = { rx: 0, ry: 0, rz: 0 };

/**
 * Rotate a vector by quaternion q. Writes result into module-scoped `vecOut`.
 */
function quatRotateVec(
	q: Quat,
	vx: number,
	vy: number,
	vz: number,
): Vec3 {
	const tx = 2 * (q.y * vz - q.z * vy);
	const ty = 2 * (q.z * vx - q.x * vz);
	const tz = 2 * (q.x * vy - q.y * vx);

	vecOut.x = vx + q.w * tx + (q.y * tz - q.z * ty);
	vecOut.y = vy + q.w * ty + (q.z * tx - q.x * tz);
	vecOut.z = vz + q.w * tz + (q.x * ty - q.y * tx);
	return vecOut;
}

/**
 * Convert quaternion to Euler angles (XYZ intrinsic order).
 * Writes result into module-scoped `eulerOut`.
 */
function quatToEuler(q: Quat): Euler3 {
	const x2 = q.x + q.x, y2 = q.y + q.y, z2 = q.z + q.z;
	const xx = q.x * x2, xy = q.x * y2, xz = q.x * z2;
	const yy = q.y * y2, yz = q.y * z2, zz = q.z * z2;
	const wx = q.w * x2, wy = q.w * y2, wz = q.w * z2;

	const m11 = 1 - (yy + zz);
	const m12 = xy - wz;
	const m13 = xz + wy;
	const m22 = 1 - (xx + zz);
	const m23 = yz - wx;
	const m33 = 1 - (xx + yy);

	eulerOut.ry = Math.asin(Math.max(-1, Math.min(1, m13)));
	const cosY = Math.cos(eulerOut.ry);

	if (Math.abs(cosY) > 1e-6) {
		eulerOut.rx = Math.atan2(-m23, m33);
		eulerOut.rz = Math.atan2(-m12, m11);
	} else {
		// Gimbal lock fallback
		const m21 = xy + wz;
		eulerOut.rx = Math.atan2(m21, m22);
		eulerOut.rz = 0;
	}
	return eulerOut;
}

// ==================== Plugin Factory ====================

/**
 * Create a 3D transform plugin for ECSpresso.
 *
 * This plugin provides:
 * - 3D transform propagation system that computes world transforms from local transforms
 * - Parent-first traversal ensures parents are processed before children
 * - Supports full 3D transform hierarchy (position, rotation, scale)
 * - Rotation composed via quaternions internally for correctness
 *
 * @example
 * ```typescript
 * const ecs = ECSpresso.create()
 *   .withPlugin(createTransform3DPlugin())
 *   .withComponentTypes<{ velocity: { x: number; y: number; z: number } }>()
 *   .build();
 *
 * ecs.spawn({
 *   ...createTransform3D(10, 5, -20),
 *   velocity: { x: 1, y: 0, z: 0 },
 * });
 * ```
 */
export function createTransform3DPlugin<G extends string = 'transform3d'>(
	options?: Transform3DPluginOptions<G>,
) {
	const {
		systemGroup = 'transform3d',
		priority = 500,
		phase = 'postUpdate',
	} = options ?? {};

	return definePlugin('transform3d')
		.withComponentTypes<Transform3DComponentTypes>()
		.withLabels<'transform3d-propagation'>()
		.withGroups<G>()
		.install((world) => {
			// localTransform3D requires worldTransform3D — initialize from localTransform3D values
			world.registerRequired('localTransform3D', 'worldTransform3D', (lt) => ({
				x: lt.x, y: lt.y, z: lt.z,
				rx: lt.rx, ry: lt.ry, rz: lt.rz,
				sx: lt.sx, sy: lt.sy, sz: lt.sz,
			}));

			const orphanBuffer: Array<import('../../types').FilteredEntity<Transform3DComponentTypes, 'localTransform3D' | 'worldTransform3D'>> = [];
			const hierarchyVisited = new Set<number>();

			world
				.addSystem('transform3d-propagation')
				.setPriority(priority)
				.inPhase(phase)
				.inGroup(systemGroup)
				.setProcess(({ ecs }) => {
					propagateTransforms3D(ecs, orphanBuffer, hierarchyVisited);
				});
		});
}

// ==================== Propagation ====================

/**
 * Propagate 3D transforms through the hierarchy.
 * Parent-first traversal ensures parents are computed before children.
 */
function propagateTransforms3D(
	ecs: ECSpresso<WorldConfigFrom<Transform3DComponentTypes>>,
	orphanBuffer: Array<import('../../types').FilteredEntity<Transform3DComponentTypes, 'localTransform3D' | 'worldTransform3D'>>,
	hierarchyVisited: Set<number>,
): void {
	const em = ecs.entityManager;

	// Fast path: no hierarchy relationships exist — all entities are flat
	if (!em.hasHierarchy) {
		em.getEntitiesWithQueryInto(orphanBuffer, ['localTransform3D', 'worldTransform3D']);
		for (const entity of orphanBuffer) {
			const { localTransform3D, worldTransform3D } = entity.components;
			if (copyTransform3D(localTransform3D, worldTransform3D)) {
				ecs.markChanged(entity.id, 'worldTransform3D');
			}
		}
		return;
	}

	// Hierarchy exists — use parent-first traversal then process remaining orphans
	hierarchyVisited.clear();

	ecs.forEachInHierarchy((entityId, parentId) => {
		hierarchyVisited.add(entityId);
		const localTransform3D = em.getComponent(entityId, 'localTransform3D');
		const worldTransform3D = em.getComponent(entityId, 'worldTransform3D');

		if (!localTransform3D || !worldTransform3D) return;

		const parentWorld = parentId !== null
			? em.getComponent(parentId, 'worldTransform3D')
			: null;

		const changed = parentWorld
			? combineTransforms3D(parentWorld, localTransform3D, worldTransform3D)
			: copyTransform3D(localTransform3D, worldTransform3D);

		if (changed) ecs.markChanged(entityId, 'worldTransform3D');
	});

	em.getEntitiesWithQueryInto(orphanBuffer, ['localTransform3D', 'worldTransform3D']);
	for (const entity of orphanBuffer) {
		if (hierarchyVisited.has(entity.id)) continue;
		const { localTransform3D, worldTransform3D } = entity.components;
		if (copyTransform3D(localTransform3D, worldTransform3D)) {
			ecs.markChanged(entity.id, 'worldTransform3D');
		}
	}
}

/**
 * Copy 3D transform values from source to destination.
 * Returns true if the destination was actually modified.
 */
function copyTransform3D(src: LocalTransform3D, dest: WorldTransform3D): boolean {
	if (
		dest.x === src.x && dest.y === src.y && dest.z === src.z &&
		dest.rx === src.rx && dest.ry === src.ry && dest.rz === src.rz &&
		dest.sx === src.sx && dest.sy === src.sy && dest.sz === src.sz
	) {
		return false;
	}
	dest.x = src.x;
	dest.y = src.y;
	dest.z = src.z;
	dest.rx = src.rx;
	dest.ry = src.ry;
	dest.rz = src.rz;
	dest.sx = src.sx;
	dest.sy = src.sy;
	dest.sz = src.sz;
	return true;
}

/**
 * Combine parent world transform with child local transform into child world transform.
 * Uses quaternion math internally for correct rotation composition.
 * Returns true if the destination was actually modified.
 */
function combineTransforms3D(
	parent: WorldTransform3D,
	local: LocalTransform3D,
	world: WorldTransform3D,
): boolean {
	// Convert parent and local rotations to quaternions
	eulerToQuat(parent.rx, parent.ry, parent.rz, qP);
	eulerToQuat(local.rx, local.ry, local.rz, qL);

	// Compose rotations: worldQuat = parentQuat * localQuat
	quatMultiply(qP, qL, qW);

	// Convert back to Euler (writes into eulerOut scratch)
	const euler = quatToEuler(qW);

	// Apply parent scale to local position, rotate by parent rotation (writes into vecOut scratch)
	const rotated = quatRotateVec(qP, local.x * parent.sx, local.y * parent.sy, local.z * parent.sz);

	// Compute final world values
	const newX = parent.x + rotated.x;
	const newY = parent.y + rotated.y;
	const newZ = parent.z + rotated.z;
	const newSx = parent.sx * local.sx;
	const newSy = parent.sy * local.sy;
	const newSz = parent.sz * local.sz;

	if (
		world.x === newX && world.y === newY && world.z === newZ &&
		world.rx === euler.rx && world.ry === euler.ry && world.rz === euler.rz &&
		world.sx === newSx && world.sy === newSy && world.sz === newSz
	) {
		return false;
	}

	world.x = newX;
	world.y = newY;
	world.z = newZ;
	world.rx = euler.rx;
	world.ry = euler.ry;
	world.rz = euler.rz;
	world.sx = newSx;
	world.sy = newSy;
	world.sz = newSz;
	return true;
}
