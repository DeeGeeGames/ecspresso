/**
 * Isometric 3D Example
 *
 * The 3D counterpart to `examples/isometric/`. Instead of faking isometric
 * projection in 2D, this uses a true 3D scene with an OrthographicCamera
 * positioned at standard iso angles (azimuth 45°, elevation atan(1/√2)).
 * Three.js's projection matrix and z-buffer replace the 2D version's
 * iso-projection and depth-sort plugins entirely.
 *
 * Demonstrates:
 * - Orthographic camera construction via renderer3D (`projection: 'orthographic'`)
 * - camera3D driving an OrthographicCamera (follow / shake / zoom)
 * - WASD player movement on the XZ ground plane via kinematic physics3D body
 * - Runtime zoom via setZoom (Q/E keys)
 * - Trauma-based screen shake (spacebar)
 */

import {
	BoxGeometry,
	PlaneGeometry,
	MeshStandardMaterial,
	Mesh,
	AmbientLight,
	DirectionalLight,
} from 'three';
import ECSpresso from 'ecspresso';
import {
	createRenderer3DPlugin,
	createMeshComponents,
} from 'ecspresso/plugins/rendering/renderer3D';
import {
	createPhysics3DPlugin,
	createRigidBody3D,
} from 'ecspresso/plugins/physics/physics3D';
import { createCamera3DPlugin } from 'ecspresso/plugins/spatial/camera3D';
import { createInputPlugin } from 'ecspresso/plugins/input/input';

// ==================== Constants ====================

const GRID_SIZE = 10;
const TILE_SIZE = 1;
const PLAYER_SPEED = 4;
const ZOOM_STEP = 1.1;

const ISO_AZIMUTH = Math.PI / 4;                 // 45°
const ISO_ELEVATION = Math.atan(1 / Math.SQRT2); // ~35.264°

const GRID_CENTER = (GRID_SIZE - 1) * TILE_SIZE / 2;

const TILE_COLOR_A = 0x3a7d44;
const TILE_COLOR_B = 0x2d6a36;
const PLAYER_COLOR = 0x44bbee;

// ==================== ECS Setup ====================

const ecs = ECSpresso.create()
	.withPlugin(createRenderer3DPlugin({
		background: 0x1a1a2e,
		antialias: true,
		cameraOptions: {
			projection: 'orthographic',
			viewSize: 16,
			zoom: 1,
			near: 0.1,
			far: 200,
		},
	}))
	.withPlugin(createPhysics3DPlugin({ gravity: { x: 0, y: 0, z: 0 } }))
	.withPlugin(createInputPlugin({
		actions: {
			moveUp:    { keys: ['w', 'ArrowUp'] },
			moveDown:  { keys: ['s', 'ArrowDown'] },
			moveLeft:  { keys: ['a', 'ArrowLeft'] },
			moveRight: { keys: ['d', 'ArrowRight'] },
			zoomIn:    { keys: ['e'] },
			zoomOut:   { keys: ['q'] },
			shake:     { keys: [' '] },
		},
	}))
	.withPlugin(createCamera3DPlugin({
		projection: 'orthographic',
		target: { x: GRID_CENTER, y: 0, z: GRID_CENTER },
		azimuth: ISO_AZIMUTH,
		elevation: ISO_ELEVATION,
		distance: 40,
		minDistance: 40,
		maxDistance: 40,
		follow: { smoothing: 4 },
		shake: { traumaDecay: 1.5, maxOffsetX: 0.3, maxOffsetY: 0.3, maxOffsetZ: 0.3 },
	}))
	.withComponentTypes<{
		player: true;
	}>()
	.build();

// ==================== Player Input System ====================

ecs.addSystem('player-input')
	.inPhase('preUpdate')
	.addQuery('players', { with: ['player', 'velocity3D'] })
	.withResources(['inputState'])
	.setProcess(({ queries, resources: { inputState: input } }) => {
		for (const entity of queries.players) {
			const { velocity3D } = entity.components;
			velocity3D.x = 0;
			velocity3D.z = 0;
			if (input.actions.isActive('moveUp'))    velocity3D.z = -PLAYER_SPEED;
			if (input.actions.isActive('moveDown'))  velocity3D.z = PLAYER_SPEED;
			if (input.actions.isActive('moveLeft'))  velocity3D.x = -PLAYER_SPEED;
			if (input.actions.isActive('moveRight')) velocity3D.x = PLAYER_SPEED;
		}
	});

// ==================== Zoom & Shake Triggers ====================

ecs.addSystem('camera-controls')
	.inPhase('preUpdate')
	.withResources(['inputState', 'camera3DState'])
	.setProcess(({ resources: { inputState: input, camera3DState: cam } }) => {
		if (input.actions.justActivated('shake')) {
			cam.addTrauma(0.6);
		}
		if (cam.projection !== 'orthographic') return;
		if (input.actions.justActivated('zoomIn'))  cam.setZoom(cam.zoom * ZOOM_STEP);
		if (input.actions.justActivated('zoomOut')) cam.setZoom(cam.zoom / ZOOM_STEP);
	});

// ==================== Coordinate Display ====================

ecs.addSystem('coord-display')
	.inPhase('render')
	.addQuery('players', { with: ['player', 'worldTransform3D'] })
	.withResources(['camera3DState'])
	.setProcess(({ queries, resources: { camera3DState: cam } }) => {
		const el = document.getElementById('coords');
		if (!el) return;

		const first = queries.players[0];
		if (!first) return;

		const { worldTransform3D: t } = first.components;
		const zoom = cam.projection === 'orthographic' ? cam.zoom : 1;

		el.textContent =
			`Player: ${t.x.toFixed(1)}, ${t.z.toFixed(1)}\n` +
			`Zoom:   ${zoom.toFixed(2)}x`;
	});

// ==================== Initialization ====================

await ecs.initialize();

const scene = ecs.getResource('scene');

// -- Lighting --
scene.add(new AmbientLight(0xffffff, 0.55));
const sun = new DirectionalLight(0xffffff, 0.75);
sun.position.set(8, 20, 6);
scene.add(sun);

// -- Shared geometries / materials --
// PlaneGeometry is oriented along XY by default; we rotate it to lie on XZ per tile.
const tileGeo = new PlaneGeometry(TILE_SIZE, TILE_SIZE);
const tileMatA = new MeshStandardMaterial({ color: TILE_COLOR_A, roughness: 0.9 });
const tileMatB = new MeshStandardMaterial({ color: TILE_COLOR_B, roughness: 0.9 });

// -- Tile grid (XZ plane, Y=0) --
for (let gx = 0; gx < GRID_SIZE; gx++) {
	for (let gz = 0; gz < GRID_SIZE; gz++) {
		const mat = (gx + gz) % 2 === 0 ? tileMatA : tileMatB;
		ecs.spawn({
			...createMeshComponents(new Mesh(tileGeo, mat), { x: gx, y: 0, z: gz }, {
				rotation: { x: -Math.PI / 2 },
			}),
		});
	}
}

// -- Player --
const playerGeo = new BoxGeometry(0.5, 0.5, 0.5);
const playerMat = new MeshStandardMaterial({ color: PLAYER_COLOR, roughness: 0.4, metalness: 0.1 });
const playerMesh = new Mesh(playerGeo, playerMat);

const player = ecs.spawn({
	...createMeshComponents(playerMesh, { x: GRID_CENTER, y: 0.25, z: GRID_CENTER }),
	...createRigidBody3D('kinematic'),
	player: true,
	velocity3D: { x: 0, y: 0, z: 0 },
});

// -- Camera follow --
const cameraState = ecs.getResource('camera3DState');
cameraState.follow(player);
