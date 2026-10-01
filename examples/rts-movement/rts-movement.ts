import { createBeanGraphics, examplePalette } from '../brand';
import { Sprite } from 'pixi.js';
import ECSpresso from 'ecspresso';
import {
	createRenderer2DPlugin,
	createLocalTransform,
} from 'ecspresso/plugins/rendering/renderer2D';
import { createInputPlugin } from 'ecspresso/plugins/input/input';
import { createCameraPlugin, screenToWorld } from 'ecspresso/plugins/spatial/camera';
import { createSelectionPlugin, createSelectable } from 'ecspresso/plugins/input/selection';
import { createSteeringPlugin, createMoveSpeed } from 'ecspresso/plugins/physics/steering';

const ecs = ECSpresso.create()
	.withPlugin(createRenderer2DPlugin({
		background: examplePalette.background,
		renderLayers: ['game', 'ui'],
		screenSpaceLayers: ['ui'],
		camera: true,
	}))
	.withPlugin(createInputPlugin())
	.withPlugin(createCameraPlugin({
		zoom: { minZoom: 0.3, maxZoom: 3 },
	}))
	.withPlugin(createSelectionPlugin({ renderLayer: 'ui' }))
	.withPlugin(createSteeringPlugin())
	.build();

// Issue move orders on right-click (convert screen → world coords)
ecs.addSystem('issue-move-order')
	.inPhase('preUpdate')
	.setPriority(50)
	.addQuery('selectedUnits', { with: ['selected', 'localTransform'] })
	.withResources(['inputState', 'cameraState'])
	.setProcess(({ queries, ecs: world, resources: { inputState: input, cameraState } }) => {
		if (!input.pointer.justPressed(2)) return;

		const worldPos = screenToWorld(
			input.pointer.position.x,
			input.pointer.position.y,
			cameraState,
		);
		for (const entity of queries.selectedUnits) {
			world.addComponent(entity.id, 'moveTarget', { x: worldPos.x, y: worldPos.y });
		}
	});

await ecs.initialize();

const pixiApp = ecs.getResource('pixiApp');
const unitRadius = 10;
const unitTexture = pixiApp.renderer.generateTexture(
	createBeanGraphics(unitRadius)
);

// Position camera at center of the screen
const screenWidth = pixiApp.screen.width;
const screenHeight = pixiApp.screen.height;
const cameraState = ecs.getResource('cameraState');
cameraState.setPosition(screenWidth / 2, screenHeight / 2);

const unitCount = 20;
const margin = 60;

for (let i = 0; i < unitCount; i++) {
	const x = margin + Math.random() * (screenWidth - margin * 2);
	const y = margin + Math.random() * (screenHeight - margin * 2);
	const sprite = new Sprite(unitTexture);
	sprite.anchor.set(0.5, 0.5);

	ecs.spawn({
		sprite,
		...createLocalTransform(x, y),
		...createSelectable(),
		...createMoveSpeed(150),
		renderLayer: 'game',
	});
}
