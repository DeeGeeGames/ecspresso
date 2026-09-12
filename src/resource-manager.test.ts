import { expect, describe, test } from 'bun:test';
import ECSpresso from './ecspresso';
import ResourceManager, { directValue } from './resource-manager';
import { definePlugin } from './plugin';
import type { WorldConfigFrom } from './type-utils';

function settleWithin<T>(promise: Promise<T>, timeoutMs = 100): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<T>((_, reject) => {
		timer = setTimeout(() => reject(new Error('operation did not settle in time')), timeoutMs);
	});
	return Promise.race([promise, timeout]).finally(() => {
		if (timer !== undefined) clearTimeout(timer);
	});
}

interface TestComponents {
	position: { x: number; y: number };
	velocity: { x: number; y: number };
}

interface TestEvents {
	resourceUpdated: { resourceName: string; newValue: any };
}

interface TestResources {
	config: { debug: boolean; maxEntities: number };
	gameState: { current: string; previous: string };
	logger: { log: (message: string) => void };
	counter: { increment: () => number };
	controlMap: { up: boolean; down: boolean; left: boolean; right: boolean };
	objectInstance: () => number;
}

describe('ResourceManager', () => {
	test('should add and get resources', () => {
		const resourceManager = new ResourceManager<TestResources>();
		resourceManager.add('config', { debug: true, maxEntities: 1000 });

		const config = resourceManager.get('config');
		expect(config).toEqual({ debug: true, maxEntities: 1000 });

		resourceManager.add('gameState', { current: 'mainMenu', previous: '' });
		expect(resourceManager.get('gameState')).toEqual({ current: 'mainMenu', previous: '' });
	});

	test('should add and get factory function values after initialization', async () => {
		const resourceManager = new ResourceManager<TestResources>();
		resourceManager.add('config', () => ({ debug: true, maxEntities: 1000 }));

		await resourceManager.initializeResources();

		const config = resourceManager.get('config');
		expect(config).toEqual({ debug: true, maxEntities: 1000 });
	});
	
	test('should add and get async factory function values after initialization', async () => {
		const resourceManager = new ResourceManager<TestResources>();
		resourceManager.add('config', async () => ({ debug: true, maxEntities: 1000 }));

		await resourceManager.initializeResources();

		const config = resourceManager.get('config');
		expect(config).toEqual({ debug: true, maxEntities: 1000 });
	});
	
	test('should add and get resources with type safety', () => {
		const resourceManager = new ResourceManager<TestResources>();
		// @ts-expect-error Throw an error when accessing a resource that doesn't exist
		resourceManager.add('not-a-resource', {});
		// @ts-expect-error Throw an error when setting the incorrect type
		resourceManager.add('config', true);
		// @ts-expect-error Throw an error when a factory function returns an incorrect type
		resourceManager.add('config', () => true);
		// @ts-expect-error Throw an error when a factory function returns an incorrect type
		resourceManager.add('config', async () => true);
		// @ts-expect-error Throw an error when accessing a resource that doesn't exist
		resourceManager.get('not-a-resource');
	});

	test('should check if a resource exists', () => {
		const resourceManager = new ResourceManager<TestResources>();
		resourceManager.add('config', { debug: true, maxEntities: 1000 });

		expect(resourceManager.has('config')).toBe(true);
		expect(resourceManager.has('gameState')).toBe(false);
	});

	test('should remove resources', () => {
		const resourceManager = new ResourceManager<TestResources>();
		resourceManager.add('config', { debug: true, maxEntities: 1000 });
		resourceManager.add('gameState', { current: 'mainMenu', previous: '' });

		resourceManager.remove('config');

		expect(resourceManager.has('config')).toBe(false);
		expect(resourceManager.has('gameState')).toBe(true);
	});

	test('should gracefully handle removing non-existent resources', () => {
		const resourceManager = new ResourceManager<TestResources>();
		resourceManager.add('config', { debug: true, maxEntities: 1000 });

		// Should not throw
		resourceManager.remove('gameState');
		expect(resourceManager.has('gameState')).toBe(false);
	});

	test('should handle resources in ECS systems', () => {
		const plugin = definePlugin('config-aware')
			.withComponentTypes<TestComponents>()
			.withEventTypes<TestEvents>()
			.withResourceTypes<TestResources>()
			.install((world) => {
				world.addResource('config', { debug: true, maxEntities: 1000 });
				world.addSystem('ConfigAwareSystem')
					.addQuery('entities', {
						with: ['position']
					})
					.setProcess(({ ecs }) => {
						const config = ecs.getResource('config');
						if (config.debug) {
							systemDebugRan = true;
						}
					});
			});

		const world = ECSpresso.create()
			.withPlugin(plugin)
			.build();

		// Track system execution
		let systemDebugRan = false;

		world.spawn({
			position: { x: 0, y: 0 }
		});

		// Update the world to run the system
		world.update(1/60);

		// Verify the system accessed the resource
		expect(systemDebugRan).toBe(true);
	});

	test('should support object and function resources', () => {
		// Create a custom logger
		const customLogger = {
			log: (message: string) => {
				loggedMessages.push(message);
			}
		};

		// Create a counter resource with a function
		const counter = {
			value: 0,
			increment: function() {
				this.value += 1;
				return this.value;
			}
		};

		// Track logged messages
		const loggedMessages: string[] = [];

		const plugin = definePlugin('resource-system')
			.withComponentTypes<TestComponents>()
			.withEventTypes<TestEvents>()
			.withResourceTypes<TestResources>()
			.install((world) => {
				world.addResource('logger', customLogger);
				world.addResource('counter', counter);
				world.addSystem('ResourceSystem')
					.addQuery('entities', {
						with: ['position']
					})
					.setProcess(({ ecs }) => {
						const logger = ecs.getResource('logger');
						const counter = ecs.getResource('counter');

						const value = counter.increment();
						logger.log(`Counter value: ${value}`);
					});
			});

		const world = ECSpresso.create()
			.withPlugin(plugin)
			.build();

		world.spawn({
			position: { x: 0, y: 0 }
		});

		// Update the world to run the system
		world.update(1/60);

		// Verify the resources were used correctly
		expect(counter.value).toBe(1);
		expect(loggedMessages).toEqual(['Counter value: 1']);

		// Update again to see that state is maintained
		world.update(1/60);
		expect(counter.value).toBe(2);
		expect(loggedMessages).toEqual(['Counter value: 1', 'Counter value: 2']);
	});

	test('should support resources in event handlers', () => {
		// Create resources for event handlers to use
		const gameState = { current: 'playing', previous: 'menu' };
		const logger = {
			log: (message: string) => {
				loggedMessages.push(message);
			}
		};

		// Track logged messages
		const loggedMessages: string[] = [];

		const plugin = definePlugin('event-system')
			.withComponentTypes<TestComponents>()
			.withEventTypes<TestEvents>()
			.withResourceTypes<TestResources>()
			.install((world) => {
				world.addResource('gameState', gameState);
				world.addResource('logger', logger);
				world.addSystem('EventSystem')
					.setEventHandlers({
						resourceUpdated: ({ data, ecs }) => {
							const logger = ecs.getResource('logger');
							const gameState = ecs.getResource('gameState');

							logger.log(`Resource ${data.resourceName} updated to ${data.newValue} (game state: ${gameState.current})`);

							gameState.previous = gameState.current;
							gameState.current = 'updated';
						}
					});
			});

		const world = ECSpresso.create()
			.withPlugin(plugin)
			.build();

		// Publish an event to trigger the handler
		world.eventBus.publish('resourceUpdated', {
			resourceName: 'config',
			newValue: { debug: false, maxEntities: 500 }
		});

		// Verify the resources were used and updated correctly
		expect(loggedMessages).toEqual([
			'Resource config updated to [object Object] (game state: playing)'
		]);
		expect(gameState).toEqual({ current: 'updated', previous: 'playing' });
	});

	describe('Resource Resolution', () => {
		test('bare functions are treated as factories', async () => {
			const resourceManager = new ResourceManager<TestResources>();

			function createControlMap() {
				return { up: false, down: false, left: false, right: false };
			}

			const createConfig = () => ({ debug: true, maxEntities: 1000 });

			resourceManager.add('controlMap', createControlMap);
			resourceManager.add('config', createConfig);

			await resourceManager.initializeResources();

			expect(resourceManager.get('controlMap')).toEqual({
				up: false, down: false, left: false, right: false,
			});
			expect(resourceManager.get('config')).toEqual({ debug: true, maxEntities: 1000 });
		});

		test('directValue() stores functions as-is without invoking', async () => {
			const myFn = () => 42;
			const resourceManager = new ResourceManager<TestResources>();

			resourceManager.add('objectInstance', directValue(myFn));

			// Should be immediately available (no initialization needed)
			expect(resourceManager.get('objectInstance')).toBe(myFn);
			expect(resourceManager.needsInitialization('objectInstance')).toBe(false);
		});

		test('directValue() stores classes as-is without invoking', async () => {
			class GameConfig {
				static defaultDifficulty = 'normal';
			}

			const rm = new ResourceManager<{ config: typeof GameConfig }>();
			rm.add('config', directValue(GameConfig));

			expect(rm.get('config')).toBe(GameConfig);
			expect(rm.get('config').defaultDifficulty).toBe('normal');
		});

		test('non-function values are stored directly', () => {
			const resourceManager = new ResourceManager<TestResources>();

			resourceManager.add('config', { debug: true, maxEntities: 1000 });
			expect(resourceManager.get('config')).toEqual({ debug: true, maxEntities: 1000 });
		});

		test('bare factory works end-to-end with ECSpresso', async () => {
			interface InputComponents {
				position: { x: number; y: number };
				velocity: { x: number; y: number };
				speed: number;
			}

			interface InputResources {
				controlMap: {
					up: boolean;
					down: boolean;
					left: boolean;
					right: boolean;
				};
			}

			function activeKeyMap() {
				return { up: false, down: false, left: false, right: false };
			}

			const world = new ECSpresso<WorldConfigFrom<InputComponents, {}, InputResources>>();
			world.addResource('controlMap', activeKeyMap);
			await world.initializeResources();

			let systemRan = false;
			world.addSystem('input-test')
				.addQuery('entities', { with: ['position', 'velocity', 'speed'] })
				.setProcess(({ ecs }) => {
					const controlMap = ecs.getResource('controlMap');
					expect(typeof controlMap).toBe('object');
					expect(controlMap.up).toBe(false);
					systemRan = true;
				});

			world.spawn({
				position: { x: 0, y: 0 },
				velocity: { x: 0, y: 0 },
				speed: 100,
			});

			world.update(1/60);
			expect(systemRan).toBe(true);
		});

		test('directValue() works with ECSpresso.addResource', () => {
			interface Res { handler: () => string }
			const world = new ECSpresso<WorldConfigFrom<{}, {}, Res>>();

			const handler = () => 'hello';
			world.addResource('handler', directValue(handler));

			expect(world.getResource('handler')).toBe(handler);
			expect(world.getResource('handler')()).toBe('hello');
		});
	});

	describe('Resource Dependencies', () => {
		test('should initialize resources in dependency order', async () => {
			const order: string[] = [];
			const rm = new ResourceManager<{ a: number; b: number; c: number }>();

			rm.add('c', {
				dependsOn: ['b'],
				factory: () => { order.push('c'); return 3; }
			});
			rm.add('a', () => { order.push('a'); return 1; });
			rm.add('b', {
				dependsOn: ['a'],
				factory: () => { order.push('b'); return 2; }
			});

			await rm.initializeResources();

			expect(order).toEqual(['a', 'b', 'c']);
		});

		test('should handle diamond dependencies', async () => {
			// D depends on B and C, both depend on A
			const order: string[] = [];
			const rm = new ResourceManager<{ a: number; b: number; c: number; d: number }>();

			rm.add('d', { dependsOn: ['b', 'c'], factory: () => { order.push('d'); return 4; } });
			rm.add('b', { dependsOn: ['a'], factory: () => { order.push('b'); return 2; } });
			rm.add('c', { dependsOn: ['a'], factory: () => { order.push('c'); return 3; } });
			rm.add('a', () => { order.push('a'); return 1; });

			await rm.initializeResources();

			expect(order[0]).toBe('a');           // A must be first
			expect(order[3]).toBe('d');           // D must be last
			expect(order.indexOf('b')).toBeLessThan(order.indexOf('d'));
			expect(order.indexOf('c')).toBeLessThan(order.indexOf('d'));
		});

		test('should detect circular dependencies', async () => {
			const rm = new ResourceManager<{ a: number; b: number }>();

			rm.add('a', { dependsOn: ['b'], factory: () => 1 });
			rm.add('b', { dependsOn: ['a'], factory: () => 2 });

			await expect(rm.initializeResources()).rejects.toThrow(/[Cc]ircular/);
		});

		test('should detect self-referential dependencies', async () => {
			const rm = new ResourceManager<{ a: number }>();

			rm.add('a', { dependsOn: ['a'], factory: () => 1 });

			await expect(rm.initializeResources()).rejects.toThrow(/[Cc]ircular/);
		});

		test('should allow factory to access dependencies via context', async () => {
			interface Res { config: { value: number }; derived: { doubled: number } }
			interface MockEcs { getResource: (key: keyof Res) => Res[keyof Res] }
			const rm = new ResourceManager<Res, MockEcs>();

			// Create a mock ECS instance with getResource method
			const mockEcs: MockEcs = {
				getResource: (key: keyof Res) => rm.get(key, mockEcs)
			};

			rm.add('config', { value: 42 });
			rm.add('derived', {
				dependsOn: ['config'],
				factory: (ecs) => ({ doubled: (ecs.getResource('config') as Res['config']).value * 2 })
			});

			await rm.initializeResources(mockEcs);

			expect(rm.get('derived', mockEcs)).toEqual({ doubled: 84 });
		});

		test('should work with async factories that have dependencies', async () => {
			const rm = new ResourceManager<{ sync: number; async: number }>();

			rm.add('sync', () => 1);
			rm.add('async', {
				dependsOn: ['sync'],
				factory: async () => {
					await new Promise(r => setTimeout(r, 10));
					return 2;
				}
			});

			await rm.initializeResources();

			expect(rm.get('async')).toBe(2);
		});

		test('backward compatibility - existing patterns still work', async () => {
			const rm = new ResourceManager<{ direct: number; factory: number; asyncFactory: number }>();

			rm.add('direct', 1);
			rm.add('factory', () => 2);
			rm.add('asyncFactory', async () => 3);

			await rm.initializeResources();

			expect(rm.get('direct')).toBe(1);
			expect(rm.get('factory')).toBe(2);
			expect(rm.get('asyncFactory')).toBe(3);
		});

		test('should handle multiple independent and dependent resources', async () => {
			const order: string[] = [];
			const rm = new ResourceManager<{ a: number; b: number; c: number; d: number; e: number }>();

			// Independent resources
			rm.add('a', () => { order.push('a'); return 1; });
			rm.add('b', () => { order.push('b'); return 2; });

			// c depends on a
			rm.add('c', {
				dependsOn: ['a'],
				factory: () => { order.push('c'); return 3; }
			});

			// d depends on b
			rm.add('d', {
				dependsOn: ['b'],
				factory: () => { order.push('d'); return 4; }
			});

			// e depends on c and d
			rm.add('e', {
				dependsOn: ['c', 'd'],
				factory: () => { order.push('e'); return 5; }
			});

			await rm.initializeResources();

			// a must come before c
			expect(order.indexOf('a')).toBeLessThan(order.indexOf('c'));
			// b must come before d
			expect(order.indexOf('b')).toBeLessThan(order.indexOf('d'));
			// c and d must come before e
			expect(order.indexOf('c')).toBeLessThan(order.indexOf('e'));
			expect(order.indexOf('d')).toBeLessThan(order.indexOf('e'));
		});

		test('should reject invalid dependency names at compile time', () => {
			const rm = new ResourceManager<{ a: number; b: number }>();
			rm.add('b', {
				// @ts-expect-error - 'nonExistent' is not a key of ResourceTypes
				dependsOn: ['nonExistent'],
				factory: () => 2,
			});
		});

		test('should expose getDependencies for introspection', () => {
			const rm = new ResourceManager<{ a: number; b: number; c: number }>();

			rm.add('a', 1);
			rm.add('b', {
				dependsOn: ['a'],
				factory: () => 2
			});
			rm.add('c', () => 3);

			expect(rm.getDependencies('a')).toEqual([]);
			expect(rm.getDependencies('b')).toEqual(['a']);
			expect(rm.getDependencies('c')).toEqual([]);
		});
	});

	describe('tryGet', () => {
		test('returns undefined for non-existent resource', () => {
			const rm = new ResourceManager<TestResources>();
			expect(rm.tryGet('config')).toBeUndefined();
		});

		test('returns value for existing direct resource', () => {
			const rm = new ResourceManager<TestResources>();
			rm.add('config', { debug: true, maxEntities: 1000 });
			expect(rm.tryGet('config')).toEqual({ debug: true, maxEntities: 1000 });
		});

		test('initializes factory resource on access (same as get)', () => {
			const rm = new ResourceManager<TestResources>();
			rm.add('config', () => ({ debug: false, maxEntities: 500 }));
			const result = rm.tryGet('config');
			expect(result).toEqual({ debug: false, maxEntities: 500 });
		});

		test('type: return type is T | undefined', () => {
			const rm = new ResourceManager<TestResources>();
			const result = rm.tryGet('config');
			// @ts-expect-error - result may be undefined, cannot assign to non-optional type
			const _n: { debug: boolean; maxEntities: number } = result;
			void _n;
		});

		test('type: rejects invalid keys', () => {
			const rm = new ResourceManager<TestResources>();
			// @ts-expect-error - 'nonExistent' is not a valid key
			rm.tryGet('nonExistent');
		});
	});

	describe('Resource Disposal', () => {
		test('disposeResource() should call onDispose callback with resource value', async () => {
			const rm = new ResourceManager<{ db: { close: () => void } }>();
			let disposeCalled = false;
			let disposedValue: { close: () => void } | undefined;

			rm.add('db', {
				factory: () => ({ close: () => {} }),
				onDispose: (resource) => {
					disposeCalled = true;
					disposedValue = resource;
				}
			});

			await rm.initializeResources();
			const dbValue = rm.get('db');

			await rm.disposeResource('db');

			expect(disposeCalled).toBe(true);
			expect(disposedValue).toBe(dbValue);
			expect(rm.has('db')).toBe(false);
		});

		test('disposeResource() should return true if resource existed, false otherwise', async () => {
			const rm = new ResourceManager<{ a: number; b: number }>();
			rm.add('a', 1);

			const result1 = await rm.disposeResource('a');
			const result2 = await rm.disposeResource('a');
			const result3 = await rm.disposeResource('b');

			expect(result1).toBe(true);
			expect(result2).toBe(false);
			expect(result3).toBe(false);
		});

		test('disposeResources() should dispose in reverse dependency order', async () => {
			const order: string[] = [];
			const rm = new ResourceManager<{ a: number; b: number; c: number }>();

			rm.add('a', {
				factory: () => 1,
				onDispose: () => { order.push('a'); }
			});
			rm.add('b', {
				dependsOn: ['a'],
				factory: () => 2,
				onDispose: () => { order.push('b'); }
			});
			rm.add('c', {
				dependsOn: ['b'],
				factory: () => 3,
				onDispose: () => { order.push('c'); }
			});

			await rm.initializeResources();
			await rm.disposeResources();

			// Should dispose in reverse order: c, b, a
			expect(order).toEqual(['c', 'b', 'a']);
		});

		test('disposeResources() should support async disposal', async () => {
			const rm = new ResourceManager<{ asyncResource: number }>();
			let asyncDisposeCalled = false;

			rm.add('asyncResource', {
				factory: () => 42,
				onDispose: async () => {
					await new Promise(r => setTimeout(r, 10));
					asyncDisposeCalled = true;
				}
			});

			await rm.initializeResources();
			await rm.disposeResources();

			expect(asyncDisposeCalled).toBe(true);
		});

		test('concurrent external bulk disposal waits for the shared teardown', async () => {
			let releaseDisposal: (() => void) | undefined;
			let disposalStarted: (() => void) | undefined;
			let disposeCalls = 0;
			const disposalStart = new Promise<void>(resolve => {
				disposalStarted = resolve;
			});
			const disposalGate = new Promise<void>(resolve => {
				releaseDisposal = resolve;
			});
			const rm = new ResourceManager<{ value: number }>();
			rm.add('value', {
				factory: () => 1,
				onDispose: async () => {
					disposalStarted?.();
					await disposalGate;
					disposeCalls++;
				},
			});
			await rm.initializeResources();

			const first = rm.disposeResources();
			await disposalStart;
			let secondCompleted = false;
			const second = rm.disposeResources().then(() => {
				secondCompleted = true;
			});
			await Promise.resolve();
			expect(secondCompleted).toBe(false);

			releaseDisposal?.();
			await settleWithin(first);
			await settleWithin(second);
			expect(disposeCalls).toBe(1);
		});

		test('bulk disposal reports an in-flight partial failure once', async () => {
			let releaseDisposal: (() => void) | undefined;
			let disposalStarted: (() => void) | undefined;
			const disposalStart = new Promise<void>(resolve => {
				disposalStarted = resolve;
			});
			const disposalGate = new Promise<void>(resolve => {
				releaseDisposal = resolve;
			});
			const rm = new ResourceManager<{ value: number }>();
			rm.add('value', {
				factory: () => 1,
				onDispose: async () => {
					disposalStarted?.();
					await disposalGate;
					throw new Error('partial disposal failed');
				},
			});
			await rm.initializeResources();

			const partial = rm.disposeResource('value');
			await disposalStart;
			const bulk = rm.disposeResources();
			releaseDisposal?.();

			let partialFailed = false;
			try {
				await settleWithin(partial);
			} catch (error) {
				partialFailed = error instanceof Error && error.message === 'partial disposal failed';
			}
			let bulkError: unknown;
			try {
				await settleWithin(bulk);
			} catch (error) {
				bulkError = error;
			}

			expect(partialFailed).toBe(true);
			expect(bulkError).toBeInstanceOf(Error);
			expect(bulkError).not.toBeInstanceOf(AggregateError);
		});

		test('disposeResources() continues after a disposer fails and is repeat-safe', async () => {
			const order: string[] = [];
			const rm = new ResourceManager<{ first: number; second: number }>();

			rm.add('first', {
				factory: () => 1,
				onDispose: () => {
					order.push('first');
					throw new Error('first disposer failed');
				},
			});
			rm.add('second', {
				factory: () => 2,
				onDispose: () => { order.push('second'); },
			});

			await rm.initializeResources();
			await expect(rm.disposeResources()).rejects.toThrow('first disposer failed');
			expect(order).toEqual(['second', 'first']);
			await rm.disposeResources();
			expect(order).toEqual(['second', 'first']);
		});

		test('cleanup control can request bulk disposal from an async disposer', async () => {
			let disposerCalls = 0;
			const rm = new ResourceManager<{ value: number }>();
			rm.add('value', {
				factory: () => 1,
				onDispose: async (_resource, _context, cleanup) => {
					await Promise.resolve();
					cleanup.requestDisposal();
					disposerCalls++;
				},
			});

			await rm.initializeResources();
			await rm.disposeResources();

			expect(disposerCalls).toBe(1);
		});

		test('tracks an async factory started through get() during disposal', async () => {
			let resolveValue: ((value: number) => void) | undefined;
			let disposerCalls = 0;
			const valuePromise = new Promise<number>(resolve => {
				resolveValue = resolve;
			});
			const rm = new ResourceManager<{ value: number }>();
			rm.add('value', {
				factory: () => valuePromise,
				onDispose: () => { disposerCalls++; },
			});

			const value = rm.get('value');
			const disposal = rm.disposeResources();
			resolveValue?.(1);

			expect(await value).toBe(1);
			await disposal;
			expect(disposerCalls).toBe(1);
		});

		test('resources without onDispose should just be removed', async () => {
			const rm = new ResourceManager<{ simple: number }>();
			rm.add('simple', 42);

			const result = await rm.disposeResource('simple');

			expect(result).toBe(true);
			expect(rm.has('simple')).toBe(false);
		});

		test('disposeResource() calls onDispose for an initialized undefined value', async () => {
			let disposed = false;
			const rm = new ResourceManager<{ optional: undefined }>();
			rm.add('optional', {
				factory: () => undefined,
				onDispose: () => { disposed = true; },
			});

			await rm.initializeResource('optional');
			await rm.disposeResource('optional');

			expect(disposed).toBe(true);
		});

		test('disposeResources() should handle diamond dependencies', async () => {
			const order: string[] = [];
			const rm = new ResourceManager<{ a: number; b: number; c: number; d: number }>();

			rm.add('a', {
				factory: () => 1,
				onDispose: () => { order.push('a'); }
			});
			rm.add('b', {
				dependsOn: ['a'],
				factory: () => 2,
				onDispose: () => { order.push('b'); }
			});
			rm.add('c', {
				dependsOn: ['a'],
				factory: () => 3,
				onDispose: () => { order.push('c'); }
			});
			rm.add('d', {
				dependsOn: ['b', 'c'],
				factory: () => 4,
				onDispose: () => { order.push('d'); }
			});

			await rm.initializeResources();
			await rm.disposeResources();

			// d must be first, a must be last
			expect(order[0]).toBe('d');
			expect(order[3]).toBe('a');
			// b and c must come before a
			expect(order.indexOf('b')).toBeLessThan(order.indexOf('a'));
			expect(order.indexOf('c')).toBeLessThan(order.indexOf('a'));
		});

		test('should only dispose initialized resources', async () => {
			const order: string[] = [];
			const rm = new ResourceManager<{ initialized: number; notInitialized: number }>();

			rm.add('initialized', {
				factory: () => 1,
				onDispose: () => { order.push('initialized'); }
			});
			rm.add('notInitialized', {
				factory: () => 2,
				onDispose: () => { order.push('notInitialized'); }
			});

			// Only initialize one resource
			await rm.initializeResource('initialized');
			await rm.disposeResources();

			expect(order).toEqual(['initialized']);
		});

		test('disposeResource() should pass context to onDispose', async () => {
			const rm = new ResourceManager<{ db: { value: number } }>();
			let receivedContext: any;

			rm.add('db', {
				factory: () => ({ value: 42 }),
				onDispose: (_resource, context) => {
					receivedContext = context;
				}
			});

			await rm.initializeResources();
			const mockContext = { name: 'test-context' };
			await rm.disposeResource('db', mockContext);

			expect(receivedContext).toBe(mockContext);
		});

		test('factory with onDispose but no dependsOn should work', async () => {
			const rm = new ResourceManager<{ simple: number }>();
			let disposed = false;

			rm.add('simple', {
				factory: () => 42,
				onDispose: () => { disposed = true; }
			});

			await rm.initializeResources();
			expect(rm.get('simple')).toBe(42);

			await rm.disposeResources();
			expect(disposed).toBe(true);
		});
	});
});
