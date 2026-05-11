import { createRenderer2DPlugin } from '../../src/plugins/rendering/renderer2D';
import { createTimerPlugin } from '../../src/plugins/scripting/timers';
import { createPhysics2DPlugin } from '../../src/plugins/physics/physics2D';
import { createBoundsPlugin } from '../../src/plugins/spatial/bounds';
import { createCollisionPlugin } from '../../src/plugins/physics/collision';
import collisionLayers from './collision-layers';
import createCombatPlugin from './plugins/combat-plugin';
import createInputProcessingPlugin, { createInputPlugin } from './plugins/input-plugin';
import createSpawnerPlugin from './plugins/spawner-plugin';
import createUIPlugin from './plugins/ui-plugin';
import createGameLogicPlugin from './plugins/game-logic-plugin';
import { builder, type TimerSlot } from './types';

const game = builder
	.withResource('gameState', { status: 'ready', level: 1, lives: 3 })
	.withResource('config', {
		playerSpeed: 200,
		enemySpeed: 50,
		projectileSpeed: 400,
		enemiesPerRow: 8,
		enemyRows: 4,
		shootCooldown: 0.5
	})
	.withResource('score', { value: 0 })
	.withResource('enemyMovementState', {
		isMovingDown: false,
		currentDirection: 'right',
		lastEdgeHit: null,
	})
	.withPlugin(createTimerPlugin<TimerSlot>())
	.withPlugin(createRenderer2DPlugin({
		background: '#000000',
		container: '#game-container',
		renderLayers: ['game'],
		screenScale: { width: 800, height: 600 },
	}))
	.withPlugin(createPhysics2DPlugin({ integrationPriority: 200, systemGroup: 'gameplay' }))
	.withPlugin(createBoundsPlugin({ priority: 100, systemGroup: 'gameplay' }))
	.withPlugin(createCollisionPlugin({ layers: collisionLayers, priority: 50, systemGroup: 'gameplay' }))
	.withPlugin(createInputPlugin())
	.withPlugin(createInputProcessingPlugin())
	.withPlugin(createSpawnerPlugin())
	.withPlugin(createUIPlugin())
	.withPlugin(createGameLogicPlugin())
	.withPlugin(createCombatPlugin())
	.build();

await game.initialize();
game.eventBus.publish('gameInit', true);
