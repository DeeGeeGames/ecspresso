/**
 * Flocking Plugin for ECSpresso
 *
 * Classic boid simulation — separation, alignment, cohesion. Produces
 * emergent group movement from simple per-entity steering forces.
 *
 * Composes with the physics2D plugin: flocking computes steering forces
 * and feeds them through `applyForce()`. Physics integration handles
 * velocity and position updates.
 *
 * Requires the spatial-index plugin for efficient neighbor queries.
 * Entities must have a `circleCollider` (or `aabbCollider`) to appear
 * in spatial index queries.
 */

import { definePlugin, type BasePluginOptions } from 'ecspresso';
import type { WorldConfigFrom } from 'ecspresso';
import type { TransformWorldConfig } from '../spatial/transform';
import type { Physics2DOwnComponentTypes } from '../physics/physics2D';
import { applyForce } from '../physics/physics2D';
import type { SpatialIndexResourceTypes } from '../spatial/spatial-index';

// ==================== Component Types ====================

/**
 * Configures flocking behavior for a boid entity.
 *
 * Entities with this component must also have:
 * - `localTransform` + `worldTransform` (transform plugin)
 * - `velocity` + `force` + `rigidBody` (physics2D plugin)
 * - `circleCollider` with radius >= perceptionRadius (for spatial index queries)
 */
export interface FlockingAgent {
	/** Radius within which neighbors are detected */
	perceptionRadius: number;
	/** Separation weight — steer away from nearby neighbors (default: 1.5) */
	separationWeight: number;
	/** Alignment weight — match average heading of neighbors (default: 1.0) */
	alignmentWeight: number;
	/** Cohesion weight — steer toward average position of neighbors (default: 1.0) */
	cohesionWeight: number;
	/** Maximum steering force magnitude per frame */
	maxForce: number;
	/** Maximum velocity magnitude (hard speed cap) */
	maxSpeed: number;
	/** Flock group ID for independent flocks (default: 0) */
	flockGroup: number;
}

/**
 * Component types provided by the flocking plugin.
 */
export interface FlockingComponentTypes {
	flockingAgent: FlockingAgent;
}

// ==================== WorldConfig ====================

/**
 * WorldConfig representing the flocking plugin's provided types.
 */
export type FlockingWorldConfig = WorldConfigFrom<FlockingComponentTypes>;

// ==================== Plugin Options ====================

export interface FlockingPluginOptions<G extends string = 'ai'> extends BasePluginOptions<G> {
	/** Priority for the heading/speed-clamp system (default: 200) */
	headingPriority?: number;
}

// ==================== Helper Functions ====================

/**
 * Create a flockingAgent component with sensible defaults.
 *
 * Entities must also have a `circleCollider` with radius >= perceptionRadius
 * for the spatial index to find them as neighbors.
 *
 * @param options Partial overrides for flocking agent fields
 * @returns Component object suitable for spreading into spawn()
 *
 * @example
 * ```typescript
 * ecs.spawn({
 *   ...createFlockingAgent({ perceptionRadius: 80, maxSpeed: 150 }),
 *   ...createRigidBody('dynamic', { mass: 1, drag: 1, gravityScale: 0 }),
 *   ...createCircleCollider(80),
 *   ...createGraphicsComponents(boidGraphics, { x: 100, y: 200 }),
 * });
 * ```
 */
export function createFlockingAgent(
	options?: Partial<FlockingAgent>,
): Pick<FlockingComponentTypes, 'flockingAgent'> {
	return {
		flockingAgent: {
			perceptionRadius: options?.perceptionRadius ?? 100,
			separationWeight: options?.separationWeight ?? 1.5,
			alignmentWeight: options?.alignmentWeight ?? 1.0,
			cohesionWeight: options?.cohesionWeight ?? 1.0,
			maxForce: options?.maxForce ?? 400,
			maxSpeed: options?.maxSpeed ?? 200,
			flockGroup: options?.flockGroup ?? 0,
		},
	};
}

// ==================== Plugin Factory ====================

const _neighborBuf: number[] = [];

const SPEED_EPSILON = 0.01;

/**
 * Create a flocking plugin for ECSpresso.
 *
 * Installs two systems:
 * - `flocking-forces` — computes separation/alignment/cohesion and applies via applyForce()
 * - `flocking-heading` — clamps speed to maxSpeed and orients rotation to match velocity
 *
 * Requires the transform, physics2D, and spatial-index plugins to be installed.
 *
 * @example
 * ```typescript
 * const ecs = ECSpresso.create()
 *   .withPlugin(createRenderer2DPlugin({ background: '#0a0a2e' }))
 *   .withPlugin(createPhysics2DPlugin())
 *   .withPlugin(createSpatialIndexPlugin())
 *   .withPlugin(createFlockingPlugin())
 *   .build();
 * ```
 */
export function createFlockingPlugin<G extends string = 'ai'>(
	options?: FlockingPluginOptions<G>,
) {
	const {
		systemGroup = 'ai',
		priority = 500,
		phase = 'update',
		headingPriority = 200,
	} = options ?? {};

	return definePlugin('flocking')
		.withComponentTypes<FlockingComponentTypes>()
		.withLabels<'flocking-forces' | 'flocking-heading'>()
		.withGroups<G>()
		.requires<
			TransformWorldConfig &
			WorldConfigFrom<Pick<Physics2DOwnComponentTypes, 'velocity' | 'force'>> &
			WorldConfigFrom<{}, {}, SpatialIndexResourceTypes>
		>()
		.install((world) => {
			// --- System 1: Compute and apply flocking forces ---
			world
				.addSystem('flocking-forces')
				.setPriority(priority)
				.inPhase(phase)
				.inGroup(systemGroup)
				.addQuery('boids', {
					with: ['flockingAgent', 'worldTransform', 'velocity', 'force'],
				})
				.setProcess(({ queries, ecs }) => {
					const spatialIndex = ecs.getResource('spatialIndex');

					for (const entity of queries.boids) {
						const { flockingAgent, worldTransform, velocity } = entity.components;
						const { perceptionRadius, separationWeight, alignmentWeight, cohesionWeight, maxForce, flockGroup } = flockingAgent;

						// Query neighbors via spatial index
						_neighborBuf.length = 0;
						spatialIndex.queryRadiusInto(worldTransform.x, worldTransform.y, perceptionRadius, _neighborBuf);

						// Accumulate steering forces — all inline scalars, no allocations
						let sepX = 0, sepY = 0, sepCount = 0;
						let alignX = 0, alignY = 0, alignCount = 0;
						let cohX = 0, cohY = 0, cohCount = 0;

						const separationRadius = perceptionRadius * 0.5;
						const separationRadiusSq = separationRadius * separationRadius;

						for (const neighborId of _neighborBuf) {
							if (neighborId === entity.id) continue;

							const neighborAgent = ecs.getComponent(neighborId, 'flockingAgent');
							if (!neighborAgent) continue;
							if (neighborAgent.flockGroup !== flockGroup) continue;

							const neighborTransform = ecs.getComponent(neighborId, 'worldTransform');
							if (!neighborTransform) continue;

							const dx = worldTransform.x - neighborTransform.x;
							const dy = worldTransform.y - neighborTransform.y;
							const distSq = dx * dx + dy * dy;

							// Separation — closer neighbors push harder
							if (distSq > 0 && distSq < separationRadiusSq) {
								const dist = Math.sqrt(distSq);
								sepX += dx / dist;
								sepY += dy / dist;
								sepCount++;
							}

							// Alignment — average velocity of neighbors
							const neighborVel = ecs.getComponent(neighborId, 'velocity');
							if (neighborVel) {
								alignX += neighborVel.x;
								alignY += neighborVel.y;
								alignCount++;
							}

							// Cohesion — average position of neighbors
							cohX += neighborTransform.x;
							cohY += neighborTransform.y;
							cohCount++;
						}

						let totalFx = 0, totalFy = 0;

						// Separation: steer away from crowded neighbors
						if (sepCount > 0) {
							totalFx += (sepX / sepCount) * separationWeight;
							totalFy += (sepY / sepCount) * separationWeight;
						}

						// Alignment: steer toward average heading
						if (alignCount > 0) {
							const avgVx = alignX / alignCount;
							const avgVy = alignY / alignCount;
							// Desired = average velocity - current velocity
							totalFx += (avgVx - velocity.x) * alignmentWeight;
							totalFy += (avgVy - velocity.y) * alignmentWeight;
						}

						// Cohesion: steer toward average position
						if (cohCount > 0) {
							const avgPx = cohX / cohCount;
							const avgPy = cohY / cohCount;
							// Desired = direction to center of mass - current velocity
							totalFx += (avgPx - worldTransform.x - velocity.x) * cohesionWeight;
							totalFy += (avgPy - worldTransform.y - velocity.y) * cohesionWeight;
						}

						// Clamp total steering force to maxForce
						const forceMagSq = totalFx * totalFx + totalFy * totalFy;
						if (forceMagSq > maxForce * maxForce) {
							const forceMag = Math.sqrt(forceMagSq);
							totalFx = (totalFx / forceMag) * maxForce;
							totalFy = (totalFy / forceMag) * maxForce;
						}

						applyForce(ecs, entity.id, totalFx, totalFy);
					}
				});

			// --- System 2: Clamp speed and orient heading from velocity ---
			world
				.addSystem('flocking-heading')
				.setPriority(headingPriority)
				.inPhase(phase)
				.inGroup(systemGroup)
				.addQuery('boids', {
					with: ['flockingAgent', 'velocity', 'localTransform'],
				})
				.setProcess(({ queries, ecs }) => {
					for (const entity of queries.boids) {
						const { flockingAgent, velocity, localTransform } = entity.components;
						const { maxSpeed } = flockingAgent;

						// Clamp velocity to maxSpeed
						const speedSq = velocity.x * velocity.x + velocity.y * velocity.y;
						if (speedSq > maxSpeed * maxSpeed) {
							const speed = Math.sqrt(speedSq);
							velocity.x = (velocity.x / speed) * maxSpeed;
							velocity.y = (velocity.y / speed) * maxSpeed;
							ecs.markChanged(entity.id, 'velocity');
						}

						// Orient rotation to match velocity heading
						if (speedSq > SPEED_EPSILON * SPEED_EPSILON) {
							const heading = Math.atan2(velocity.y, velocity.x);
							if (heading !== localTransform.rotation) {
								localTransform.rotation = heading;
								ecs.markChanged(entity.id, 'localTransform');
							}
						}
					}
				});
		});
}
