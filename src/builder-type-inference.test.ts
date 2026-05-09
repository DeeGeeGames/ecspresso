import { expect, describe, test } from 'bun:test';
import ECSpresso from './ecspresso';
import { createTimerPlugin } from './plugins/scripting/timers';
import { createTransformPlugin, createLocalTransform, type TransformComponentTypes } from './plugins/spatial/transform';
import type { ComponentsOf, EventsOf, ResourcesOf } from './types';
import type { AssetsResource } from './asset-types';
import { definePlugin } from './plugin';
import type { WorldConfigFrom } from './type-utils';

describe('Builder Type Inference', () => {
	test('withComponentTypes adds app component types', () => {
		const ecs = ECSpresso.create()
			.withComponentTypes<{
				position: { x: number; y: number };
				health: number;
			}>()
			.build();

		const entity = ecs.spawn({ position: { x: 1, y: 2 }, health: 100 });
		expect(entity.components.position.x).toBe(1);
		expect(entity.components.health).toBe(100);

		// Query works with inferred types
		const results = ecs.getEntitiesWithQuery(['position']);
		expect(results.length).toBe(1);
		expect(results[0]?.components.position.y).toBe(2);

		// @ts-expect-error - invalid component name
		ecs.spawn({ nonExistent: true });
	});

	test('withEventTypes adds app event types', () => {
		const ecs = ECSpresso.create()
			.withEventTypes<{
				gameStart: { level: number };
				gameEnd: true;
			}>()
			.build();

		let received: { level: number } | undefined = undefined;
		ecs.on('gameStart', (data) => {
			received = data;
		});
		ecs.eventBus.publish('gameStart', { level: 1 });
		expect(received).toBeDefined();
		expect(received!.level).toBe(1);

		// @ts-expect-error - invalid event name
		ecs.on('nonExistent', () => {});
	});

	test('multiple withComponentTypes calls accumulate', () => {
		const ecs = ECSpresso.create()
			.withComponentTypes<{ position: { x: number; y: number } }>()
			.withComponentTypes<{ velocity: { dx: number; dy: number } }>()
			.build();

		const entity = ecs.spawn({
			position: { x: 0, y: 0 },
			velocity: { dx: 1, dy: 1 },
		});
		expect(entity.components.position.x).toBe(0);
		expect(entity.components.velocity.dx).toBe(1);

		// Both types present in queries
		const results = ecs.getEntitiesWithQuery(['position', 'velocity']);
		expect(results.length).toBe(1);
	});

	test('combined: withPlugin + withComponentTypes + withEventTypes + withResource', () => {
		const ecs = ECSpresso.create()
			.withPlugin(createTransformPlugin())
			.withComponentTypes<{ player: true; enemy: { type: string } }>()
			.withEventTypes<{ gameStart: true }>()
			.withResource('score', { value: 0 })
			.build();

		// Plugin components work
		const entity = ecs.spawn({
			localTransform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
			worldTransform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
			player: true as const,
		});
		expect(entity.components.localTransform.x).toBe(0);
		expect(entity.components.player).toBe(true);

		// App events work
		let fired = false;
		ecs.on('gameStart', () => { fired = true; });
		ecs.eventBus.publish('gameStart', true);
		expect(fired).toBe(true);

		// Resource works
		expect(ecs.getResource('score').value).toBe(0);
	});

	test('@ts-expect-error on invalid components/events after build', () => {
		const ecs = ECSpresso.create()
			.withComponentTypes<{ position: { x: number; y: number } }>()
			.withEventTypes<{ hit: { damage: number } }>()
			.build();

		// @ts-expect-error - 'velocity' not in component types
		ecs.spawn({ velocity: { x: 1, y: 1 } });

		// @ts-expect-error - 'miss' not in event types
		ecs.on('miss', () => {});
	});

	test('timer plugin with event types in the chain', () => {
		const ecs = ECSpresso.create()
			.withPlugin(createTimerPlugin())
			.withEventTypes<{
				playerRespawn: {};
				scoreUpdate: { points: number };
			}>()
			.build();

		// Timer component works
		const entity = ecs.spawn({
			timers: {
				respawn: {
					elapsed: 0,
					duration: 1,
					repeat: false,
					active: true,
					justFinished: false,
					onComplete: () => ecs.eventBus.publish('playerRespawn', {}),
				},
			},
		});
		expect(entity.components.timers['respawn']?.duration).toBe(1);

		// Custom events work alongside timer events
		let points = 0;
		ecs.on('scoreUpdate', (data) => { points = data.points; });
		ecs.eventBus.publish('scoreUpdate', { points: 42 });
		expect(points).toBe(42);
	});

	test('ComponentsOf, EventsOf, ResourcesOf extract correctly', () => {
		const timerPlugin = createTimerPlugin();
		const transformPlugin = createTransformPlugin();

		// These are compile-time checks — if they compile, the types are correct.
		// Each type is used in a variable assignment to prove it resolves to the expected shape.
		const _timerCCheck: ComponentsOf<typeof timerPlugin> = {
			timers: { fuse: { elapsed: 0, duration: 1, repeat: false, active: true, justFinished: false } },
		};
		expect(_timerCCheck.timers['fuse']?.duration).toBe(1);

		// Timer plugin no longer carries event types (loosened to {})
		const _timerECheck: EventsOf<typeof timerPlugin> = {};
		expect(_timerECheck).toEqual({});

		const _transformCCheck: ComponentsOf<typeof transformPlugin> = {
			localTransform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
			worldTransform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
		};
		expect(_transformCCheck.localTransform.x).toBe(0);

		const _transformRCheck: ResourcesOf<typeof transformPlugin> = {};
		expect(_transformRCheck).toEqual({});
	});

	test('typeof ecs captures full inferred type', () => {
		const ecs = ECSpresso.create()
			.withPlugin(createTransformPlugin())
			.withComponentTypes<{ player: true }>()
			.withEventTypes<{ gameStart: true }>()
			.withResource('level', 1)
			.build();

		type ECS = typeof ecs;

		// Use the type alias in a function signature to prove it carries all types
		function spawnPlayer(world: ECS) {
			return world.spawn({
				localTransform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
				worldTransform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
				player: true as const,
			});
		}

		const entity = spawnPlayer(ecs);
		expect(entity.components.player).toBe(true);
		expect(entity.components.localTransform.x).toBe(0);
	});

	test('backward compat: create<C,E,R>() still works', () => {
		interface Components {
			position: { x: number; y: number };
		}
		interface Events {
			hit: { damage: number };
		}
		interface Resources {
			config: { debug: boolean };
		}

		const ecs = ECSpresso.create<WorldConfigFrom<Components, Events, Resources>>()
			.withResource('config', { debug: true })
			.build();

		const entity = ecs.spawn({ position: { x: 5, y: 10 } });
		expect(entity.components.position.x).toBe(5);
		expect(ecs.getResource('config').debug).toBe(true);

		let damage = 0;
		ecs.on('hit', (data) => { damage = data.damage; });
		ecs.eventBus.publish('hit', { damage: 25 });
		expect(damage).toBe(25);
	});

	test('identical overlapping types are OK (idempotent intersection)', () => {
		// Both the plugin and withComponentTypes declare the same localTransform type
		const ecs = ECSpresso.create()
			.withPlugin(createTransformPlugin())
			.withComponentTypes<{ localTransform: TransformComponentTypes['localTransform']; player: true }>()
			.build();

		const entity = ecs.spawn({
			localTransform: { x: 1, y: 2, rotation: 0, scaleX: 1, scaleY: 1 },
			worldTransform: { x: 1, y: 2, rotation: 0, scaleX: 1, scaleY: 1 },
			player: true as const,
		});
		expect(entity.components.localTransform.x).toBe(1);
		expect(entity.components.player).toBe(true);
	});
});

describe('Built-in Resource Typing ($assets / $screen)', () => {
	// Type-level checks use function signatures that are never called at runtime.
	// This validates compile-time assignability without triggering getResource before initialize.

	test('$assets resource is typed after withAssets()', () => {
		const ecs = ECSpresso.create()
			.withAssets(a => a.add('sprite', () => Promise.resolve('sprite-data')))
			.build();

		// Compile-time: '$assets' is a valid resource key and returns AssetsResource
		function _typeCheck(world: typeof ecs) {
			const assets: AssetsResource<{ sprite: string }> = world.getResource('$assets');
			return assets;
		}
		void _typeCheck;
	});

	test('$screen resource is typed after withScreens()', () => {
		const ecs = ECSpresso.create()
			.withScreens(s => s
				.add('menu', { initialState: () => ({}) })
				.add('play', { initialState: () => ({ score: 0 }) })
			)
			.build();

		// Compile-time: '$screen' is a valid resource key with isCurrent/current
		function _typeCheck(world: typeof ecs) {
			const screen = world.getResource('$screen');
			const _check: boolean = screen.isCurrent('menu');
			return _check;
		}
		void _typeCheck;
	});

	test('$assets not in ResourceTypes without withAssets()', () => {
		const ecs = ECSpresso.create()
			.withComponentTypes<{ position: { x: number; y: number } }>()
			.build();

		function _typeCheck(world: typeof ecs) {
			// @ts-expect-error - $assets should not be a valid resource key without withAssets()
			world.getResource('$assets');
		}
		void _typeCheck;
	});

	test('$screen not in ResourceTypes without withScreens()', () => {
		const ecs = ECSpresso.create()
			.withComponentTypes<{ position: { x: number; y: number } }>()
			.build();

		function _typeCheck(world: typeof ecs) {
			// @ts-expect-error - $screen should not be a valid resource key without withScreens()
			world.getResource('$screen');
		}
		void _typeCheck;
	});

	test('$assets and $screen coexist with user resources', () => {
		const ecs = ECSpresso.create()
			.withResource('score', { value: 0 })
			.withAssets(a => a.add('texture', () => Promise.resolve('img')))
			.withScreens(s => s.add('menu', { initialState: () => ({}) }))
			.build();

		// Compile-time: all three resource keys are valid
		function _typeCheck(world: typeof ecs) {
			const score: { value: number } = world.getResource('score');
			const assets: AssetsResource<{ texture: string }> = world.getResource('$assets');
			const screen = world.getResource('$screen');
			return { score, assets, screen };
		}
		void _typeCheck;
	});

	test('$assets resource provides typed asset access', () => {
		const ecs = ECSpresso.create()
			.withAssets(a => a
				.add('playerSprite', () => Promise.resolve('player.png'))
				.add('enemyData', () => Promise.resolve({ hp: 100 }))
			)
			.build();

		// Compile-time: get() returns correct type per asset key
		function _typeCheck(world: typeof ecs) {
			const assets = world.getResource('$assets');
			const _sprite: string = assets.get('playerSprite');
			const _data: { hp: number } = assets.get('enemyData');
			return { _sprite, _data };
		}
		void _typeCheck;
	});

	test('$assets resource group methods are typed when groups are declared', () => {
		const ecs = ECSpresso.create()
			.withAssets(a => a
				.addGroup('level1', { bg: () => Promise.resolve('bg') })
				.addGroup('level2', { music: () => Promise.resolve('music') })
			)
			.build();

		function _typeCheck(world: typeof ecs) {
			const assets = world.getResource('$assets');
			// Valid group names
			assets.isGroupLoaded('level1');
			assets.isGroupLoaded('level2');
			assets.getGroupProgress('level1');
			// @ts-expect-error 'typo' is not a valid group
			assets.isGroupLoaded('typo');
			// @ts-expect-error 'typo' is not a valid group
			assets.getGroupProgress('typo');
		}
		void _typeCheck;
	});

	test('$screen resource provides typed screen access', () => {
		const ecs = ECSpresso.create()
			.withScreens(s => s
				.add('menu', { initialState: () => ({}) })
				.add('gameplay', { initialState: () => ({ score: 0 }) })
			)
			.build();

		// Compile-time: isCurrent() accepts valid screen names
		function _typeCheck(world: typeof ecs) {
			const screen = world.getResource('$screen');
			const _check: boolean = screen.isCurrent('menu');
			const _check2: boolean = screen.isCurrent('gameplay');
			return { _check, _check2 };
		}
		void _typeCheck;
	});

	test('getResource($assets) works after initialize()', async () => {
		const ecs = ECSpresso.create()
			.withAssets(a => a.add('sprite', () => Promise.resolve('sprite-data')))
			.build();

		await ecs.initialize();
		const assets = ecs.getResource('$assets');
		expect(assets).toBeDefined();
		expect(assets.isLoaded('sprite')).toBe(true);
		expect(assets.get('sprite')).toBe('sprite-data');
	});

	test('getResource($screen) works after initialize()', async () => {
		const ecs = ECSpresso.create()
			.withScreens(s => s.add('menu', { initialState: () => ({}) }))
			.build();

		await ecs.initialize();
		const screen = ecs.getResource('$screen');
		expect(screen).toBeDefined();
		expect(screen.current).toBeNull();
	});
});

describe('withPlugin() asset/screen type propagation', () => {
	test('withPlugin(pluginWithAssets) + withAssets() merges both asset types', () => {
		const assetPlugin = definePlugin('asset-plugin')
			.withComponentTypes<{ pos: { x: number } }>()
			.withAssetTypes<{ bundleSprite: string }>()
			.install((world) => {
				world._registerAsset('bundleSprite', { loader: () => Promise.resolve('bundle-sprite') });
			});

		const ecs = ECSpresso.create()
			.withPlugin(assetPlugin)
			.withAssets(a => a.add('appTexture', () => Promise.resolve('app-texture')))
			.build();

		function _typeCheck(world: typeof ecs) {
			const assets: AssetsResource<{ bundleSprite: string; appTexture: string }> = world.getResource('$assets');
			return assets;
		}
		void _typeCheck;
	});

	test('withPlugin(pluginWithAssets) without withAssets() auto-injects $assets', () => {
		const assetPlugin = definePlugin('asset-plugin')
			.withComponentTypes<{ pos: { x: number } }>()
			.withAssetTypes<{ bundleSprite: string }>()
			.install((world) => {
				world._registerAsset('bundleSprite', { loader: () => Promise.resolve('bundle-sprite') });
			});

		const ecs = ECSpresso.create()
			.withPlugin(assetPlugin)
			.build();

		function _typeCheck(world: typeof ecs) {
			const assets: AssetsResource<{ bundleSprite: string }> = world.getResource('$assets');
			return assets;
		}
		void _typeCheck;
	});

	test('withPlugin(pluginWithScreens) + withScreens() merges both screen types', () => {
		const screenPlugin = definePlugin('screen-plugin')
			.withScreenTypes<{ loading: { initialState: () => { progress: number } } }>()
			.install((world) => {
				world._registerScreen('loading', { initialState: () => ({ progress: 0 }) });
			});

		const ecs = ECSpresso.create()
			.withPlugin(screenPlugin)
			.withScreens(s => s.add('menu', { initialState: () => ({}) }))
			.build();

		function _typeCheck(world: typeof ecs) {
			const screen = world.getResource('$screen');
			const _check1: boolean = screen.isCurrent('loading');
			const _check2: boolean = screen.isCurrent('menu');
			return { _check1, _check2 };
		}
		void _typeCheck;
	});

	test('withPlugin(pluginWithScreens) without withScreens() auto-injects $screen', () => {
		const screenPlugin = definePlugin('screen-plugin')
			.withScreenTypes<{ loading: { initialState: () => { progress: number } } }>()
			.install((world) => {
				world._registerScreen('loading', { initialState: () => ({ progress: 0 }) });
			});

		const ecs = ECSpresso.create()
			.withPlugin(screenPlugin)
			.build();

		function _typeCheck(world: typeof ecs) {
			const screen = world.getResource('$screen');
			const _check: boolean = screen.isCurrent('loading');
			return _check;
		}
		void _typeCheck;
	});

	test('two plugins with compatible asset types work', () => {
		const pluginA = definePlugin('a')
			.withComponentTypes<{ a: number }>()
			.withAssetTypes<{ spriteA: string }>()
			.install((world) => {
				world._registerAsset('spriteA', { loader: () => Promise.resolve('a') });
			});

		const pluginB = definePlugin('b')
			.withComponentTypes<{ b: number }>()
			.withAssetTypes<{ spriteB: string }>()
			.install((world) => {
				world._registerAsset('spriteB', { loader: () => Promise.resolve('b') });
			});

		const ecs = ECSpresso.create()
			.withPlugin(pluginA)
			.withPlugin(pluginB)
			.build();

		function _typeCheck(world: typeof ecs) {
			const assets: AssetsResource<{ spriteA: string; spriteB: string }> = world.getResource('$assets');
			return assets;
		}
		void _typeCheck;
	});

	test('two plugins with conflicting asset types produce error', () => {
		const pluginA = definePlugin('a')
			.withComponentTypes<{ a: number }>()
			.withAssetTypes<{ sprite: string }>()
			.install((world) => {
				world._registerAsset('sprite', { loader: () => Promise.resolve('string-data') });
			});

		const pluginB = definePlugin('b')
			.withComponentTypes<{ b: number }>()
			.withAssetTypes<{ sprite: number }>()
			.install((world) => {
				world._registerAsset('sprite', { loader: () => Promise.resolve(42) });
			});

		ECSpresso.create()
			.withPlugin(pluginA)
			// @ts-expect-error conflicting asset types (sprite: string vs sprite: number)
			.withPlugin(pluginB)
			.build();
	});

	test('runtime: plugin assets accessible after build() + initialize()', async () => {
		const assetPlugin = definePlugin('asset-plugin')
			.withAssetTypes<{ mySprite: string }>()
			.install((world) => {
				world._registerAsset('mySprite', { loader: () => Promise.resolve('sprite-data'), eager: true });
			});

		const ecs = ECSpresso.create()
			.withPlugin(assetPlugin)
			.build();

		await ecs.initialize();
		const assets = ecs.getResource('$assets');
		expect(assets).toBeDefined();
		expect(assets.isLoaded('mySprite')).toBe(true);
		expect(assets.get('mySprite')).toBe('sprite-data');
	});

	test('runtime: plugin screens accessible after build() + initialize()', async () => {
		const screenPlugin = definePlugin('screen-plugin')
			.withScreenTypes<{ menu: { initialState: () => { selected: number } } }>()
			.install((world) => {
				world._registerScreen('menu', { initialState: () => ({ selected: 0 }) });
			});

		const ecs = ECSpresso.create()
			.withPlugin(screenPlugin)
			.build();

		await ecs.initialize();
		const screen = ecs.getResource('$screen');
		expect(screen).toBeDefined();
		expect(screen.current).toBeNull();
	});

	test('$assets not in ResourceTypes when no plugin assets and no withAssets()', () => {
		const plugin = definePlugin('no-assets')
			.withComponentTypes<{ a: number }>()
			.install((world) => {
				world.addSystem('sys')
					.setProcess(() => {});
			});

		const ecs = ECSpresso.create()
			.withPlugin(plugin)
			.build();

		function _typeCheck(world: typeof ecs) {
			// @ts-expect-error - $assets should not be present
			world.getResource('$assets');
		}
		void _typeCheck;
	});

	test('$screen not in ResourceTypes when no plugin screens and no withScreens()', () => {
		const plugin = definePlugin('no-screens')
			.withComponentTypes<{ a: number }>()
			.install((world) => {
				world.addSystem('sys')
					.setProcess(() => {});
			});

		const ecs = ECSpresso.create()
			.withPlugin(plugin)
			.build();

		function _typeCheck(world: typeof ecs) {
			// @ts-expect-error - $screen should not be present
			world.getResource('$screen');
		}
		void _typeCheck;
	});
});

describe('withResourceTypes', () => {
	test('withResourceTypes adds resource types to the builder', () => {
		interface Resources {
			score: number;
			config: { debug: boolean; volume: number };
		}

		const ecs = ECSpresso.create()
			.withResourceTypes<Resources>()
			.withResource('score', 0)
			.withResource('config', { debug: false, volume: 0.8 })
			.build();

		function _typeCheck(world: typeof ecs) {
			const score: number = world.getResource('score');
			const config: { debug: boolean; volume: number } = world.getResource('config');
			return { score, config };
		}
		void _typeCheck;
	});

	test('withResourceTypes validates initial values via withResource', () => {
		interface Resources {
			score: number;
		}

		ECSpresso.create()
			.withResourceTypes<Resources>()
			// @ts-expect-error - score should be number, not string
			.withResource('score', 'not a number')
			.build();
	});

	test('withResourceTypes validates string literal unions', () => {
		interface Resources {
			gameState: { status: 'ready' | 'playing' | 'paused' | 'gameOver' };
		}

		// Valid value
		ECSpresso.create()
			.withResourceTypes<Resources>()
			.withResource('gameState', { status: 'ready' as const })
			.build();

		ECSpresso.create()
			.withResourceTypes<Resources>()
			// @ts-expect-error - 'invalid' is not in the union
			.withResource('gameState', { status: 'invalid' })
			.build();
	});

	test('withResourceTypes works with factory functions', () => {
		interface Resources {
			score: number;
		}

		ECSpresso.create()
			.withResourceTypes<Resources>()
			.withResource('score', () => 42)
			.build();
	});

	test('withResourceTypes + withPlugin are compatible', () => {
		const plugin = definePlugin('phys')
			.withComponentTypes<{ pos: { x: number } }>()
			.withResourceTypes<{ physics: { gravity: number } }>()
			.install(() => {});

		const ecs = ECSpresso.create()
			.withPlugin(plugin)
			.withResourceTypes<{ score: number }>()
			.withResource('score', 0)
			.build();

		function _typeCheck(world: typeof ecs) {
			const score: number = world.getResource('score');
			const physics: { gravity: number } = world.getResource('physics');
			return { score, physics };
		}
		void _typeCheck;
	});

	test('withResourceTypes conflict detection', () => {
		const result = ECSpresso.create()
			.withResourceTypes<{ score: number }>()
			.withResourceTypes<{ score: string }>();

		// @ts-expect-error - conflicting types produce never, so build() doesn't exist
		result.build();
	});

	test('withResource for undeclared key still infers', () => {
		const ecs = ECSpresso.create()
			.withResourceTypes<{ score: number }>()
			.withResource('score', 0)
			.withResource('newThing', { foo: 'bar' })
			.build();

		function _typeCheck(world: typeof ecs) {
			const score: number = world.getResource('score');
			const newThing: { foo: string } = world.getResource('newThing');
			return { score, newThing };
		}
		void _typeCheck;
	});

	test('multiple withResourceTypes calls accumulate', () => {
		const ecs = ECSpresso.create()
			.withResourceTypes<{ score: number }>()
			.withResourceTypes<{ config: { debug: boolean } }>()
			.withResource('score', 0)
			.withResource('config', { debug: true })
			.build();

		function _typeCheck(world: typeof ecs) {
			const score: number = world.getResource('score');
			const config: { debug: boolean } = world.getResource('config');
			return { score, config };
		}
		void _typeCheck;
	});

	test('create<C,E,R>() validates withResource values against R', () => {
		interface Components {
			position: { x: number; y: number };
		}
		interface Events {
			hit: { damage: number };
		}
		interface Resources {
			config: { debug: boolean };
		}

		// Valid value passes
		ECSpresso.create<WorldConfigFrom<Components, Events, Resources>>()
			.withResource('config', { debug: true })
			.build();

		ECSpresso.create<WorldConfigFrom<Components, Events, Resources>>()
			// @ts-expect-error - wrong type for config
			.withResource('config', { debug: 'yes' })
			.build();
	});

	test('withResourceTypes + withResource with wrong shape', () => {
		interface Resources {
			config: { debug: boolean; volume: number };
		}

		ECSpresso.create()
			.withResourceTypes<Resources>()
			// @ts-expect-error - missing 'volume' field
			.withResource('config', { debug: true })
			.build();
	});

	test('withResourceTypes is a no-op at runtime', async () => {
		const ecs = ECSpresso.create()
			.withResourceTypes<{ score: number }>()
			.withResource('score', 42)
			.build();

		await ecs.initialize();
		expect(ecs.getResource('score')).toBe(42);
	});

	test('withResourceTypes + withResource provides runtime values', async () => {
		const ecs = ECSpresso.create()
			.withResourceTypes<{ score: number; config: { debug: boolean } }>()
			.withResource('score', 100)
			.withResource('config', { debug: true })
			.build();

		await ecs.initialize();
		expect(ecs.getResource('score')).toBe(100);
		expect(ecs.getResource('config').debug).toBe(true);
	});
});

describe('pluginFactory()', () => {
	test('produces type-safe definePlugin from builder state', () => {
		const base = ECSpresso.create()
			.withPlugin(createTransformPlugin())
			.withPlugin(createTimerPlugin())
			.withComponentTypes<{ player: true }>()
			.withEventTypes<{ gameStart: true }>();

		const define = base.pluginFactory();

		const testPlugin = define({
			id: 'test',
			install(world) {
				world.spawn({ ...createLocalTransform(0, 0), player: true as const });
				world.eventBus.publish('gameStart', true);
			},
		});

		const ecs = base.withPlugin(testPlugin).build();
		expect(ecs).toBeDefined();
	});

	test('rejects invalid component/event usage at compile time', () => {
		const base = ECSpresso.create()
			.withComponentTypes<{ position: { x: number; y: number } }>()
			.withEventTypes<{ hit: { damage: number } }>();

		const define = base.pluginFactory();

		define({
			id: 'valid',
			install(world) {
				world.spawn({ position: { x: 0, y: 0 } });
				world.eventBus.publish('hit', { damage: 10 });
			},
		});

		define({
			id: 'invalid',
			install(world) {
				// @ts-expect-error - 'velocity' not in accumulated types
				world.spawn({ velocity: { x: 1, y: 1 } });
			},
		});
	});
});
