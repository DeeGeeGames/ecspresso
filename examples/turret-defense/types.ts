import ECSpresso from '../../src';
import type { TimerComponentTypes } from '../../src/plugins/scripting/timers';
import type { TransformComponentTypes } from '../../src/plugins/spatial/transform';
import type { BoundsComponentTypes, BoundsEventTypes, BoundsResourceTypes } from '../../src/plugins/spatial/bounds';
import type { CollisionComponentTypes, CollisionEventTypes, LayersOf } from '../../src/plugins/physics/collision';
import type { Renderer2DComponentTypes, Renderer2DEventTypes, Renderer2DResourceTypes, ViewportScaleResourceTypes } from '../../src/plugins/rendering/renderer2D';
import type { SpatialIndexResourceTypes } from '../../src/plugins/spatial/spatial-index';
import type { SteeringComponentTypes, SteeringEventTypes } from '../../src/plugins/physics/steering';
import type { DetectionComponentTypes, DetectionEventTypes } from '../../src/plugins/ai/detection';
import type { HealthComponentTypes, HealthEventTypes } from '../../src/plugins/combat/health';
import type { ProjectileComponentTypes, ProjectileEventTypes } from '../../src/plugins/combat/projectile';
import type collisionLayers from './collision-layers';

type Layer = LayersOf<typeof collisionLayers>;

export const SCREEN_WIDTH = 800;
export const SCREEN_HEIGHT = 800;
export const CENTER_X = SCREEN_WIDTH / 2;
export const CENTER_Y = SCREEN_HEIGHT / 2;

export type TimerSlot = 'spawn' | 'fire';

export const builder = ECSpresso.create()
	.withComponentTypes<
		TimerComponentTypes<TimerSlot> &
		TransformComponentTypes &
		CollisionComponentTypes<Layer> &
		Renderer2DComponentTypes &
		BoundsComponentTypes &
		SteeringComponentTypes &
		DetectionComponentTypes &
		HealthComponentTypes &
		ProjectileComponentTypes &
		{
			turret: true;
			enemy: { type: 'fast' | 'tank' | 'swarm'; speed: number; scoreValue: number };
			base: true;
		}
	>()
	.withEventTypes<
		CollisionEventTypes<Layer> &
		Renderer2DEventTypes &
		BoundsEventTypes &
		SteeringEventTypes &
		DetectionEventTypes &
		HealthEventTypes &
		ProjectileEventTypes &
		{
			gameInit: true;
			waveStart: { wave: number };
			waveComplete: { wave: number };
			gameOver: { score: number };
		}
	>()
	.withResourceTypes<
		Renderer2DResourceTypes &
		ViewportScaleResourceTypes &
		BoundsResourceTypes &
		SpatialIndexResourceTypes &
		{
			gameState: {
				status: 'ready' | 'playing' | 'gameOver';
				wave: number;
				score: number;
				enemiesRemaining: number;
				baseEntityId: number;
			};
		}
	>();

export const definePlugin = builder.pluginFactory();

export type World = ReturnType<typeof builder.build>;
