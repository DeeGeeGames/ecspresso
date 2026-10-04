import { createBouncingPlugin } from './bouncing-plugin';
import { createCupTexture, examplePalette } from '../brand';
import { Graphics, Sprite } from 'pixi.js';
import ECSpresso from "ecspresso";
import {
	createRenderer2DPlugin,
	createLocalTransform,
} from "ecspresso/plugins/rendering/renderer2D";

// -- Build the world --
// .withPlugin() installs the plugin and merges its types into the world.
// The bouncing plugin's velocity, radius, and wallHit types are now available.
const ecs = ECSpresso.create()
	.withPlugin(createRenderer2DPlugin({
		background: examplePalette.background,
	}))
	.withPlugin(createBouncingPlugin())
	.build();

// Systems on the world can use types provided by any installed plugin.
// This system uses the wallHit event declared by the bouncing plugin.
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
