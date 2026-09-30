/**
 * Flocking / Boids
 *
 * Classic Reynolds boid simulation using the flocking plugin.
 * Separation, alignment, and cohesion produce emergent group behavior
 * from simple per-entity rules.
 *
 * Click to toggle the mouse between attractor and repulsor.
 */

import { Graphics } from 'pixi.js';
import ECSpresso from 'ecspresso';
import {
	createRenderer2DPlugin,
	createGraphicsComponents,
} from 'ecspresso/plugins/rendering/renderer2D';
import { createPhysics2DPlugin, createRigidBody, applyForce } from 'ecspresso/plugins/physics/physics2D';
import { createCollisionPlugin, createCircleCollider } from 'ecspresso/plugins/physics/collision';
import { createSpatialIndexPlugin } from 'ecspresso/plugins/spatial/spatial-index';
import { createBoundsPlugin, createWrapAtBounds } from 'ecspresso/plugins/spatial/bounds';
import { createFlockingPlugin, createFlockingAgent } from 'ecspresso/plugins/ai/flocking';
import { createDiagnosticsPlugin } from 'ecspresso/plugins/debug/diagnostics';

// ==================== Constants ====================

const BOID_COUNT = 200;
const PERCEPTION_RADIUS = 80;
const MAX_SPEED = 150;
const MAX_FORCE = 400;
const BOID_SIZE = 8;
const MOUSE_FORCE = 8000;
const MOUSE_MAX_DIST = 250;

// ==================== Types ====================

interface AppComponents {
	boid: true;
}

// ==================== Build ECS ====================

const ecs = ECSpresso
	.create()
	.withPlugin(createRenderer2DPlugin({ background: '#0a0a2e' }))
	.withPlugin(createPhysics2DPlugin({ gravity: { x: 0, y: 0 } }))
	.withPlugin(createCollisionPlugin({ layers: {} }))
	.withPlugin(createSpatialIndexPlugin())
	.withPlugin(createBoundsPlugin())
	.withPlugin(createFlockingPlugin())
	.withPlugin(createDiagnosticsPlugin())
	.withComponentTypes<AppComponents>()
	.build();

// ==================== Mouse Tracking ====================

const mouse = { x: -9999, y: -9999, attract: true };

// ==================== Mouse Interaction System ====================

ecs
	.addSystem('mouse-force')
	.setPriority(400)
	.inPhase('update')
	.addQuery('boids', { with: ['boid', 'worldTransform', 'force'] })
	.setProcess(({ queries, ecs }) => {
		// Skip entirely when mouse is offscreen
		if (mouse.x < -1000) return;

		const direction = mouse.attract ? 1 : -1;

		for (const entity of queries.boids) {
			const { worldTransform } = entity.components;
			const dx = mouse.x - worldTransform.x;
			const dy = mouse.y - worldTransform.y;
			const distSq = dx * dx + dy * dy;

			if (distSq < 1 || distSq > MOUSE_MAX_DIST * MOUSE_MAX_DIST) continue;

			const dist = Math.sqrt(distSq);
			const strength = (MOUSE_FORCE / dist) * direction;
			applyForce(ecs, entity.id, (dx / dist) * strength, (dy / dist) * strength);
		}
	});

// ==================== Initialize ====================

await ecs.initialize();

const bounds = ecs.getResource('bounds');
const rootContainer = ecs.getResource('rootContainer');

// Wire up mouse events on the PixiJS stage
rootContainer.eventMode = 'static';
rootContainer.hitArea = { contains: () => true };

rootContainer.on('pointermove', (e) => {
	mouse.x = e.global.x;
	mouse.y = e.global.y;
});

rootContainer.on('pointerdown', () => {
	mouse.attract = !mouse.attract;
});

// ==================== Spawn Boids ====================

function createBoidGraphics(hue: number): Graphics {
	const gfx = new Graphics();
	// Triangle pointing right (+x), centered at origin
	gfx.poly([
		BOID_SIZE, 0,
		-BOID_SIZE * 0.6, -BOID_SIZE * 0.5,
		-BOID_SIZE * 0.6, BOID_SIZE * 0.5,
	]);
	const lightness = 55 + Math.random() * 15;
	gfx.fill(`hsl(${hue}, 80%, ${lightness}%)`);
	return gfx;
}

const baseHue = 180 + Math.random() * 60; // aqua–blue range

for (let i = 0; i < BOID_COUNT; i++) {
	const x = Math.random() * bounds.width;
	const y = Math.random() * bounds.height;
	const angle = Math.random() * Math.PI * 2;
	const speed = 40 + Math.random() * 60;
	const hue = baseHue + (Math.random() - 0.5) * 40;

	ecs.spawn({
		boid: true as const,
		...createGraphicsComponents(createBoidGraphics(hue), { x, y }),
		...createRigidBody('dynamic', { mass: 1, drag: 1, gravityScale: 0 }),
		...createCircleCollider(PERCEPTION_RADIUS),
		...createFlockingAgent({
			perceptionRadius: PERCEPTION_RADIUS,
			maxSpeed: MAX_SPEED,
			maxForce: MAX_FORCE,
			separationWeight: 1.5,
			alignmentWeight: 1.0,
			cohesionWeight: 1.0,
		}),
		...createWrapAtBounds(20),
		velocity: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
	});
}

