import { Graphics, Sprite } from 'pixi.js';
import ECSpresso from '../../src';
import {
	createRenderer2DPlugin,
	createLocalTransform,
} from '../../src/plugins/rendering/renderer2D';
import {
	createPhysics2DPlugin,
	createRigidBody,
} from '../../src/plugins/physics/physics2D';
import { createInputPlugin } from '../../src/plugins/input/input';
import {
	defineCollisionLayers,
	createAABBCollider,
} from '../../src/plugins/physics/collision';
import { createTimerPlugin, createTimer, type Timer } from '../../src/plugins/scripting/timers';

const MOVE_SPEED = 300;
const JUMP_VELOCITY = -450;
const GRAVITY = 800;
const PLAYER_WIDTH = 32;
const PLAYER_HEIGHT = 48;
const PLAYER_COLOR = 0xFF4444;
const PLATFORM_COLOR = 0x44AA44;
const PLATFORM_HEIGHT = 20;
const GROUND_HEIGHT = 32;
const COYOTE_DURATION = 0.12;      // seconds (~7 ticks at 60Hz)
const JUMP_BUFFER_DURATION = 0.1;  // seconds (~6 ticks at 60Hz)

const layers = defineCollisionLayers({
	player: ['platform'],
	platform: ['player'],
});

const ecs = ECSpresso.create()
	.withPlugin(createRenderer2DPlugin({ background: '#222244' }))
	.withPlugin(createPhysics2DPlugin({
		gravity: { x: 0, y: GRAVITY },
		layers,
	}))
	.withPlugin(createInputPlugin({
		actions: {
			moveLeft: { keys: ['a', 'ArrowLeft'] },
			moveRight: { keys: ['d', 'ArrowRight'] },
			jump: { keys: ['w', 'ArrowUp', ' '] },
		},
	}))
	.withPlugin(createTimerPlugin<'coyote' | 'jumpBuffer'>())
	.withFixedTimestep(1 / 60)
	.withComponentTypes<{
		player: true;
		groundContact: { grounded: boolean };
	}>()
	.build();

// Reset grounded flag before physics runs each tick
ecs.addSystem('ground-reset')
	.inPhase('fixedUpdate')
	.setPriority(2000)
	.setProcessEach({ with: ['groundContact'] }, ({ entity }) => {
		entity.components.groundContact.grounded = false;
	});

type PlayerTimerSlot = 'coyote' | 'jumpBuffer';
type PlayerTimer = Timer<PlayerTimerSlot>;

function restartTimer(t: PlayerTimer) {
	t.elapsed = 0;
	t.active = true;
}

function applyGroundLanding(
	gc: { grounded: boolean },
	timers: { coyote: PlayerTimer; jumpBuffer: PlayerTimer },
	vel: { y: number } | undefined,
) {
	gc.grounded = true;
	restartTimer(timers.coyote);
	if (timers.jumpBuffer.active && vel) {
		vel.y = JUMP_VELOCITY;
		timers.jumpBuffer.active = false;
	}
}

function getPlayerTimers(timers: Partial<Record<PlayerTimerSlot, PlayerTimer>>): { coyote: PlayerTimer; jumpBuffer: PlayerTimer } | undefined {
	const coyote = timers.coyote;
	const jumpBuffer = timers.jumpBuffer;
	if (!coyote || !jumpBuffer) return undefined;
	return { coyote, jumpBuffer };
}

// Detect ground contact from physics collision normals
// Normal points from entityA toward entityB; normalY > 0.5 means A is above B
ecs.addSystem('ground-detect')
	.setEventHandlers({
		physicsCollision({ data, ecs: world }) {
			const handle = (id: number) => {
				const gc = world.getComponent(id, 'groundContact');
				const timers = world.getComponent(id, 'timers');
				if (!gc || !timers) return;
				const player = getPlayerTimers(timers);
				if (player) applyGroundLanding(gc, player, world.getComponent(id, 'velocity'));
			};
			if (world.getComponent(data.entityA, 'player') && data.normalY > 0.5) {
				handle(data.entityA);
				return;
			}
			if (world.getComponent(data.entityB, 'player') && data.normalY < -0.5) {
				handle(data.entityB);
			}
		},
	});

// Player input: horizontal movement + jump when grounded
ecs.addSystem('player-input')
	.inPhase('preUpdate')
	.withResources(['inputState'])
	.setProcessEach({ with: ['player', 'velocity', 'groundContact', 'timers'] }, ({ entity, resources: { inputState: input } }) => {
		const { velocity, groundContact, timers } = entity.components;
		const player = getPlayerTimers(timers);
		if (!player) return;

		const left = input.actions.isActive('moveLeft') ? -MOVE_SPEED : 0;
		const right = input.actions.isActive('moveRight') ? MOVE_SPEED : 0;
		velocity.x = left + right;

		const canJump = groundContact.grounded || player.coyote.active;
		if (input.actions.justActivated('jump')) {
			if (canJump) {
				velocity.y = JUMP_VELOCITY;
				player.coyote.active = false;
				player.jumpBuffer.active = false;
			} else {
				restartTimer(player.jumpBuffer);
			}
		}
	});

await ecs.initialize();

const pixiApp = ecs.getResource('pixiApp');
const screenW = pixiApp.screen.width;
const screenH = pixiApp.screen.height;

function createRectSprite(width: number, height: number, color: number): Sprite {
	const gfx = new Graphics().rect(0, 0, width, height).fill(color);
	const texture = pixiApp.renderer.generateTexture(gfx);
	gfx.destroy();
	const sprite = new Sprite(texture);
	sprite.anchor.set(0.5, 0.5);
	return sprite;
}

function spawnPlatform(x: number, y: number, w: number, h: number) {
	ecs.spawn({
		sprite: createRectSprite(w, h, PLATFORM_COLOR),
		...createLocalTransform(x, y),
		...createRigidBody('static'),
		...createAABBCollider(w, h),
		...layers.platform(),
	});
}

// Player
ecs.spawn({
	sprite: createRectSprite(PLAYER_WIDTH, PLAYER_HEIGHT, PLAYER_COLOR),
	...createLocalTransform(screenW / 2, screenH - 100),
	...createRigidBody('dynamic', { restitution: 0, friction: 0 }),
	velocity: { x: 0, y: 0 },
	...createAABBCollider(PLAYER_WIDTH, PLAYER_HEIGHT),
	...layers.player(),
	player: true as const,
	groundContact: { grounded: false },
	timers: {
		coyote: { ...createTimer(COYOTE_DURATION), active: false },
		jumpBuffer: { ...createTimer(JUMP_BUFFER_DURATION), active: false },
	},
});

// Ground
spawnPlatform(screenW / 2, screenH - GROUND_HEIGHT / 2, screenW, GROUND_HEIGHT);

// Platforms
function col(frac: number) { return screenW * frac; }
const platforms = [
	// Bottom tier
	{ x: col(0.1), y: screenH - 130, w: 130 },
	{ x: col(0.3), y: screenH - 160, w: 120 },
	{ x: col(0.5), y: screenH - 120, w: 110 },
	{ x: col(0.7), y: screenH - 170, w: 120 },
	{ x: col(0.9), y: screenH - 140, w: 130 },
	// Mid-low tier
	{ x: col(0.15), y: screenH - 250, w: 120 },
	{ x: col(0.4), y: screenH - 270, w: 130 },
	{ x: col(0.6), y: screenH - 240, w: 110 },
	{ x: col(0.85), y: screenH - 260, w: 120 },
	// Mid-high tier
	{ x: col(0.1), y: screenH - 350, w: 110 },
	{ x: col(0.3), y: screenH - 370, w: 120 },
	{ x: col(0.5), y: screenH - 340, w: 140 },
	{ x: col(0.7), y: screenH - 360, w: 110 },
	{ x: col(0.9), y: screenH - 380, w: 120 },
	// Upper tier
	{ x: col(0.2), y: screenH - 460, w: 120 },
	{ x: col(0.45), y: screenH - 480, w: 110 },
	{ x: col(0.65), y: screenH - 460, w: 110 },
	{ x: col(0.85), y: screenH - 490, w: 120 },
	// Top
	{ x: col(0.35), y: screenH - 560, w: 120 },
	{ x: col(0.6), y: screenH - 570, w: 130 },
];

platforms.forEach(p => spawnPlatform(p.x, p.y, p.w, PLATFORM_HEIGHT));
