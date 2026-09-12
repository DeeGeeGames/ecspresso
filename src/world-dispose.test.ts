import { describe, expect, test } from 'bun:test';
import ECSpresso from './ecspresso';
import { definePlugin } from './plugin';
import type { WorldConfigFrom } from './type-utils';

type Components = {
	resource: { id: number };
};

type Events = {
	ping: void;
};

type Resources = {
	base: { value: number };
	child: { value: number };
	lazy: number;
};

type Config = WorldConfigFrom<Components, Events, Resources>;
type PendingConfig = WorldConfigFrom<Components, Events, { base: number; child: { value: number }; lazy: number }>;

function settleWithin<T>(promise: Promise<T>, timeoutMs = 100): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<T>((_, reject) => {
		timer = setTimeout(() => reject(new Error('operation did not settle in time')), timeoutMs);
	});
	return Promise.race([promise, timeout]).finally(() => {
		if (timer !== undefined) clearTimeout(timer);
	});
}

describe('world disposal', () => {
	test('awaits cleanup, removes entities, detaches systems, and becomes inert', async () => {
		const resourceOrder: string[] = [];
		const componentDisposals: number[] = [];
		let processCalls = 0;
		let systemEvents = 0;
		let directEvents = 0;
		let detachCalls = 0;
		let releaseDetach: (() => void) | undefined;
		const detachGate = new Promise<void>(resolve => {
			releaseDetach = resolve;
		});

		const world = ECSpresso.create<Config>()
			.withResource('base', {
				factory: () => ({ value: 1 }),
				onDispose: (_resource, ecs) => {
					resourceOrder.push('base');
					expect(ecs.hasResource('base')).toBe(true);
					expect(ecs.hasResource('child')).toBe(false);
				},
			})
			.withResource('child', {
				dependsOn: ['base'],
				factory: () => ({ value: 2 }),
				onDispose: (_resource, ecs) => {
					resourceOrder.push('child');
					expect(ecs.getResource('base')).toEqual({ value: 1 });
				},
			})
			.withResource('lazy', () => {
				throw new Error('lazy resource was initialized during disposal');
			})
			.build();

		world.registerDispose('resource', ({ entityId }) => {
			componentDisposals.push(entityId);
		});
		world.addSystem('cleanup-system')
			.setProcess(() => { processCalls++; })
			.setEventHandlers({
				ping: () => { systemEvents++; },
			})
			.setOnDetach(async ecs => {
				expect(ecs.hasResource('base')).toBe(true);
				await detachGate;
				detachCalls++;
			});

		await world.initializeResources('base', 'child');
		const entity = world.spawn({ resource: { id: 1 } });
		world.on('ping', () => { directEvents++; });
		world.eventBus.publish('ping');
		world.update(0.016);
		world.commands.spawn({ resource: { id: 2 } });

		expect(systemEvents).toBe(1);
		expect(directEvents).toBe(1);
		expect(processCalls).toBe(1);

		const disposal = world.dispose();
		expect(world.dispose()).toBe(disposal);
		expect(world.commands.length).toBe(0);
		expect(detachCalls).toBe(0);
		world.update(0.016);
		expect(processCalls).toBe(1);

		releaseDetach?.();
		await disposal;

		expect(detachCalls).toBe(1);
		expect(componentDisposals).toEqual([entity.id]);
		expect(world.entityCount).toBe(0);
		expect(resourceOrder).toEqual(['child', 'base']);
		expect(world.resourceNeedsInitialization('lazy')).toBe(false);
		expect(world.commands.length).toBe(0);

		world.eventBus.publish('ping');
		world.commands.spawn({ resource: { id: 3 } });
		expect(systemEvents).toBe(1);
		expect(directEvents).toBe(1);
		expect(world.commands.length).toBe(0);
		expect(() => world.addSystem('after-dispose')).toThrow(/disposed/);
	});

	test('detaches pending application and plugin systems without initializing them', async () => {
		let initialized = false;
		const detached: string[] = [];
		let releaseDetach: (() => void) | undefined;
		const detachGate = new Promise<void>(resolve => {
			releaseDetach = resolve;
		});
		const plugin = definePlugin('pending-system-plugin').install(world => {
			world.addSystem('plugin-pending')
				.setOnInitialize(() => { initialized = true; })
				.setOnDetach(() => { detached.push('plugin'); });
		});
		const world = ECSpresso.create<Config>()
			.withPlugin(plugin)
			.build();
		world.addSystem('application-pending')
			.setOnInitialize(() => { initialized = true; })
			.setOnDetach(async () => {
				await detachGate;
				detached.push('application');
			});

		const disposal = world.dispose();
		expect(initialized).toBe(false);
		releaseDetach?.();
		await settleWithin(disposal);

		expect(initialized).toBe(false);
		expect(detached).toEqual(['plugin', 'application']);
		await settleWithin(world.dispose());
		expect(detached).toEqual(['plugin', 'application']);
		expect(world.entityCount).toBe(0);
	});

	test('pending detach failures do not prevent other pending cleanup', async () => {
		let releaseDetach: (() => void) | undefined;
		const detachGate = new Promise<void>(resolve => {
			releaseDetach = resolve;
		});
		const detached: string[] = [];
		const world = new ECSpresso<Config>();
		world.addSystem('slow-pending')
			.setOnDetach(async () => {
				await detachGate;
				detached.push('slow');
			});
		world.addSystem('failing-pending').setOnDetach(() => {
			detached.push('failing');
			throw new Error('pending detach failed');
		});

		const disposal = world.dispose();
		releaseDetach?.();
		await expect(settleWithin(disposal)).rejects.toThrow('pending detach failed');
		expect(detached).toEqual(['failing', 'slow']);
		await settleWithin(world.dispose());
		expect(detached).toEqual(['failing', 'slow']);
	});

	test('closes the exposed entity manager during teardown', async () => {
		const world = new ECSpresso<Config>();
		const disposal = world.dispose();

		expect(() => world.entityManager.createEntity()).toThrow(/closed/);
		await disposal;
	});

	test('stops the current update when disposal starts inside a system', async () => {
		const phases: string[] = [];
		const world = new ECSpresso<Config>();
		world.addSystem('dispose-in-update')
			.inPhase('preUpdate')
			.setProcess(() => {
				phases.push('pre');
				void world.dispose();
			});
		world.addSystem('later-update')
			.inPhase('update')
			.setProcess(() => { phases.push('update'); });

		world.update(0.016);
		await world.dispose();

		expect(phases).toEqual(['pre']);
	});

	test('waits for an asynchronous detach already started by removeSystem', async () => {
		let releaseDetach: (() => void) | undefined;
		let detachFinished = false;
		const detachGate = new Promise<void>(resolve => {
			releaseDetach = resolve;
		});
		const world = new ECSpresso<Config>();
		world.addSystem('removed-before-dispose').setOnDetach(async () => {
			await detachGate;
			detachFinished = true;
		});
		world.update(0);

		expect(world.removeSystem('removed-before-dispose')).toBe(true);
		const disposal = world.dispose();
		expect(detachFinished).toBe(false);
		releaseDetach?.();
		await disposal;
		expect(detachFinished).toBe(true);
	});

	test('waits for an in-flight resource factory without creating lazy resources', async () => {
		let resolveResource: ((value: number) => void) | undefined;
		let factoryCalls = 0;
		let disposalCalls = 0;
		const pendingResource = new Promise<number>(resolve => {
			resolveResource = resolve;
		});
		const world = ECSpresso.create<PendingConfig>()
			.withResource('base', {
				factory: () => {
					factoryCalls++;
					return pendingResource;
				},
				onDispose: () => { disposalCalls++; },
			})
			.build();

		const initialization = world.initializeResources('base');
		const disposal = world.dispose();
		resolveResource?.(7);

		await initialization;
		await disposal;

		expect(factoryCalls).toBe(1);
		expect(disposalCalls).toBe(1);
	});

	test('does not initialize systems after disposal interrupts initialize()', async () => {
		let resolveResource: ((value: number) => void) | undefined;
		let initializeCalls = 0;
		const pendingResource = new Promise<number>(resolve => {
			resolveResource = resolve;
		});
		const world = ECSpresso.create<PendingConfig>()
			.withResource('base', () => pendingResource)
			.build();
		world.addSystem('late-initializer').setOnInitialize(() => {
			initializeCalls++;
		});

		const initialization = world.initialize();
		const disposal = world.dispose();
		resolveResource?.(1);

		await initialization;
		await disposal;
		expect(initializeCalls).toBe(0);
	});

	test('exits the active screen stack during world disposal', async () => {
		const exits: string[] = [];
		const world = ECSpresso.create()
			.withScreens(screens => screens
				.add('base', {
					initialState: () => ({}),
					onExit: async () => { exits.push('base'); },
				})
				.add('overlay', {
					initialState: () => ({}),
					onExit: async () => { exits.push('overlay'); },
				})
			)
			.build();

		await world.initialize();
		await world.setScreen('base', {});
		await world.pushScreen('overlay', {});
		await world.dispose();

		expect(exits).toEqual(['overlay', 'base']);
		expect(world.getCurrentScreen()).toBe(null);
		expect(world.getScreenStackDepth()).toBe(0);
	});

	test('surfaces resource disposal failures after finishing remaining cleanup', async () => {
		const disposed: string[] = [];
		const world = ECSpresso.create<Config>()
			.withResource('base', {
				factory: () => ({ value: 1 }),
				onDispose: () => {
					disposed.push('base');
					throw new Error('base disposal failed');
				},
			})
			.withResource('child', {
				dependsOn: ['base'],
				factory: () => ({ value: 2 }),
				onDispose: () => { disposed.push('child'); },
			})
			.build();

		await world.initializeResources('base', 'child');
		await expect(world.dispose()).rejects.toThrow('base disposal failed');
		expect(disposed).toEqual(['child', 'base']);

		await world.dispose();
		expect(disposed).toEqual(['child', 'base']);
	});

	test('awaits asynchronous plugin cleanup callbacks', async () => {
		let releaseCleanup: (() => void) | undefined;
		let cleanupCalls = 0;
		const cleanupGate = new Promise<void>(resolve => {
			releaseCleanup = resolve;
		});
		const plugin = definePlugin('async-cleanup').install((_world, onCleanup) => {
			onCleanup(async () => {
				await cleanupGate;
				cleanupCalls++;
			});
		});
		const world = ECSpresso.create().withPlugin(plugin).build();

		const disposal = world.dispose();
		expect(cleanupCalls).toBe(0);
		releaseCleanup?.();
		await disposal;

		expect(cleanupCalls).toBe(1);
	});

	test('allows plugin cleanup to request world disposal after suspension', async () => {
		let releaseCleanup: (() => void) | undefined;
		let cleanupCalls = 0;
		let nestedCompleted = false;
		const cleanupGate = new Promise<void>(resolve => {
			releaseCleanup = resolve;
		});
		const plugin = definePlugin('reentrant-plugin').install((_world, onCleanup) => {
			onCleanup(async cleanup => {
				await cleanupGate;
				cleanup.requestDisposal();
				nestedCompleted = true;
				cleanupCalls++;
			});
		});
		const world = ECSpresso.create().withPlugin(plugin).build();

		const disposal = world.dispose();
		let externalCompleted = false;
		const externalDisposal = world.dispose().then(
			() => { externalCompleted = true; },
			() => { externalCompleted = true; },
		);
		await Promise.resolve();
		expect(externalCompleted).toBe(false);
		world.update(0.016);
		expect(() => world.addSystem('during-dispose')).toThrow(/disposing/);
		releaseCleanup?.();

		await settleWithin(disposal);
		await settleWithin(externalDisposal);
		expect(nestedCompleted).toBe(true);
		expect(cleanupCalls).toBe(1);
	});

	test('external disposal remains pending and receives cleanup failures', async () => {
		let releaseCleanup: (() => void) | undefined;
		const cleanupGate = new Promise<void>(resolve => {
			releaseCleanup = resolve;
		});
		const plugin = definePlugin('failing-suspended-cleanup').install((_world, onCleanup) => {
			onCleanup(async () => {
				await cleanupGate;
				throw new Error('suspended cleanup failed');
			});
		});
		const world = ECSpresso.create().withPlugin(plugin).build();

		const disposal = world.dispose();
		let externalCompleted = false;
		const externalDisposal = world.dispose().catch(() => {
			externalCompleted = true;
		});
		await Promise.resolve();
		expect(externalCompleted).toBe(false);
		releaseCleanup?.();

		await expect(settleWithin(disposal)).rejects.toThrow('suspended cleanup failed');
		await settleWithin(externalDisposal);
		expect(externalCompleted).toBe(true);
	});

	test('allows system detach to request disposal after suspension', async () => {
		let releaseDetach: (() => void) | undefined;
		let detachCalls = 0;
		const detachGate = new Promise<void>(resolve => {
			releaseDetach = resolve;
		});
		const world = new ECSpresso<Config>();
		world.addSystem('reentrant-detach').setOnDetach(async (_ecs, cleanup) => {
			await detachGate;
			cleanup.requestDisposal();
			detachCalls++;
		});
		world.update(0);

		const disposal = world.dispose();
		releaseDetach?.();
		await settleWithin(disposal);
		expect(detachCalls).toBe(1);
	});

	test('allows resource disposal to request world disposal after suspension', async () => {
		let releaseResource: (() => void) | undefined;
		let disposeCalls = 0;
		const resourceGate = new Promise<void>(resolve => {
			releaseResource = resolve;
		});
		const world = ECSpresso.create<Config>()
			.withResource('base', {
				factory: () => ({ value: 1 }),
				onDispose: async (_resource, _ecs, cleanup) => {
					await resourceGate;
					cleanup.requestDisposal();
					disposeCalls++;
				},
			})
			.build();
		await world.initializeResources('base');

		const disposal = world.dispose();
		releaseResource?.();
		await settleWithin(disposal);
		expect(disposeCalls).toBe(1);
	});

	test('a suspended detach can initiate disposal without weakening the external barrier', async () => {
		let releaseInitiator: (() => void) | undefined;
		let releaseOther: (() => void) | undefined;
		let disposalRequested: (() => void) | undefined;
		const initiatorGate = new Promise<void>(resolve => {
			releaseInitiator = resolve;
		});
		const otherGate = new Promise<void>(resolve => {
			releaseOther = resolve;
		});
		const requestSignal = new Promise<void>(resolve => {
			disposalRequested = resolve;
		});
		const detached: string[] = [];
		const world = new ECSpresso<Config>();
		world.addSystem('detach-initiator').setOnDetach(async (_ecs, cleanup) => {
			await Promise.resolve();
			cleanup.requestDisposal();
			disposalRequested?.();
			await initiatorGate;
			detached.push('initiator');
		});
		world.addSystem('other-detach').setOnDetach(async () => {
			await otherGate;
			detached.push('other');
		});
		world.update(0);

		expect(world.removeSystem('detach-initiator')).toBe(true);
		await requestSignal;
		let externalCompleted = false;
		const external = world.dispose().then(() => {
			externalCompleted = true;
		});
		await Promise.resolve();
		expect(externalCompleted).toBe(false);

		releaseInitiator?.();
		await Promise.resolve();
		expect(externalCompleted).toBe(false);
		releaseOther?.();
		await settleWithin(external);

		expect(detached).toContain('initiator');
		expect(detached).toContain('other');
	});

	test('an immediate detach request starts world disposal exactly once', async () => {
		let detachCalls = 0;
		const world = new ECSpresso<Config>();
		world.addSystem('immediate-detach').setOnDetach((_ecs, cleanup) => {
			detachCalls++;
			cleanup.requestDisposal();
		});
		world.update(0);

		expect(world.removeSystem('immediate-detach')).toBe(true);
		await settleWithin(world.dispose());
		expect(detachCalls).toBe(1);
	});

	test('a failing detach that initiates disposal rejects the external barrier', async () => {
		let disposalRequested: (() => void) | undefined;
		let releaseFailure: (() => void) | undefined;
		const requestSignal = new Promise<void>(resolve => {
			disposalRequested = resolve;
		});
		const failureGate = new Promise<void>(resolve => {
			releaseFailure = resolve;
		});
		const originalError = console.error;
		console.error = () => undefined;
		try {
			const world = new ECSpresso<Config>();
			world.addSystem('failing-initiator').setOnDetach(async (_ecs, cleanup) => {
				await Promise.resolve();
				cleanup.requestDisposal();
				disposalRequested?.();
				await failureGate;
				throw new Error('initiating detach failed');
			});
			world.update(0);

			expect(world.removeSystem('failing-initiator')).toBe(true);
			await requestSignal;
			const external = world.dispose();
			releaseFailure?.();
			await expect(settleWithin(external)).rejects.toThrow('initiating detach failed');
		} finally {
			console.error = originalError;
		}
	});

	test('partial resource cleanup can initiate world disposal without losing dependencies', async () => {
		let releaseChild: (() => void) | undefined;
		let disposalRequested: (() => void) | undefined;
		const childGate = new Promise<void>(resolve => {
			releaseChild = resolve;
		});
		const requestSignal = new Promise<void>(resolve => {
			disposalRequested = resolve;
		});
		const disposed: string[] = [];
		const world = ECSpresso.create<Config>()
			.withResource('base', {
				factory: () => ({ value: 1 }),
				onDispose: () => { disposed.push('base'); },
			})
			.withResource('child', {
				dependsOn: ['base'],
				factory: () => ({ value: 2 }),
				onDispose: async (_resource, ecs, cleanup) => {
					await Promise.resolve();
					cleanup.requestDisposal();
					disposalRequested?.();
					await childGate;
					expect(ecs.getResource('base')).toEqual({ value: 1 });
					disposed.push('child');
				},
			})
			.build();
		await world.initializeResources('base', 'child');

		const partial = world.disposeResource('child');
		await requestSignal;
		let externalCompleted = false;
		const external = world.dispose().then(() => {
			externalCompleted = true;
		});
		await Promise.resolve();
		expect(externalCompleted).toBe(false);
		releaseChild?.();

		expect(await settleWithin(partial)).toBe(true);
		await settleWithin(external);
		expect(disposed).toEqual(['child', 'base']);
	});

	test('bulk resource cleanup can initiate world disposal and surface failures', async () => {
		let disposalRequested: (() => void) | undefined;
		let releaseFailure: (() => void) | undefined;
		const requestSignal = new Promise<void>(resolve => {
			disposalRequested = resolve;
		});
		const failureGate = new Promise<void>(resolve => {
			releaseFailure = resolve;
		});
		const disposed: string[] = [];
		const world = ECSpresso.create<Config>()
			.withResource('base', {
				factory: () => ({ value: 1 }),
				onDispose: () => { disposed.push('base'); },
			})
			.withResource('child', {
				dependsOn: ['base'],
				factory: () => ({ value: 2 }),
				onDispose: async (_resource, ecs, cleanup) => {
					await Promise.resolve();
					cleanup.requestDisposal();
					disposalRequested?.();
					expect(ecs.getResource('base')).toEqual({ value: 1 });
					await failureGate;
					disposed.push('child');
					throw new Error('initiating resource failed');
				},
			})
			.build();
		await world.initializeResources('base', 'child');

		const bulk = world.disposeResources();
		await requestSignal;
		const external = world.dispose();
		releaseFailure?.();
		await expect(settleWithin(bulk)).rejects.toThrow('initiating resource failed');
		await expect(settleWithin(external)).rejects.toThrow('initiating resource failed');
		expect(disposed).toEqual(['child', 'base']);
	});

	test('waits for a partial resource teardown before clearing dependencies', async () => {
		let releaseChild: (() => void) | undefined;
		let childStarted: (() => void) | undefined;
		const childStart = new Promise<void>(resolve => {
			childStarted = resolve;
		});
		const childGate = new Promise<void>(resolve => {
			releaseChild = resolve;
		});
		const disposed: string[] = [];
		const world = ECSpresso.create<Config>()
			.withResource('base', {
				factory: () => ({ value: 1 }),
				onDispose: () => { disposed.push('base'); },
			})
			.withResource('child', {
				dependsOn: ['base'],
				factory: () => ({ value: 2 }),
				onDispose: async (_resource, ecs) => {
					childStarted?.();
					await childGate;
					expect(ecs.getResource('base')).toEqual({ value: 1 });
					disposed.push('child');
				},
			})
			.build();
		await world.initializeResources('base', 'child');

		const partial = world.disposeResources();
		await childStart;
		const disposal = world.dispose();
		let disposalCompleted = false;
		void disposal.then(
			() => { disposalCompleted = true; },
			() => { disposalCompleted = true; },
		);
		await Promise.resolve();
		expect(disposalCompleted).toBe(false);
		releaseChild?.();

		await settleWithin(partial);
		await settleWithin(disposal);
		expect(disposed).toEqual(['child', 'base']);
	});

	test('waits for a partial single-resource teardown before clearing dependencies', async () => {
		let releaseChild: (() => void) | undefined;
		let childStarted: (() => void) | undefined;
		const childStart = new Promise<void>(resolve => {
			childStarted = resolve;
		});
		const childGate = new Promise<void>(resolve => {
			releaseChild = resolve;
		});
		const disposed: string[] = [];
		const world = ECSpresso.create<Config>()
			.withResource('base', {
				factory: () => ({ value: 1 }),
				onDispose: () => { disposed.push('base'); },
			})
			.withResource('child', {
				dependsOn: ['base'],
				factory: () => ({ value: 2 }),
				onDispose: async (_resource, ecs) => {
					childStarted?.();
					await childGate;
					expect(ecs.getResource('base')).toEqual({ value: 1 });
					disposed.push('child');
				},
			})
			.build();
		await world.initializeResources('base', 'child');

		const partial = world.disposeResource('child');
		await childStart;
		const disposal = world.dispose();
		let disposalCompleted = false;
		void disposal.then(
			() => { disposalCompleted = true; },
			() => { disposalCompleted = true; },
		);
		await Promise.resolve();
		expect(disposalCompleted).toBe(false);
		releaseChild?.();

		await settleWithin(partial);
		await settleWithin(disposal);
		expect(disposed).toEqual(['child', 'base']);
	});

	test('surfaces a failed partial teardown after dependent cleanup completes', async () => {
		let releaseChild: (() => void) | undefined;
		let childStarted: (() => void) | undefined;
		const childStart = new Promise<void>(resolve => {
			childStarted = resolve;
		});
		const childGate = new Promise<void>(resolve => {
			releaseChild = resolve;
		});
		const disposed: string[] = [];
		const world = ECSpresso.create<Config>()
			.withResource('base', {
				factory: () => ({ value: 1 }),
				onDispose: () => { disposed.push('base'); },
			})
			.withResource('child', {
				dependsOn: ['base'],
				factory: () => ({ value: 2 }),
				onDispose: async (_resource, ecs) => {
					childStarted?.();
					await childGate;
					expect(ecs.getResource('base')).toEqual({ value: 1 });
					disposed.push('child');
					throw new Error('partial child disposal failed');
				},
			})
			.build();
		await world.initializeResources('base', 'child');

		const partial = world.disposeResource('child');
		await childStart;
		const disposal = world.dispose();
		releaseChild?.();

		let partialFailed = false;
		try {
			await settleWithin(partial);
		} catch (error) {
			partialFailed = error instanceof Error && error.message === 'partial child disposal failed';
		}
		let disposalFailed = false;
		try {
			await settleWithin(disposal);
		} catch (error) {
			disposalFailed = error instanceof Error;
		}
		expect(partialFailed).toBe(true);
		expect(disposalFailed).toBe(true);
		expect(disposed).toEqual(['child', 'base']);
	});
});
