/**
 * State Machine Example
 *
 * Demonstrates the state machine plugin with enemies that patrol, chase,
 * and attack based on proximity to the player.
 *
 * States:
 *   Patrol (blue)  — wander back and forth
 *   Chase (orange) — move toward player when nearby
 *   Attack (red)   — flash red when very close, then return to chase
 */

import { Graphics, Sprite } from 'pixi.js';
import ECSpresso from 'ecspresso';
import {
	createRenderer2DPlugin,
	createSpriteComponents,
} from 'ecspresso/plugins/rendering/renderer2D';
import {
	createPhysics2DPlugin,
	createRigidBody,
	setVelocity,
} from 'ecspresso/plugins/physics/physics2D';
import { createInputPlugin } from 'ecspresso/plugins/input/input';
import {
	createStateMachinePlugin,
	createStateMachine,
	createStateMachineHelpers,
	getStateMachineState,
} from 'ecspresso/plugins/scripting/state-machine';

// ==================== Types ====================

interface AppComponents {
	player: true;
	enemy: true;
	patrolDirection: 1 | -1;
	speed: number;
}

// ==================== Constants ====================

const CHASE_RANGE = 180;
const ATTACK_RANGE = 50;
const PATROL_SPEED = 80;
const CHASE_SPEED = 150;
const ATTACK_DURATION = 0.4;

const STATE_COLORS = {
	patrol: 0x4444ff,
	chase: 0xff8800,
	attack: 0xff0000,
} as const;

// ==================== Build ECS ====================

const ecs = ECSpresso
	.create()
	.withPlugin(createRenderer2DPlugin({
		background: '#111122',
	}))
	.withPlugin(createPhysics2DPlugin({ gravity: { x: 0, y: 0 } }))
	.withPlugin(createInputPlugin({
		actions: {
			moveUp: { keys: ['w', 'ArrowUp'] },
			moveDown: { keys: ['s', 'ArrowDown'] },
			moveLeft: { keys: ['a', 'ArrowLeft'] },
			moveRight: { keys: ['d', 'ArrowRight'] },
		},
	}))
	.withPlugin(createStateMachinePlugin())
	.withComponentTypes<AppComponents>()
	.build();

type ECS = typeof ecs;

const { defineStateMachine } = ecs.getHelpers(createStateMachineHelpers);

// ==================== Helpers ====================

function getPlayerPosition(ecsWorld: ECS): { x: number; y: number } | null {
	const entities = ecsWorld.getEntitiesWithQuery(['player', 'worldTransform']);
	const player = entities[0];
	if (!player) return null;
	return player.components.worldTransform;
}

function distanceToPlayer(ecsWorld: ECS, entityId: number): number {
	const playerPos = getPlayerPosition(ecsWorld);
	if (!playerPos) return Infinity;

	const wt = ecsWorld.getComponent(entityId, 'worldTransform');
	if (!wt) return Infinity;

	const dx = wt.x - playerPos.x;
	const dy = wt.y - playerPos.y;
	return Math.sqrt(dx * dx + dy * dy);
}

function updateEnemyColor(ecsWorld: ECS, entityId: number, color: number): void {
	const gfx = ecsWorld.getComponent(entityId, 'graphics');
	if (!gfx) return;
	gfx.clear().circle(0, 0, 15).fill(color);
}

// ==================== State Machine Definition ====================

const enemyFSM = defineStateMachine('enemy', {
	initial: 'patrol',
	states: {
		patrol: {
			onEnter({ ecs: ecsWorld, entityId }) {
				updateEnemyColor(ecsWorld, entityId, STATE_COLORS.patrol);
			},
			onUpdate({ ecs: ecsWorld, entityId }) {
				const wt = ecsWorld.getComponent(entityId, 'worldTransform');
				const dir = ecsWorld.getComponent(entityId, 'patrolDirection');
				if (!wt || dir === null) return;

				// Reverse at screen edges
				const bounds = ecsWorld.getResource('bounds');
				if (wt.x < 40 || wt.x > bounds.width - 40) {
					const newDir = dir === 1 ? -1 : 1;
					ecsWorld.addComponent(entityId, 'patrolDirection', newDir);
					setVelocity(ecsWorld, entityId, newDir * PATROL_SPEED, 0);
				}
			},
			transitions: [
				{
					target: 'chase',
					guard: ({ ecs: ecsWorld, entityId }) => distanceToPlayer(ecsWorld, entityId) < CHASE_RANGE,
				},
			],
		},
		chase: {
			onEnter({ ecs: ecsWorld, entityId }) {
				updateEnemyColor(ecsWorld, entityId, STATE_COLORS.chase);
			},
			onUpdate({ ecs: ecsWorld, entityId }) {
				const playerPos = getPlayerPosition(ecsWorld);
				if (!playerPos) return;

				const wt = ecsWorld.getComponent(entityId, 'worldTransform');
				if (!wt) return;

				const dx = playerPos.x - wt.x;
				const dy = playerPos.y - wt.y;
				const len = Math.sqrt(dx * dx + dy * dy);
				if (len < 0.001) return;

				setVelocity(ecsWorld, entityId, (dx / len) * CHASE_SPEED, (dy / len) * CHASE_SPEED);
			},
			transitions: [
				{
					target: 'attack',
					guard: ({ ecs: ecsWorld, entityId }) => distanceToPlayer(ecsWorld, entityId) < ATTACK_RANGE,
				},
				{
					target: 'patrol',
					guard: ({ ecs: ecsWorld, entityId }) => distanceToPlayer(ecsWorld, entityId) > CHASE_RANGE * 1.3,
				},
			],
		},
		attack: {
			onEnter({ ecs: ecsWorld, entityId }) {
				updateEnemyColor(ecsWorld, entityId, STATE_COLORS.attack);
				setVelocity(ecsWorld, entityId, 0, 0);
			},
			transitions: [
				{
					target: 'chase',
					guard: ({ ecs: ecsWorld, entityId }) => {
						const sm = ecsWorld.getComponent(entityId, 'stateMachine');
						return (sm?.stateTime ?? 0) > ATTACK_DURATION;
					},
				},
			],
		},
	},
});

// ==================== Systems ====================

// Player movement
ecs
	.addSystem('player-input')
	.inPhase('preUpdate')
	.withResources(['inputState'])
	.setProcessEach({ with: ['player', 'velocity', 'speed'] }, ({ entity, ecs, resources: { inputState: input } }) => {
		const { speed } = entity.components;
		const vx = (input.actions.isActive('moveRight') ? 1 : 0) - (input.actions.isActive('moveLeft') ? 1 : 0);
		const vy = (input.actions.isActive('moveDown') ? 1 : 0) - (input.actions.isActive('moveUp') ? 1 : 0);

		// Normalize diagonal movement
		const len = Math.sqrt(vx * vx + vy * vy);
		const scale = len > 0 ? speed / len : 0;

		setVelocity(ecs, entity.id, vx * scale, vy * scale);
	});

// State label display (updates a text label above each enemy)
ecs
	.addSystem('state-label')
	.inPhase('render')
	.setProcessEach({ with: ['enemy', 'stateMachine', 'worldTransform', 'graphics'] }, ({ entity }) => {
		const state = getStateMachineState(ecs, entity.id);
		const gfx = entity.components.graphics;

		// Pulse scale in attack state for visual feedback
		if (state === 'attack') {
			const t = entity.components.stateMachine.stateTime;
			const pulse = 1 + 0.3 * Math.sin(t * 20);
			gfx.scale.set(pulse, pulse);
		} else {
			gfx.scale.set(1, 1);
		}
	});

// ==================== Initialize & Spawn ====================

await ecs.initialize();

const pixiApp = ecs.getResource('pixiApp');
const bounds = ecs.getResource('bounds');

// Spawn player
const playerGfx = new Graphics().circle(0, 0, 20).fill(0x00ff00);
ecs.spawn({
	...createSpriteComponents(
		new Sprite(pixiApp.renderer.generateTexture(playerGfx)),
		{ x: bounds.width / 2, y: bounds.height / 2 },
		{ anchor: { x: 0.5, y: 0.5 } },
	),
	...createRigidBody('kinematic'),
	player: true,
	speed: 250,
	velocity: { x: 0, y: 0 },
});

// Spawn enemies
const enemyPositions = [
	{ x: 100, y: 100 },
	{ x: bounds.width - 100, y: 100 },
	{ x: 100, y: bounds.height - 100 },
	{ x: bounds.width - 100, y: bounds.height - 100 },
	{ x: bounds.width / 2, y: 80 },
];

for (const pos of enemyPositions) {
	const gfx = new Graphics().circle(0, 0, 15).fill(STATE_COLORS.patrol);
	const dir: 1 | -1 = pos.x < bounds.width / 2 ? 1 : -1;

	ecs.spawn({
		...createSpriteComponents(
			new Sprite(pixiApp.renderer.generateTexture(gfx)),
			pos,
			{ anchor: { x: 0.5, y: 0.5 } },
		),
		...createRigidBody('kinematic'),
		...createStateMachine(enemyFSM),
		enemy: true,
		patrolDirection: dir,
		speed: PATROL_SPEED,
		velocity: { x: dir * PATROL_SPEED, y: 0 },
		graphics: gfx,
	});
}
