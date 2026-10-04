import { createCupTexture, examplePalette } from '../brand';
import { Graphics, Sprite } from 'pixi.js';
import ECSpresso from "ecspresso";
import {
	createRenderer2DPlugin,
	createLocalTransform,
} from "ecspresso/plugins/rendering/renderer2D";

// -- Build the world --
// Building on the movement example, we add custom event types for inter-system communication.
// withEventTypes declares typed events that systems can publish and subscribe to.
const ecs = ECSpresso.create()
	.withPlugin(createRenderer2DPlugin({
		background: examplePalette.background,
	}))
	.withComponentTypes<{
		velocity: { x: number; y: number };
		radius: number;
	}>()
	.withEventTypes<{
		wallHit: { x: number; y: number };
	}>()
	.build();

// -- Systems --

// Movement (same as the movement example)
ecs.addSystem('movement')
	.setProcessEach({ with: ['localTransform', 'velocity'], mutates: ['localTransform'] }, ({ entity, dt }) => {
		const { localTransform, velocity } = entity.components;
		localTransform.x += velocity.x * dt;
		localTransform.y += velocity.y * dt;
	});

// Bounce: reverses velocity at screen edges and publishes a wallHit event.
// Events decouple the "what happened" from the "what should happen in response."
ecs.addSystem('bounce')
	.withResources(['bounds'])
	.setProcessEach({ with: ['localTransform', 'velocity', 'radius'], mutates: ['localTransform', 'velocity'] }, ({ entity, ecs, resources: { bounds } }) => {
		const { localTransform, velocity, radius } = entity.components;
		const maxX = Math.max(radius, bounds.width - radius);
		const maxY = Math.max(radius, bounds.height - radius);
		const x = Math.max(radius, Math.min(maxX, localTransform.x));
		const y = Math.max(radius, Math.min(maxY, localTransform.y));
		const hitX = (x <= radius && velocity.x < 0) || (x >= maxX && velocity.x > 0);
		const hitY = (y <= radius && velocity.y < 0) || (y >= maxY && velocity.y > 0);
		if (x === localTransform.x && y === localTransform.y && !hitX && !hitY) return false;
		localTransform.x = x;
		localTransform.y = y;
		if (hitX) velocity.x *= -1;
		if (hitY) velocity.y *= -1;
		if (hitX || hitY) ecs.eventBus.publish('wallHit', { x, y });
	});

// Trail spawner: subscribes to wallHit events via setEventHandlers.
// This system has no query and no process — it only reacts to events.
// Retain a bounded trail without adding a timer dependency.
const wallMarks: Array<{ id: number; graphics: Graphics }> = [];
const MAX_WALL_MARKS = 64;

ecs.addSystem('trail-spawner')
	.setEventHandlers({
		wallHit({ data: { x, y }, ecs }) {
			const graphics = new Graphics().circle(0, 0, 4).fill(examplePalette.spark);
			const mark = ecs.spawn({
				graphics,
				...createLocalTransform(x, y),
			});
			wallMarks.push({ id: mark.id, graphics });
			if (wallMarks.length > MAX_WALL_MARKS) {
				const oldest = wallMarks.shift();
				if (oldest) {
					ecs.removeEntity(oldest.id);
					oldest.graphics.destroy();
				}
			}
		},
	})
	.setOnDetach(() => {
		for (const mark of wallMarks) mark.graphics.destroy();
		wallMarks.length = 0;
	});

// -- Initialize and spawn --
await ecs.initialize();

const pixiApp = ecs.getResource('pixiApp');
const ballRadius = 30;
const sprite = new Sprite(
	await createCupTexture(pixiApp.renderer, ballRadius)
);
sprite.anchor.set(0.5, 0.5);

ecs.spawn({
	sprite,
	...createLocalTransform(pixiApp.screen.width / 2, pixiApp.screen.height / 2),
	velocity: { x: 300, y: 250 },
	radius: ballRadius,
});
