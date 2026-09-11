import type ECSpresso from './ecspresso';
import type { SystemPhase } from './types';
import type { SystemDefaults } from './system-registrar';
import type {
	WorldConfig,
	EmptyConfig,
	MergeConfigs,
	WithComponents,
	WithEvents,
	WithResources,
	WithAssets,
	WithScreens,
} from './type-utils';

/**
 * Registrar passed as the second argument to a plugin's `install` function.
 * Each registered disposer runs (in reverse order) when the plugin is
 * uninstalled via `world.uninstallPlugin(id)` or when `world.dispose()` is called.
 * Disposers may return promises; world disposal awaits them.
 */
export type PluginCleanup = (() => void) | (() => Promise<void>);
export type PluginCleanupRegistrar = (fn: PluginCleanup) => void;

/**
 * Plugin interface for ECSpresso. A plugin is a plain object with an `install`
 * function that configures a world directly, plus phantom properties for
 * compile-time type extraction.
 *
 * @typeParam Cfg - The WorldConfig this plugin provides (components, events, resources, etc.)
 * @typeParam Requires - The WorldConfig this plugin requires from other plugins
 */
export interface Plugin<
	Cfg extends WorldConfig = EmptyConfig,
	Requires extends WorldConfig = EmptyConfig,
	Labels extends string = never,
	Groups extends string = never,
	AssetGroupNames extends string = never,
	ReactiveQueryNames extends string = never,
> {
	readonly id: string;
	readonly install: (world: ECSpresso<MergeConfigs<Cfg, Requires>>, onCleanup: PluginCleanupRegistrar) => void;
	/**
	 * Default system configuration applied to every `world.addSystem(...)` call
	 * made inside the plugin's install function. Explicit per-system calls
	 * override. Set via `PluginBuilder.setSystemDefaults(...)`.
	 */
	readonly systemDefaults?: SystemDefaults<MergeConfigs<Cfg, Requires>>;
	// Phantom type for structural extraction (never set at runtime)
	readonly _cfg?: Cfg;
	readonly _requires?: Requires;
	// Phantom types for positional extraction (never set at runtime)
	readonly _labels?: Labels;
	readonly _groups?: Groups;
	readonly _assetGroupNames?: AssetGroupNames;
	readonly _reactiveQueryNames?: ReactiveQueryNames;
}

/**
 * Common configuration options shared by most plugins.
 * Plugin-specific options interfaces extend this with additional fields.
 */
export interface BasePluginOptions<G extends string = string> {
	/** System group name for all systems registered by this plugin */
	systemGroup?: G;
	/** Priority for the plugin's primary system (default varies per plugin) */
	priority?: number;
	/** Execution phase for the plugin's primary system */
	phase?: SystemPhase;
}

/**
 * Fluent builder for defining plugins. Mirrors `ECSpressoBuilder`'s
 * type-accumulator pattern: each `.withXxx<T>()` call threads `T` into the
 * appropriate WorldConfig slot at the type level, with no runtime cost.
 *
 * Terminal call is `.install(fn)` which returns the finalized `Plugin<...>`.
 *
 * @example
 * ```typescript
 * const myPlugin = definePlugin('my-plugin')
 *   .withComponentTypes<MyComponents>()
 *   .withEventTypes<MyEvents>()
 *   .withResourceTypes<MyResources>()
 *   .install((world) => {
 *     world.addSystem('foo').setProcess(() => {});
 *   });
 * ```
 */
export class PluginBuilder<
	Cfg extends WorldConfig = EmptyConfig,
	Requires extends WorldConfig = EmptyConfig,
	Labels extends string = never,
	Groups extends string = never,
	AssetGroupNames extends string = never,
	ReactiveQueryNames extends string = never,
> {
	constructor(private readonly _id: string) {}

	private _systemDefaults?: SystemDefaults<MergeConfigs<Cfg, Requires>>;

	/**
	 * Set defaults applied to every system created via `world.addSystem(...)`
	 * inside this plugin's install function. Calling again replaces the
	 * previous defaults wholesale (not merge). Per-system builder calls
	 * override defaults.
	 */
	setSystemDefaults(
		defaults: SystemDefaults<MergeConfigs<Cfg, Requires>>,
	): this {
		this._systemDefaults = defaults;
		return this;
	}

	/**
	 * Declare component types this plugin provides.
	 * Pure type-level operation with no runtime cost.
	 */
	withComponentTypes<T extends Record<string, any>>(): PluginBuilder<
		WithComponents<Cfg, T>,
		Requires,
		Labels,
		Groups,
		AssetGroupNames,
		ReactiveQueryNames
	> {
		return this as unknown as PluginBuilder<
			WithComponents<Cfg, T>,
			Requires,
			Labels,
			Groups,
			AssetGroupNames,
			ReactiveQueryNames
		>;
	}

	/**
	 * Declare event types this plugin provides.
	 * Pure type-level operation with no runtime cost.
	 */
	withEventTypes<T extends Record<string, any>>(): PluginBuilder<
		WithEvents<Cfg, T>,
		Requires,
		Labels,
		Groups,
		AssetGroupNames,
		ReactiveQueryNames
	> {
		return this as unknown as PluginBuilder<
			WithEvents<Cfg, T>,
			Requires,
			Labels,
			Groups,
			AssetGroupNames,
			ReactiveQueryNames
		>;
	}

	/**
	 * Declare resource types this plugin provides.
	 * Pure type-level operation with no runtime cost.
	 */
	withResourceTypes<T extends Record<string, any>>(): PluginBuilder<
		WithResources<Cfg, T>,
		Requires,
		Labels,
		Groups,
		AssetGroupNames,
		ReactiveQueryNames
	> {
		return this as unknown as PluginBuilder<
			WithResources<Cfg, T>,
			Requires,
			Labels,
			Groups,
			AssetGroupNames,
			ReactiveQueryNames
		>;
	}

	/**
	 * Declare asset types this plugin provides.
	 * Pure type-level operation with no runtime cost.
	 */
	withAssetTypes<T extends Record<string, unknown>>(): PluginBuilder<
		WithAssets<Cfg, T>,
		Requires,
		Labels,
		Groups,
		AssetGroupNames,
		ReactiveQueryNames
	> {
		return this as unknown as PluginBuilder<
			WithAssets<Cfg, T>,
			Requires,
			Labels,
			Groups,
			AssetGroupNames,
			ReactiveQueryNames
		>;
	}

	/**
	 * Declare screen types this plugin provides.
	 * Pure type-level operation with no runtime cost.
	 */
	withScreenTypes<T extends Record<string, any>>(): PluginBuilder<
		WithScreens<Cfg, T>,
		Requires,
		Labels,
		Groups,
		AssetGroupNames,
		ReactiveQueryNames
	> {
		return this as unknown as PluginBuilder<
			WithScreens<Cfg, T>,
			Requires,
			Labels,
			Groups,
			AssetGroupNames,
			ReactiveQueryNames
		>;
	}

	/**
	 * Declare system labels this plugin registers.
	 * Pure type-level operation with no runtime cost.
	 */
	withLabels<L extends string>(): PluginBuilder<
		Cfg,
		Requires,
		Labels | L,
		Groups,
		AssetGroupNames,
		ReactiveQueryNames
	> {
		return this as unknown as PluginBuilder<
			Cfg,
			Requires,
			Labels | L,
			Groups,
			AssetGroupNames,
			ReactiveQueryNames
		>;
	}

	/**
	 * Declare system groups this plugin uses.
	 * Pure type-level operation with no runtime cost.
	 */
	withGroups<G extends string>(): PluginBuilder<
		Cfg,
		Requires,
		Labels,
		Groups | G,
		AssetGroupNames,
		ReactiveQueryNames
	> {
		return this as unknown as PluginBuilder<
			Cfg,
			Requires,
			Labels,
			Groups | G,
			AssetGroupNames,
			ReactiveQueryNames
		>;
	}

	/**
	 * Declare asset group names this plugin uses.
	 * Pure type-level operation with no runtime cost.
	 */
	withAssetGroupNames<N extends string>(): PluginBuilder<
		Cfg,
		Requires,
		Labels,
		Groups,
		AssetGroupNames | N,
		ReactiveQueryNames
	> {
		return this as unknown as PluginBuilder<
			Cfg,
			Requires,
			Labels,
			Groups,
			AssetGroupNames | N,
			ReactiveQueryNames
		>;
	}

	/**
	 * Declare reactive query names this plugin registers.
	 * Pure type-level operation with no runtime cost.
	 */
	withReactiveQueryNames<N extends string>(): PluginBuilder<
		Cfg,
		Requires,
		Labels,
		Groups,
		AssetGroupNames,
		ReactiveQueryNames | N
	> {
		return this as unknown as PluginBuilder<
			Cfg,
			Requires,
			Labels,
			Groups,
			AssetGroupNames,
			ReactiveQueryNames | N
		>;
	}

	/**
	 * Declare dependencies this plugin requires from other plugins.
	 * Accepts a pre-built `WorldConfig` type (typically a named alias like
	 * `TransformWorldConfig`). The install callback will see these types
	 * merged into its world parameter.
	 * Pure type-level operation with no runtime cost.
	 */
	requires<R extends WorldConfig>(): PluginBuilder<
		Cfg,
		R,
		Labels,
		Groups,
		AssetGroupNames,
		ReactiveQueryNames
	> {
		return this as unknown as PluginBuilder<
			Cfg,
			R,
			Labels,
			Groups,
			AssetGroupNames,
			ReactiveQueryNames
		>;
	}

	/**
	 * Terminal method. Provide the install function and receive the finalized
	 * `Plugin<...>` object. The install function receives a world typed as
	 * `ECSpresso<MergeConfigs<Cfg, Requires>>` — meaning it can use both the
	 * types this plugin provides and the types it declared via `.requires<>()`.
	 */
	install(
		install: (world: ECSpresso<MergeConfigs<Cfg, Requires>>, onCleanup: PluginCleanupRegistrar) => void
	): Plugin<Cfg, Requires, Labels, Groups, AssetGroupNames, ReactiveQueryNames> {
		return {
			id: this._id,
			install,
			...(this._systemDefaults ? { systemDefaults: this._systemDefaults } : {}),
		} as Plugin<Cfg, Requires, Labels, Groups, AssetGroupNames, ReactiveQueryNames>;
	}
}

/**
 * Entry point for the fluent plugin builder. Pass the plugin id and chain
 * type-accumulator methods, terminating with `.install(fn)`.
 *
 * @example
 * ```typescript
 * const myPlugin = definePlugin('my-plugin')
 *   .withComponentTypes<MyComponents>()
 *   .withResourceTypes<MyResources>()
 *   .install((world) => { ... });
 * ```
 */
export function definePlugin(id: string): PluginBuilder {
	return new PluginBuilder(id);
}
