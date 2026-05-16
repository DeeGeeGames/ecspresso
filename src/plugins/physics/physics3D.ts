/**
 * Physics 3D Plugin for ECSpresso
 *
 * Provides ECS-native 3D arcade physics: gravity, forces, drag, semi-implicit Euler
 * integration, and impulse-based collision response with friction.
 *
 * Reuses RigidBody and collider types from the 2D physics/collision plugins for
 * shape definitions. Has its own collision detection in fixedUpdate for physics
 * response; the existing collision3D plugin can still run in postUpdate for game
 * logic events.
 */

import { definePlugin } from 'ecspresso';
import type { SystemPhase } from 'ecspresso';
import type { Vector3D } from 'ecspresso';
import type { Transform3DWorldConfig } from '../spatial/transform3D';
import type { Collision3DComponentTypes, LayerFactories } from './collision3D';
import type { RigidBody, BodyType, RigidBodyOptions } from './physics2D';
import { fillBaseColliderInfo3D, detectCollisions3D, AABB3D_SHAPE, type Contact3D, type BaseColliderInfo3D } from '../../utils/narrowphase3D';
import type { SpatialIndex3D } from '../../utils/spatial-hash3D';

// Re-export so consumers can type rigid bodies without importing physics2D
export type { RigidBody, BodyType, RigidBodyOptions };

// ==================== Component Types ====================

/**
 * Component types directly provided by the physics3D plugin.
 */
export interface Physics3DOwnComponentTypes {
	rigidBody3D: RigidBody;
	velocity3D: Vector3D;
	force3D: Vector3D;
}

/**
 * Full component types available when using the physics3D plugin
 * (own components + transform + collision dependencies).
 * Convenience alias for consumer code.
 */
export interface Physics3DComponentTypes<L extends string = never> extends Collision3DComponentTypes<L>, Physics3DOwnComponentTypes {}

// ==================== Resource Types ====================

/**
 * Physics 3D configuration resource.
 */
export interface Physics3DConfig {
	gravity: Vector3D;
}

export interface Physics3DResourceTypes {
	physics3DConfig: Physics3DConfig;
}

// ==================== Event Types ====================

/**
 * Event emitted for each physics 3D collision pair.
 *
 * Normal components are flattened (`normalX`/`normalY`/`normalZ`) rather than
 * nested in a `Vector3D` to avoid a per-event allocation in the physics hot path.
 */
export interface Physics3DCollisionEvent {
	entityA: number;
	entityB: number;
	/** Unit normal X, pointing from A toward B */
	normalX: number;
	/** Unit normal Y, pointing from A toward B */
	normalY: number;
	/** Unit normal Z, pointing from A toward B */
	normalZ: number;
	/** Penetration depth (positive) */
	depth: number;
}

export interface Physics3DEventTypes {
	physics3DCollision: Physics3DCollisionEvent;
}

// ==================== Plugin Options ====================

export interface Physics3DPluginOptions<G extends string = 'physics3D', CG extends string = never> {
	/** World gravity vector (default: {x: 0, y: 0, z: 0}) */
	gravity?: Vector3D;
	/** System group name (default: 'physics3D') */
	systemGroup?: G;
	/** Additional group for the collision system only (default: none).
	 * When set, the collision system belongs to both `systemGroup` and this group,
	 * allowing independent enable/disable of collision detection. */
	collisionSystemGroup?: CG;
	/** Priority for integration system (default: 1000) */
	integrationPriority?: number;
	/** Priority for collision system (default: 900) */
	collisionPriority?: number;
	/** Execution phase (default: 'fixedUpdate') */
	phase?: SystemPhase;
}

// ==================== Helper Functions ====================

/**
 * Create a rigidBody3D + force3D component pair.
 * Static bodies automatically get mass=Infinity.
 */
export function createRigidBody3D(
	type: BodyType,
	options?: RigidBodyOptions,
): { rigidBody3D: RigidBody; force3D: Vector3D } {
	return {
		rigidBody3D: {
			type,
			mass: type === 'static' ? Infinity : (options?.mass ?? 1),
			drag: options?.drag ?? 0,
			restitution: options?.restitution ?? 0,
			friction: options?.friction ?? 0,
			gravityScale: options?.gravityScale ?? 1,
		},
		force3D: { x: 0, y: 0, z: 0 },
	};
}

/**
 * Create a force3D component with initial values.
 */
export function createForce3D(x: number, y: number, z: number): { force3D: Vector3D } {
	return { force3D: { x, y, z } };
}

/**
 * Accumulate a force onto an entity's force3D component.
 */
export function applyForce3D(
	ecs: { getComponent(id: number, name: 'force3D'): Vector3D | undefined },
	entityId: number,
	fx: number,
	fy: number,
	fz: number,
): void {
	const force = ecs.getComponent(entityId, 'force3D');
	if (!force) return;
	force.x += fx;
	force.y += fy;
	force.z += fz;
}

/**
 * Apply an instantaneous impulse: velocity3D += impulse / mass.
 */
export function applyImpulse3D(
	ecs: {
		getComponent(id: number, name: 'velocity3D'): Vector3D | undefined;
		getComponent(id: number, name: 'rigidBody3D'): RigidBody | undefined;
	},
	entityId: number,
	ix: number,
	iy: number,
	iz: number,
): void {
	const velocity = ecs.getComponent(entityId, 'velocity3D');
	const rigidBody = ecs.getComponent(entityId, 'rigidBody3D');
	if (!velocity || !rigidBody) return;
	if (rigidBody.mass === Infinity || rigidBody.mass === 0) return;
	velocity.x += ix / rigidBody.mass;
	velocity.y += iy / rigidBody.mass;
	velocity.z += iz / rigidBody.mass;
}

/**
 * Directly set an entity's velocity3D.
 */
export function setVelocity3D(
	ecs: { getComponent(id: number, name: 'velocity3D'): Vector3D | undefined },
	entityId: number,
	vx: number,
	vy: number,
	vz: number,
): void {
	const velocity = ecs.getComponent(entityId, 'velocity3D');
	if (!velocity) return;
	velocity.x = vx;
	velocity.y = vy;
	velocity.z = vz;
}

// ==================== Internal: Collider Info ====================

interface Physics3DColliderInfo<L extends string = string> extends BaseColliderInfo3D<L> {
	rigidBody: RigidBody;
	velocity: Vector3D;
}

// ==================== Collision Response ====================

/**
 * Module-level reusable physics3D collision event. Subscribers must consume
 * synchronously — same contract as the shared narrowphase Contact3D.
 */
const _physicsCollisionEvent: Physics3DCollisionEvent = {
	entityA: 0, entityB: 0, normalX: 0, normalY: 0, normalZ: 0, depth: 0,
};

interface PhysicsEcs3DLike {
	getComponent(id: number, name: 'localTransform3D'): { x: number; y: number; z: number } | undefined;
	eventBus: { publish(event: 'physics3DCollision', data: Physics3DCollisionEvent): void };
	markChangedIfTracked(entityId: number, componentName: 'localTransform3D' | 'velocity3D'): void;
}

/**
 * Resolve a 3D physics collision pair: position correction, impulse response, event.
 *
 * Friction uses a tangent plane projection: the tangential velocity is the
 * component of relative velocity perpendicular to the contact normal. This
 * generalizes the 2D tangent-line approach to 3D — mathematically the same
 * operation with an added Z component.
 */
function resolvePhysicsContact3D(
	a: Physics3DColliderInfo,
	b: Physics3DColliderInfo,
	contact: Contact3D,
	ecs: PhysicsEcs3DLike,
): void {
	const invMassA = (a.rigidBody.type === 'dynamic' && a.rigidBody.mass > 0 && a.rigidBody.mass !== Infinity)
		? 1 / a.rigidBody.mass
		: 0;
	const invMassB = (b.rigidBody.type === 'dynamic' && b.rigidBody.mass > 0 && b.rigidBody.mass !== Infinity)
		? 1 / b.rigidBody.mass
		: 0;
	const totalInvMass = invMassA + invMassB;

	// Position correction
	if (totalInvMass > 0) {
		const correctionScale = contact.depth / totalInvMass;

		if (invMassA > 0) {
			const ltA = ecs.getComponent(a.entityId, 'localTransform3D');
			if (!ltA) return;
			const corrA = correctionScale * invMassA;
			ltA.x -= corrA * contact.normalX;
			ltA.y -= corrA * contact.normalY;
			ltA.z -= corrA * contact.normalZ;
			// Sync cached position so subsequent pairs in this frame use corrected values
			a.x = ltA.x;
			a.y = ltA.y;
			a.z = ltA.z;
			ecs.markChangedIfTracked(a.entityId, 'localTransform3D');
		}

		if (invMassB > 0) {
			const ltB = ecs.getComponent(b.entityId, 'localTransform3D');
			if (!ltB) return;
			const corrB = correctionScale * invMassB;
			ltB.x += corrB * contact.normalX;
			ltB.y += corrB * contact.normalY;
			ltB.z += corrB * contact.normalZ;
			b.x = ltB.x;
			b.y = ltB.y;
			b.z = ltB.z;
			ecs.markChangedIfTracked(b.entityId, 'localTransform3D');
		}

		// Velocity response (impulse-based)
		const relVelX = b.velocity.x - a.velocity.x;
		const relVelY = b.velocity.y - a.velocity.y;
		const relVelZ = b.velocity.z - a.velocity.z;
		const velAlongNormal = relVelX * contact.normalX + relVelY * contact.normalY + relVelZ * contact.normalZ;

		if (velAlongNormal < 0) {
			const restitution = Math.min(a.rigidBody.restitution, b.rigidBody.restitution);
			const normalImpulse = -(1 + restitution) * velAlongNormal / totalInvMass;
			const impA = normalImpulse * invMassA;
			const impB = normalImpulse * invMassB;

			a.velocity.x -= impA * contact.normalX;
			a.velocity.y -= impA * contact.normalY;
			a.velocity.z -= impA * contact.normalZ;
			b.velocity.x += impB * contact.normalX;
			b.velocity.y += impB * contact.normalY;
			b.velocity.z += impB * contact.normalZ;

			// Friction (tangential impulse — project relative velocity onto tangent plane)
			const tangentX = relVelX - velAlongNormal * contact.normalX;
			const tangentY = relVelY - velAlongNormal * contact.normalY;
			const tangentZ = relVelZ - velAlongNormal * contact.normalZ;
			const tangentSpeed = Math.sqrt(tangentX * tangentX + tangentY * tangentY + tangentZ * tangentZ);

			if (tangentSpeed > 1e-6) {
				const tangentNX = tangentX / tangentSpeed;
				const tangentNY = tangentY / tangentSpeed;
				const tangentNZ = tangentZ / tangentSpeed;
				const friction = Math.sqrt(a.rigidBody.friction * b.rigidBody.friction);
				const maxFrictionImpulse = friction * Math.abs(normalImpulse);
				const tangentImpulse = Math.min(tangentSpeed / totalInvMass, maxFrictionImpulse);
				const tanA = tangentImpulse * invMassA;
				const tanB = tangentImpulse * invMassB;

				a.velocity.x += tanA * tangentNX;
				a.velocity.y += tanA * tangentNY;
				a.velocity.z += tanA * tangentNZ;
				b.velocity.x -= tanB * tangentNX;
				b.velocity.y -= tanB * tangentNY;
				b.velocity.z -= tanB * tangentNZ;
			}
		}

		ecs.markChangedIfTracked(a.entityId, 'velocity3D');
		ecs.markChangedIfTracked(b.entityId, 'velocity3D');
	}

	_physicsCollisionEvent.entityA = a.entityId;
	_physicsCollisionEvent.entityB = b.entityId;
	_physicsCollisionEvent.normalX = contact.normalX;
	_physicsCollisionEvent.normalY = contact.normalY;
	_physicsCollisionEvent.normalZ = contact.normalZ;
	_physicsCollisionEvent.depth = contact.depth;
	ecs.eventBus.publish('physics3DCollision', _physicsCollisionEvent);
}

// ==================== Plugin Factory ====================

/**
 * Create a 3D physics plugin for ECSpresso.
 *
 * Provides:
 * - Semi-implicit Euler integration (gravity, forces, drag → velocity3D → position)
 * - Impulse-based collision response with restitution and friction
 * - physics3DCollision events with contact normal and depth
 *
 * @example
 * ```typescript
 * const ecs = ECSpresso.create()
 *   .withPlugin(createTransform3DPlugin())
 *   .withPlugin(createPhysics3DPlugin({ gravity: { x: 0, y: -9.81, z: 0 } }))
 *   .withFixedTimestep(1/60)
 *   .build();
 *
 * ecs.spawn({
 *   ...createTransform3D(0, 10, 0),
 *   ...createRigidBody3D('dynamic', { mass: 1, restitution: 0.5 }),
 *   velocity3D: { x: 0, y: 0, z: 0 },
 *   ...createAABB3DCollider(1, 1, 1),
 *   ...createCollisionLayer('player', ['ground']),
 * });
 * ```
 */

type Physics3DProvides<L extends string = never> = Physics3DOwnComponentTypes & Collision3DComponentTypes<L>;

export function createPhysics3DPlugin<L extends string = never, G extends string = 'physics3D', CG extends string = never>(
	options?: Physics3DPluginOptions<G, CG> & { layers?: LayerFactories<Record<L, readonly string[]>> },
) {
	const {
		gravity = { x: 0, y: 0, z: 0 },
		systemGroup = 'physics3D',
		collisionSystemGroup,
		integrationPriority = 1000,
		collisionPriority = 900,
		phase = 'fixedUpdate',
	} = options ?? {};

	return definePlugin('physics3D')
		.withComponentTypes<Physics3DProvides<L>>()
		.withEventTypes<Physics3DEventTypes>()
		.withResourceTypes<Physics3DResourceTypes>()
		.withLabels<'physics3D-integration' | 'physics3D-collision'>()
		.withGroups<G | CG>()
		.requires<Transform3DWorldConfig>()
		.install((world) => {
			// rigidBody3D requires velocity3D and force3D — auto-add with zero defaults
			world.registerRequired('rigidBody3D', 'velocity3D', () => ({ x: 0, y: 0, z: 0 }));
			world.registerRequired('rigidBody3D', 'force3D', () => ({ x: 0, y: 0, z: 0 }));

			world.addResource('physics3DConfig', { gravity: { x: gravity.x, y: gravity.y, z: gravity.z } });

			// ==================== Integration System ====================

			world
				.addSystem('physics3D-integration')
				.setPriority(integrationPriority)
				.inPhase(phase)
				.inGroup(systemGroup)
				.addQuery('bodies', {
					with: ['localTransform3D', 'velocity3D', 'rigidBody3D', 'force3D'],
				})
				.setProcess(({ queries, dt, ecs }) => {
					const { gravity: g } = ecs.getResource('physics3DConfig');
					const gx = g.x;
					const gy = g.y;
					const gz = g.z;

					// TODO(perf): no early-out for "sleeping" dynamic bodies — a packed
					// pile of resting entities still runs gravity/drag/force-clear/
					// markChanged every step. A sleep flag on RigidBody that latches
					// after N frames of near-zero velocity (and clears on impulse or
					// applied force) would let most of a stabilized scene skip the
					// full per-entity body of this loop. Needs collision response to
					// wake sleepers back up; keep in sync with physics2D when landed.
					for (const entity of queries.bodies) {
						const { localTransform3D, velocity3D, rigidBody3D, force3D } = entity.components;

						// Static bodies: skip entirely
						if (rigidBody3D.type === 'static') continue;

						// Dynamic bodies: apply gravity, forces, drag
						if (rigidBody3D.type === 'dynamic') {
							// 1. Gravity
							const gsdt = rigidBody3D.gravityScale * dt;
							velocity3D.x += gx * gsdt;
							velocity3D.y += gy * gsdt;
							velocity3D.z += gz * gsdt;

							// 2. Forces (F = ma → a = F/m)
							const mass = rigidBody3D.mass;
							if (mass > 0 && mass !== Infinity) {
								const invMassDt = dt / mass;
								velocity3D.x += force3D.x * invMassDt;
								velocity3D.y += force3D.y * invMassDt;
								velocity3D.z += force3D.z * invMassDt;
							}

							// 3. Drag
							if (rigidBody3D.drag > 0) {
								const damping = Math.max(0, 1 - rigidBody3D.drag * dt);
								velocity3D.x *= damping;
								velocity3D.y *= damping;
								velocity3D.z *= damping;
							}
						}

						// Both dynamic and kinematic: integrate position
						localTransform3D.x += velocity3D.x * dt;
						localTransform3D.y += velocity3D.y * dt;
						localTransform3D.z += velocity3D.z * dt;

						// Clear accumulated forces
						force3D.x = 0;
						force3D.y = 0;
						force3D.z = 0;

						ecs.markChangedIfTracked(entity.id, 'localTransform3D');
					}
				});

			// ==================== Collision System ====================

			const collisionSystem = world
				.addSystem('physics3D-collision')
				.setPriority(collisionPriority)
				.inPhase(phase)
				.inGroup(systemGroup);

			if (collisionSystemGroup) {
				collisionSystem.inGroup(collisionSystemGroup);
			}

			// Grow-only pool of Physics3DColliderInfo slots reused across frames.
			// Steady-state: zero allocations per frame once the pool is warm.
			const colliderPool: Physics3DColliderInfo<L>[] = [];
			// Reusable entityId → collider lookup for the broadphase path.
			const broadphaseMap = new Map<number, Physics3DColliderInfo<L>>();
			// Cached spatial index reference (resolved once on first frame).
			let cachedSI: SpatialIndex3D | undefined;
			let siResolved = false;

			collisionSystem
				.addQuery('collidables', {
					with: ['localTransform3D', 'rigidBody3D', 'velocity3D', 'collisionLayer'],
				})
				.setProcess(({ queries, ecs }) => {
					let count = 0;

					// TODO(perf): collider shape is discovered via two ecs.getComponent
					// calls per entity per frame because the query can't express
					// "aabb3DCollider OR sphereCollider". Splitting into two queries
					// (aabb-bearing, sphere-bearing) would eliminate these lookups at
					// the cost of two pool-fill passes. Revisit once the query API
					// gains `anyOf`-style predicates.
					for (const entity of queries.collidables) {
						const { localTransform3D, rigidBody3D, velocity3D, collisionLayer } = entity.components;
						const aabb = ecs.getComponent(entity.id, 'aabb3DCollider');
						const sphere = aabb ? undefined : ecs.getComponent(entity.id, 'sphereCollider');
						if (!aabb && !sphere) continue;

						let slot = colliderPool[count];
						if (!slot) {
							slot = {
								entityId: entity.id,
								x: localTransform3D.x,
								y: localTransform3D.y,
								z: localTransform3D.z,
								layer: collisionLayer.layer,
								collidesWith: collisionLayer.collidesWith,
								layerBit: 0,
								collidesWithMask: 0,
								shape: AABB3D_SHAPE,
								halfWidth: 0,
								halfHeight: 0,
								halfDepth: 0,
								radius: 0,
								rigidBody: rigidBody3D,
								velocity: velocity3D,
							};
							colliderPool[count] = slot;
						} else {
							slot.rigidBody = rigidBody3D;
							slot.velocity = velocity3D;
						}

						if (!fillBaseColliderInfo3D(
							slot,
							entity.id, localTransform3D.x, localTransform3D.y, localTransform3D.z,
							collisionLayer.layer, collisionLayer.collidesWith,
							aabb, sphere,
						)) continue;

						count++;
					}

					if (!siResolved) {
						cachedSI = ecs.tryGetResource<SpatialIndex3D>('spatialIndex3D');
						siResolved = true;
					}
					detectCollisions3D(colliderPool, count, broadphaseMap, cachedSI, resolvePhysicsContact3D, ecs);
				});
		});
}
