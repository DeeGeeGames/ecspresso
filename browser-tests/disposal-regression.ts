import ECSpresso, { definePlugin, type WorldConfigFrom } from '../src/index';

type Config = WorldConfigFrom<
	{},
	{},
	{
		base: { value: number };
		child: { value: number };
	}
>;

interface Deferred<T> {
	readonly promise: Promise<T>;
	readonly resolve: (value: T | PromiseLike<T>) => void;
}

function deferred<T>(): Deferred<T> {
	let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
	const promise = new Promise<T>(resolvePromise => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

function assert(condition: boolean, message: string): void {
	if (condition) return;
	throw new Error(message);
}

async function settleWithin<T>(promise: Promise<T>): Promise<T> {
	const timeout = new Promise<T>((_resolve, reject) => {
		setTimeout(() => reject(new Error('browser disposal test timed out')), 1000);
	});
	return Promise.race([promise, timeout]);
}

async function pluginCleanupReentry(): Promise<void> {
	const finish = deferred<void>();
	let cleanupCalls = 0;
	const plugin = definePlugin('browser-cleanup').install((_world, onCleanup) => {
		onCleanup(async cleanup => {
			await Promise.resolve();
			cleanup.requestDisposal();
			await finish.promise;
			cleanupCalls += 1;
		});
	});
	const world = ECSpresso.create().withPlugin(plugin).build();
	const disposal = world.dispose();
	let externalComplete = false;
	const external = world.dispose().then(() => {
		externalComplete = true;
	});
	await Promise.resolve();
	assert(!externalComplete, 'external plugin cleanup barrier completed early');
	finish.resolve();
	await settleWithin(Promise.all([disposal, external]));
	assert(cleanupCalls === 1, 'plugin cleanup did not complete exactly once');
}

async function detachInitiatesDisposal(): Promise<void> {
	const requested = deferred<void>();
	const finish = deferred<void>();
	let detachCalls = 0;
	const world = new ECSpresso<Config>();
	world.addSystem('browser-detach').setOnDetach(async (_ecs, cleanup) => {
		await Promise.resolve();
		cleanup.requestDisposal();
		requested.resolve();
		await finish.promise;
		detachCalls += 1;
	});
	world.update(0);
	world.removeSystem('browser-detach');
	await requested.promise;
	let externalComplete = false;
	const external = world.dispose().then(() => {
		externalComplete = true;
	});
	await Promise.resolve();
	assert(!externalComplete, 'external detach barrier completed early');
	finish.resolve();
	await settleWithin(external);
	assert(detachCalls === 1, 'detach cleanup did not complete exactly once');
}

async function resourceInitiatesDisposal(): Promise<void> {
	const requested = deferred<void>();
	const finish = deferred<void>();
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
				requested.resolve();
				await finish.promise;
				assert(ecs.hasResource('base'), 'base dependency disappeared during child cleanup');
				disposed.push('child');
			},
		})
		.build();
	await world.initializeResources('base', 'child');
	const partial = world.disposeResource('child');
	await requested.promise;
	let externalComplete = false;
	const external = world.dispose().then(() => {
		externalComplete = true;
	});
	await Promise.resolve();
	assert(!externalComplete, 'external resource barrier completed early');
	finish.resolve();
	await settleWithin(Promise.all([partial, external]));
	assert(disposed.join(',') === 'child,base', 'resources did not dispose once in dependency order');
}

async function failuresReachExternalCallers(): Promise<void> {
	const finish = deferred<void>();
	const plugin = definePlugin('browser-failure').install((_world, onCleanup) => {
		onCleanup(async () => {
			await finish.promise;
			throw new Error('browser cleanup failed');
		});
	});
	const world = ECSpresso.create().withPlugin(plugin).build();
	const first = world.dispose();
	const external = world.dispose();
	finish.resolve();
	const results = await settleWithin(Promise.allSettled([first, external]));
	assert(
		results.every(result => result.status === 'rejected'),
		'cleanup failure did not reach every external disposal caller',
	);
}

async function assertPending(promise: Promise<unknown>): Promise<void> {
	const status = await Promise.race([
		promise.then(() => 'settled', () => 'settled'),
		new Promise<string>(resolve => setTimeout(() => resolve('pending'), 10)),
	]);
	assert(status === 'pending', 'world disposal completed before its cleanup');
}

async function uninstalledPluginCleanup(): Promise<void> {
	const finish = deferred<void>();
	const calls: string[] = [];
	const plugin = definePlugin('uninstalled-browser-plugin').install((_world, onCleanup) => {
		onCleanup(async cleanup => {
			cleanup.requestDisposal();
			await finish.promise;
			calls.push('finished');
		});
	});
	const world = ECSpresso.create().withPlugin(plugin).build();
	world.uninstallPlugin('uninstalled-browser-plugin');
	const disposal = world.dispose();
	await assertPending(disposal);
	finish.resolve();
	await settleWithin(disposal);
	assert(calls.length === 1, 'uninstalled cleanup was not joined');
}

async function screenEntryTeardown(): Promise<void> {
	const started = deferred<void>();
	const finish = deferred<void>();
	const calls: string[] = [];
	const world = ECSpresso.create().withScreens(screens => screens.add('base', {
		initialState: () => ({}),
		onEnter: async () => {
			started.resolve();
			await finish.promise;
			calls.push('enter');
		},
		onExit: () => { calls.push('exit'); },
	})).build();
	await world.initialize();
	const transition = world.setScreen('base', {}).catch((error: unknown) => error);
	await started.promise;
	const disposal = world.dispose();
	await assertPending(disposal);
	finish.resolve();
	await settleWithin(disposal);
	await transition;
	assert(calls.join(',') === 'enter,exit', 'screen exit raced pending entry');
}

async function removalFailureIsolation(): Promise<void> {
	const calls: string[] = [];
	const world = ECSpresso.create().withComponentTypes<{ a: number; b: number }>().build();
	world.registerDispose('a', () => { calls.push('a'); });
	world.registerDispose('b', () => { calls.push('b'); });
	world.onComponentRemoved('a', () => { throw new Error('observer failed'); });
	world.spawn({ a: 1, b: 2 });
	const failure = await world.dispose().catch((error: unknown) => error);
	assert(failure instanceof Error, 'observer error was not reported');
	assert(calls.join(',') === 'a,b' && world.entityCount === 0, 'component cleanup was skipped');
}

const cases = [
	['uninstalled plugin cleanup', uninstalledPluginCleanup],
	['pending screen entry', screenEntryTeardown],
	['removal failure isolation', removalFailureIsolation],
	['plugin cleanup reentry', pluginCleanupReentry],
	['detach initiates disposal', detachInitiatesDisposal],
	['resource initiates disposal', resourceInitiatesDisposal],
	['external failure propagation', failuresReachExternalCallers],
] as const;

const results = await Promise.all(cases.map(async ([name, run]) => {
	try {
		await run();
		return `PASS ${name}`;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return `FAIL ${name}: ${message}`;
	}
}));
const failed = results.some(result => result.startsWith('FAIL'));
document.body.dataset['status'] = failed ? 'failed' : 'passed';
const output = document.querySelector('#results');
if (output) output.textContent = results.join('\n');
