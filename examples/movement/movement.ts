import { createCupTexture, examplePalette } from '../brand';
import { Sprite } from 'pixi.js';
import ECSpresso from "ecspresso";
import {
	createRenderer2DPlugin,
	createLocalTransform,
} from "ecspresso/plugins/rendering/renderer2D";

// -- Create the world --
// ECSpresso.create() starts a builder chain where you declare your types and plugins.
// The renderer2D plugin provides PixiJS rendering and a transform system.
// withComponentTypes adds app-specific component types (type-level only, no runtime cost).
const ecs = ECSpresso.create()
	.withPlugin(createRenderer2DPlugin({
		background: examplePalette.background,
	}))
	.withComponentTypes<{
		velocity: { x: number; y: number };
		radius: number;
	}>()
	.build();

// -- Define systems --
// A system processes entities that match a query each frame.
// Queries select entities by which components they have.

// Movement: applies velocity to position each frame
ecs.addSystem('movement')
	.setProcessEach({ with: ['localTransform', 'velocity'], mutates: ['localTransform'] }, ({ entity, dt }) => {
		const { localTransform, velocity } = entity.components;
		localTransform.x += velocity.x * dt;
		localTransform.y += velocity.y * dt;
	});

// Bounce: reverses velocity when an entity hits a screen edge
ecs.addSystem('bounce')
	.withResources(['bounds'])
	.setProcessEach({ with: ['localTransform', 'velocity', 'radius'], mutates: ['localTransform', 'velocity'] }, ({ entity, resources: { bounds } }) => {
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
	});

// -- Initialize the world --
// initialize() sets up all plugin resources (e.g. the PixiJS application).
await ecs.initialize();

// -- Spawn an entity --
// An entity is just an ID with components attached. Components are plain data objects.
// The sprite component auto-requires localTransform, visible, and worldTransform,
// so we only need to provide the ones we want to customize.
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
