import { test, expect } from 'bun:test';
import ECSpresso, { type InstallPluginParam, type PluginError } from './ecspresso';
import { definePlugin, type Plugin } from './plugin';
import type { ScreenDefinition } from './screen-types';
import type { AssetsConfig, ComponentsConfig, ConflictingSlot, EmptyConfig, EventsConfig, MissingRequirementSlot, ResourcesConfig, ScreensConfig, WorldConfigFrom } from './type-utils';

// ==================== Type-level assertion helpers ====================

function assertType<_T extends true>() {}

type IsEqual<T, U> = [T] extends [U] ? [U] extends [T] ? true : false : false;

// ==================== Fixture configs ====================

type WorldCfg = WorldConfigFrom<
	{ pos: { x: number; y: number } },
	{ click: true },
	{ db: object },
	{ img: string },
	{}
>;

type ConflictingComponents = ComponentsConfig<{ pos: { a: string } }>;
type ConflictingEvents = EventsConfig<{ click: { mouseButton: number } }>;
type ConflictingResources = ResourcesConfig<{ db: string }>;
type ConflictingAssets = AssetsConfig<{ img: number }>;

type RequiresMissingComponent = ComponentsConfig<{ missing: number }>;
type RequiresMissingEvent = EventsConfig<{ missingEvent: true }>;
type RequiresMissingResource = ResourcesConfig<{ missingResource: object }>;
type RequiresMissingAsset = AssetsConfig<{ missingAsset: string }>;
type RequiresMissingScreen = ScreensConfig<{ playing: ScreenDefinition<{ level: number }> }>;

type MixedSlotWorld = WorldConfigFrom<
	{ position: number; health: number },
	{ click: true; close: false },
	{ database: object; score: number },
	{ image: string; font: string },
	{ menu: ScreenDefinition<{ tab: string }>; game: ScreenDefinition<{ level: number }> }
>;
type MixedSlotPlugin = WorldConfigFrom<
	{ position: number; health: string },
	{ click: true; close: string },
	{ database: object; score: string },
	{ image: string; font: number },
	{ menu: ScreenDefinition<{ tab: string }>; game: ScreenDefinition<{ level: string }> }
>;
type UnionWorld = WorldConfigFrom<
	{ mode: 'idle' | 'run' },
	{ result: 'hit' | 'miss' }
>;
type LiteralWorld = WorldConfigFrom<
	{ mode: 'idle' },
	{ result: 'hit' }
>;
type CompleteWorldCfg = WorldConfigFrom<
	WorldCfg['components'],
	WorldCfg['events'],
	WorldCfg['resources'],
	WorldCfg['assets'],
	{ menu: ScreenDefinition<{ tab: string }> }
>;
type NarrowWritableWorld = WorldConfigFrom<
	{
		state: { mode: 'idle' | 'running' };
		settings: { mode: 'idle' | 'running'; enabled: boolean };
	},
	{},
	{ store: { status: 'open' | 'closed'; version: number } }
>;
type BroadWritableRequirement = ComponentsConfig<{
	state: { mode: string };
		settings: { mode: 'idle' | 'running' };
}> & ResourcesConfig<{
	store: { status: string; version: number };
}>;

// ==================== Type-level tests: failure messages ====================

test('type-level: conflicting component slot produces named error', () => {
	type Actual = InstallPluginParam<WorldCfg, ConflictingComponents, EmptyConfig, never, never, never, never>;
	type Expected = PluginError<"Plugin's components conflict with this world (same key, different type)">;
	assertType<IsEqual<Actual, Expected>>();
});

test('type-level: conflicting event slot produces named error', () => {
	type Actual = InstallPluginParam<WorldCfg, ConflictingEvents, EmptyConfig, never, never, never, never>;
	type Expected = PluginError<"Plugin's events conflict with this world (same key, different type)">;
	assertType<IsEqual<Actual, Expected>>();
});

test('type-level: conflicting resource slot produces named error', () => {
	type Actual = InstallPluginParam<WorldCfg, ConflictingResources, EmptyConfig, never, never, never, never>;
	type Expected = PluginError<"Plugin's resources conflict with this world (same key, different type)">;
	assertType<IsEqual<Actual, Expected>>();
});

test('type-level: conflicting asset slot produces named error', () => {
	type Actual = InstallPluginParam<WorldCfg, ConflictingAssets, EmptyConfig, never, never, never, never>;
	type Expected = PluginError<"Plugin's assets conflict with this world (same key, different type)">;
	assertType<IsEqual<Actual, Expected>>();
});

test('type-level: multi-slot conflict produces union of named errors', () => {
	type MultiConflict = WorldConfigFrom<{ pos: { a: string } }, { click: { mouseButton: number } }>;
	type Actual = InstallPluginParam<WorldCfg, MultiConflict, EmptyConfig, never, never, never, never>;
	type Expected =
		| PluginError<"Plugin's components conflict with this world (same key, different type)">
		| PluginError<"Plugin's events conflict with this world (same key, different type)">;
	assertType<IsEqual<Actual, Expected>>();
});

test('type-level: mixed compatible and conflicting keys reject every affected slot', () => {
	type Actual = ConflictingSlot<MixedSlotWorld, MixedSlotPlugin>;
	type Expected = 'components' | 'events' | 'resources' | 'assets' | 'screens';
	assertType<IsEqual<Actual, Expected>>();
});

test('type-level: requirements validate value types in every slot', () => {
	type Actual = MissingRequirementSlot<MixedSlotWorld, MixedSlotPlugin>;
	type Expected = 'components' | 'events' | 'resources' | 'assets' | 'screens';
	assertType<IsEqual<Actual, Expected>>();
});

test('type-level: union and literal overlaps remain exact for provided slots', () => {
	assertType<IsEqual<ConflictingSlot<UnionWorld, UnionWorld>, never>>();
	assertType<IsEqual<ConflictingSlot<UnionWorld, LiteralWorld>, 'components' | 'events'>>();
});

test('type-level: requirement values are mutually exact for literal unions', () => {
	assertType<IsEqual<MissingRequirementSlot<LiteralWorld, UnionWorld>, 'components' | 'events'>>();
	assertType<IsEqual<MissingRequirementSlot<UnionWorld, LiteralWorld>, 'components' | 'events'>>();
});

test('type-level: writable broad requirements reject narrower worlds and dropped fields', () => {
	type Actual = MissingRequirementSlot<NarrowWritableWorld, BroadWritableRequirement>;
	assertType<IsEqual<Actual, 'components' | 'resources'>>();
});

test('type-level: missing required component produces named error', () => {
	type Actual = InstallPluginParam<WorldCfg, EmptyConfig, RequiresMissingComponent, never, never, never, never>;
	type Expected = PluginError<'Plugin requires components not provided by this world'>;
	assertType<IsEqual<Actual, Expected>>();
});

test('type-level: missing required event produces named error', () => {
	type Actual = InstallPluginParam<WorldCfg, EmptyConfig, RequiresMissingEvent, never, never, never, never>;
	type Expected = PluginError<'Plugin requires events not provided by this world'>;
	assertType<IsEqual<Actual, Expected>>();
});

test('type-level: missing required resource produces named error', () => {
	type Actual = InstallPluginParam<WorldCfg, EmptyConfig, RequiresMissingResource, never, never, never, never>;
	type Expected = PluginError<'Plugin requires resources not provided by this world'>;
	assertType<IsEqual<Actual, Expected>>();
});

test('type-level: missing required asset produces named error', () => {
	type Actual = InstallPluginParam<WorldCfg, EmptyConfig, RequiresMissingAsset, never, never, never, never>;
	type Expected = PluginError<'Plugin requires assets not provided by this world'>;
	assertType<IsEqual<Actual, Expected>>();
});

test('type-level: missing required screen produces named error', () => {
	type Actual = InstallPluginParam<WorldCfg, EmptyConfig, RequiresMissingScreen, never, never, never, never>;
	type Expected = PluginError<'Plugin requires screens not provided by this world'>;
	assertType<IsEqual<Actual, Expected>>();
});

test('type-level: multi-slot missing requirements produce union of named errors', () => {
	type MultiMissing = WorldConfigFrom<{ missing: number }, { missingEvent: true }>;
	type Actual = InstallPluginParam<WorldCfg, EmptyConfig, MultiMissing, never, never, never, never>;
	type Expected =
		| PluginError<'Plugin requires components not provided by this world'>
		| PluginError<'Plugin requires events not provided by this world'>;
	assertType<IsEqual<Actual, Expected>>();
});

// ==================== Type-level tests: happy path ====================

test('type-level: compatible plugin with satisfied requirements resolves to Plugin', () => {
	type CompatibleProvide = ComponentsConfig<{ vel: { x: number; y: number } }>;
	type SatisfiedRequires = ComponentsConfig<{ pos: { x: number; y: number } }>;
	type Actual = InstallPluginParam<WorldCfg, CompatibleProvide, SatisfiedRequires, 'label', 'group', 'ag', 'rq'>;
	type Expected = Plugin<CompatibleProvide, SatisfiedRequires, 'label', 'group', 'ag', 'rq'>;
	assertType<IsEqual<Actual, Expected>>();
});

test('type-level: ScreensConfig creates a screen-only WorldConfig', () => {
	type Screens = { playing: ScreenDefinition<{ level: number }> };
	type Actual = ScreensConfig<Screens>;
	type Expected = WorldConfigFrom<{}, {}, {}, {}, Screens>;
	assertType<IsEqual<Actual, Expected>>();
});

test('type-level: slot-specific config helpers create single-slot WorldConfigs', () => {
	type Components = { position: { x: number; y: number } };
	type Events = { damaged: { amount: number } };
	type Resources = { score: { value: number } };
	type Assets = { sprite: HTMLImageElement };

	assertType<IsEqual<ComponentsConfig<Components>, WorldConfigFrom<Components>>>();
	assertType<IsEqual<EventsConfig<Events>, WorldConfigFrom<{}, Events>>>();
	assertType<IsEqual<ResourcesConfig<Resources>, WorldConfigFrom<{}, {}, Resources>>>();
	assertType<IsEqual<AssetsConfig<Assets>, WorldConfigFrom<{}, {}, {}, Assets>>>();
});

// ==================== Runtime smoke test ====================

test('runtime: installPlugin still installs a compatible plugin', () => {
	const world = ECSpresso.create().withComponentTypes<{ pos: number }>().build();
	let installed = false;
	const plugin = definePlugin('test-compat')
		.withComponentTypes<{ vel: number }>()
		.install(() => { installed = true; });
	world.installPlugin(plugin);
	expect(installed).toBe(true);
});

// ==================== Wiring test ====================
// Confirms installPlugin's overload is actually connected to InstallPluginParam.
// The type-level message-content tests above compare expected strings against
// InstallPluginParam directly; these @ts-expect-error calls prove the overload
// routes through the same logic so incompatible plugins are rejected at the
// call site.

test('wiring: installPlugin rejects incompatible plugin at call site', () => {
	const world = ECSpresso.create().withComponentTypes<{ pos: number }>().build();

	const conflictingPlugin = definePlugin('bad')
		.withComponentTypes<{ pos: string }>()
		.install(() => {});
	const invalidInstanceInstall = () => {
		// @ts-expect-error - conflicting component type should be rejected
		world.installPlugin(conflictingPlugin);
	};

	const needyPlugin = definePlugin('needy')
		.requires<ComponentsConfig<{ missing: number }>>()
		.install(() => {});
	const invalidRequiredInstall = () => {
		// @ts-expect-error - missing required component should be rejected
		world.installPlugin(needyPlugin);
	};

	const wrongRequirementPlugin = definePlugin('wrong-requirement')
		.requires<ComponentsConfig<{ pos: string }>>()
		.install(() => {});
	const invalidValueRequirementInstall = () => {
		// @ts-expect-error - a required component must have the declared value type
		world.installPlugin(wrongRequirementPlugin);
	};

	const invalidFirstInstall = () => {
		// @ts-expect-error - the first plugin must also have its requirements satisfied
		ECSpresso.create().withPlugin(needyPlugin);
	};

	expect(invalidInstanceInstall).toBeDefined();
	expect(invalidRequiredInstall).toBeDefined();
	expect(invalidValueRequirementInstall).toBeDefined();
	expect(invalidFirstInstall).toBeDefined();
	expect(true).toBe(true);
});

test('wiring: direct install rejects wrong requirement values in every slot', () => {
	const world = new ECSpresso<CompleteWorldCfg>();
	const wrongEventPlugin = definePlugin('wrong-event-call-site')
		.requires<EventsConfig<{ click: string }>>()
		.install(() => {});
	const wrongResourcePlugin = definePlugin('wrong-resource-call-site')
		.requires<ResourcesConfig<{ db: string }>>()
		.install(() => {});
	const wrongAssetPlugin = definePlugin('wrong-asset-call-site')
		.requires<AssetsConfig<{ img: number }>>()
		.install(() => {});
	const wrongScreenPlugin = definePlugin('wrong-screen-call-site')
		.requires<ScreensConfig<{ menu: ScreenDefinition<{ tab: number }> }>>()
		.install(() => {});

	const invalidEventInstall = () => {
		// @ts-expect-error - required event value type must match the world
		world.installPlugin(wrongEventPlugin);
	};
	const invalidResourceInstall = () => {
		// @ts-expect-error - required resource value type must match the world
		world.installPlugin(wrongResourcePlugin);
	};
	const invalidAssetInstall = () => {
		// @ts-expect-error - required asset value type must match the world
		world.installPlugin(wrongAssetPlugin);
	};
	const invalidScreenInstall = () => {
		// @ts-expect-error - required screen definition type must match the world
		world.installPlugin(wrongScreenPlugin);
	};

	expect(invalidEventInstall).toBeDefined();
	expect(invalidResourceInstall).toBeDefined();
	expect(invalidAssetInstall).toBeDefined();
	expect(invalidScreenInstall).toBeDefined();
});

test('wiring: builder and direct installation reject broad writable requirements', () => {
	const broadWriter = definePlugin('broad-writer')
		.requires<BroadWritableRequirement>()
		.install(() => {});

	const invalidBuilderInstall = () => {
		// @ts-expect-error - a broad writer can violate the narrow component/resource types
		ECSpresso.create<NarrowWritableWorld>().withPlugin(broadWriter);
	};
	const world = new ECSpresso<NarrowWritableWorld>();
	const invalidDirectInstall = () => {
		// @ts-expect-error - direct installation uses the same writable requirement check
		world.installPlugin(broadWriter);
	};

	expect(invalidBuilderInstall).toBeDefined();
	expect(invalidDirectInstall).toBeDefined();
});
