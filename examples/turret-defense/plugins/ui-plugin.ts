import { Text, TextStyle } from 'pixi.js';
import { createLocalTransform } from 'ecspresso/plugins/rendering/renderer2D';
import { SCREEN_WIDTH, type GameSystemRegistrar } from '../types';

const LABEL_STYLE = new TextStyle({
	fontFamily: 'monospace',
	fontSize: 16,
	fill: 0xCCCCCC,
});

const VALUE_STYLE = new TextStyle({
	fontFamily: 'monospace',
	fontSize: 20,
	fill: 0xFFFFFF,
	fontWeight: 'bold',
});

const GAME_OVER_STYLE = new TextStyle({
	fontFamily: 'monospace',
	fontSize: 40,
	fill: 0xFF4444,
	fontWeight: 'bold',
	align: 'center',
});

export default function registerUISystems(
	systems: GameSystemRegistrar,
): void {
	let scoreText: Text | null = null;
	let waveText: Text | null = null;
	let baseHealthText: Text | null = null;
	let enemiesText: Text | null = null;

	systems
		.addSystem('ui-setup')
		.setOnInitialize((ecs) => {
			scoreText = new Text({ text: 'Score: 0', style: VALUE_STYLE });
			ecs.spawn({
				container: scoreText,
				...createLocalTransform(10, 10),
				renderLayer: 'ui',
			});

			waveText = new Text({ text: 'Wave: 1', style: VALUE_STYLE });
			ecs.spawn({
				container: waveText,
				...createLocalTransform(SCREEN_WIDTH - 120, 10),
				renderLayer: 'ui',
			});

			baseHealthText = new Text({ text: 'Base: 100', style: LABEL_STYLE });
			ecs.spawn({
				container: baseHealthText,
				...createLocalTransform(10, 40),
				renderLayer: 'ui',
			});

			enemiesText = new Text({ text: 'Enemies: 0', style: LABEL_STYLE });
			ecs.spawn({
				container: enemiesText,
				...createLocalTransform(10, 65),
				renderLayer: 'ui',
			});
		});

	// Update UI text each frame
	systems
		.addSystem('ui-update')
		.inPhase('render')
		.setPriority(100)
		.addQuery('bases', {
			with: ['base', 'health'],
		})
		.setProcess(({ queries, ecs }) => {
			const gameState = ecs.getResource('gameState');

			if (scoreText) {
				scoreText.text = `Score: ${gameState.score}`;
			}
			if (waveText) {
				waveText.text = `Wave: ${gameState.wave}`;
			}
			if (enemiesText) {
				enemiesText.text = `Enemies: ${gameState.enemiesRemaining}`;
			}

			const baseEntity = queries.bases[0];
			if (baseEntity && baseHealthText) {
				const { health } = baseEntity.components;
				baseHealthText.text = `Base: ${health.current}/${health.max}`;
			}
		});

	// Health bar rendering for enemies
	systems
		.addSystem('enemy-health-bars')
		.inPhase('render')
		.setPriority(50)
		.setProcessEach({ with: ['enemy', 'health', 'worldTransform', 'sprite'] }, ({ entity }) => {
			const { health, sprite } = entity.components;
			// Tint enemies red as they take damage
			const healthRatio = health.current / health.max;
			const gb = Math.floor(255 * healthRatio);
			sprite.tint = (255 << 16) | (gb << 8) | gb;
		});

	// Game over overlay
	systems
		.addSystem('game-over-ui')
		.setEventHandlers({
			gameOver({ data, ecs }) {
				const gameOverText = new Text({
					text: `GAME OVER\nScore: ${data.score}`,
					style: GAME_OVER_STYLE,
				});
				gameOverText.anchor.set(0.5, 0.5);

				ecs.spawn({
					container: gameOverText,
					...createLocalTransform(SCREEN_WIDTH / 2, SCREEN_WIDTH / 2),
					renderLayer: 'ui',
				});

				// Disable gameplay systems
				ecs.disableSystemGroup('gameplay');
			},
		});
}
