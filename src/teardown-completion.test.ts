import { describe, expect, test } from 'bun:test';
import ECSpresso, { definePlugin } from './index';

async function expectPending(promise: Promise<unknown>): Promise<void> {
	const outcome = await Promise.race([
		promise.then(() => 'settled', () => 'settled'),
		new Promise<string>(resolve => setTimeout(() => resolve('pending'), 10)),
	]);
	expect(outcome).toBe('pending');
}

describe('complete world teardown', () => {
	test.each([false, true])('joins uninstall-initiated cleanup (failure: %s)', async fail => {
		const gate = Promise.withResolvers<void>();
		const calls: string[] = [];
		const plugin = definePlugin('uninstalled')
			.withResourceTypes<{ dependency: number }>()
			.install((world, onCleanup) => {
				world.addResource('dependency', {
					factory: () => 1,
					onDispose: () => { calls.push('resource'); },
				});
				onCleanup(async cleanup => {
					cleanup.requestDisposal();
					await gate.promise;
					expect(world.getResource('dependency')).toBe(1);
					calls.push('plugin');
					if (fail) throw new Error('uninstall failed');
				});
			});
		const world = ECSpresso.create().withPlugin(plugin).build();
		await world.initialize();
		world.uninstallPlugin('uninstalled');
		const disposal = world.dispose();
		await expectPending(disposal);
		gate.resolve();
		if (fail) await expect(disposal).rejects.toThrow('uninstall failed');
		else await disposal;
		expect(calls).toEqual(['plugin', 'resource']);
		await world.dispose();
		expect(calls).toHaveLength(2);
	});

	test('retains completed uninstall failures until world disposal observes them', async () => {
		const plugin = definePlugin('completed-failure').install((_world, onCleanup) => {
			onCleanup(async () => { throw new Error('earlier failure'); });
		});
		const world = ECSpresso.create().withPlugin(plugin).build();
		world.uninstallPlugin('completed-failure');
		await Promise.resolve();
		await Promise.resolve();
		await expect(world.dispose()).rejects.toThrow('earlier failure');
	});

	test.each(['enter', 'resume', 'exit'] as const)('drains screen %s before teardown', async phase => {
		const gate = Promise.withResolvers<void>();
		const started = Promise.withResolvers<void>();
		const calls: string[] = [];
		async function suspend(): Promise<void> {
			started.resolve();
			await gate.promise;
			calls.push('hook finished');
		}
		const world = ECSpresso.create()
			.withResource('dependency', {
				factory: () => 1,
				onDispose: () => { calls.push('resource'); },
			})
			.withScreens(screens => screens
				.add('base', {
					initialState: () => ({}),
					onEnter: async () => { if (phase === 'enter') await suspend(); },
					onResume: async () => { if (phase === 'resume') await suspend(); },
					onExit: async () => {
						if (phase === 'exit') await suspend();
						calls.push('base exit');
					},
				})
				.add('overlay', { initialState: () => ({}) })
			)
			.build();
		await world.initialize();
		async function transition(): Promise<void> {
			await world.setScreen('base', {});
			if (phase === 'enter') return;
			if (phase === 'exit') return world.setScreen('overlay', {});
			await world.pushScreen('overlay', {});
			await world.popScreen();
		}
		const pendingTransition = transition().catch((error: unknown) => error);
		await started.promise;
		const disposal = world.dispose();
		await expectPending(disposal);
		expect(world.getResource('dependency')).toBe(1);
		gate.resolve();
		await disposal;
		expect(await pendingTransition).toBeInstanceOf(Error);
		expect(calls).toEqual(['hook finished', 'base exit', 'resource']);
	});

	test('a failed in-flight screen entry still exits and reports its failure', async () => {
		const started = Promise.withResolvers<void>();
		const gate = Promise.withResolvers<void>();
		const calls: string[] = [];
		const world = ECSpresso.create().withScreens(screens => screens.add('base', {
			initialState: () => ({}),
			onEnter: async () => {
				started.resolve();
				await gate.promise;
				throw new Error('entry failed');
			},
			onExit: () => { calls.push('exit'); },
		})).build();
		await world.initialize();
		const transition = world.setScreen('base', {}).catch((error: unknown) => error);
		await started.promise;
		const disposal = world.dispose();
		gate.resolve();
		await expect(disposal).rejects.toThrow('screens failed to exit');
		expect(await transition).toBeInstanceOf(Error);
		expect(calls).toEqual(['exit']);
	});

	test('removal observer failures do not skip siblings, components, or observers', async () => {
		const calls: string[] = [];
		const world = ECSpresso.create().withComponentTypes<{ a: number; b: number }>().build();
		world.registerDispose('a', ({ value }) => { calls.push(`a${value}`); });
		world.registerDispose('b', ({ value }) => { calls.push(`b${value}`); });
		world.onComponentRemoved('a', () => { throw new Error('observer failed'); });
		world.onComponentRemoved('a', () => { calls.push('later observer'); });
		const parent = world.spawn({ a: 1, b: 1 });
		world.spawnChild(parent.id, { a: 2, b: 2 });
		await expect(world.dispose()).rejects.toThrow('Entity removal observers failed');
		expect(calls).toEqual(['a2', 'later observer', 'b2', 'a1', 'later observer', 'b1']);
		expect(world.entityCount).toBe(0);
	});
});
