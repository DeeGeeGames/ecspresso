/**
 * Transform Plugin for ECSpresso
 *
 * Provides hierarchical transform propagation following Bevy's Transform/GlobalTransform pattern.
 * LocalTransform is modified by user code; WorldTransform is computed automatically.
 *
 * @see https://docs.rs/bevy/latest/bevy/transform/components/struct.GlobalTransform.html
 */

import { definePlugin, type BasePluginOptions } from 'ecspresso';
import type ECSpresso from 'ecspresso';
import type { WorldConfigFrom } from '../../type-utils';

// ==================== Component Types ====================

/**
 * Local transform relative to parent (or world if no parent).
 * This is the transform you modify directly.
 */
export interface LocalTransform {
	x: number;
	y: number;
	rotation: number;
	scaleX: number;
	scaleY: number;
}

/**
 * Computed world transform (accumulated from parent chain).
 * Read-only - managed by the transform propagation system.
 */
export interface WorldTransform {
	x: number;
	y: number;
	rotation: number;
	scaleX: number;
	scaleY: number;
}

/**
 * Component types provided by the transform plugin.
 * Included automatically via `.withPlugin(createTransformPlugin())`.
 *
 * @example
 * ```typescript
 * const ecs = ECSpresso.create()
 *   .withPlugin(createTransformPlugin())
 *   .withComponentTypes<{ sprite: Sprite; velocity: { x: number; y: number } }>()
 *   .build();
 * ```
 */
export interface TransformComponentTypes {
	localTransform: LocalTransform;
	worldTransform: WorldTransform;
}

/**
 * WorldConfig representing the transform plugin's provided components.
 * Used as the `Requires` type parameter by plugins that depend on transform.
 */
export type TransformWorldConfig = WorldConfigFrom<TransformComponentTypes>;

// ==================== Plugin Options ====================

/**
 * Configuration options for the transform plugin.
 */
export interface TransformPluginOptions<G extends string = 'transform'> extends BasePluginOptions<G> {}

// ==================== Default Values ====================

/**
 * Default local transform values.
 */
export const DEFAULT_LOCAL_TRANSFORM: Readonly<LocalTransform> = {
	x: 0,
	y: 0,
	rotation: 0,
	scaleX: 1,
	scaleY: 1,
};

/**
 * Default world transform values.
 */
export const DEFAULT_WORLD_TRANSFORM: Readonly<WorldTransform> = {
	x: 0,
	y: 0,
	rotation: 0,
	scaleX: 1,
	scaleY: 1,
};

// ==================== Helper Functions ====================

/**
 * Create a local transform component with position only.
 * Uses default rotation (0) and scale (1, 1).
 *
 * @param x The x coordinate
 * @param y The y coordinate
 * @returns Component object suitable for spreading into spawn()
 *
 * @example
 * ```typescript
 * ecs.spawn({
 *   ...createLocalTransform(100, 200),
 *   sprite,
 * });
 * ```
 */
export function createLocalTransform(x: number, y: number): Pick<TransformComponentTypes, 'localTransform'> {
	return {
		localTransform: {
			x,
			y,
			rotation: 0,
			scaleX: 1,
			scaleY: 1,
		},
	};
}

/**
 * Create a world transform component with position only.
 * Typically used alongside createLocalTransform for initial state.
 *
 * @param x The x coordinate
 * @param y The y coordinate
 * @returns Component object suitable for spreading into spawn()
 */
export function createWorldTransform(x: number, y: number): Pick<TransformComponentTypes, 'worldTransform'> {
	return {
		worldTransform: {
			x,
			y,
			rotation: 0,
			scaleX: 1,
			scaleY: 1,
		},
	};
}

/**
 * Options for creating a full transform.
 */
export interface TransformOptions {
	rotation?: number;
	scaleX?: number;
	scaleY?: number;
	/** Uniform scale (overrides scaleX/scaleY if provided) */
	scale?: number;
}

/**
 * Create both local and world transform components.
 * World transform is initialized to match local transform.
 *
 * @param x The x coordinate
 * @param y The y coordinate
 * @param options Optional rotation and scale
 * @returns Component object suitable for spreading into spawn()
 *
 * @example
 * ```typescript
 * ecs.spawn({
 *   ...createTransform(100, 200),
 *   sprite,
 * });
 *
 * // With rotation and scale
 * ecs.spawn({
 *   ...createTransform(100, 200, { rotation: Math.PI / 4, scale: 2 }),
 *   sprite,
 * });
 * ```
 */
export function createTransform(
	x: number,
	y: number,
	options?: TransformOptions
): TransformComponentTypes {
	const scaleX = options?.scale ?? options?.scaleX ?? 1;
	const scaleY = options?.scale ?? options?.scaleY ?? 1;
	const rotation = options?.rotation ?? 0;

	const transform = {
		x,
		y,
		rotation,
		scaleX,
		scaleY,
	};

	return {
		localTransform: { ...transform },
		worldTransform: { ...transform },
	};
}

// ==================== Plugin Factory ====================

/**
 * Create a transform plugin for ECSpresso.
 *
 * This plugin provides:
 * - Transform propagation system that computes world transforms from local transforms
 * - Parent-first traversal ensures parents are processed before children
 * - Supports full transform hierarchy (position, rotation, scale)
 *
 * @example
 * ```typescript
 * const ecs = ECSpresso
 *   .create<Components, Events, Resources>()
 *   .withPlugin(createTransformPlugin())
 *   .withPlugin(createPhysics2DPlugin())
 *   .build();
 *
 * // Spawn entity with transform
 * ecs.spawn({
 *   ...createTransform(100, 200),
 *   velocity: { x: 50, y: 0 },
 * });
 * ```
 */
export function createTransformPlugin<G extends string = 'transform'>(
	options?: TransformPluginOptions<G>
) {
	const {
		systemGroup = 'transform',
		priority = 500,
		phase = 'postUpdate',
	} = options ?? {};

	return definePlugin('transform')
		.withComponentTypes<TransformComponentTypes>()
		.withLabels<'transform-propagation'>()
		.withGroups<G>()
		.install((world) => {
			// localTransform requires worldTransform — initialize from localTransform values
			world.registerRequired('localTransform', 'worldTransform', (lt) => ({
				x: lt.x, y: lt.y, rotation: lt.rotation, scaleX: lt.scaleX, scaleY: lt.scaleY,
			}));

			const orphanBuffer: Array<import('../../types').FilteredEntity<TransformComponentTypes, 'localTransform' | 'worldTransform'>> = [];
			const hierarchyVisited = new Set<number>();

			world
				.addSystem('transform-propagation')
				.setPriority(priority)
				.inPhase(phase)
				.inGroup(systemGroup)
				.setProcess(({ ecs }) => {
					propagateTransforms(ecs, orphanBuffer, hierarchyVisited);
				});
		});
}

/**
 * Propagate transforms through the hierarchy.
 * Parent-first traversal ensures parents are computed before children.
 *
 * Runs unconditionally for all entities with transforms — user code can
 * freely mutate localTransform without needing to call markChanged.
 * Only marks worldTransform as changed when values actually differ,
 * so downstream systems (e.g. renderer sync) can skip static entities.
 */
function propagateTransforms(
	ecs: ECSpresso<WorldConfigFrom<TransformComponentTypes>>,
	orphanBuffer: Array<import('../../types').FilteredEntity<TransformComponentTypes, 'localTransform' | 'worldTransform'>>,
	hierarchyVisited: Set<number>,
): void {
	const em = ecs.entityManager;

	// Fast path: no hierarchy relationships exist — all entities are flat
	if (!em.hasHierarchy) {
		em.getEntitiesWithQueryInto(orphanBuffer, ['localTransform', 'worldTransform']);
		for (const entity of orphanBuffer) {
			const { localTransform, worldTransform } = entity.components;
			if (copyTransform(localTransform, worldTransform)) {
				ecs.markChanged(entity.id, 'worldTransform');
			}
		}
		return;
	}

	// Hierarchy exists — use parent-first traversal then process remaining orphans
	hierarchyVisited.clear();

	ecs.forEachInHierarchy((entityId, parentId) => {
		hierarchyVisited.add(entityId);
		const localTransform = em.getComponent(entityId, 'localTransform');
		const worldTransform = em.getComponent(entityId, 'worldTransform');

		if (!localTransform || !worldTransform) return;

		const parentWorld = parentId !== null
			? em.getComponent(parentId, 'worldTransform')
			: null;

		const changed = parentWorld
			? combineTransforms(parentWorld, localTransform, worldTransform)
			: copyTransform(localTransform, worldTransform);

		if (changed) ecs.markChanged(entityId, 'worldTransform');
	});

	em.getEntitiesWithQueryInto(orphanBuffer, ['localTransform', 'worldTransform']);
	for (const entity of orphanBuffer) {
		if (hierarchyVisited.has(entity.id)) continue;
		const { localTransform, worldTransform } = entity.components;
		if (copyTransform(localTransform, worldTransform)) {
			ecs.markChanged(entity.id, 'worldTransform');
		}
	}
}

/**
 * Copy transform values from source to destination.
 * Returns true if the destination was actually modified.
 */
function copyTransform(src: LocalTransform, dest: WorldTransform): boolean {
	if (dest.x === src.x && dest.y === src.y &&
		dest.rotation === src.rotation &&
		dest.scaleX === src.scaleX && dest.scaleY === src.scaleY) {
		return false;
	}
	dest.x = src.x;
	dest.y = src.y;
	dest.rotation = src.rotation;
	dest.scaleX = src.scaleX;
	dest.scaleY = src.scaleY;
	return true;
}

/**
 * Combine parent world transform with child local transform into child world transform.
 * Returns true if the destination was actually modified.
 */
function combineTransforms(
	parent: WorldTransform,
	local: LocalTransform,
	world: WorldTransform
): boolean {
	// Apply parent's scale to local position
	const scaledLocalX = local.x * parent.scaleX;
	const scaledLocalY = local.y * parent.scaleY;

	// Rotate local position by parent's rotation
	const cos = Math.cos(parent.rotation);
	const sin = Math.sin(parent.rotation);
	const rotatedX = scaledLocalX * cos - scaledLocalY * sin;
	const rotatedY = scaledLocalX * sin + scaledLocalY * cos;

	// Add to parent's position
	const newX = parent.x + rotatedX;
	const newY = parent.y + rotatedY;
	const newRotation = parent.rotation + local.rotation;
	const newScaleX = parent.scaleX * local.scaleX;
	const newScaleY = parent.scaleY * local.scaleY;

	if (world.x === newX && world.y === newY &&
		world.rotation === newRotation &&
		world.scaleX === newScaleX && world.scaleY === newScaleY) {
		return false;
	}

	world.x = newX;
	world.y = newY;
	world.rotation = newRotation;
	world.scaleX = newScaleX;
	world.scaleY = newScaleY;
	return true;
}
