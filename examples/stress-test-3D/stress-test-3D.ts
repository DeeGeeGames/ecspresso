import {
	SphereGeometry,
	MeshLambertMaterial,
	Mesh,
	AmbientLight,
	DirectionalLight,
	BoxGeometry,
	EdgesGeometry,
	LineSegments,
	LineBasicMaterial,
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
import {
	defineCollisionLayers,
	createSphereCollider,
} from 'ecspresso/plugins/physics/collision3D';
import { createSpatialIndex3DPlugin } from 'ecspresso/plugins/spatial/spatial-index3D';
import { createCamera3DPlugin } from 'ecspresso/plugins/spatial/camera3D';
import {
	createDiagnosticsPlugin,
	createDiagnosticsOverlay,
} from 'ecspresso/plugins/debug/diagnostics';

// -- Constants --

const BOX_HALF = 120;           // bounding box extends ±120 on each axis
const BOX_SIZE = BOX_HALF * 2;
const BALL_RADIUS = 0.4;
const SPAWN_RATE = 3;           // spheres per frame while held
const SPAWN_HEIGHT = BOX_HALF - BALL_RADIUS - 0.5;
const SPAWN_JITTER = BOX_HALF * 0.6;
const COLORS = [0xff6b6b, 0x4ecdc4, 0x45b7d1, 0xf9ca24, 0xa29bfe, 0xfd79a8, 0x00cec9, 0xe17055];

// -- Collision layers --

const layers = defineCollisionLayers({
	ball: ['ball'],
});

// -- ECS setup --

const ecs = ECSpresso.create()
	.withPlugin(createRenderer3DPlugin({
		background: 0x1a1a2e,
		antialias: false,
		cameraOptions: { fov: 60, near: 0.1, far: 700 },
	}))
	.withPlugin(createSpatialIndex3DPlugin({ cellSize: 4, phases: ['fixedUpdate'] }))
	.withPlugin(createPhysics3DPlugin({
		collisionSystemGroup: 'collision',
		layers,
	}))
	.withPlugin(createCamera3DPlugin({
		target: { x: 0, y: 0, z: 0 },
		azimuth: 0.6,
		elevation: 0.4,
		distance: 140,
		minDistance: 15,
		maxDistance: 400,
	}))
	.withPlugin(createDiagnosticsPlugin())
	.withComponentTypes<{ radius: number }>()
	.build();

function bounceAxis(position: number, velocity: number, min: number, max: number): readonly [number, number] {
	if (position < min) return [min, Math.abs(velocity)];
	if (position > max) return [max, -Math.abs(velocity)];
	return [position, velocity];
}

// Clamp the authoritative local position after integration and before 3D collision.
// Transform propagation publishes this position to worldTransform3D in postUpdate.
ecs
	.addSystem('bounce')
	.inPhase('fixedUpdate')
	.setPriority(950)
	.setProcessEach({
		with: ['localTransform3D', 'velocity3D', 'radius'],
		mutates: ['localTransform3D', 'velocity3D'],
	}, ({ entity }) => {
		const { localTransform3D, velocity3D, radius } = entity.components;
		const min = -BOX_HALF + radius;
		const max = BOX_HALF - radius;

		const [x, vx] = bounceAxis(localTransform3D.x, velocity3D.x, min, max);
		const [y, vy] = bounceAxis(localTransform3D.y, velocity3D.y, min, max);
		const [z, vz] = bounceAxis(localTransform3D.z, velocity3D.z, min, max);
		if (x === localTransform3D.x && y === localTransform3D.y && z === localTransform3D.z) return false;

		localTransform3D.x = x;
		localTransform3D.y = y;
		localTransform3D.z = z;
		velocity3D.x = vx;
		velocity3D.y = vy;
		velocity3D.z = vz;
	});

// Continuous spawn system — emits spheres near the top of the box while pointer is held.
const pointerState = { down: false };

ecs
	.addSystem('continuous-spawn')
	.inPhase('preUpdate')
	.withResources(['camera3DState'])
	.setProcess(({ resources: { camera3DState } }) => {
		if (!pointerState.down) return;
		for (let i = 0; i < SPAWN_RATE; i++) {
			const x = camera3DState.targetX + (Math.random() - 0.5) * SPAWN_JITTER * 2;
			const z = camera3DState.targetZ + (Math.random() - 0.5) * SPAWN_JITTER * 2;
			spawnBall(x, SPAWN_HEIGHT, z);
		}
	});

// Initialize
await ecs.initialize();

const scene = ecs.getResource('scene');
const threeRenderer = ecs.getResource('threeRenderer');

// Lighting
scene.add(new AmbientLight(0xffffff, 0.5));
const sun = new DirectionalLight(0xffffff, 0.8);
sun.position.set(30, 50, 20);
scene.add(sun);

// Wireframe bounding box
const boxGeo = new BoxGeometry(BOX_SIZE, BOX_SIZE, BOX_SIZE);
const boxEdges = new EdgesGeometry(boxGeo);
const boxLines = new LineSegments(boxEdges, new LineBasicMaterial({ color: 0x6c7086 }));
scene.add(boxLines);

// Pre-create one shared SphereGeometry and per-color materials so Three.js can batch draw calls.
const sphereGeometry = new SphereGeometry(BALL_RADIUS, 12, 8);
const ballMaterials = COLORS.map(color => new MeshLambertMaterial({ color }));

// -- Ball spawning --

function spawnBall(x: number, y: number, z: number) {
	const colorIndex = Math.floor(Math.random() * COLORS.length);
	const material = ballMaterials[colorIndex];
	if (!material) throw new Error(`No material at index ${colorIndex}`);
	const mesh = new Mesh(sphereGeometry, material);

	ecs.spawn({
		...createMeshComponents(mesh, { x, y, z }),
		...createRigidBody3D('dynamic', { mass: 1, restitution: 0.85, drag: 0.005 }),
		...createSphereCollider(BALL_RADIUS),
		...layers.ball(),
		velocity3D: {
			x: (Math.random() - 0.5) * 30,
			y: (Math.random() - 0.5) * 10,
			z: (Math.random() - 0.5) * 30,
		},
		radius: BALL_RADIUS,
	});
}

// Spawn an initial cloud of spheres in the upper half of the box.
for (let i = 0; i < 50; i++) {
	spawnBall(
		(Math.random() - 0.5) * SPAWN_JITTER * 2,
		Math.random() * (BOX_HALF - BALL_RADIUS),
		(Math.random() - 0.5) * SPAWN_JITTER * 2,
	);
}

// -- Pointer tracking --
// camera3D already attaches its own pointerdown/move/up/wheel listeners on the same canvas
// for orbit/dolly. Our handler only sets a boolean flag and never preventDefaults, so the
// two coexist: drag rotates the camera AND spawns spheres while held.

const canvas = threeRenderer.domElement;

canvas.addEventListener('pointerdown', () => { pointerState.down = true; });
canvas.addEventListener('pointerup', () => { pointerState.down = false; });
canvas.addEventListener('pointerleave', () => { pointerState.down = false; });

// -- Collision toggle --

const toggleBtn = document.createElement('button');
toggleBtn.textContent = 'Collision: ON';
toggleBtn.style.cssText = 'position:fixed;bottom:12px;right:12px;z-index:999999;padding:6px 14px;font:13px/1 monospace;background:#2a2a3e;color:#0f0;border:1px solid #555;border-radius:4px;cursor:pointer';

toggleBtn.addEventListener('click', () => {
	const enabled = ecs.isSystemGroupEnabled('collision');
	if (enabled) {
		ecs.disableSystemGroup('collision');
		ecs.disableSystemGroup('spatialIndex3D');
		toggleBtn.textContent = 'Collision: OFF';
		toggleBtn.style.color = '#f55';
	} else {
		ecs.enableSystemGroup('collision');
		ecs.enableSystemGroup('spatialIndex3D');
		toggleBtn.textContent = 'Collision: ON';
		toggleBtn.style.color = '#0f0';
	}
});

document.body.appendChild(toggleBtn);

// -- Stress test overlay --

const cleanupOverlay = createDiagnosticsOverlay(ecs, {
	position: 'top-right',
	showSystemTimings: true,
	maxSystemsShown: 8,
});

// Clean up on page unload
window.addEventListener('beforeunload', cleanupOverlay);
