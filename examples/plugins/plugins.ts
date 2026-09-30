import { Graphics, Sprite } from 'pixi.js';
import ECSpresso, { definePlugin } from "ecspresso";
import {
	createRenderer2DPlugin,
	createLocalTransform,
	type TransformComponentTypes,
	type BoundsRect,
} from "ecspresso/plugins/rendering/renderer2D";

// -- Custom plugin --
// A plugin packages related components, events, and systems into a reusable unit.
// Type parameters declare what component/event/resource types the plugin's systems use.

interface BouncingComponents extends TransformComponentTypes {
	velocity: { x: number; y: number };
	radius: number;
}

interface BouncingEvents {
	wallHit: { x: number; y: number };
}

// The plugin reads the 'bounds' resource (provided by the renderer plugin).
// Declaring it here gives the plugin's systems type-safe access.
interface BouncingResources {
	bounds: BoundsRect;
}

function createBouncingPlugin() {
	return definePlugin('bouncing')
		.withComponentTypes<BouncingComponents>()
		.withEventTypes<BouncingEvents>()
		.withResourceTypes<BouncingResources>()
		.install((world) => {
			world.addSystem('movement')
				.setProcessEach({ with: ['localTransform', 'velocity'] }, ({ entity, dt }) => {
					const { localTransform, velocity } = entity.components;
					localTransform.x += velocity.x * dt;
					localTransform.y += velocity.y * dt;
				});
			world.addSystem('bounce')
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
		});
}

// -- Build the world --
// .withPlugin() installs the plugin and merges its types into the world.
// The bouncing plugin's velocity, radius, and wallHit types are now available.
const ecs = ECSpresso.create()
	.withPlugin(createRenderer2DPlugin({
		background: '#1099bb',
	}))
	.withPlugin(createBouncingPlugin())
	.build();

// Systems on the world can use types provided by any installed plugin.
// This system uses the wallHit event declared by the bouncing plugin.
ecs.addSystem('trail-spawner')
	.setEventHandlers({
		wallHit({ data: { x, y }, ecs }) {
			ecs.spawn({
				graphics: new Graphics().circle(0, 0, 4).fill(0xFFFF00),
				...createLocalTransform(x, y),
			});
		},
	});

// -- Initialize and spawn --
await ecs.initialize();

const pixiApp = ecs.getResource('pixiApp');
const ballRadius = 30;
const sprite = new Sprite(
	pixiApp.renderer.generateTexture(
		new Graphics().circle(0, 0, ballRadius).fill(0x0000FF)
	)
);
sprite.anchor.set(0.5, 0.5);

ecs.spawn({
	sprite,
	...createLocalTransform(pixiApp.screen.width / 2, pixiApp.screen.height / 2),
	velocity: { x: 300, y: 250 },
	radius: ballRadius,
});
