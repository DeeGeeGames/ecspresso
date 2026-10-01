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
	.setProcessEach({ with: ['localTransform', 'velocity'] }, ({ entity, dt }) => {
		const { localTransform, velocity } = entity.components;
		localTransform.x += velocity.x * dt;
		localTransform.y += velocity.y * dt;
	});

// Bounce: reverses velocity at screen edges and publishes a wallHit event.
// Events decouple the "what happened" from the "what should happen in response."
ecs.addSystem('bounce')
	.withResources(['bounds'])
	.setProcessEach({ with: ['localTransform', 'velocity', 'radius'] }, ({ entity, ecs, resources: { bounds } }) => {
		const { localTransform, velocity, radius } = entity.components;
		if (localTransform.x > bounds.width - radius || localTransform.x < radius) {
			velocity.x *= -1;
			ecs.eventBus.publish('wallHit', { x: localTransform.x, y: localTransform.y });
		}
		if (localTransform.y > bounds.height - radius || localTransform.y < radius) {
			velocity.y *= -1;
			ecs.eventBus.publish('wallHit', { x: localTransform.x, y: localTransform.y });
		}
	});

// Trail spawner: subscribes to wallHit events via setEventHandlers.
// This system has no query and no process — it only reacts to events.
ecs.addSystem('trail-spawner')
	.setEventHandlers({
		wallHit({ data: { x, y }, ecs }) {
			ecs.spawn({
				graphics: new Graphics().circle(0, 0, 4).fill(examplePalette.spark),
				...createLocalTransform(x, y),
			});
		},
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
