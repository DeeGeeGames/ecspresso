/**
 * Screen/State management for ECSpresso ECS framework
 */

import type EventBus from './event-bus';
import { createDeferred } from './cleanup-control';
import type {
	ScreenDefinition,
	ScreenResource,
	ScreenEvents,
	ScreenConfigurator,
	ScreenStackEntry,
	ScreenConfig,
	ScreenState,
} from './screen-types';

/** Structural interface covering only the AssetManager methods ScreenManager uses. */
interface ScreenManagerAssetDeps {
	isLoaded(key: string): boolean;
	loadAsset(key: string): Promise<unknown>;
	isGroupLoaded(group: string): boolean;
	loadAssetGroup(group: string): Promise<void>;
}

/** Store definitions with W erased to `unknown` so callbacks accept unknown ecs. */
type ErasedDefinition = ScreenDefinition<any, any, unknown>;

interface ScreenEntry {
	definition: ErasedDefinition;
}

interface ActiveScreen<Screens extends Record<string, ScreenDefinition<any, any>>> {
	name: keyof Screens;
	config: Record<string, unknown>;
	state: Record<string, unknown>;
}

/**
 * Manages screen/state transitions for ECSpresso
 */
export default class ScreenManager<Screens extends Record<string, ScreenDefinition<any, any>> = Record<string, never>> {
	private readonly screens: Map<keyof Screens, ScreenEntry> = new Map();
	private currentScreen: ActiveScreen<Screens> | null = null;
	private screenStack: Array<ActiveScreen<Screens>> = [];

	private eventBus: EventBus<ScreenEvents<keyof Screens & string>> | null = null;
	private assetManager: ScreenManagerAssetDeps | null = null;
	private ecs: unknown = null;
	private closed = false;
	private readonly pendingHooks = new Set<Promise<void>>();
	private readonly teardownErrors: unknown[] = [];
	private readonly exitedScreens = new WeakSet<ActiveScreen<Screens>>();

	/** Register before invoking user code, which may synchronously start teardown. */
	private runHook(callback: () => void | Promise<void>): Promise<void> {
		const deferred = createDeferred<void>();
		const tracked = deferred.promise.then(
			() => undefined,
			(error: unknown) => {
				if (this.closed) this.teardownErrors.push(error);
			},
		);
		this.pendingHooks.add(tracked);
		void tracked.then(() => this.pendingHooks.delete(tracked));
		try {
			deferred.resolve(callback());
		} catch (error) {
			deferred.reject(error);
		}
		return deferred.promise;
	}

	/**
	 * Set dependencies for screen transitions
	 * @internal
	 */
	setDependencies(
		eventBus: EventBus<ScreenEvents<keyof Screens & string>>,
		assetManager: ScreenManagerAssetDeps | null,
		ecs: unknown
	): void {
		this.eventBus = eventBus;
		this.assetManager = assetManager;
		this.ecs = ecs;
	}

	private requireEcs(): unknown {
		if (!this.ecs) throw new Error('ScreenManager: dependencies not set. Call setDependencies() first.');
		return this.ecs;
	}

	/**
	 * Register a screen definition
	 */
	register<K extends string, Config extends Record<string, unknown>, State extends Record<string, unknown>>(
		name: K,
		definition: ScreenDefinition<Config, State>
	): void {
		if (this.closed) {
			throw new Error('ScreenManager is closed');
		}
		this.screens.set(name, { definition: definition as ErasedDefinition });
	}

	/**
	 * Transition to a new screen, clearing the stack
	 */
	async setScreen<K extends keyof Screens>(
		name: K,
		config: Screens[K] extends ScreenDefinition<infer C, any> ? C : never
	): Promise<void> {
		if (this.closed) {
			throw new Error('ScreenManager is closed');
		}
		const entry = this.screens.get(name);

		if (!entry) {
			throw new Error(`Screen '${String(name)}' not found`);
		}

		// Verify required assets
		await this.verifyRequiredAssets(entry.definition.requiredAssets, entry.definition.requiredAssetGroups);
		if (this.closed) {
			throw new Error('ScreenManager is closed');
		}

		// Exit all screens in stack (bottom to top order)
		while (this.screenStack.length > 0) {
			const stackScreen = this.screenStack.pop();
			if (stackScreen) {
				await this.exitScreen(stackScreen);
				if (this.closed) throw new Error('ScreenManager is closed');
			}
		}

		// Exit current screen
		if (this.currentScreen) {
			await this.exitScreen(this.currentScreen);
			if (this.closed) throw new Error('ScreenManager is closed');
		}

		// Enter new screen
		const state = entry.definition.initialState(config);
		this.currentScreen = {
			name,
			config: config as Record<string, unknown>,
			state,
		};

		await this.runHook(() => entry.definition.onEnter?.({ config, ecs: this.requireEcs() }));
		if (this.closed) throw new Error('ScreenManager is closed');
		this.eventBus?.publish('screenEnter', { screen: name as keyof Screens & string, config });
	}

	/**
	 * Push a screen onto the stack (overlay)
	 */
	async pushScreen<K extends keyof Screens>(
		name: K,
		config: Screens[K] extends ScreenDefinition<infer C, any> ? C : never
	): Promise<void> {
		if (this.closed) {
			throw new Error('ScreenManager is closed');
		}
		const entry = this.screens.get(name);

		if (!entry) {
			throw new Error(`Screen '${String(name)}' not found`);
		}

		// Verify required assets
		await this.verifyRequiredAssets(entry.definition.requiredAssets, entry.definition.requiredAssetGroups);
		if (this.closed) {
			throw new Error('ScreenManager is closed');
		}

		// Push current screen to stack
		if (this.currentScreen) {
			this.screenStack.push(this.currentScreen);
		}

		// Enter new screen
		const state = entry.definition.initialState(config);
		this.currentScreen = {
			name,
			config: config as Record<string, unknown>,
			state,
		};

		await this.runHook(() => entry.definition.onEnter?.({ config, ecs: this.requireEcs() }));
		if (this.closed) throw new Error('ScreenManager is closed');
		this.eventBus?.publish('screenPush', { screen: name as keyof Screens & string, config });
	}

	/**
	 * Pop the current screen and return to the previous one
	 */
	async popScreen(): Promise<void> {
		if (this.closed) {
			throw new Error('ScreenManager is closed');
		}
		if (this.screenStack.length === 0) {
			throw new Error('Cannot pop screen: stack is empty');
		}

		// Exit current screen
		if (this.currentScreen) {
			const exitingScreen = this.currentScreen;
			await this.exitScreen(exitingScreen);
			if (this.closed) throw new Error('ScreenManager is closed');
			this.eventBus?.publish('screenPop', { screen: exitingScreen.name as keyof Screens & string });
		}

		// Restore previous screen from stack
		const resumedScreen = this.screenStack.pop();
		this.currentScreen = resumedScreen ?? null;

		if (!resumedScreen) return;

		const entry = this.screens.get(resumedScreen.name);
		await this.runHook(() => entry?.definition.onResume?.({
			config: resumedScreen.config,
			state: resumedScreen.state,
			ecs: this.requireEcs(),
		}));
		if (this.closed) throw new Error('ScreenManager is closed');
		this.eventBus?.publish('screenResume', {
			screen: resumedScreen.name as keyof Screens & string,
			config: resumedScreen.config,
			state: resumedScreen.state,
		});
	}

	/**
	 * Exit an activation once, including when teardown overlaps a transition.
	 */
	private async exitScreen(screen: ActiveScreen<Screens>): Promise<void> {
		if (this.exitedScreens.has(screen)) return;
		this.exitedScreens.add(screen);
		const name = screen.name;
		const entry = this.screens.get(name);
		if (entry?.definition.onExit) {
			await this.runHook(() => entry.definition.onExit?.(this.requireEcs()));
		}
		this.eventBus?.publish('screenExit', { screen: name as keyof Screens & string });
	}

	/**
	 * Verify required assets are loaded before screen transition
	 */
	private async verifyRequiredAssets(
		assets?: ReadonlyArray<string>,
		groups?: ReadonlyArray<string>,
	): Promise<void> {
		if (!this.assetManager) return;

		if (assets) {
			for (const assetKey of assets) {
				if (!this.assetManager.isLoaded(assetKey)) {
					await this.assetManager.loadAsset(assetKey);
				}
			}
		}

		if (groups) {
			for (const groupName of groups) {
				if (!this.assetManager.isGroupLoaded(groupName)) {
					await this.assetManager.loadAssetGroup(groupName);
				}
			}
		}
	}

	/**
	 * Get the current screen name
	 */
	getCurrentScreen(): keyof Screens | null {
		return this.currentScreen?.name ?? null;
	}

	/**
	 * Get the current screen config (immutable).
	 * If `screen` is provided, asserts that the current screen matches.
	 */
	getConfig(screen?: keyof Screens): Readonly<ScreenConfig<Screens[keyof Screens]>> {
		if (!this.currentScreen) {
			throw new Error('No current screen');
		}
		if (screen !== undefined && this.currentScreen.name !== screen) {
			throw new Error(`Expected current screen '${String(screen)}', but current is '${String(this.currentScreen.name)}'`);
		}
		return this.currentScreen.config as Readonly<ScreenConfig<Screens[keyof Screens]>>;
	}

	/**
	 * Get the current screen config or undefined.
	 * If `screen` is provided, returns undefined when the current screen doesn't match.
	 */
	tryGetConfig(screen?: keyof Screens): Readonly<ScreenConfig<Screens[keyof Screens]>> | undefined {
		if (!this.currentScreen) return undefined;
		if (screen !== undefined && this.currentScreen.name !== screen) return undefined;
		return this.currentScreen.config as Readonly<ScreenConfig<Screens[keyof Screens]>>;
	}

	/**
	 * Get the current screen state (mutable).
	 * If `screen` is provided, asserts that the current screen matches.
	 */
	getState(screen?: keyof Screens): ScreenState<Screens[keyof Screens]> {
		if (!this.currentScreen) {
			throw new Error('No current screen');
		}
		if (screen !== undefined && this.currentScreen.name !== screen) {
			throw new Error(`Expected current screen '${String(screen)}', but current is '${String(this.currentScreen.name)}'`);
		}
		return this.currentScreen.state as ScreenState<Screens[keyof Screens]>;
	}

	/**
	 * Get the current screen state or undefined.
	 * If `screen` is provided, returns undefined when the current screen doesn't match.
	 */
	tryGetState(screen?: keyof Screens): ScreenState<Screens[keyof Screens]> | undefined {
		if (!this.currentScreen) return undefined;
		if (screen !== undefined && this.currentScreen.name !== screen) return undefined;
		return this.currentScreen.state as ScreenState<Screens[keyof Screens]>;
	}

	/**
	 * Update the current screen state.
	 * If `screen` is provided, asserts that the current screen matches.
	 */
	updateState(update: unknown, screen?: keyof Screens): void {
		if (!this.currentScreen) {
			throw new Error('No current screen');
		}
		if (screen !== undefined && this.currentScreen.name !== screen) {
			throw new Error(`Expected current screen '${String(screen)}', but current is '${String(this.currentScreen.name)}'`);
		}

		const partial = typeof update === 'function'
			? (update as (current: Record<string, unknown>) => Record<string, unknown>)(this.currentScreen.state)
			: update;

		this.currentScreen.state = {
			...this.currentScreen.state,
			...(partial as Record<string, unknown>),
		};
	}

	/**
	 * Get the screen stack depth
	 */
	getStackDepth(): number {
		return this.screenStack.length;
	}

	/**
	 * Check if current screen is an overlay
	 */
	isOverlay(): boolean {
		return this.screenStack.length > 0;
	}

	/**
	 * Check if a screen is active (current or in stack)
	 */
	isActive(screenName: keyof Screens): boolean {
		if (this.currentScreen?.name === screenName) {
			return true;
		}
		return this.screenStack.some(s => s.name === screenName);
	}

	/**
	 * Check if a screen is the current screen
	 */
	isCurrent(screenName: keyof Screens): boolean {
		return this.currentScreen?.name === screenName;
	}

	/**
	 * Create the $screen resource object
	 */
	createResource(): ScreenResource<Screens> {
		const manager = this;
		return {
			get current(): keyof Screens | null {
				return manager.getCurrentScreen();
			},
			get config(): Readonly<ScreenConfig<Screens[keyof Screens]>> | null {
				return manager.tryGetConfig() ?? null;
			},
			get state(): ScreenState<Screens[keyof Screens]> | null {
				return manager.tryGetState() ?? null;
			},
			set state(value: ScreenState<Screens[keyof Screens]> | null) {
				if (manager.currentScreen && value !== null) {
					manager.currentScreen.state = value as Record<string, unknown>;
				}
			},
			get stack(): ReadonlyArray<ScreenStackEntry<Screens>> {
				return manager.screenStack as unknown as ReadonlyArray<ScreenStackEntry<Screens>>;
			},
			get isOverlay(): boolean {
				return manager.isOverlay();
			},
			get stackDepth(): number {
				return manager.getStackDepth();
			},
			isActive(screenName: keyof Screens): boolean {
				return manager.isActive(screenName);
			},
			isCurrent(screenName: keyof Screens): boolean {
				return manager.isCurrent(screenName);
			},
		};
	}

	/**
	 * Get all registered screen names
	 */
	getScreenNames(): Array<keyof Screens> {
		return Array.from(this.screens.keys());
	}

	/**
	 * Check if a screen is registered
	 */
	hasScreen(name: keyof Screens): boolean {
		return this.screens.has(name);
	}

	/** @internal Stop transitions while the enclosing world is disposing. */
	close(): void {
		this.closed = true;
	}

	/**
	 * Exit active screens during enclosing-world disposal. Screen-exit events are
	 * best-effort here because the world event bus is already closed; the world
	 * separately removes all entities and screen-scope registrations.
	 */
	async dispose(): Promise<void> {
		this.close();
		// Entry/resume may still acquire external state. Finish them before exit,
		// and join an exit already underway rather than invoking it twice.
		await Promise.all(this.pendingHooks);
		const activeScreens = [
			...(this.currentScreen ? [this.currentScreen] : []),
			...this.screenStack.slice().reverse(),
		];
		const errors: unknown[] = [];
		for (const screen of activeScreens) {
			try {
				await this.exitScreen(screen);
			} catch {
				// runHook records failures during teardown; keep removing screens.
			}
		}
		this.currentScreen = null;
		this.screenStack = [];
		errors.push(...this.teardownErrors);
		this.teardownErrors.length = 0;
		if (errors.length > 0) {
			throw new AggregateError(errors, 'One or more screens failed to exit');
		}
	}

	/** @internal Release screen definitions, active state, and world references. */
	clear(): void {
		this.screens.clear();
		this.currentScreen = null;
		this.screenStack = [];
		this.eventBus = null;
		this.assetManager = null;
		this.ecs = null;
	}
}

/**
 * Implementation of ScreenConfigurator for builder pattern
 */
export class ScreenConfiguratorImpl<Screens extends Record<string, ScreenDefinition<any, any>>, W = unknown> implements ScreenConfigurator<Screens, W> {
	private readonly manager: ScreenManager<Screens>;

	constructor(manager: ScreenManager<Screens>) {
		this.manager = manager;
	}

	add<K extends string, Config extends Record<string, unknown>, State extends Record<string, unknown>>(
		name: K,
		definition: ScreenDefinition<Config, State, W>
	): ScreenConfigurator<Screens & Record<K, ScreenDefinition<Config, State, W>>, W> {
		this.manager.register(name, definition as ScreenDefinition<Config, State>);
		return this as unknown as ScreenConfigurator<Screens & Record<K, ScreenDefinition<Config, State, W>>, W>;
	}

	/**
	 * Get the underlying manager
	 * @internal
	 */
	getManager(): ScreenManager<Screens> {
		return this.manager;
	}
}

/**
 * Create a new ScreenConfigurator for builder pattern usage
 */
export function createScreenConfigurator<Screens extends Record<string, ScreenDefinition<any, any>> = Record<string, never>, W = unknown>(
	manager?: ScreenManager<Screens>
): ScreenConfiguratorImpl<Screens, W> {
	return new ScreenConfiguratorImpl<Screens, W>(manager ?? new ScreenManager<Screens>());
}
