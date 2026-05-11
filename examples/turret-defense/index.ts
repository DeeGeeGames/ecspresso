import { createRenderer2DPlugin } from '../../src/plugins/rendering/renderer2D';
import { createTransformPlugin } from '../../src/plugins/spatial/transform';
import { createTimerPlugin } from '../../src/plugins/scripting/timers';
import { createBoundsPlugin } from '../../src/plugins/spatial/bounds';
import { createCollisionPlugin } from '../../src/plugins/physics/collision';
import { createSpatialIndexPlugin } from '../../src/plugins/spatial/spatial-index';
import { createSteeringPlugin } from '../../src/plugins/physics/steering';
import { createDetectionPlugin } from '../../src/plugins/ai/detection';
import { createHealthPlugin } from '../../src/plugins/combat/health';
import { createProjectilePlugin } from '../../src/plugins/combat/projectile';
import collisionLayers from './collision-layers';
import createTurretPlugin from './plugins/turret-plugin';
import createEnemyPlugin from './plugins/enemy-plugin';
import createCombatPlugin from './plugins/combat-plugin';
import createUIPlugin from './plugins/ui-plugin';
import { builder, SCREEN_WIDTH, SCREEN_HEIGHT, type TimerSlot } from './types';
import { spawnTurret, spawnBase } from './utils';

const game = builder
	.withResource('gameState', {
		status: 'ready' as const,
		wave: 0,
		score: 0,
		enemiesRemaining: 0,
		baseEntityId: -1,
	})
	.withPlugin(createTimerPlugin<TimerSlot>())
	.withPlugin(createRenderer2DPlugin({
		background: '#111122',
		container: '#game-container',
		renderLayers: ['background', 'enemies', 'projectiles', 'turret', 'ui'],
		screenScale: { width: SCREEN_WIDTH, height: SCREEN_HEIGHT },
	}))
	.withPlugin(createTransformPlugin())
	.withPlugin(createBoundsPlugin())
	.withPlugin(createCollisionPlugin({ layers: collisionLayers, priority: 50 }))
	.withPlugin(createSpatialIndexPlugin())
	.withPlugin(createSteeringPlugin())
	.withPlugin(createDetectionPlugin())
	.withPlugin(createHealthPlugin())
	.withPlugin(createProjectilePlugin())
	.withPlugin(createTurretPlugin())
	.withPlugin(createEnemyPlugin())
	.withPlugin(createCombatPlugin())
	.withPlugin(createUIPlugin())
	.build();

await game.initialize();

// Spawn base and turret, then start the game
const baseId = spawnBase(game);
const gameState = game.getResource('gameState');
gameState.baseEntityId = baseId;
spawnTurret(game);

game.eventBus.publish('gameInit', true);
