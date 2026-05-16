/**
 * Physics 2D Plugin for ECSpresso
 *
 * Provides ECS-native arcade physics: gravity, forces, drag, semi-implicit Euler
 * integration, and impulse-based collision response with friction.
 *
 * Reuses collider types from the collision plugin for shape definitions.
 * Has its own collision detection in fixedUpdate for physics response;
 * the existing collision plugin can still run in postUpdate for game logic events.
 */

import { definePlugin } from 'ecspresso';
import type { SystemPhase } from 'ecspresso';
import type { TransformComponentTypes, TransformWorldConfig } from '../spatial/transform';
import type { CollisionComponentTypes, LayerFactories } from './collision';
import type { Vector2D } from 'ecspresso';
import { fillBaseColliderInfo, detectCollisions, createBroadphaseScratch, AABB_SHAPE, type Contact, type BaseColliderInfo } from '../../utils/narrowphase';
import type { SpatialIndex } from '../../utils/spatial-hash';

// ==================== Component Types ====================

/**
 * Rigid body types for physics simulation.
 * - 'dynamic': Fully simulated (gravity, forces, collisions)
 * - 'kinematic': Moves via velocity only (ignores gravity/forces, immovable in collisions)
 * - 'static': Immovable (ignores gravity, forces, and velocity)
 */
export type BodyType = 'dynamic' | 'kinematic' | 'static';

/**
 * Rigid body component controlling physics behavior.
 */
export interface RigidBody {
	type: BodyType;
	/** Mass in arbitrary units. Affects force→acceleration. Infinity = immovable. */
	mass: number;
	/** Linear velocity damping coefficient (units/sec, 0 = none) */
	drag: number;
	/** Bounciness 0–1 (0 = no bounce, 1 = perfectly elastic) */
	restitution: number;
	/** Surface friction coefficient 0–1 */
	friction: number;
	/** Per-entity gravity multiplier (0 = no gravity) */
	gravityScale: number;
}

/**
 * Component types directly provided by the physics plugin.
 */
export interface Physics2DOwnComponentTypes {
	rigidBody: RigidBody;
	velocity: Vector2D;
	force: Vector2D;
}

/**
 * Full component types available when using the physics plugin
 * (own components + transform + collision dependencies).
 * Convenience alias for consumer code.
 */
export interface Physics2DComponentTypes<L extends string = never> extends TransformComponentTypes, CollisionComponentTypes<L>, Physics2DOwnComponentTypes {}

// ==================== Resource Types ====================

/**
 * Physics configuration resource.
 */
export interface Physics2DConfig {
	gravity: Vector2D;
}

export interface Physics2DResourceTypes {
	physicsConfig: Physics2DConfig;
}

// ==================== Event Types ====================

/**
 * Event emitted for each physics collision pair.
 *
 * Normal components are flattened (`normalX`/`normalY`) rather than nested
 * in a `Vector2D` to avoid a per-event allocation in the physics hot path.
 */
export interface Physics2DCollisionEvent {
	entityA: number;
	entityB: number;
	/** Unit normal X, pointing from A toward B */
	normalX: number;
	/** Unit normal Y, pointing from A toward B */
	normalY: number;
	/** Penetration depth (positive) */
	depth: number;
}

export interface Physics2DEventTypes {
	physicsCollision: Physics2DCollisionEvent;
}

// ==================== Plugin Options ====================

export interface Physics2DPluginOptions<G extends string = 'physics2D', CG extends string = never> {
	/** World gravity vector (default: {x: 0, y: 0}) */
	gravity?: Vector2D;
	/** System group name (default: 'physics2D') */
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

export interface RigidBodyOptions {
	mass?: number;
	drag?: number;
	restitution?: number;
	friction?: number;
	gravityScale?: number;
}

/**
 * Create a rigid body + force component pair.
 * Static bodies automatically get mass=Infinity.
 */
export function createRigidBody(
	type: BodyType,
	options?: RigidBodyOptions,
): { rigidBody: RigidBody; force: Vector2D } {
	return {
		rigidBody: {
			type,
			mass: type === 'static' ? Infinity : (options?.mass ?? 1),
			drag: options?.drag ?? 0,
			restitution: options?.restitution ?? 0,
			friction: options?.friction ?? 0,
			gravityScale: options?.gravityScale ?? 1,
		},
		force: { x: 0, y: 0 },
	};
}

/**
 * Create a force component with initial values.
 */
export function createForce(x: number, y: number): { force: Vector2D } {
	return { force: { x, y } };
}

/**
 * Accumulate a force onto an entity's force component.
 */
export function applyForce(
	ecs: { getComponent(id: number, name: 'force'): Vector2D | undefined },
	entityId: number,
	fx: number,
	fy: number,
): void {
	const force = ecs.getComponent(entityId, 'force');
	if (!force) return;
	force.x += fx;
	force.y += fy;
}

/**
 * Apply an instantaneous impulse: velocity += impulse / mass.
 */
export function applyImpulse(
	ecs: {
		getComponent(id: number, name: 'velocity'): Vector2D | undefined;
		getComponent(id: number, name: 'rigidBody'): RigidBody | undefined;
	},
	entityId: number,
	ix: number,
	iy: number,
): void {
	const velocity = ecs.getComponent(entityId, 'velocity');
	const rigidBody = ecs.getComponent(entityId, 'rigidBody');
	if (!velocity || !rigidBody) return;
	if (rigidBody.mass === Infinity || rigidBody.mass === 0) return;
	velocity.x += ix / rigidBody.mass;
	velocity.y += iy / rigidBody.mass;
}

/**
 * Directly set an entity's velocity.
 */
export function setVelocity(
	ecs: { getComponent(id: number, name: 'velocity'): Vector2D | undefined },
	entityId: number,
	vx: number,
	vy: number,
): void {
	const velocity = ecs.getComponent(entityId, 'velocity');
	if (!velocity) return;
	velocity.x = vx;
	velocity.y = vy;
}

// ==================== Internal: Collider Info ====================

interface Physics2DColliderInfo<L extends string = string> extends BaseColliderInfo<L> {
	rigidBody: RigidBody;
	velocity: Vector2D;
}

// ==================== Collision Response ====================

/**
 * Module-level reusable physics collision event. Subscribers must consume
 * synchronously — same contract as the shared narrowphase Contact.
 */
const _physicsCollisionEvent: Physics2DCollisionEvent = {
	entityA: 0, entityB: 0, normalX: 0, normalY: 0, depth: 0,
};

interface PhysicsEcsLike {
	getComponent(id: number, name: 'localTransform'): { x: number; y: number } | undefined;
	eventBus: { publish(event: 'physicsCollision', data: Physics2DCollisionEvent): void };
	markChangedIfTracked(entityId: number, componentName: 'localTransform' | 'velocity'): void;
}

/**
 * Resolve a physics collision pair: position correction, impulse response, event.
 */
function resolvePhysicsContact(
	a: Physics2DColliderInfo,
	b: Physics2DColliderInfo,
	contact: Contact,
	ecs: PhysicsEcsLike,
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
			const ltA = ecs.getComponent(a.entityId, 'localTransform');
			if (!ltA) return;
			const corrA = correctionScale * invMassA;
			ltA.x -= corrA * contact.normalX;
			ltA.y -= corrA * contact.normalY;
			// Sync cached position so subsequent pairs in this frame use corrected values
			a.x = ltA.x;
			a.y = ltA.y;
			ecs.markChangedIfTracked(a.entityId, 'localTransform');
		}

		if (invMassB > 0) {
			const ltB = ecs.getComponent(b.entityId, 'localTransform');
			if (!ltB) return;
			const corrB = correctionScale * invMassB;
			ltB.x += corrB * contact.normalX;
			ltB.y += corrB * contact.normalY;
			b.x = ltB.x;
			b.y = ltB.y;
			ecs.markChangedIfTracked(b.entityId, 'localTransform');
		}

		// Velocity response (impulse-based)
		const relVelX = b.velocity.x - a.velocity.x;
		const relVelY = b.velocity.y - a.velocity.y;
		const velAlongNormal = relVelX * contact.normalX + relVelY * contact.normalY;

		if (velAlongNormal < 0) {
			const restitution = Math.min(a.rigidBody.restitution, b.rigidBody.restitution);
			const normalImpulse = -(1 + restitution) * velAlongNormal / totalInvMass;

			a.velocity.x -= normalImpulse * invMassA * contact.normalX;
			a.velocity.y -= normalImpulse * invMassA * contact.normalY;
			b.velocity.x += normalImpulse * invMassB * contact.normalX;
			b.velocity.y += normalImpulse * invMassB * contact.normalY;

			// Friction (tangential impulse)
			const tangentX = relVelX - velAlongNormal * contact.normalX;
			const tangentY = relVelY - velAlongNormal * contact.normalY;
			const tangentSpeed = Math.sqrt(tangentX * tangentX + tangentY * tangentY);

			if (tangentSpeed > 1e-6) {
				const tangentNX = tangentX / tangentSpeed;
				const tangentNY = tangentY / tangentSpeed;
				const friction = Math.sqrt(a.rigidBody.friction * b.rigidBody.friction);
				const maxFrictionImpulse = friction * Math.abs(normalImpulse);
				const tangentImpulse = Math.min(tangentSpeed / totalInvMass, maxFrictionImpulse);

				a.velocity.x += tangentImpulse * invMassA * tangentNX;
				a.velocity.y += tangentImpulse * invMassA * tangentNY;
				b.velocity.x -= tangentImpulse * invMassB * tangentNX;
				b.velocity.y -= tangentImpulse * invMassB * tangentNY;
			}
		}

		ecs.markChangedIfTracked(a.entityId, 'velocity');
		ecs.markChangedIfTracked(b.entityId, 'velocity');
	}

	_physicsCollisionEvent.entityA = a.entityId;
	_physicsCollisionEvent.entityB = b.entityId;
	_physicsCollisionEvent.normalX = contact.normalX;
	_physicsCollisionEvent.normalY = contact.normalY;
	_physicsCollisionEvent.depth = contact.depth;
	ecs.eventBus.publish('physicsCollision', _physicsCollisionEvent);
}

// ==================== Plugin Factory ====================

/**
 * Create a 2D physics plugin for ECSpresso.
 *
 * Provides:
 * - Semi-implicit Euler integration (gravity, forces, drag → velocity → position)
 * - Impulse-based collision response with restitution and friction
 * - physicsCollision events with contact normal and depth
 *
 * @example
 * ```typescript
 * const ecs = ECSpresso.create()
 *   .withPlugin(createTransformPlugin())
 *   .withPlugin(createPhysics2DPlugin({ gravity: { x: 0, y: 980 } }))
 *   .withFixedTimestep(1/60)
 *   .build();
 *
 * ecs.spawn({
 *   ...createTransform(100, 200),
 *   ...createRigidBody('dynamic', { mass: 1, restitution: 0.5 }),
 *   velocity: { x: 0, y: 0 },
 *   ...createAABBCollider(32, 32),
 *   ...createCollisionLayer('player', ['ground']),
 * });
 * ```
 */

type Physics2DProvides<L extends string = never> = Physics2DOwnComponentTypes & CollisionComponentTypes<L>;

export function createPhysics2DPlugin<L extends string = never, G extends string = 'physics2D', CG extends string = never>(
	options?: Physics2DPluginOptions<G, CG> & { layers?: LayerFactories<Record<L, readonly string[]>> },
) {
	const {
		gravity = { x: 0, y: 0 },
		systemGroup = 'physics2D',
		collisionSystemGroup,
		integrationPriority = 1000,
		collisionPriority = 900,
		phase = 'fixedUpdate',
	} = options ?? {};

	return definePlugin('physics2D')
		.withComponentTypes<Physics2DProvides<L>>()
		.withEventTypes<Physics2DEventTypes>()
		.withResourceTypes<Physics2DResourceTypes>()
		.withLabels<'physics2D-integration' | 'physics2D-collision'>()
		.withGroups<G | CG>()
		.requires<TransformWorldConfig>()
		.install((world) => {
			// rigidBody requires velocity and force — auto-add with zero defaults
			world.registerRequired('rigidBody', 'velocity', () => ({ x: 0, y: 0 }));
			world.registerRequired('rigidBody', 'force', () => ({ x: 0, y: 0 }));

			world.addResource('physicsConfig', { gravity: { x: gravity.x, y: gravity.y } });

			// ==================== Integration System ====================

			world
				.addSystem('physics2D-integration')
				.setPriority(integrationPriority)
				.inPhase(phase)
				.inGroup(systemGroup)
				.addQuery('bodies', {
					with: ['localTransform', 'velocity', 'rigidBody', 'force'],
				})
				.setProcess(({ queries, dt, ecs }) => {
					const { gravity: g } = ecs.getResource('physicsConfig');
					const gx = g.x;
					const gy = g.y;

					// TODO(perf): no early-out for "sleeping" dynamic bodies — a packed
					// pile of resting entities still runs gravity/drag/force-clear/
					// markChanged every step. A sleep flag on RigidBody that latches
					// after N frames of near-zero velocity (and clears on impulse or
					// applied force) would let most of a stabilized scene skip the
					// full per-entity body of this loop. Keep in sync with physics3D.
					for (const entity of queries.bodies) {
						const { localTransform, velocity, rigidBody, force } = entity.components;

						// Static bodies: skip entirely
						if (rigidBody.type === 'static') continue;

						// Dynamic bodies: apply gravity, forces, drag
						if (rigidBody.type === 'dynamic') {
							// 1. Gravity
							const gsdt = rigidBody.gravityScale * dt;
							velocity.x += gx * gsdt;
							velocity.y += gy * gsdt;

							// 2. Forces (F = ma → a = F/m)
							const mass = rigidBody.mass;
							if (mass > 0 && mass !== Infinity) {
								const invMassDt = dt / mass;
								velocity.x += force.x * invMassDt;
								velocity.y += force.y * invMassDt;
							}

							// 3. Drag
							if (rigidBody.drag > 0) {
								const damping = Math.max(0, 1 - rigidBody.drag * dt);
								velocity.x *= damping;
								velocity.y *= damping;
							}
						}

						// Both dynamic and kinematic: integrate position
						localTransform.x += velocity.x * dt;
						localTransform.y += velocity.y * dt;

						// Clear accumulated forces
						force.x = 0;
						force.y = 0;

						ecs.markChangedIfTracked(entity.id, 'localTransform');
					}
				});

			// ==================== Collision System ====================

			const collisionSystem = world
				.addSystem('physics2D-collision')
				.setPriority(collisionPriority)
				.inPhase(phase)
				.inGroup(systemGroup);

			if (collisionSystemGroup) {
				collisionSystem.inGroup(collisionSystemGroup);
			}

			// Grow-only pool of Physics2DColliderInfo slots reused across frames.
			// Steady-state: zero allocations per frame once the pool is warm.
			const colliderPool: Physics2DColliderInfo<L>[] = [];
			const broadphaseScratch = createBroadphaseScratch<Physics2DColliderInfo<L>>();
			// Cached spatial index reference (resolved once on first frame).
			let cachedSI: SpatialIndex | undefined;
			let siResolved = false;

			collisionSystem
				.addQuery('collidables', {
					with: ['localTransform', 'rigidBody', 'velocity', 'collisionLayer'],
				})
				.setProcess(({ queries, ecs }) => {
					let count = 0;

					// TODO(perf): collider shape is discovered via two ecs.getComponent
					// calls per entity per frame because the query can't express
					// "aabbCollider OR circleCollider". Splitting into two queries
					// (aabb-bearing, circle-bearing) would eliminate these lookups at
					// the cost of two pool-fill passes. Keep in sync with physics3D.
					for (const entity of queries.collidables) {
						const { localTransform, rigidBody, velocity, collisionLayer } = entity.components;
						const aabb = ecs.getComponent(entity.id, 'aabbCollider');
						const circle = aabb ? undefined : ecs.getComponent(entity.id, 'circleCollider');
						if (!aabb && !circle) continue;

						let slot = colliderPool[count];
						if (!slot) {
							slot = {
								entityId: entity.id,
								x: localTransform.x,
								y: localTransform.y,
								layer: collisionLayer.layer,
								collidesWith: collisionLayer.collidesWith,
								layerBit: 0,
								collidesWithMask: 0,
								shape: AABB_SHAPE,
								halfWidth: 0,
								halfHeight: 0,
								radius: 0,
								rigidBody,
								velocity,
							};
							colliderPool[count] = slot;
						} else {
							slot.rigidBody = rigidBody;
							slot.velocity = velocity;
						}

						if (!fillBaseColliderInfo(
							slot,
							entity.id, localTransform.x, localTransform.y,
							collisionLayer.layer, collisionLayer.collidesWith,
							aabb, circle,
						)) continue;

						count++;
					}

					if (!siResolved) {
						cachedSI = ecs.tryGetResource<SpatialIndex>('spatialIndex');
						siResolved = true;
					}
					detectCollisions(colliderPool, count, broadphaseScratch, cachedSI, resolvePhysicsContact, ecs);
				});
		});
}
