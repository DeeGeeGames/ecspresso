import ECSpresso, { type InstallPluginParam, type PluginError } from "./ecspresso";
import AssetManager, { AssetConfiguratorImpl, createAssetConfigurator } from "./asset-manager";
import ScreenManager, { ScreenConfiguratorImpl, createScreenConfigurator } from "./screen-manager";
import type { ResourceFactoryWithDeps, ResourceDirectValue } from "./resource-manager";
import { definePlugin, type Plugin } from "./plugin";
import type { WorldConfig, EmptyConfig, MergeConfigs, TypesAreCompatible, WithComponents, WithEvents, WithResources, WithTrackedChanges } from "./type-utils";
import type { AssetConfigurator, AssetsResource } from "./asset-types";
import type { ScreenDefinition, ScreenConfigurator, ScreenResource } from "./screen-types";

/**
 * Helper type: finalize built-in resources ($assets, $screen) in the resource map.
 * Auto-injects $assets/$screen when plugins contribute asset/screen types even without
 * explicit withAssets()/withScreens(). Also narrows the AssetGroupNames on $assets.
 */
type FinalizeBuiltinResources<Cfg extends WorldConfig, AG extends string> = {
	readonly components: Cfg['components'];
	readonly events: Cfg['events'];
	readonly resources: Omit<Cfg['resources'], '$assets' | '$screen'>
		& ([keyof Cfg['assets']] extends [never] ? {} : { $assets: AssetsResource<Cfg['assets'], AG> })
		& ([keyof Cfg['screens']] extends [never] ? {} : { $screen: ScreenResource<Cfg['screens']> });
	readonly assets: Cfg['assets'];
	readonly screens: Cfg['screens'];
	readonly trackedChanges: Cfg['trackedChanges'];
};

/**
	* Builder class for ECSpresso that provides fluent type-safe plugin installation.
	* Handles type checking during build process to ensure type safety.
*/
export class ECSpressoBuilder<
	Cfg extends WorldConfig = EmptyConfig,
	Labels extends string = never,
	Groups extends string = never,
	AssetGroupNames extends string = never,
	ReactiveQueryNames extends string = never,
> {
	/** Asset configurator for collecting asset definitions */
	private assetConfigurator: AssetConfiguratorImpl<Cfg['assets']> | null = null;
	/** Screen configurator for collecting screen definitions */
	private screenConfigurator: ScreenConfiguratorImpl<Cfg['screens']> | null = null;
	/** Pending resources to add during build */
	private pendingResources: Array<{ key: string; value: unknown }> = [];
	/** Pending dispose callbacks to register during build */
	private pendingDisposeCallbacks: Array<{ key: string; callback: (ctx: { value: unknown; entityId: number }) => void }> = [];
	/** Pending required component registrations to apply during build */
	private pendingRequiredComponents: Array<{ trigger: string; required: string; factory: (triggerValue: any) => unknown }> = [];
	/** Pending plugins to install during build */
	private pendingPlugins: Plugin<any, any, any, any, any, any>[] = [];
	/** Fixed timestep interval (null means use default 1/60) */
	private _fixedDt: number | null = null;
	/** `null` means "no `.setTrackedChanges(...)` call" → runtime keeps default track-all behavior. */
	private _trackedChanges: string[] | null = null;

	constructor() {}

	/**
		* Add the first plugin when starting with empty types.
		* This overload allows any plugin to be added to an empty ECSpresso instance.
		* Only merges the plugin's Provides (PCfg) into accumulated config, not its Requires (PReq).
	*/
	withPlugin<
		PCfg extends WorldConfig,
		PReq extends WorldConfig = EmptyConfig,
		BL extends string = never,
		BG extends string = never,
		BAG extends string = never,
		BRQ extends string = never,
	>(
		this: ECSpressoBuilder<{ readonly components: {}; readonly events: {}; readonly resources: {}; readonly assets: Cfg['assets']; readonly screens: Cfg['screens']; readonly trackedChanges: {} }, Labels, Groups, AssetGroupNames, ReactiveQueryNames>,
		plugin: Plugin<PCfg, PReq, BL, BG, BAG, BRQ>
	): ECSpressoBuilder<MergeConfigs<Cfg, PCfg>, Labels | BL, Groups | BG, AssetGroupNames | BAG, ReactiveQueryNames | BRQ>;

	/**
		* Add a subsequent plugin with type checking.
		* This overload enforces plugin type compatibility and requirement satisfaction.
		* Only merges the plugin's Provides (PCfg) into accumulated config, not its Requires (PReq).
	*/
	withPlugin<
		PCfg extends WorldConfig,
		PReq extends WorldConfig = EmptyConfig,
		BL extends string = never,
		BG extends string = never,
		BAG extends string = never,
		BRQ extends string = never,
	>(
		plugin: InstallPluginParam<Cfg, PCfg, PReq, BL, BG, BAG, BRQ>
	): ECSpressoBuilder<MergeConfigs<Cfg, PCfg>, Labels | BL, Groups | BG, AssetGroupNames | BAG, ReactiveQueryNames | BRQ>;

	/**
		* Implementation of both overloads.
		* Since the type compatibility is checked in the method signature,
		* we can safely assume the plugin is compatible here.
	*/
	withPlugin<
		PCfg extends WorldConfig,
		PReq extends WorldConfig = EmptyConfig,
		BL extends string = never,
		BG extends string = never,
		BAG extends string = never,
		BRQ extends string = never,
	>(
		plugin: Plugin<PCfg, PReq, BL, BG, BAG, BRQ> | PluginError<string>
	): ECSpressoBuilder<MergeConfigs<Cfg, PCfg>, Labels | BL, Groups | BG, AssetGroupNames | BAG, ReactiveQueryNames | BRQ> {
		// PluginError is uninhabitable at the value level — the second overload
		// only resolves to it when the argument is rejected, so the runtime path
		// always receives a real Plugin.
		this.pendingPlugins.push(plugin as Plugin<PCfg, PReq, BL, BG, BAG, BRQ>);
		return this as unknown as ECSpressoBuilder<MergeConfigs<Cfg, PCfg>, Labels | BL, Groups | BG, AssetGroupNames | BAG, ReactiveQueryNames | BRQ>;
	}

	/**
	 * Add application-specific component types to the builder chain.
	 * This is a pure type-level operation with no runtime cost.
	 * Conflicts with existing component types (same key, different type) produce a `never` return.
	 */
	withComponentTypes<T extends Record<string, any>>(): TypesAreCompatible<Cfg['components'], T> extends true
		? ECSpressoBuilder<WithComponents<Cfg, T>, Labels, Groups, AssetGroupNames, ReactiveQueryNames>
		: never;
	withComponentTypes<T extends Record<string, any>>(): ECSpressoBuilder<WithComponents<Cfg, T>, Labels, Groups, AssetGroupNames, ReactiveQueryNames> {
		return this as unknown as ECSpressoBuilder<WithComponents<Cfg, T>, Labels, Groups, AssetGroupNames, ReactiveQueryNames>;
	}

	/**
	 * Add application-specific event types to the builder chain.
	 * This is a pure type-level operation with no runtime cost.
	 * Conflicts with existing event types (same key, different type) produce a `never` return.
	 */
	withEventTypes<T extends Record<string, any>>(): TypesAreCompatible<Cfg['events'], T> extends true
		? ECSpressoBuilder<WithEvents<Cfg, T>, Labels, Groups, AssetGroupNames, ReactiveQueryNames>
		: never;
	withEventTypes<T extends Record<string, any>>(): ECSpressoBuilder<WithEvents<Cfg, T>, Labels, Groups, AssetGroupNames, ReactiveQueryNames> {
		return this as unknown as ECSpressoBuilder<WithEvents<Cfg, T>, Labels, Groups, AssetGroupNames, ReactiveQueryNames>;
	}

	/**
	 * Add application-specific resource types to the builder chain.
	 * This is a pure type-level operation with no runtime cost.
	 * Conflicts with existing resource types (same key, different type) produce a `never` return.
	 */
	withResourceTypes<T extends Record<string, any>>(): TypesAreCompatible<Cfg['resources'], T> extends true
		? ECSpressoBuilder<WithResources<Cfg, T>, Labels, Groups, AssetGroupNames, ReactiveQueryNames>
		: never;
	withResourceTypes<T extends Record<string, any>>(): ECSpressoBuilder<WithResources<Cfg, T>, Labels, Groups, AssetGroupNames, ReactiveQueryNames> {
		return this as unknown as ECSpressoBuilder<WithResources<Cfg, T>, Labels, Groups, AssetGroupNames, ReactiveQueryNames>;
	}

	/**
	 * Declare the subset of components whose changes are tracked. Components
	 * outside this set get no-op behavior from `markChangedIfTracked` and a
	 * compile error from `markChanged` / `changed:` query filters.
	 *
	 * Calling this REPLACES the tracked set (defaults to all components when
	 * not called). Use `setTrackedChanges()` with no args to track nothing.
	 *
	 * @param names Component names to track.
	 */
	setTrackedChanges<K extends keyof Cfg['components'] & string>(
		...names: K[]
	): ECSpressoBuilder<WithTrackedChanges<Cfg, K>, Labels, Groups, AssetGroupNames, ReactiveQueryNames> {
		this._trackedChanges = names.slice();
		return this as unknown as ECSpressoBuilder<WithTrackedChanges<Cfg, K>, Labels, Groups, AssetGroupNames, ReactiveQueryNames>;
	}

	/**
	 * Add a resource during ECSpresso construction.
	 *
	 * When the key matches a pre-declared resource type (via `withResourceTypes`, `create<C,E,R>()`,
	 * or plugin resources), the value is validated against that type.
	 * For new keys, the value type is inferred as before.
	 *
	 * @param key The resource key
	 * @param resource The resource value, factory function, or factory with dependencies/disposal
	 * @returns This builder with updated resource types
	 */
	withResource<K extends keyof Cfg['resources'] & string>(
		key: K,
		resource: Cfg['resources'][K] | ((context: ECSpresso<Cfg>) => Cfg['resources'][K] | Promise<Cfg['resources'][K]>) | ResourceFactoryWithDeps<Cfg['resources'][K], ECSpresso<Cfg>, keyof Cfg['resources'] & string> | ResourceDirectValue<Cfg['resources'][K]>
	): ECSpressoBuilder<Cfg, Labels, Groups, AssetGroupNames, ReactiveQueryNames>;
	withResource<K extends string, V>(
		key: K & ([K] extends [keyof Cfg['resources']] ? [V] extends [Cfg['resources'][K & keyof Cfg['resources']]] ? string : never : string),
		resource: V | ((context: ECSpresso<WithResources<Cfg, Record<K, V>>>) => V | Promise<V>) | ResourceFactoryWithDeps<V, ECSpresso<WithResources<Cfg, Record<K, V>>>, keyof (Cfg['resources'] & Record<K, V>) & string> | ResourceDirectValue<V>
	): ECSpressoBuilder<WithResources<Cfg, Record<K, V>>, Labels, Groups, AssetGroupNames, ReactiveQueryNames>;
	withResource(key: string, resource: unknown): ECSpressoBuilder<any, Labels, Groups, AssetGroupNames, ReactiveQueryNames> {
		this.pendingResources.push({ key, value: resource });
		return this as unknown as ECSpressoBuilder<any, Labels, Groups, AssetGroupNames, ReactiveQueryNames>;
	}

	/**
	 * Register a dispose callback for a component type during build.
	 * Called when a component is removed (explicit removal, entity destruction, or replacement).
	 * @param componentName The component type to register disposal for
	 * @param callback Function receiving the component value being disposed
	 * @returns This builder for method chaining
	 */
	withDispose<K extends keyof Cfg['components'] & string>(
		componentName: K,
		callback: (ctx: { value: Cfg['components'][K]; entityId: number }) => void
	): this {
		this.pendingDisposeCallbacks.push({ key: componentName, callback: callback as (ctx: { value: unknown; entityId: number }) => void });
		return this;
	}

	/**
	 * Register a required component relationship during build.
	 * When an entity gains `trigger`, the `required` component is auto-added
	 * (using `factory` for the default value) if not already present.
	 * @param trigger The component whose presence triggers auto-addition
	 * @param required The component to auto-add
	 * @param factory Function that creates the default value for the required component
	 * @returns This builder for method chaining
	 */
	withRequired<
		Trigger extends keyof Cfg['components'] & string,
		Required extends keyof Cfg['components'] & string,
	>(
		trigger: Trigger,
		required: Required,
		factory: (triggerValue: Cfg['components'][Trigger]) => Cfg['components'][Required]
	): this {
		this.pendingRequiredComponents.push({
			trigger,
			required,
			factory: factory as (triggerValue: any) => unknown,
		});
		return this;
	}

	/**
	 * Configure assets for this ECSpresso instance
	 * @param configurator Function that receives an AssetConfigurator and returns it after adding assets
	 * @returns This builder with updated asset types
	 */
	withAssets<NewA extends Record<string, unknown>, NewG extends string = never>(
		configurator: (assets: AssetConfigurator<{}, never>) => AssetConfigurator<NewA, NewG>
	): ECSpressoBuilder<{
		readonly components: Cfg['components'];
		readonly events: Cfg['events'];
		readonly resources: Cfg['resources'] & { $assets: AssetsResource<Cfg['assets'] & NewA, string> };
		readonly assets: Cfg['assets'] & NewA;
		readonly screens: Cfg['screens'];
		readonly trackedChanges: Cfg['trackedChanges'];
	}, Labels, Groups, AssetGroupNames | NewG, ReactiveQueryNames> {
		const assetConfig = createAssetConfigurator<{}, never>();
		configurator(assetConfig);
		this.assetConfigurator = assetConfig as unknown as AssetConfiguratorImpl<Cfg['assets']>;
		return this as unknown as ECSpressoBuilder<{
			readonly components: Cfg['components'];
			readonly events: Cfg['events'];
			readonly resources: Cfg['resources'] & { $assets: AssetsResource<Cfg['assets'] & NewA, string> };
			readonly assets: Cfg['assets'] & NewA;
			readonly screens: Cfg['screens'];
			readonly trackedChanges: Cfg['trackedChanges'];
		}, Labels, Groups, AssetGroupNames | NewG, ReactiveQueryNames>;
	}

	/**
	 * Configure screens for this ECSpresso instance
	 * @param configurator Function that receives a ScreenConfigurator and returns it after adding screens
	 * @returns This builder with updated screen types
	 */
	withScreens<NewS extends Record<string, ScreenDefinition<any, any>>>(
		configurator: (screens: ScreenConfigurator<{}, ECSpresso<{
			readonly components: Cfg['components'];
			readonly events: Cfg['events'];
			readonly resources: Cfg['resources'];
			readonly assets: Cfg['assets'];
			readonly screens: Record<string, ScreenDefinition>;
			readonly trackedChanges: Cfg['trackedChanges'];
		}>>) => ScreenConfigurator<NewS, ECSpresso<{
			readonly components: Cfg['components'];
			readonly events: Cfg['events'];
			readonly resources: Cfg['resources'];
			readonly assets: Cfg['assets'];
			readonly screens: Record<string, ScreenDefinition>;
			readonly trackedChanges: Cfg['trackedChanges'];
		}>>
	): ECSpressoBuilder<{
		readonly components: Cfg['components'];
		readonly events: Cfg['events'];
		readonly resources: Cfg['resources'] & { $screen: ScreenResource<Cfg['screens'] & NewS> };
		readonly assets: Cfg['assets'];
		readonly screens: Cfg['screens'] & NewS;
		readonly trackedChanges: Cfg['trackedChanges'];
	}, Labels, Groups, AssetGroupNames, ReactiveQueryNames> {
		const screenConfig = createScreenConfigurator<{}, ECSpresso<{
			readonly components: Cfg['components'];
			readonly events: Cfg['events'];
			readonly resources: Cfg['resources'];
			readonly assets: Cfg['assets'];
			readonly screens: Record<string, ScreenDefinition>;
			readonly trackedChanges: Cfg['trackedChanges'];
		}>>();
		configurator(screenConfig);
		this.screenConfigurator = screenConfig as unknown as ScreenConfiguratorImpl<Cfg['screens']>;
		return this as unknown as ECSpressoBuilder<{
			readonly components: Cfg['components'];
			readonly events: Cfg['events'];
			readonly resources: Cfg['resources'] & { $screen: ScreenResource<Cfg['screens'] & NewS> };
			readonly assets: Cfg['assets'];
			readonly screens: Cfg['screens'] & NewS;
			readonly trackedChanges: Cfg['trackedChanges'];
		}, Labels, Groups, AssetGroupNames, ReactiveQueryNames>;
	}

	/**
	 * Configure the fixed timestep interval for the fixedUpdate phase.
	 * @param dt The fixed timestep in seconds (e.g., 1/60 for 60Hz physics)
	 * @returns This builder for method chaining
	 */
	withFixedTimestep(dt: number): this {
		this._fixedDt = dt;
		return this;
	}

	/**
	 * Declare reactive query names that will be registered at runtime.
	 * This is a pure type-level operation with no runtime cost.
	 */
	withReactiveQueryNames<N extends string>(): ECSpressoBuilder<Cfg, Labels, Groups, AssetGroupNames, ReactiveQueryNames | N> {
		return this as unknown as ECSpressoBuilder<Cfg, Labels, Groups, AssetGroupNames, ReactiveQueryNames | N>;
	}

	/**
	 * Create a plugin factory from the builder's accumulated types.
	 * Returns a definePlugin equivalent with no manual type parameters.
	 */
	pluginFactory(): <
		PL extends string = never,
		PG extends string = never,
		PAG extends string = never,
		PRQ extends string = never,
	>(config: {
		id: string;
		install: (world: ECSpresso<Cfg>) => void;
	}) => Plugin<Cfg, EmptyConfig, PL, PG, PAG, PRQ> {
		return ((config: { id: string; install: (world: ECSpresso<any>) => void }) =>
			definePlugin(config.id).install(config.install)
		) as unknown as ReturnType<ECSpressoBuilder<Cfg>['pluginFactory']>;
	}

	/**
		* Complete the build process and return the built ECSpresso instance
	*/
	build(): ECSpresso<
		FinalizeBuiltinResources<Cfg, [AssetGroupNames] extends [never] ? string : AssetGroupNames>,
		[Labels] extends [never] ? string : Labels,
		[Groups] extends [never] ? string : Groups,
		[AssetGroupNames] extends [never] ? string : AssetGroupNames,
		[ReactiveQueryNames] extends [never] ? string : ReactiveQueryNames
	> {
		const ecspresso = new ECSpresso() as ECSpresso<Cfg>;

		// Apply explicit tracked-changes set before plugins install, so plugin
		// systems that declare `changed:` filters subscribe consistently.
		if (this._trackedChanges !== null) {
			ecspresso._setTrackedChanges(this._trackedChanges as Array<keyof Cfg['components']>);
		}

		// Install all pending plugins. Compatibility was already enforced at
		// withPlugin() time, so we skip the public installPlugin overload's
		// constraint via the unchecked internal path.
		for (const plugin of this.pendingPlugins) {
			ecspresso._installPluginUnchecked(plugin);
		}

		// Apply pending resources
		for (const { key, value } of this.pendingResources) {
			ecspresso.addResource(key as keyof Cfg['resources'], value as any);
		}

		// Apply pending dispose callbacks
		for (const { key, callback } of this.pendingDisposeCallbacks) {
			ecspresso.registerDispose(key as keyof Cfg['components'], callback as (ctx: { value: Cfg['components'][keyof Cfg['components']]; entityId: number }) => void);
		}

		// Apply pending required component registrations
		for (const { trigger, required, factory } of this.pendingRequiredComponents) {
			ecspresso.registerRequired(
				trigger as keyof Cfg['components'],
				required as keyof Cfg['components'],
				factory as () => Cfg['components'][keyof Cfg['components']]
			);
		}

		// Set up asset manager if configured via withAssets(), or auto-create if plugins contributed assets
		if (this.assetConfigurator) {
			ecspresso._setAssetManager(this.assetConfigurator.getManager() as unknown as AssetManager<Cfg['assets']>);
		} else if (ecspresso._hasPendingPluginAssets()) {
			ecspresso._setAssetManager(new AssetManager() as unknown as AssetManager<Cfg['assets']>);
		}

		// Set up screen manager if configured via withScreens(), or auto-create if plugins contributed screens
		if (this.screenConfigurator) {
			ecspresso._setScreenManager(this.screenConfigurator.getManager() as unknown as ScreenManager<Cfg['screens']>);
		} else if (ecspresso._hasPendingPluginScreens()) {
			ecspresso._setScreenManager(new ScreenManager() as unknown as ScreenManager<Cfg['screens']>);
		}

		// Set fixed timestep if configured
		if (this._fixedDt !== null) {
			ecspresso._setFixedDt(this._fixedDt);
		}

		return ecspresso as unknown as ECSpresso<
			FinalizeBuiltinResources<Cfg, [AssetGroupNames] extends [never] ? string : AssetGroupNames>,
			[Labels] extends [never] ? string : Labels,
			[Groups] extends [never] ? string : Groups,
			[AssetGroupNames] extends [never] ? string : AssetGroupNames,
			[ReactiveQueryNames] extends [never] ? string : ReactiveQueryNames
		>;
	}
}
