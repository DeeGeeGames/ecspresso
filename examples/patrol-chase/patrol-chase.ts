/**
 * Patrol & Chase
 *
 * Demonstrates the detection → state machine → steering plugin pipeline.
 * Guards patrol waypoints. When the player enters detection range, they
 * chase. When the player escapes, they return to their last waypoint
 * and resume patrolling.
 *
 * States:
 *   Patrol (blue)   — cycle through waypoints via steering
 *   Chase  (orange) — follow nearest detected entity
 *   Return (yellow) — head back to last patrol waypoint, then resume
 */

import { createBeanGraphics, drawBean } from '../brand';
import { Graphics } from 'pixi.js';
import ECSpresso from 'ecspresso';
import {
	createRenderer2DPlugin,
	createGraphicsComponents,
} from 'ecspresso/plugins/rendering/renderer2D';
import { createInputPlugin } from 'ecspresso/plugins/input/input';
import { defineCollisionLayers, createCollisionPlugin, createCircleCollider, type LayersOf } from 'ecspresso/plugins/physics/collision';
import { createSpatialIndexPlugin } from 'ecspresso/plugins/spatial/spatial-index';
import { createDetectionPlugin, createDetector, hasDetectedTargets } from 'ecspresso/plugins/ai/detection';
import {
	createStateMachinePlugin,
	createStateMachine,
	createStateMachineHelpers,
} from 'ecspresso/plugins/scripting/state-machine';
import { createSteeringPlugin, createMoveSpeed } from 'ecspresso/plugins/physics/steering';

// ==================== Types ====================

interface Vector2D {
	x: number;
	y: number;
}

interface AppComponents {
	player: true;
	guard: true;
	patrol: { waypoints: ReadonlyArray<Readonly<Vector2D>>; currentIndex: number };
}

// ==================== Constants ====================

const PLAYER_SPEED = 200;
const GUARD_SPEED = 120;
const GUARD_RADIUS = 12;
const DETECTION_RANGE = 180;

const COLORS = {
	player: 0x44dd66,
	patrol: 0x4488ff,
	chase: 0xff8844,
	return: 0xddcc44,
	waypoint: 0x334466,
} as const;

function buildPatrolRoutes(w: number, h: number): ReadonlyArray<ReadonlyArray<Readonly<Vector2D>>> {
	return [
		[{ x: 80, y: 80 }, { x: w * 0.4, y: 80 }, { x: w * 0.4, y: 200 }, { x: 80, y: 200 }],
		[{ x: w - 100, y: 100 }, { x: w - 100, y: h - 100 }, { x: w - 200, y: h / 2 }],
		[{ x: w * 0.2, y: h - 100 }, { x: w * 0.5, y: h - 200 }, { x: w * 0.8, y: h - 100 }],
		[{ x: w / 2, y: h * 0.3 }, { x: w * 0.6, y: h / 2 }, { x: w / 2, y: h * 0.7 }, { x: w * 0.4, y: h / 2 }],
	];
}

// ==================== Collision Layers ====================

const layers = defineCollisionLayers({
	guard: ['player'],
	player: ['guard'],
});

// ==================== Build ECS ====================

const ecs = ECSpresso
	.create()
	.withPlugin(createRenderer2DPlugin({ background: '#111122' }))
	.withPlugin(createCollisionPlugin({ layers }))
	.withPlugin(createSpatialIndexPlugin())
	.withPlugin(createDetectionPlugin<'ai', LayersOf<typeof layers>>())
	.withPlugin(createStateMachinePlugin())
	.withPlugin(createSteeringPlugin({ arrivalThreshold: 8 }))
	.withPlugin(createInputPlugin({
		actions: {
			moveUp: { keys: ['w', 'ArrowUp'] },
			moveDown: { keys: ['s', 'ArrowDown'] },
			moveLeft: { keys: ['a', 'ArrowLeft'] },
			moveRight: { keys: ['d', 'ArrowRight'] },
		},
	}))
	.withComponentTypes<AppComponents>()
	.build();

type ECS = typeof ecs;

const { defineStateMachine } = ecs.getHelpers(createStateMachineHelpers);

// ==================== Helpers ====================

function setGuardVisual(world: ECS, entityId: number, color: number): void {
	const gfx = world.getComponent(entityId, 'graphics');
	if (!gfx) return;
	drawBean(gfx.clear(), GUARD_RADIUS, color);
	// Range ring is a child of the guard graphic — redraw it too
	const ring = gfx.children[0];
	if (!(ring instanceof Graphics)) return;
	ring.clear().circle(0, 0, DETECTION_RANGE).stroke({ color, alpha: 0.15, width: 1 });
}

// Waypoint patrol plugin candidate: the patrol component, setNextWaypoint,
// advanceWaypointIndex, and the moveTarget-absence check in patrol.onUpdate
// form a reusable pattern. Extraction is deferred until a second consumer
// emerges. Key gotcha: steering removes moveTarget via command buffer
// (deferred), but publishes arriveAtTarget synchronously — so an event-driven
// approach doesn't work (the deferred removal clobbers the new moveTarget).
// A patrol plugin must poll for moveTarget absence instead.

function setNextWaypoint(world: ECS, entityId: number): void {
	const patrol = world.getComponent(entityId, 'patrol');
	if (!patrol) return;
	const wp = patrol.waypoints[patrol.currentIndex];
	if (!wp) return;
	world.addComponent(entityId, 'moveTarget', { x: wp.x, y: wp.y });
}

function advanceWaypointIndex(world: ECS, entityId: number): void {
	const patrol = world.getComponent(entityId, 'patrol');
	if (!patrol) return;
	patrol.currentIndex = (patrol.currentIndex + 1) % patrol.waypoints.length;
}

// ==================== State Machine ====================

const guardFSM = defineStateMachine('guard', {
	initial: 'patrol',
	states: {
		patrol: {
			onEnter({ ecs: world, entityId }) {
				setGuardVisual(world, entityId, COLORS.patrol);
				setNextWaypoint(world, entityId);
			},
			onUpdate({ ecs: world, entityId }) {
				// Steering removes moveTarget on arrival — advance to next waypoint
				if (!world.getComponent(entityId, 'moveTarget')) {
					advanceWaypointIndex(world, entityId);
					setNextWaypoint(world, entityId);
				}
			},
			transitions: [
				{
					target: 'chase',
					guard: ({ ecs: world, entityId }) => hasDetectedTargets(world, entityId),
				},
			],
		},
		chase: {
			onEnter({ ecs: world, entityId }) {
				setGuardVisual(world, entityId, COLORS.chase);
			},
			onUpdate({ ecs: world, entityId }) {
				const detected = world.getComponent(entityId, 'detectedEntities');
				const nearest = detected?.entities[0];
				if (!nearest) return;
				const targetWt = world.getComponent(nearest.entityId, 'worldTransform');
				if (!targetWt) return;
				world.addComponent(entityId, 'moveTarget', { x: targetWt.x, y: targetWt.y });
			},
			transitions: [
				{
					target: 'return',
					guard: ({ ecs: world, entityId }) => !hasDetectedTargets(world, entityId),
				},
			],
		},
		return: {
			onEnter({ ecs: world, entityId }) {
				setGuardVisual(world, entityId, COLORS.return);
				setNextWaypoint(world, entityId);
			},
			transitions: [
				{
					target: 'patrol',
					guard: ({ ecs: world, entityId }) => !world.getComponent(entityId, 'moveTarget'),
				},
				{
					target: 'chase',
					guard: ({ ecs: world, entityId }) => hasDetectedTargets(world, entityId),
				},
			],
		},
	},
});

// ==================== Systems ====================

ecs
	.addSystem('player-movement')
	.inPhase('update')
	.setPriority(900)
	.withResources(['inputState'])
	.setProcessEach({ with: ['player', 'localTransform'] }, ({ entity, dt, ecs: world, resources: { inputState: input } }) => {
		const lt = entity.components.localTransform;
		const vx = (input.actions.isActive('moveRight') ? 1 : 0)
			- (input.actions.isActive('moveLeft') ? 1 : 0);
		const vy = (input.actions.isActive('moveDown') ? 1 : 0)
			- (input.actions.isActive('moveUp') ? 1 : 0);

		const len = Math.sqrt(vx * vx + vy * vy);
		if (len > 0) {
			const scale = PLAYER_SPEED * dt / len;
			lt.x += vx * scale;
			lt.y += vy * scale;
			world.markChanged(entity.id, 'localTransform');
		}
	});

// ==================== Initialize & Spawn ====================

await ecs.initialize();

const bounds = ecs.getResource('bounds');
const rootContainer = ecs.getResource('rootContainer');

const patrolRoutes = buildPatrolRoutes(bounds.width, bounds.height);

// Draw waypoint markers
for (const route of patrolRoutes) {
	for (const wp of route) {
		const dot = new Graphics().circle(0, 0, 4).fill({ color: COLORS.waypoint, alpha: 0.5 });
		dot.position.set(wp.x, wp.y);
		rootContainer.addChild(dot);
	}
}

// Spawn player
const playerGfx = createBeanGraphics(16, COLORS.player);
ecs.spawn({
	...createGraphicsComponents(
		playerGfx,
		{ x: bounds.width / 2, y: bounds.height / 2 },
	),
	...layers.player(),
	...createCircleCollider(16),
	player: true,
});

// Spawn guards
for (const route of patrolRoutes) {
	const startPos = route[0];
	if (!startPos) continue;

	const guardGfx = createBeanGraphics(GUARD_RADIUS, COLORS.patrol);
	// Range ring parented to guard — moves automatically, no sync system needed
	const rangeRing = new Graphics()
		.circle(0, 0, DETECTION_RANGE)
		.stroke({ color: COLORS.patrol, alpha: 0.15, width: 1 });
	guardGfx.addChild(rangeRing);

	ecs.spawn({
		...createGraphicsComponents(guardGfx, startPos),
		...layers.guard(),
		...createCircleCollider(GUARD_RADIUS),
		...createDetector(DETECTION_RANGE, ['player']),
		...createStateMachine(guardFSM),
		...createMoveSpeed(GUARD_SPEED),
		guard: true,
		patrol: { waypoints: route, currentIndex: 0 },
	});
}
