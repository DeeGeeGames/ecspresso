import ECSpresso, { type SystemRegistrarOf } from '../../src';
import { createDetectionPlugin } from '../../src/plugins/ai/detection';
import { createHealthPlugin } from '../../src/plugins/combat/health';
import { createProjectilePlugin } from '../../src/plugins/combat/projectile';
import { createCollisionPlugin, type LayersOf } from '../../src/plugins/physics/collision';
import { createSteeringPlugin } from '../../src/plugins/physics/steering';
import { createRenderer2DPlugin } from '../../src/plugins/rendering/renderer2D';
import { createTimerPlugin } from '../../src/plugins/scripting/timers';
import { createBoundsPlugin } from '../../src/plugins/spatial/bounds';
import { createSpatialIndexPlugin } from '../../src/plugins/spatial/spatial-index';
import { createTransformPlugin } from '../../src/plugins/spatial/transform';
import collisionLayers from './collision-layers';

export const SCREEN_WIDTH = 800;
export const SCREEN_HEIGHT = 800;
export const CENTER_X = SCREEN_WIDTH / 2;
export const CENTER_Y = SCREEN_HEIGHT / 2;

export type TimerSlot = 'spawn' | 'fire';

export const game = ECSpresso.create()
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
	.withPlugin(createDetectionPlugin<'ai', LayersOf<typeof collisionLayers>>())
	.withPlugin(createHealthPlugin())
	.withPlugin(createProjectilePlugin<'combat', LayersOf<typeof collisionLayers>>())
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
