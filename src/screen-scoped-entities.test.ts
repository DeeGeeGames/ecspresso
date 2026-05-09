import { expect, describe, test } from 'bun:test';
import ECSpresso from './ecspresso';

type Components = {
	position: { x: number; y: number };
	enemy: { hp: number };
	ui: { label: string };
};

const buildWorld = async () => {
	const world = ECSpresso.create()
		.withComponentTypes<Components>()
		.withScreens(s => s
			.add('title', { initialState: () => ({}) })
			.add('playing', { initialState: () => ({}) })
			.add('pause', { initialState: () => ({}) })
		)
		.build();
	await world.initialize();
	return world;
};

describe('screen-scoped entity lifetimes', () => {
	test('world.spawn with scope removes entity on screenExit for that screen', async () => {
		const world = await buildWorld();

		await world.setScreen('playing', {});
		const scoped = world.spawn({ enemy: { hp: 10 } }, { scope: 'playing' });
		expect(world.entityManager.entityCount).toBe(1);

		await world.setScreen('title', {});
		expect(world.entityManager.entityCount).toBe(0);
		expect(world.entityManager.getEntity(scoped.id)).toBeUndefined();
	});

	test('entities without scope survive screen exit', async () => {
		const world = await buildWorld();
		await world.setScreen('playing', {});

		const unscoped = world.spawn({ enemy: { hp: 5 } });
		const scoped = world.spawn({ enemy: { hp: 7 } }, { scope: 'playing' });

		await world.setScreen('title', {});

		expect(world.entityManager.getEntity(unscoped.id)).toBeDefined();
		expect(world.entityManager.getEntity(scoped.id)).toBeUndefined();
	});

	test('scopes are keyed by screen name — exiting one does not affect another', async () => {
		const world = await buildWorld();
		await world.setScreen('playing', {});

		const a = world.spawn({ enemy: { hp: 1 } }, { scope: 'playing' });
		const b = world.spawn({ ui: { label: 'hud' } }, { scope: 'title' });

		await world.setScreen('title', {});
		expect(world.entityManager.getEntity(a.id)).toBeUndefined();
		expect(world.entityManager.getEntity(b.id)).toBeDefined();

		await world.setScreen('playing', {});
		expect(world.entityManager.getEntity(b.id)).toBeUndefined();
	});

	test('manually removing a scoped entity does not cause a zombie on later screen exit', async () => {
		const world = await buildWorld();
		await world.setScreen('playing', {});
		const scoped = world.spawn({ enemy: { hp: 10 } }, { scope: 'playing' });

		world.removeEntity(scoped.id);
		// Spawn a fresh entity — it may reuse the id slot; scope tracking must not target it.
		const replacement = world.spawn({ position: { x: 0, y: 0 } });

		await world.setScreen('title', {});
		expect(world.entityManager.getEntity(replacement.id)).toBeDefined();
	});

	test('spawnChild with scope is cleaned up on screenExit', async () => {
		const world = await buildWorld();
		await world.setScreen('playing', {});

		const parent = world.spawn({ position: { x: 0, y: 0 } });
		const child = world.spawnChild(parent.id, { enemy: { hp: 3 } }, { scope: 'playing' });

		await world.setScreen('title', {});
		expect(world.entityManager.getEntity(child.id)).toBeUndefined();
		expect(world.entityManager.getEntity(parent.id)).toBeDefined();
	});

	test('commands.spawn with scope is cleaned up on screenExit', async () => {
		const world = await buildWorld();
		await world.setScreen('playing', {});

		world.commands.spawn({ enemy: { hp: 1 } }, { scope: 'playing' });
		world.commands.playback(world);
		expect(world.entityManager.entityCount).toBe(1);

		await world.setScreen('title', {});
		expect(world.entityManager.entityCount).toBe(0);
	});

	test('commands.spawnChild with scope is cleaned up on screenExit', async () => {
		const world = await buildWorld();
		await world.setScreen('playing', {});

		const parent = world.spawn({ position: { x: 0, y: 0 } });
		world.commands.spawnChild(parent.id, { enemy: { hp: 1 } }, { scope: 'playing' });
		world.commands.playback(world);

		await world.setScreen('title', {});
		expect(world.entityManager.entityCount).toBe(1); // only parent remains
		expect(world.entityManager.getEntity(parent.id)).toBeDefined();
	});

	test('popScreen drains scope for the popped screen', async () => {
		const world = await buildWorld();
		await world.setScreen('playing', {});
		await world.pushScreen('pause', {});

		const pauseScoped = world.spawn({ ui: { label: 'pause-menu' } }, { scope: 'pause' });
		const gameplayScoped = world.spawn({ enemy: { hp: 10 } }, { scope: 'playing' });

		await world.popScreen();

		expect(world.entityManager.getEntity(pauseScoped.id)).toBeUndefined();
		expect(world.entityManager.getEntity(gameplayScoped.id)).toBeDefined();
	});

	test('setScreen from X directly to X still exits X first and drains its scope', async () => {
		const world = await buildWorld();
		await world.setScreen('playing', {});
		const a = world.spawn({ enemy: { hp: 1 } }, { scope: 'playing' });

		await world.setScreen('playing', {});
		// 'playing' exited then re-entered — the scoped entity from the first entry is gone.
		expect(world.entityManager.getEntity(a.id)).toBeUndefined();
	});

	test('type-level: scope must be a known screen name', async () => {
		const world = await buildWorld();
		// @ts-expect-error 'nope' is not a registered screen
		world.spawn({ position: { x: 0, y: 0 } }, { scope: 'nope' });
	});
});

describe('active-system scope auto-tagging', () => {
	test('spawn from inside an inScreens-gated system auto-scopes to the active screen', async () => {
		const world = await buildWorld();
		const spawned: number[] = [];

		world.addSystem('spawner')
			.inScreens(['playing'])
			.runWhenEmpty()
			.setProcess(({ ecs }) => {
				if (spawned.length === 0) {
					const e = ecs.spawn({ enemy: { hp: 1 } });
					spawned.push(e.id);
				}
			});

		await world.setScreen('playing', {});
		world.update(1 / 60);
		expect(spawned.length).toBe(1);
		expect(world.entityManager.entityCount).toBe(1);

		await world.setScreen('title', {});
		expect(world.entityManager.getEntity(spawned[0]!)).toBeUndefined();
	});

	test('spawnChild from inside an inScreens-gated system auto-scopes to the active screen', async () => {
		const world = await buildWorld();
		const childIds: number[] = [];

		const parent = world.spawn({ position: { x: 0, y: 0 } });

		world.addSystem('child-spawner')
			.inScreens(['playing'])
			.runWhenEmpty()
			.setProcess(({ ecs }) => {
				if (childIds.length === 0) {
					const c = ecs.spawnChild(parent.id, { enemy: { hp: 1 } });
					childIds.push(c.id);
				}
			});

		await world.setScreen('playing', {});
		world.update(1 / 60);
		expect(childIds.length).toBe(1);

		await world.setScreen('title', {});
		expect(world.entityManager.getEntity(childIds[0]!)).toBeUndefined();
		expect(world.entityManager.getEntity(parent.id)).toBeDefined();
	});

	test('commands.spawn from inside a gated system captures the hint at queue time, not playback', async () => {
		const world = await buildWorld();

		world.addSystem('queue-spawner')
			.inScreens(['playing'])
			.runWhenEmpty()
			.setProcess(({ ecs }) => {
				ecs.commands.spawn({ enemy: { hp: 1 } });
			});

		await world.setScreen('playing', {});
		world.update(1 / 60);
		expect(world.entityManager.entityCount).toBe(1);

		await world.setScreen('title', {});
		expect(world.entityManager.entityCount).toBe(0);
	});

	test('commands.spawnChild from inside a gated system captures the hint at queue time', async () => {
		const world = await buildWorld();
		const parent = world.spawn({ position: { x: 0, y: 0 } });

		world.addSystem('queue-child')
			.inScreens(['playing'])
			.runWhenEmpty()
			.setProcess(({ ecs }) => {
				ecs.commands.spawnChild(parent.id, { enemy: { hp: 1 } });
			});

		await world.setScreen('playing', {});
		world.update(1 / 60);
		expect(world.entityManager.entityCount).toBe(2);

		await world.setScreen('title', {});
		expect(world.entityManager.entityCount).toBe(1);
		expect(world.entityManager.getEntity(parent.id)).toBeDefined();
	});

	test('explicit scope: null opts out of auto-scoping inside a gated system', async () => {
		const world = await buildWorld();
		const ids: number[] = [];

		world.addSystem('opt-out-spawner')
			.inScreens(['playing'])
			.runWhenEmpty()
			.setProcess(({ ecs }) => {
				if (ids.length === 0) {
					const e = ecs.spawn({ enemy: { hp: 1 } }, { scope: null });
					ids.push(e.id);
				}
			});

		await world.setScreen('playing', {});
		world.update(1 / 60);
		expect(ids.length).toBe(1);

		await world.setScreen('title', {});
		// Explicit null opts out — entity survives.
		expect(world.entityManager.getEntity(ids[0]!)).toBeDefined();
	});

	test('explicit scope wins over the active hint', async () => {
		const world = await buildWorld();
		const ids: number[] = [];

		world.addSystem('explicit-scope')
			.inScreens(['playing'])
			.runWhenEmpty()
			.setProcess(({ ecs }) => {
				if (ids.length === 0) {
					const e = ecs.spawn({ ui: { label: 'menu' } }, { scope: 'title' });
					ids.push(e.id);
				}
			});

		await world.setScreen('playing', {});
		world.update(1 / 60);

		// Exiting playing should NOT remove an entity scoped explicitly to 'title'.
		await world.setScreen('title', {});
		expect(world.entityManager.getEntity(ids[0]!)).toBeDefined();

		// But exiting 'title' must remove it.
		await world.setScreen('playing', {});
		expect(world.entityManager.getEntity(ids[0]!)).toBeUndefined();
	});

	test('multi-screen inScreens auto-scopes to the currently-active screen', async () => {
		const world = await buildWorld();
		const ids: number[] = [];

		world.addSystem('multi-spawner')
			.inScreens(['playing', 'pause'])
			.runWhenEmpty()
			.setProcess(({ ecs }) => {
				const e = ecs.spawn({ enemy: { hp: 1 } });
				ids.push(e.id);
			});

		await world.setScreen('playing', {});
		world.update(1 / 60); // spawns one scoped to 'playing'

		await world.pushScreen('pause', {});
		world.update(1 / 60); // spawns one scoped to 'pause' (system runs in both)

		const playingId = ids[0]!;
		const pauseId = ids[1]!;

		await world.popScreen(); // exits 'pause', drops pauseId, leaves playingId
		expect(world.entityManager.getEntity(pauseId)).toBeUndefined();
		expect(world.entityManager.getEntity(playingId)).toBeDefined();
	});

	test('excludeScreens systems do not auto-scope', async () => {
		const world = await buildWorld();
		const ids: number[] = [];

		world.addSystem('excluded-spawner')
			.excludeScreens(['title'])
			.runWhenEmpty()
			.setProcess(({ ecs }) => {
				if (ids.length === 0) {
					const e = ecs.spawn({ enemy: { hp: 1 } });
					ids.push(e.id);
				}
			});

		await world.setScreen('playing', {});
		world.update(1 / 60);
		expect(ids.length).toBe(1);

		// excludeScreens does not encode positive screen intent — entity survives screen exit.
		await world.setScreen('title', {});
		expect(world.entityManager.getEntity(ids[0]!)).toBeDefined();
	});

	test('ungated systems do not auto-scope', async () => {
		const world = await buildWorld();
		const ids: number[] = [];

		world.addSystem('ungated')
			.runWhenEmpty()
			.setProcess(({ ecs }) => {
				if (ids.length === 0) {
					const e = ecs.spawn({ enemy: { hp: 1 } });
					ids.push(e.id);
				}
			});

		await world.setScreen('playing', {});
		world.update(1 / 60);
		expect(ids.length).toBe(1);

		await world.setScreen('title', {});
		expect(world.entityManager.getEntity(ids[0]!)).toBeDefined();
	});

	test('spawns from outside any system tick are not auto-scoped', async () => {
		const world = await buildWorld();

		// Register a gated system, but spawn from outside its tick.
		world.addSystem('idle')
			.inScreens(['playing'])
			.runWhenEmpty()
			.setProcess(() => {});

		await world.setScreen('playing', {});

		const e = world.spawn({ enemy: { hp: 1 } }); // direct call, no active hint

		world.update(1 / 60); // runs the gated system, but doesn't affect our entity

		await world.setScreen('title', {});
		expect(world.entityManager.getEntity(e.id)).toBeDefined();
	});

	test('spawns from system onInitialize do not auto-scope', async () => {
		const ids: number[] = [];
		const world = ECSpresso.create()
			.withComponentTypes<Components>()
			.withScreens(s => s
				.add('title', { initialState: () => ({}) })
				.add('playing', { initialState: () => ({}) })
				.add('pause', { initialState: () => ({}) })
			)
			.build();

		world.addSystem('init-spawner')
			.inScreens(['playing'])
			.setOnInitialize((ecs) => {
				const e = ecs.spawn({ enemy: { hp: 1 } });
				ids.push(e.id);
			})
			.runWhenEmpty()
			.setProcess(() => {});

		await world.initialize();
		await world.setScreen('playing', {});

		expect(ids.length).toBe(1);

		await world.setScreen('title', {});
		expect(world.entityManager.getEntity(ids[0]!)).toBeDefined();
	});

	test('type-level: scope: null is accepted as opt-out', async () => {
		const world = await buildWorld();
		// Should type-check without error.
		world.spawn({ position: { x: 0, y: 0 } }, { scope: null });
	});
});
