import { expect, test } from 'bun:test';
import ECSpresso, { definePlugin, type ConfigOf } from 'ecspresso';
import { createTimer, createTimerPlugin } from 'ecspresso/plugins/scripting/timers';
import { createGroupComponents } from 'ecspresso/plugins/rendering/renderer3D';
import type { TimerSlot, World } from './types';
import registerGameplaySystems from './plugins/gameplay-plugin';
import registerAISystems from './plugins/ai-plugin';
import { PerspectiveCamera } from 'three';
import { registerInputSimulationSystems } from './plugins/input-plugin';
import { createExplosion } from './utils';

type GameConfig = ConfigOf<World>;

function createSimulation() {
	const world = ECSpresso.create()
		.withPlugin(createTimerPlugin<TimerSlot>())
		.withPlugin(definePlugin('gameplay-test-scope').withGroups<'gameplay'>().install(() => {}))
		.withComponentTypes<GameConfig['components']>()
		.withEventTypes<GameConfig['events']>()
		.withResourceTypes<GameConfig['resources']>()
		.build();
	world.addResource('simulationClock', { elapsed: 0 });
	world.addResource('waveManager', { currentWave: 1, enemiesRemaining: 0, waveStartTime: 0 });
	world.addResource('config', { playerFireRate: 10, playerProjectileSpeed: 0.03, playerProjectileDamage: 100, maxEnemies: 20, enemySpawnRate: 1, waveCount: 5, enemiesPerWave: 15 });
	registerGameplaySystems(world);
	registerAISystems(world);
	return world;
}

test('pause freezes delayed destruction, explosion particles and simulation clock', async () => {
	const world = createSimulation();
	await world.initialize();
	const explosion = createExplosion();
	const entity = world.spawn({
		...createGroupComponents(explosion.group), explosion,
		timers: { destroy: createTimer(0.2) }, pendingDestroy: true,
	});
	const destroyed: number[] = [];
	world.eventBus.subscribe('entityDestroyed', ({ entityId }) => destroyed.push(entityId));
	world.update(0.1);
	const particle = explosion.particles[0];
	expect(particle).toBeDefined();
	const particlePosition = particle?.mesh.position.clone();
	world.disableSystemGroup('gameplay');
	world.disableSystemGroup('timers');
	world.update(5);
	expect(world.getResource('simulationClock').elapsed).toBeCloseTo(0.1);
	expect(explosion.elapsed).toBeCloseTo(0.1);
	expect(particle?.mesh.position).toEqual(particlePosition);
	expect(entity.components.timers.destroy?.elapsed).toBeCloseTo(0.1);
	expect(destroyed).toEqual([]);
	world.enableSystemGroup('gameplay');
	world.enableSystemGroup('timers');
	world.update(0.11);
	expect(destroyed).toEqual([entity.id]);
	await world.dispose();
});

test('disposing an active explosion releases each owned particle asset once', async () => {
	const world = createSimulation();
	await world.initialize();
	const explosion = createExplosion();
	let geometriesDisposed = 0;
	let materialsDisposed = 0;
	for (const { mesh } of explosion.particles) {
		mesh.geometry.addEventListener('dispose', () => { geometriesDisposed++; });
		mesh.material.addEventListener('dispose', () => { materialsDisposed++; });
	}
	world.spawn({ ...createGroupComponents(explosion.group), explosion });
	await world.dispose();
	expect(geometriesDisposed).toBe(explosion.particles.length);
	expect(materialsDisposed).toBe(explosion.particles.length);
	await world.dispose();
	expect(geometriesDisposed).toBe(explosion.particles.length);
	expect(materialsDisposed).toBe(explosion.particles.length);
});


test('firing cooldown and aiming writes follow gameplay pause without catch-up shots', async () => {
	const world = createSimulation();
	world.addResource('camera', new PerspectiveCamera());
	world.addResource('input', {
		mousePosition: { x: 0, y: 0 }, mouseButtons: { left: true, right: false, middle: false },
		keys: {}, aim: { x: 0.2, y: 0.3 }, aimDirty: true, shotRequested: false,
	});
	registerInputSimulationSystems(world);
	let shots = 0;
	world.eventBus.subscribe('playerShoot', () => { shots++; });
	let aimUpdates = 0;
	world.addSystem('observe-aim')
		.inPhase('postUpdate')
		.setProcessEach({ with: ['player', 'localTransform3D'], changed: ['localTransform3D'] }, () => { aimUpdates++; });
	await world.initialize();
	const player = world.spawn({
		player: { health: 100, maxHealth: 100, lastShotTime: 0, fireRate: 10 },
		localTransform3D: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 },
	});
	world.update(0.05);
	expect(shots).toBe(1);
	expect(player.components.localTransform3D.rx).toBe(0.2);
	expect(aimUpdates).toBe(1);
	world.update(0.05);
	expect(aimUpdates).toBe(1);
	world.disableSystemGroup('gameplay');
	world.update(20);
	expect(shots).toBe(1);
	expect(player.components.player.lastShotTime).toBeCloseTo(0.05);
	world.enableSystemGroup('gameplay');
	world.update(0.05);
	expect(shots).toBe(2);
	await world.dispose();
});
