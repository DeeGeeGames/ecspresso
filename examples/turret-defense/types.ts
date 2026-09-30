import ECSpresso, { type SystemRegistrarOf } from 'ecspresso';
import { createDetectionPlugin } from 'ecspresso/plugins/ai/detection';
import { createHealthPlugin } from 'ecspresso/plugins/combat/health';
import { createProjectilePlugin } from 'ecspresso/plugins/combat/projectile';
import { createCollisionPlugin, type LayersOf } from 'ecspresso/plugins/physics/collision';
import { createSteeringPlugin } from 'ecspresso/plugins/physics/steering';
import { createRenderer2DPlugin } from 'ecspresso/plugins/rendering/renderer2D';
import { createTimerPlugin } from 'ecspresso/plugins/scripting/timers';
import { createBoundsPlugin } from 'ecspresso/plugins/spatial/bounds';
import { createSpatialIndexPlugin } from 'ecspresso/plugins/spatial/spatial-index';
import { createTransformPlugin } from 'ecspresso/plugins/spatial/transform';
import collisionLayers from './collision-layers';

export const SCREEN_WIDTH = 800;
export const SCREEN_HEIGHT = 800;
export const CENTER_X = SCREEN_WIDTH / 2;
export const CENTER_Y = SCREEN_HEIGHT / 2;

export type TimerSlot = 'spawn' | 'fire';

export const game = ECSpresso.create()
	.withPlugin(createTimerPlugin<TimerSlot, 'gameplay'>({ systemGroup: 'gameplay' }))
	.withPlugin(createRenderer2DPlugin({
		background: '#111122',
		container: '#game-container',
		renderLayers: ['background', 'enemies', 'projectiles', 'turret', 'ui'],
		screenScale: { width: SCREEN_WIDTH, height: SCREEN_HEIGHT },
	}))
	.withPlugin(createTransformPlugin())
	.withPlugin(createBoundsPlugin({ systemGroup: 'gameplay' }))
	.withPlugin(createCollisionPlugin<LayersOf<typeof collisionLayers>, 'gameplay'>({ layers: collisionLayers, priority: 50, systemGroup: 'gameplay' }))
	.withPlugin(createSpatialIndexPlugin<'gameplay'>({ systemGroup: 'gameplay' }))
	.withPlugin(createSteeringPlugin<'gameplay'>({ systemGroup: 'gameplay' }))
	.withPlugin(createDetectionPlugin<'gameplay', LayersOf<typeof collisionLayers>>({ systemGroup: 'gameplay' }))
	.withPlugin(createHealthPlugin<'gameplay'>({ systemGroup: 'gameplay' }))
	.withPlugin(createProjectilePlugin<'gameplay', LayersOf<typeof collisionLayers>>({ systemGroup: 'gameplay' }))
	.withComponentTypes<{
		turret: true;
		enemy: {
			type: 'fast' | 'tank' | 'swarm';
			speed: number;
			scoreValue: number;
		};
		base: true;
	}>()
	.withEventTypes<{
		gameInit: true;
		waveStart: { wave: number };
		waveComplete: { wave: number };
		gameOver: { score: number };
	}>()
	.withResource('gameState', {
		status: 'ready' as 'ready' | 'playing' | 'gameOver',
		wave: 0,
		score: 0,
		enemiesRemaining: 0,
		baseEntityId: -1,
	})
	.build();

export type World = typeof game;
export type GameSystemRegistrar = SystemRegistrarOf<World>;
