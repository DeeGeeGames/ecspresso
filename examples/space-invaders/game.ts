import ECSpresso from 'ecspresso';
import { createTimerPlugin } from 'ecspresso/plugins/scripting/timers';
import { createRenderer2DPlugin } from 'ecspresso/plugins/rendering/renderer2D';
import { createPhysics2DPlugin } from 'ecspresso/plugins/physics/physics2D';
import { createBoundsPlugin } from 'ecspresso/plugins/spatial/bounds';
import { createCollisionPlugin, type LayersOf } from 'ecspresso/plugins/physics/collision';
import collisionLayers from './collision-layers';
import { createInputPlugin } from './plugins/input-plugin';
import type { AppComponents, AppEvents, AppResources, TimerSlot } from './types';

type Layer = LayersOf<typeof collisionLayers>;

export const game = ECSpresso.create()
	.withPlugin(createTimerPlugin<TimerSlot, 'gameplay'>({ systemGroup: 'gameplay' }))
	.withPlugin(createRenderer2DPlugin({
		background: '#000000',
		container: '#game-container',
		renderLayers: ['game'],
		screenScale: { width: 800, height: 600 },
	}))
	.withPlugin(
		createPhysics2DPlugin<Layer, 'gameplay'>({
			integrationPriority: 200,
			systemGroup: 'gameplay',
		}),
	)
	.withPlugin(createBoundsPlugin({ priority: 100, systemGroup: 'gameplay' }))
	.withPlugin(
		createCollisionPlugin({
			layers: collisionLayers,
			priority: 50,
			systemGroup: 'gameplay',
		}),
	)
	.withPlugin(createInputPlugin())
	.withComponentTypes<AppComponents>()
	.withEventTypes<AppEvents>()
	.withResourceTypes<AppResources>()
	.withResource('gameState', { status: 'ready', level: 1, lives: 3, playerDeathPending: false })
	.withResource('config', {
		playerSpeed: 200,
		enemySpeed: 50,
		projectileSpeed: 400,
		enemiesPerRow: 8,
		enemyRows: 4,
		shootCooldown: 0.5,
	})
	.withResource('score', { value: 0 })
	.withResource('uiState', { messageHideRemaining: 0 })
	.withResource('enemyMovementState', {
		isMovingDown: false,
		currentDirection: 'right',
		lastEdgeHit: null,
	})
	.build();

export type Game = typeof game;
