import { describe, expect, test } from 'bun:test';
import ECSpresso from './ecspresso';
import ResourceManager from './resource-manager';

interface ObservedResources {
	counter: { value: number };
	optionalValue: number | undefined;
}

const initializationCases = [
	{
		name: 'a direct resource added later',
		initialize: function addDirect(manager: ResourceManager<ObservedResources>) {
			manager.add('counter', { value: 0 });
		},
	},
	{
		name: 'a synchronous factory accessed lazily',
		initialize: function getSync(manager: ResourceManager<ObservedResources>) {
			manager.add('counter', () => ({ value: 0 }));
			manager.get('counter');
		},
	},
	{
		name: 'an asynchronous factory accessed lazily',
		initialize: async function getAsync(manager: ResourceManager<ObservedResources>) {
			manager.add('counter', async () => ({ value: 0 }));
			await manager.get('counter');
		},
	},
	{
		name: 'a synchronous factory initialized explicitly',
		initialize: async function initializeSync(manager: ResourceManager<ObservedResources>) {
			manager.add('counter', () => ({ value: 0 }));
			await manager.initializeResource('counter');
		},
	},
	{
		name: 'an asynchronous factory initialized explicitly',
		initialize: async function initializeAsync(manager: ResourceManager<ObservedResources>) {
			manager.add('counter', async () => ({ value: 0 }));
			await manager.initializeResource('counter');
		},
	},
];

describe('Resource observation initialization', () => {
	test.each(initializationCases)('establishes a baseline for $name without an initialization callback', async ({ initialize }) => {
		const manager = new ResourceManager<ObservedResources>();
		const calls: Array<{ value: number; previous: number }> = [];
		manager.onResourceChange('counter', (next, previous) => {
			calls.push({ value: next.value, previous: previous.value });
		});

		manager.flushObserved();
		expect(manager.isObserved('counter')).toBe(true);
		await initialize(manager);
		expect(calls).toEqual([]);

		// Even a change before the first initialized flush uses the real initial value.
		manager.get('counter').value = 1;
		manager.flushObserved();
		expect(calls).toEqual([{ value: 1, previous: 0 }]);
		manager.flushObserved();
		expect(calls).toHaveLength(1);
	});

	test('distinguishes an initialized undefined value from a missing resource', () => {
		const manager = new ResourceManager<ObservedResources>();
		const calls: Array<{ value: number | undefined; previous: number | undefined }> = [];
		manager.onResourceChange('optionalValue', (next, previous) => {
			calls.push({ value: next, previous });
		});

		manager.add('optionalValue', undefined);
		manager.flushObserved();
		expect(calls).toEqual([]);
		manager.add('optionalValue', 1);
		manager.flushObserved();
		expect(calls).toEqual([{ value: 1, previous: undefined }]);
	});

	test('subscribing to an existing lazy world resource does not invoke its factory', async () => {
		const factoryCalls: string[] = [];
		const world = ECSpresso.create()
			.withResource('counter', () => {
				factoryCalls.push('initialized');
				return { value: 0 };
			})
			.build();
		const calls: Array<{ value: number; previous: number }> = [];
		world.onResourceChange('counter', (next, previous) => {
			calls.push({ value: next.value, previous: previous.value });
		});
		expect(factoryCalls).toEqual([]);
		await world.initialize();
		expect(factoryCalls).toEqual(['initialized']);
		expect(calls).toEqual([]);
		world.getResource('counter').value = 1;
		world.update(0);
		expect(calls).toEqual([{ value: 1, previous: 0 }]);
		await world.dispose();
	});

	test('removing an observed resource waits for a new baseline without an undefined event', () => {
		const manager = new ResourceManager<ObservedResources>();
		manager.add('counter', { value: 0 });
		const calls: Array<{ value: number; previous: number }> = [];
		manager.onResourceChange('counter', (next, previous) => {
			calls.push({ value: next.value, previous: previous.value });
		});

		manager.remove('counter');
		manager.flushObserved();
		manager.add('counter', { value: 2 });
		manager.get('counter').value = 3;
		manager.flushObserved();
		expect(calls).toEqual([{ value: 3, previous: 2 }]);
	});
});

function createScreenWorld() {
	return ECSpresso.create()
		.withScreens(screens => screens
			.add('gameplay', { initialState: () => ({ score: 0 }) })
			.add('menu', { initialState: () => ({ score: 0 }) }))
		.build();
}

describe('$screen resource observation', () => {
	test.each([
		{ name: 'before initialization', subscribeBeforeInitialization: true },
		{ name: 'after initialization', subscribeBeforeInitialization: false },
	])('observes state replacements when subscribed $name', async ({ subscribeBeforeInitialization }) => {
		const world = createScreenWorld();
		const calls: Array<{ score: number | undefined; previous: number | undefined }> = [];
		function subscribe() {
			return world.onResourceChange('$screen', (next, previous) => {
				calls.push({ score: next.state?.score, previous: previous.state?.score });
			});
		}
		if (!subscribeBeforeInitialization) await world.initialize();
		const unsubscribe = subscribe();
		if (subscribeBeforeInitialization) await world.initialize();
		world.update(0);
		expect(calls).toEqual([]);

		await world.setScreen('gameplay', {});
		world.update(0);
		expect(calls).toEqual([{ score: 0, previous: undefined }]);
		world.updateScreenState('gameplay', { score: 1 });
		world.updateScreenState('gameplay', current => ({ score: current.score + 1 }));
		expect(calls).toHaveLength(1);
		world.update(0);
		expect(calls).toEqual([
			{ score: 0, previous: undefined },
			{ score: 2, previous: 0 },
		]);
		world.update(0);
		expect(calls).toHaveLength(2);

		unsubscribe();
		expect(world.isResourceObserved('$screen')).toBe(false);
		world.updateScreenState('gameplay', { score: 3 });
		world.update(0);
		expect(calls).toHaveLength(2);
		await world.dispose();
	});

	test('batches screen transitions and preserves the previous screen snapshot', async () => {
		const world = createScreenWorld();
		const calls: Array<{ current: string | null; previous: string | null }> = [];
		world.onResourceChange('$screen', (next, previous) => {
			calls.push({ current: next.current, previous: previous.current });
		});
		await world.initialize();
		await world.setScreen('gameplay', {});
		expect(calls).toEqual([]);
		world.update(0);
		expect(calls).toEqual([{ current: 'gameplay', previous: null }]);

		await world.pushScreen('menu', {});
		await world.popScreen();
		expect(calls).toHaveLength(1);
		world.update(0);
		// The final screen/state references match the previous snapshot.
		expect(calls).toHaveLength(1);
		await world.setScreen('menu', {});
		world.update(0);
		expect(calls).toEqual([
			{ current: 'gameplay', previous: null },
			{ current: 'menu', previous: 'gameplay' },
		]);
		await world.dispose();
	});

	test('does not observe direct nested state mutations', async () => {
		const world = createScreenWorld();
		await world.initialize();
		await world.setScreen('gameplay', {});
		const calls: number[] = [];
		world.onResourceChange('$screen', next => {
			if (next.state) calls.push(next.state.score);
		});

		world.getScreenState('gameplay').score = 1;
		world.update(0);
		expect(calls).toEqual([]);
		world.updateScreenState('gameplay', { score: 2 });
		world.update(0);
		expect(calls).toEqual([2]);
		await world.dispose();
	});
});
