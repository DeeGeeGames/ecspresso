import {
	BoxGeometry,
	MeshStandardMaterial,
	Mesh,
	AmbientLight,
	DirectionalLight,
	PerspectiveCamera,
} from 'three';
import ECSpresso from '../../src';
import {
	createRenderer3DPlugin,
	createMeshComponents,
} from '../../src/plugins/rendering/renderer3D';
import {
	createPhysics3DPlugin,
	createRigidBody3D,
} from '../../src/plugins/physics/physics3D';
import { createInputPlugin } from '../../src/plugins/input/input';
import {
	defineCollisionLayers,
	createAABB3DCollider,
} from '../../src/plugins/physics/collision3D';
import { createTimerPlugin, createTimer, type Timer } from '../../src/plugins/scripting/timers';

const MOVE_SPEED = 300;
const JUMP_VELOCITY = 450;
const GRAVITY = 800;
const PLAYER_WIDTH = 32;
const PLAYER_HEIGHT = 48;
const PLAYER_DEPTH = 32;
const PLAYER_COLOR = 0xFF4444;
const PLATFORM_COLOR = 0x44AA44;
const PLATFORM_HEIGHT = 20;
const PLATFORM_DEPTH = 40;
const GROUND_HEIGHT = 32;
const GROUND_DEPTH = 80;
const CAMERA_FOV = 50;
const COYOTE_DURATION = 0.12;      // seconds (~7 ticks at 60Hz)
const JUMP_BUFFER_DURATION = 0.1;  // seconds (~6 ticks at 60Hz)

const layers = defineCollisionLayers({
	player: ['platform'],
	platform: ['player'],
});

const ecs = ECSpresso.create()
	.withPlugin(createRenderer3DPlugin({
		background: 0x222244,
		antialias: true,
		cameraOptions: { fov: CAMERA_FOV, near: 1, far: 4000 },
	}))
	.withPlugin(createPhysics3DPlugin({
		gravity: { x: 0, y: -GRAVITY, z: 0 },
		layers,
	}))
	.withPlugin(createInputPlugin({
		actions: {
			moveLeft: { keys: ['a', 'ArrowLeft'] },
			moveRight: { keys: ['d', 'ArrowRight'] },
			jump: { keys: ['w', 'ArrowUp', ' '] },
		},
	}))
	.withPlugin(createTimerPlugin())
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

function restartTimer(t: Timer) {
	t.elapsed = 0;
	t.active = true;
}

function getPlayerTimers(timers: Record<string, Timer>): { coyote: Timer; jumpBuffer: Timer } | undefined {
	const coyote = timers['coyote'];
	const jumpBuffer = timers['jumpBuffer'];
	if (!coyote || !jumpBuffer) return undefined;
	return { coyote, jumpBuffer };
}

function applyGroundLanding(
	gc: { grounded: boolean },
	timers: { coyote: Timer; jumpBuffer: Timer },
	vel: { y: number } | undefined,
) {
	gc.grounded = true;
	restartTimer(timers.coyote);
	if (timers.jumpBuffer.active && vel) {
		vel.y = JUMP_VELOCITY;
		timers.jumpBuffer.active = false;
	}
}

// Detect ground contact from physics collision normals.
// Normal points from entityA toward entityB. In Y-up, if the player is above
// the platform, the A→B direction is -Y, so we invert the sign vs the 2D version.
ecs.addSystem('ground-detect')
	.setEventHandlers({
		physics3DCollision({ data, ecs: world }) {
			const handle = (id: number) => {
				const gc = world.getComponent(id, 'groundContact');
				const timers = world.getComponent(id, 'timers');
				if (!gc || !timers) return;
				const player = getPlayerTimers(timers);
				if (player) applyGroundLanding(gc, player, world.getComponent(id, 'velocity3D'));
			};
			if (world.getComponent(data.entityA, 'player') && data.normalY < -0.5) {
				handle(data.entityA);
				return;
			}
			if (world.getComponent(data.entityB, 'player') && data.normalY > 0.5) {
				handle(data.entityB);
			}
		},
	});

// Player input: horizontal movement + jump when grounded
ecs.addSystem('player-input')
	.inPhase('preUpdate')
	.withResources(['inputState'])
	.setProcessEach({ with: ['player', 'velocity3D', 'groundContact', 'timers'] }, ({ entity, resources: { inputState: input } }) => {
		const { velocity3D, groundContact, timers } = entity.components;
		const player = getPlayerTimers(timers);
		if (!player) return;

		const left = input.actions.isActive('moveLeft') ? -MOVE_SPEED : 0;
		const right = input.actions.isActive('moveRight') ? MOVE_SPEED : 0;
		velocity3D.x = left + right;

		const canJump = groundContact.grounded || player.coyote.active;
		if (input.actions.justActivated('jump')) {
			if (canJump) {
				velocity3D.y = JUMP_VELOCITY;
				player.coyote.active = false;
				player.jumpBuffer.active = false;
			} else {
				restartTimer(player.jumpBuffer);
			}
		}
	});

await ecs.initialize();

const threeRenderer = ecs.getResource('threeRenderer');
const scene = ecs.getResource('scene');
const camera = ecs.getResource('camera');

const screenW = threeRenderer.domElement.clientWidth;
const screenH = threeRenderer.domElement.clientHeight;

if (!(camera instanceof PerspectiveCamera)) {
	throw new Error('Expected a PerspectiveCamera from renderer3D');
}

// Frame the level vertically: distance such that screenH world units fit in the FOV.
const cameraDistance = (screenH / 2) / Math.tan((CAMERA_FOV * Math.PI / 180) / 2);
camera.position.set(screenW / 2, screenH / 2, cameraDistance);
camera.lookAt(screenW / 2, screenH / 2, 0);

// Lighting — ambient + a front-top key light to shade the box faces.
scene.add(new AmbientLight(0xffffff, 0.55));
const key = new DirectionalLight(0xffffff, 0.85);
key.position.set(screenW * 0.3, screenH, cameraDistance * 0.8);
scene.add(key);

const playerMaterial = new MeshStandardMaterial({ color: PLAYER_COLOR, roughness: 0.5, metalness: 0.05 });
const platformMaterial = new MeshStandardMaterial({ color: PLATFORM_COLOR, roughness: 0.8 });

const boxGeometryCache = new Map<string, BoxGeometry>();
function createBox(width: number, height: number, depth: number, material: MeshStandardMaterial): Mesh {
	const key = `${width}:${height}:${depth}`;
	const cached = boxGeometryCache.get(key);
	const geometry = cached ?? new BoxGeometry(width, height, depth);
	if (!cached) boxGeometryCache.set(key, geometry);
	return new Mesh(geometry, material);
}

function spawnPlatform(x: number, y: number, w: number, h: number, d: number) {
	ecs.spawn({
		...createMeshComponents(createBox(w, h, d, platformMaterial), { x, y, z: 0 }),
		...createRigidBody3D('static'),
		...createAABB3DCollider(w, h, d),
		...layers.platform(),
	});
}

ecs.spawn({
	...createMeshComponents(
		createBox(PLAYER_WIDTH, PLAYER_HEIGHT, PLAYER_DEPTH, playerMaterial),
		{ x: screenW / 2, y: 100, z: 0 },
	),
	...createRigidBody3D('dynamic', { restitution: 0, friction: 0 }),
	velocity3D: { x: 0, y: 0, z: 0 },
	...createAABB3DCollider(PLAYER_WIDTH, PLAYER_HEIGHT, PLAYER_DEPTH),
	...layers.player(),
	player: true as const,
	groundContact: { grounded: false },
	timers: {
		coyote: { ...createTimer(COYOTE_DURATION), active: false },
		jumpBuffer: { ...createTimer(JUMP_BUFFER_DURATION), active: false },
	},
});

// Ground (sits at the world bottom: y = GROUND_HEIGHT / 2 from the floor)
spawnPlatform(screenW / 2, GROUND_HEIGHT / 2, screenW, GROUND_HEIGHT, GROUND_DEPTH);

// Platforms — y values are height above the ground (flipped from the 2D Y-down version).
function col(frac: number) { return screenW * frac; }
const platforms = [
	// Bottom tier
	{ x: col(0.1), y: 130, w: 130 },
	{ x: col(0.3), y: 160, w: 120 },
	{ x: col(0.5), y: 120, w: 110 },
	{ x: col(0.7), y: 170, w: 120 },
	{ x: col(0.9), y: 140, w: 130 },
	// Mid-low tier
	{ x: col(0.15), y: 250, w: 120 },
	{ x: col(0.4), y: 270, w: 130 },
	{ x: col(0.6), y: 240, w: 110 },
	{ x: col(0.85), y: 260, w: 120 },
	// Mid-high tier
	{ x: col(0.1), y: 350, w: 110 },
	{ x: col(0.3), y: 370, w: 120 },
	{ x: col(0.5), y: 340, w: 140 },
	{ x: col(0.7), y: 360, w: 110 },
	{ x: col(0.9), y: 380, w: 120 },
	// Upper tier
	{ x: col(0.2), y: 460, w: 120 },
	{ x: col(0.45), y: 480, w: 110 },
	{ x: col(0.65), y: 460, w: 110 },
	{ x: col(0.85), y: 490, w: 120 },
	// Top
	{ x: col(0.35), y: 560, w: 120 },
	{ x: col(0.6), y: 570, w: 130 },
];

platforms.forEach(p => spawnPlatform(p.x, p.y, p.w, PLATFORM_HEIGHT, PLATFORM_DEPTH));
