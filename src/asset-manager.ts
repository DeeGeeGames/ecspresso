/**
 * Asset management for ECSpresso ECS framework
 */

import type EventBus from './event-bus';
import type {
	AssetStatus,
	AssetDefinition,
	AssetHandle,
	AssetsResource,
	AssetEvents,
	AssetConfigurator,
} from './asset-types';

interface AssetEntry<T> {
	definition: AssetDefinition<T>;
	status: AssetStatus;
	value?: T;
	error?: Error;
	loadPromise?: Promise<T>;
}

/**
 * Manages asset loading and access for ECSpresso
 */
export default class AssetManager<AssetTypes extends Record<string, unknown> = Record<string, never>, AssetGroupNames extends string = string> {
	private readonly assets: Map<keyof AssetTypes, AssetEntry<unknown>> = new Map();
	private readonly groups: Map<string, Set<keyof AssetTypes>> = new Map();
	private eventBus: EventBus<AssetEvents<keyof AssetTypes & string, AssetGroupNames>> | null = null;
	private closed = false;

	/**
	 * Set the event bus for asset events
	 * @internal
	 */
	setEventBus(eventBus: EventBus<AssetEvents<keyof AssetTypes & string, AssetGroupNames>>): void {
		if (this.closed) return;
		this.eventBus = eventBus;
	}

	/**
	 * Register an asset definition
	 */
	register<K extends string, T>(
		key: K,
		definition: AssetDefinition<T>
	): void {
		if (this.closed) {
			throw new Error('AssetManager is closed');
		}
		this.assets.set(key, {
			definition,
			status: 'pending',
		});

		if (definition.group) {
			const groupSet = this.groups.get(definition.group) ?? new Set();
			groupSet.add(key);
			this.groups.set(definition.group, groupSet);
		}
	}

	/**
	 * Load all assets marked as eager
	 */
	async loadEagerAssets(): Promise<void> {
		const eagerAssets: (keyof AssetTypes)[] = [];

		for (const [key, entry] of this.assets) {
			if (entry.definition.eager && entry.status === 'pending') {
				eagerAssets.push(key);
			}
		}

		await Promise.all(eagerAssets.map(key => this.loadAsset(key)));
	}

	/**
	 * Load a single asset by key
	 */
	async loadAsset<K extends keyof AssetTypes>(key: K): Promise<AssetTypes[K]> {
		if (this.closed) {
			throw new Error('AssetManager is closed');
		}
		const entry = this.assets.get(key);

		if (!entry) {
			throw new Error(`Asset '${String(key)}' not found`);
		}

		// Already loaded
		if (entry.status === 'loaded' && entry.value !== undefined) {
			return entry.value as AssetTypes[K];
		}

		// Already loading - return existing promise
		if (entry.status === 'loading' && entry.loadPromise) {
			return entry.loadPromise as Promise<AssetTypes[K]>;
		}

		// Failed - try again
		if (entry.status === 'failed') {
			entry.status = 'pending';
		}

		// Start loading
		entry.status = 'loading';
		entry.loadPromise = entry.definition.loader();

		try {
			const value = await entry.loadPromise;
			if (this.closed) {
				const error = new Error('AssetManager was closed while loading an asset');
				entry.status = 'failed';
				entry.error = error;
				entry.loadPromise = undefined;
				throw error;
			}
			entry.value = value;
			entry.status = 'loaded';
			entry.loadPromise = undefined;

			this.eventBus?.publish('assetLoaded', { key: key as keyof AssetTypes & string });
			this.checkGroupProgress(entry.definition.group);

			return value as AssetTypes[K];
		} catch (err) {
			const error = err instanceof Error ? err : new Error(String(err));
			entry.status = 'failed';
			entry.error = error;
			entry.loadPromise = undefined;

			this.eventBus?.publish('assetFailed', { key: key as keyof AssetTypes & string, error });
			throw error;
		}
	}

	/**
	 * Load all assets in a group
	 */
	async loadAssetGroup(groupName: AssetGroupNames): Promise<void> {
		const groupKeys = this.groups.get(groupName);

		if (!groupKeys || groupKeys.size === 0) {
			throw new Error(`Asset group '${groupName}' not found or empty`);
		}

		await Promise.all(
			Array.from(groupKeys).map(key => this.loadAsset(key))
		);
	}

	/**
	 * Get a loaded asset. Throws if not loaded.
	 */
	get<K extends keyof AssetTypes>(key: K): AssetTypes[K] {
		const entry = this.assets.get(key);

		if (!entry) {
			throw new Error(`Asset '${String(key)}' not found`);
		}

		if (entry.status !== 'loaded' || entry.value === undefined) {
			throw new Error(`Asset '${String(key)}' is not loaded (status: ${entry.status})`);
		}

		return entry.value as AssetTypes[K];
	}

	/**
	 * Get a loaded asset or undefined
	 */
	tryGet<K extends keyof AssetTypes>(key: K): AssetTypes[K] | undefined {
		const entry = this.assets.get(key);

		if (!entry || entry.status !== 'loaded') {
			return undefined;
		}

		return entry.value as AssetTypes[K] | undefined;
	}

	/**
	 * Get a handle to an asset with status information
	 */
	getHandle<K extends keyof AssetTypes>(key: K): AssetHandle<AssetTypes[K]> {
		const entry = this.assets.get(key);

		if (!entry) {
			throw new Error(`Asset '${String(key)}' not found`);
		}

		const manager = this;
		return {
			get status() {
				return entry.status;
			},
			get isLoaded() {
				return entry.status === 'loaded';
			},
			get() {
				return manager.get(key);
			},
			tryGet() {
				return manager.tryGet(key);
			},
		};
	}

	/**
	 * Get the status of an asset
	 */
	getStatus<K extends keyof AssetTypes>(key: K): AssetStatus {
		const entry = this.assets.get(key);

		if (!entry) {
			throw new Error(`Asset '${String(key)}' not found`);
		}

		return entry.status;
	}

	/**
	 * Check if an asset is loaded
	 */
	isLoaded<K extends keyof AssetTypes>(key: K): boolean {
		const entry = this.assets.get(key);
		return entry?.status === 'loaded';
	}

	/**
	 * Check if all assets in a group are loaded
	 */
	isGroupLoaded(groupName: AssetGroupNames): boolean {
		const groupKeys = this.groups.get(groupName);

		if (!groupKeys || groupKeys.size === 0) {
			return false;
		}

		for (const key of groupKeys) {
			const entry = this.assets.get(key);
			if (!entry || entry.status !== 'loaded') {
				return false;
			}
		}

		return true;
	}

	/**
	 * Get the loading progress of a group (0-1)
	 */
	getGroupProgress(groupName: AssetGroupNames): number {
		return this.getGroupProgressDetails(groupName).progress;
	}

	/**
	 * Get detailed group progress
	 */
	getGroupProgressDetails(groupName: AssetGroupNames): { loaded: number; total: number; progress: number } {
		const groupKeys = this.groups.get(groupName);

		if (!groupKeys || groupKeys.size === 0) {
			return { loaded: 0, total: 0, progress: 0 };
		}

		let loaded = 0;
		for (const key of groupKeys) {
			const entry = this.assets.get(key);
			if (entry?.status === 'loaded') {
				loaded++;
			}
		}

		const total = groupKeys.size;
		return { loaded, total, progress: loaded / total };
	}

	/**
	 * Check group progress and emit events
	 */
	private checkGroupProgress(groupName: string | undefined): void {
		if (!groupName || !this.eventBus) return;

		const group = groupName as AssetGroupNames;
		const details = this.getGroupProgressDetails(group);

		this.eventBus.publish('assetGroupProgress', {
			group,
			...details,
		});

		if (details.loaded === details.total) {
			this.eventBus.publish('assetGroupLoaded', { group });
		}
	}

	/**
	 * Create the $assets resource object
	 */
	createResource(): AssetsResource<AssetTypes, AssetGroupNames> {
		const manager = this;
		return {
			getStatus<K extends keyof AssetTypes>(key: K): AssetStatus {
				return manager.getStatus(key);
			},
			isLoaded<K extends keyof AssetTypes>(key: K): boolean {
				return manager.isLoaded(key);
			},
			isGroupLoaded(groupName: AssetGroupNames): boolean {
				return manager.isGroupLoaded(groupName);
			},
			getGroupProgress(groupName: AssetGroupNames): number {
				return manager.getGroupProgress(groupName);
			},
			get<K extends keyof AssetTypes>(key: K): AssetTypes[K] {
				return manager.get(key);
			},
			tryGet<K extends keyof AssetTypes>(key: K): AssetTypes[K] | undefined {
				return manager.tryGet(key);
			},
			getHandle<K extends keyof AssetTypes>(key: K): AssetHandle<AssetTypes[K]> {
				return manager.getHandle(key);
			},
		};
	}

	/**
	 * Get all registered asset keys
	 */
	getKeys(): Array<keyof AssetTypes> {
		return Array.from(this.assets.keys());
	}

	/**
	 * Get all group names
	 */
	getGroupNames(): string[] {
		return Array.from(this.groups.keys());
	}

	/**
	 * Get all asset keys in a group
	 */
	getGroupKeys(groupName: string): Array<keyof AssetTypes> {
		const groupKeys = this.groups.get(groupName);
		return groupKeys ? Array.from(groupKeys) : [];
	}

	/** @internal Stop in-flight loads from publishing or reactivating the manager. */
	close(): void {
		this.closed = true;
		this.eventBus = null;
	}

	/** @internal Release definitions and dependency references after world teardown. */
	clear(): void {
		this.assets.clear();
		this.groups.clear();
		this.eventBus = null;
	}
}

/**
 * Implementation of AssetConfigurator for builder pattern
 */
export class AssetConfiguratorImpl<
	Assets extends Record<string, unknown> = {},
	AssetGroups extends string = never,
> implements AssetConfigurator<Assets, AssetGroups> {
	private readonly manager: AssetManager<Assets, AssetGroups>;

	constructor(manager: AssetManager<Assets, AssetGroups>) {
		this.manager = manager;
	}

	add<K extends string, T>(
		key: K,
		loader: () => Promise<T>
	): AssetConfigurator<Assets & Record<K, T>, AssetGroups> {
		this.manager.register(key, { loader, eager: true });
		return this as unknown as AssetConfigurator<Assets & Record<K, T>, AssetGroups>;
	}

	addWithConfig<K extends string, T>(
		key: K,
		definition: AssetDefinition<T>
	): AssetConfigurator<Assets & Record<K, T>, AssetGroups> {
		this.manager.register(key, definition);
		return this as unknown as AssetConfigurator<Assets & Record<K, T>, AssetGroups>;
	}

	addGroup<GN extends string, T extends Record<string, () => Promise<unknown>>>(
		groupName: GN,
		assets: T
	): AssetConfigurator<Assets & { [K in keyof T]: Awaited<ReturnType<T[K]>> }, AssetGroups | GN> {
		for (const [key, loader] of Object.entries(assets)) {
			this.manager.register(key, {
				loader: loader as () => Promise<unknown>,
				eager: false,
				group: groupName,
			});
		}
		return this as unknown as AssetConfigurator<Assets & { [K in keyof T]: Awaited<ReturnType<T[K]>> }, AssetGroups | GN>;
	}

	/**
	 * Get the underlying manager
	 * @internal
	 */
	getManager(): AssetManager<Assets, AssetGroups> {
		return this.manager;
	}
}

/**
 * Create a new AssetConfigurator for builder pattern usage
 */
export function createAssetConfigurator<
	Assets extends Record<string, unknown> = {},
	AssetGroups extends string = never,
>(
	manager?: AssetManager<Assets, AssetGroups>
): AssetConfiguratorImpl<Assets, AssetGroups> {
	return new AssetConfiguratorImpl(manager ?? new AssetManager<Assets, AssetGroups>());
}
