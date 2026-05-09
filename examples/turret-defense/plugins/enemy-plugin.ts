import { createRepeatingTimer } from '../../../src/plugins/scripting/timers';
import { definePlugin, type World } from '../types';
import type { EnemyType } from '../utils';
import { spawnEnemy } from '../utils';

interface WaveDefinition {
	readonly enemies: ReadonlyArray<{ type: EnemyType; count: number }>;
	readonly spawnInterval: number;
}

function getWaveDefinition(wave: number): WaveDefinition {
	const baseCount = 5 + wave * 3;
	const spawnInterval = Math.max(0.3, 1.0 - wave * 0.05);

	if (wave <= 2) {
		return {
			enemies: [{ type: 'fast', count: baseCount }],
			spawnInterval,
		};
	}

	if (wave <= 5) {
		return {
			enemies: [
				{ type: 'fast', count: Math.ceil(baseCount * 0.6) },
				{ type: 'tank', count: Math.ceil(baseCount * 0.4) },
			],
			spawnInterval,
		};
	}

	return {
		enemies: [
			{ type: 'fast', count: Math.ceil(baseCount * 0.3) },
			{ type: 'tank', count: Math.ceil(baseCount * 0.3) },
			{ type: 'swarm', count: Math.ceil(baseCount * 0.4) },
		],
		spawnInterval,
	};
}

type GameState = {
	status: 'ready' | 'playing' | 'gameOver';
	wave: number;
	score: number;
	enemiesRemaining: number;
	baseEntityId: number;
};

function decrementAndCheckWave(
	spawnQueue: EnemyType[],
	gameState: GameState,
	ecs: World,
): void {
	gameState.enemiesRemaining = Math.max(0, gameState.enemiesRemaining - 1);
	if (gameState.enemiesRemaining <= 0 && spawnQueue.length === 0 && gameState.status === 'playing') {
		ecs.eventBus.publish('waveComplete', { wave: gameState.wave });
	}
}

export default function createEnemyPlugin() {
	const spawnQueue: EnemyType[] = [];

	return definePlugin({
		id: 'enemy-plugin',
		install(world) {
			world
				.addSystem('wave-manager')
				.inGroup('gameplay')
				.setEventHandlers({
					gameInit({ ecs }) {
						ecs.eventBus.publish('waveStart', { wave: 1 });
					},

					waveComplete({ ecs }) {
						const gameState = ecs.getResource('gameState');
						const nextWave = gameState.wave + 1;
						ecs.eventBus.publish('waveStart', { wave: nextWave });
					},

					waveStart({ data, ecs }) {
						const gameState = ecs.getResource('gameState');
						gameState.wave = data.wave;
						gameState.status = 'playing';

						const waveDef = getWaveDefinition(data.wave);

						spawnQueue.length = 0;
						for (const group of waveDef.enemies) {
							for (let i = 0; i < group.count; i++) {
								spawnQueue.push(group.type);
							}
						}
						// Fisher-Yates shuffle
						for (let i = spawnQueue.length - 1; i > 0; i--) {
							const j = Math.floor(Math.random() * (i + 1));
							const temp = spawnQueue[i] as EnemyType;
							spawnQueue[i] = spawnQueue[j] as EnemyType;
							spawnQueue[j] = temp;
						}

						gameState.enemiesRemaining = spawnQueue.length;

						ecs.spawn({
							timers: { spawn: createRepeatingTimer(waveDef.spawnInterval) },
						});
					},
				});

			world
				.addSystem('enemy-spawner')
				.inGroup('gameplay')
				.inPhase('preUpdate')
				.setProcessEach(
					{ with: ['timers'], without: ['turret', 'enemy', 'projectile', 'base'] },
					({ entity, ecs }) => {
						if (!entity.components.timers['spawn']?.justFinished) return;

						if (spawnQueue.length > 0) {
							const type = spawnQueue.pop() as EnemyType;
							spawnEnemy(ecs, type);
						} else {
							ecs.commands.removeEntity(entity.id);
						}
					},
				);

			// All enemiesRemaining tracking consolidated here
			world
				.addSystem('enemy-lifecycle')
				.inGroup('gameplay')
				.setEventHandlers({
					arriveAtTarget({ data, ecs }) {
						const enemy = ecs.getComponent(data.entityId, 'enemy');
						if (!enemy) return;

						const gameState = ecs.getResource('gameState');
						ecs.eventBus.publish('damage', {
							entityId: gameState.baseEntityId,
							amount: 10,
							sourceId: data.entityId,
						});

						ecs.commands.removeEntity(data.entityId);
						decrementAndCheckWave(spawnQueue, gameState, ecs as World);
					},

					entityDied({ data, ecs }) {
						const enemy = ecs.getComponent(data.entityId, 'enemy');
						if (!enemy) return;

						const gameState = ecs.getResource('gameState');
						decrementAndCheckWave(spawnQueue, gameState, ecs as World);
					},
				});
		},
	});
}
