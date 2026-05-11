import { createTimerPlugin } from '../../src/plugins/scripting/timers';
import { createRenderer3DPlugin } from '../../src/plugins/rendering/renderer3D';
import { createCollision3DPlugin } from '../../src/plugins/physics/collision3D';
import { createSpatialIndex3DPlugin } from '../../src/plugins/spatial/spatial-index3D';
import { builder, collisionLayers } from './types';
import createInitPlugin from './plugins/init-plugin';
import createInputPlugin from './plugins/input-plugin';
import createRenderPlugin from './plugins/render-plugin';
import createPhysicsPlugin from './plugins/physics-plugin';
import createAIPlugin from './plugins/ai-plugin';
import createGameplayPlugin from './plugins/gameplay-plugin';
import createUIPlugin from './plugins/ui-plugin';
import createGameStatePlugin from './plugins/game-state-plugin';

// Create and initialize the game
async function initGame() {
	// Create ECS instance with our types
	const game = builder
		.withPlugin(createRenderer3DPlugin({
			container: '#game-container',
			width: window.innerWidth,
			height: window.innerHeight,
			antialias: true,
			shadows: true,
			startLoop: false, // We manage the loop via gameInit event
			cameraOptions: {
				fov: 75,
				near: 0.1,
				far: 1000,
				position: { x: 0, y: 5, z: 0 },
				lookAt: { x: 0, y: 5, z: -10 },
			},
		}))
		.withPlugin(createTimerPlugin())
		.withPlugin(createSpatialIndex3DPlugin())
		.withPlugin(createCollision3DPlugin({ layers: collisionLayers }))
		.withPlugin(createInitPlugin())
		.withPlugin(createInputPlugin())
		.withPlugin(createRenderPlugin())
		.withPlugin(createPhysicsPlugin())
		.withPlugin(createAIPlugin())
		.withPlugin(createGameplayPlugin())
		.withPlugin(createUIPlugin())
		.withPlugin(createGameStatePlugin())
		.build();

	// Initialize all resources and systems
	await game.initialize();

	// Start the game
	game.eventBus.publish('gameInit', true);
}

// Start the game when the page loads
window.addEventListener('load', initGame);
