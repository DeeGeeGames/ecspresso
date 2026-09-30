import { expect, test } from 'bun:test';
import collisionLayers from '../collision-layers';
import registerCombat from './combat-plugin';

test('simultaneous deaths are idempotent and gameplay timers pause', async () => {
	Object.defineProperty(globalThis, 'document', {
		configurable: true,
		value: { body: {}, querySelector: () => null },
	});
	const { game } = await import('../game');
	try {
		registerCombat(game);
		game.getResource('gameState').status = 'playing';
		game.update(0);

		const levelCompletions: number[] = [];
		game.eventBus.subscribe('levelComplete', ({ level }) => levelCompletions.push(level));
		const enemies = [
			game.spawn({ enemy: { type: 'grunt', points: 20, health: 1 }, ...collisionLayers.enemy() }),
			game.spawn({ enemy: { type: 'grunt', points: 20, health: 1 }, ...collisionLayers.enemy() }),
		];
		const enemyProjectiles = enemies.map(() => game.spawn({
			projectile: { owner: 'player', damage: 1 },
			...collisionLayers.playerProjectile(),
		}));

		enemyProjectiles.forEach((projectile, index) => {
			const enemy = enemies[index];
			if (!enemy) throw new Error('Expected matching enemy for projectile');
			game.eventBus.publish('collision', {
				entityA: projectile.id,
				entityB: enemy.id,
				layerA: 'playerProjectile',
				layerB: 'enemy',
				normalX: 0,
				normalY: 0,
				depth: 0,
			});
		});

		expect(levelCompletions).toEqual([1]);
		expect(game.getResource('score').value).toBe(40);
		expect(game.getEntitiesWithQuery(['enemy'])).toHaveLength(2);
		const duplicateHit = game.spawn({
			projectile: { owner: 'player', damage: 1 },
			...collisionLayers.playerProjectile(),
		});
		const firstEnemy = enemies[0];
		if (!firstEnemy) throw new Error('Expected first enemy');
		game.eventBus.publish('collision', {
			entityA: duplicateHit.id,
			entityB: firstEnemy.id,
			layerA: 'playerProjectile',
			layerB: 'enemy',
			normalX: 0,
			normalY: 0,
			depth: 0,
		});
		expect(game.getResource('score').value).toBe(40);
		expect(levelCompletions).toEqual([1]);

		const player = game.spawn({ player: true, ...collisionLayers.player() });
		const playerProjectiles = [
			game.spawn({ projectile: { owner: 'enemy', damage: 1 }, ...collisionLayers.enemyProjectile() }),
			game.spawn({ projectile: { owner: 'enemy', damage: 1 }, ...collisionLayers.enemyProjectile() }),
		];
		playerProjectiles.forEach((projectile) => {
			game.eventBus.publish('collision', {
				entityA: projectile.id,
				entityB: player.id,
				layerA: 'enemyProjectile',
				layerB: 'player',
				normalX: 0,
				normalY: 0,
				depth: 0,
			});
		});

		expect(game.getResource('gameState').lives).toBe(2);
		expect(game.getEntitiesWithQuery(['timers'])).toHaveLength(1);
		game.disableSystemGroup('gameplay');
		game.update(2);
		expect(game.getResource('gameState').playerDeathPending).toBe(true);
		expect(game.getEntitiesWithQuery(['timers'])).toHaveLength(1);

		game.enableSystemGroup('gameplay');
		game.update(1);
		expect(game.getResource('gameState').playerDeathPending).toBe(false);
		expect(game.getEntitiesWithQuery(['enemy'])).toHaveLength(0);
		expect(game.getEntitiesWithQuery(['timers'])).toHaveLength(0);
	} finally {
		await game.dispose();
		Object.defineProperty(globalThis, 'document', { configurable: true, value: undefined });
	}
});
