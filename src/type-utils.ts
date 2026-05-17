/**
 * Utility types for ECSpresso ECS framework
 * This file contains reusable type helpers used across the codebase
 */

import type { ScreenDefinition } from './screen-types';

/**
 * Check if two types are exactly the same for overlapping keys
 */
type ExactlyCompatible<T, U> = T extends U ? U extends T ? true : false : false;

/**
 * Check if two record types are compatible (no conflicting keys).
 * Returns true if no overlapping keys or all overlapping keys have exactly the same type.
 */
export type TypesAreCompatible<T extends Record<string, any>, U extends Record<string, any>> =
	[keyof T & keyof U] extends [never]
		? true  // No overlapping keys = compatible
		: {
			[K in keyof T & keyof U]: ExactlyCompatible<T[K], U[K]>;
		}[keyof T & keyof U] extends false
			? false
			: true;

// ==================== WorldConfig ====================

/**
 * Single config object that bundles all 5 world type dimensions.
 * Replaces the 5 positional type params (ComponentTypes, EventTypes,
 * ResourceTypes, AssetTypes, ScreenStates) throughout the codebase.
 */
export interface WorldConfig {
	readonly components: Record<string, any>;
	readonly events: Record<string, any>;
	readonly resources: Record<string, any>;
	readonly assets: Record<string, unknown>;
	readonly screens: Record<string, ScreenDefinition<any, any>>;
}

/**
 * Construct a WorldConfig from individual type dimensions.
 * All parameters default to empty records.
 */
export type WorldConfigFrom<
	C extends Record<string, any> = {},
	E extends Record<string, any> = {},
	R extends Record<string, any> = {},
	A extends Record<string, unknown> = {},
	S extends Record<string, ScreenDefinition<any, any>> = {},
> = {
	readonly components: C;
	readonly events: E;
	readonly resources: R;
	readonly assets: A;
	readonly screens: S;
};

/**
 * Empty WorldConfig with all slots defaulting to {}.
 */
export type EmptyConfig = WorldConfigFrom;

/**
 * Merge two WorldConfig types by intersecting each slot.
 */
export type MergeConfigs<A extends WorldConfig, B extends WorldConfig> = {
	readonly components: A['components'] & B['components'];
	readonly events: A['events'] & B['events'];
	readonly resources: A['resources'] & B['resources'];
	readonly assets: A['assets'] & B['assets'];
	readonly screens: A['screens'] & B['screens'];
};

// ==================== Per-slot replacement helpers ====================

export type WithComponents<Cfg extends WorldConfig, T> = {
	readonly components: Cfg['components'] & T;
	readonly events: Cfg['events'];
	readonly resources: Cfg['resources'];
	readonly assets: Cfg['assets'];
	readonly screens: Cfg['screens'];
};

export type WithEvents<Cfg extends WorldConfig, T> = {
	readonly components: Cfg['components'];
	readonly events: Cfg['events'] & T;
	readonly resources: Cfg['resources'];
	readonly assets: Cfg['assets'];
	readonly screens: Cfg['screens'];
};

export type WithResources<Cfg extends WorldConfig, T> = {
	readonly components: Cfg['components'];
	readonly events: Cfg['events'];
	readonly resources: Cfg['resources'] & T;
	readonly assets: Cfg['assets'];
	readonly screens: Cfg['screens'];
};

export type WithAssets<Cfg extends WorldConfig, T> = {
	readonly components: Cfg['components'];
	readonly events: Cfg['events'];
	readonly resources: Cfg['resources'];
	readonly assets: Cfg['assets'] & T;
	readonly screens: Cfg['screens'];
};

export type WithScreens<Cfg extends WorldConfig, T> = {
	readonly components: Cfg['components'];
	readonly events: Cfg['events'];
	readonly resources: Cfg['resources'];
	readonly assets: Cfg['assets'];
	readonly screens: Cfg['screens'] & T;
};

// ==================== Config Compatibility ====================

/**
 * Union of WorldConfig slots where A and B have conflicting types for the
 * same key. Empty (`never`) when the two configs are compatible.
 */
export type ConflictingSlot<A extends WorldConfig, B extends WorldConfig> =
	| (TypesAreCompatible<A['components'], B['components']> extends true ? never : 'components')
	| (TypesAreCompatible<A['events'], B['events']> extends true ? never : 'events')
	| (TypesAreCompatible<A['resources'], B['resources']> extends true ? never : 'resources')
	| (TypesAreCompatible<A['assets'], B['assets']> extends true ? never : 'assets')
	| (TypesAreCompatible<A['screens'], B['screens']> extends true ? never : 'screens');

/**
 * Union of WorldConfig slots where Required has keys not present in
 * Accumulated. Empty (`never`) when all requirements are satisfied.
 */
export type MissingRequirementSlot<
	Accumulated extends WorldConfig,
	Required extends WorldConfig,
> =
	| (keyof Required['components'] extends keyof Accumulated['components'] ? never : 'components')
	| (keyof Required['events'] extends keyof Accumulated['events'] ? never : 'events')
	| (keyof Required['resources'] extends keyof Accumulated['resources'] ? never : 'resources')
	| (keyof Required['assets'] extends keyof Accumulated['assets'] ? never : 'assets')
	| (keyof Required['screens'] extends keyof Accumulated['screens'] ? never : 'screens');

/**
 * Check if two WorldConfig types are compatible (no conflicting keys
 * across any slot).
 */
export type ConfigsAreCompatible<A extends WorldConfig, B extends WorldConfig> =
	[ConflictingSlot<A, B>] extends [never] ? true : false;

/**
 * Check if a Requires config is satisfied by an Accumulated config.
 * Checks all five WorldConfig slots (components, events, resources, assets, screens).
 * When Required is EmptyConfig, all slots have `keyof {} = never`,
 * and `never extends X = true`, so empty requirements are always satisfied.
 */
export type RequirementsSatisfied<
	Accumulated extends WorldConfig,
	Required extends WorldConfig,
> =
	[MissingRequirementSlot<Accumulated, Required>] extends [never] ? true : false;

/**
 * Utility type for merging two types
 */
export type Merge<T1, T2> = T1 & T2;

/**
 * Utility type for merging an array of types
 */
export type MergeAll<T extends any[]> = T extends [infer First, ...infer Rest] ?
	Rest extends [] ?
		First: Merge<First, MergeAll<Rest>>:
	{};

// ==================== Wildcard Types ====================

/**
 * Wildcard ECSpresso type that any concrete instance is assignable to.
 * Use as a generic constraint for functions that accept any ECSpresso world.
 * Matches the phantom _cfg property declared on the ECSpresso class.
 */
export type AnyECSpresso = {
	readonly _cfg: WorldConfig;
};

/**
 * Wildcard Plugin type that any concrete plugin is assignable to.
 * Matches the phantom _cfg and _requires properties declared on the Plugin interface.
 */
export type AnyPlugin = {
	readonly _cfg?: WorldConfig;
	readonly _requires?: WorldConfig;
};

// ==================== Structural Type Extraction ====================
// These use the phantom _cfg property for positional-independence.
// Works for both Plugin and ECSpresso instances since both declare
// the same phantom property.

/**
 * Extract the full WorldConfig from a Plugin or ECSpresso instance
 */
export type ConfigOf<B> =
	B extends { readonly _cfg: infer Cfg extends WorldConfig } ? Cfg : never;

/**
 * Extract the ComponentTypes from a Plugin or ECSpresso instance
 */
export type ComponentsOf<B> =
	B extends { readonly _cfg: { components: infer C extends Record<string, any> } } ? C :
	B extends { readonly _cfg?: { components: infer C extends Record<string, any> } } ? C :
	never;

/**
 * Extract the EventTypes from a Plugin or ECSpresso instance
 */
export type EventsOf<B> =
	B extends { readonly _cfg: { events: infer E extends Record<string, any> } } ? E :
	B extends { readonly _cfg?: { events: infer E extends Record<string, any> } } ? E :
	never;

/**
 * Extract the ResourceTypes from a Plugin or ECSpresso instance
 */
export type ResourcesOf<B> =
	B extends { readonly _cfg: { resources: infer R extends Record<string, any> } } ? R :
	B extends { readonly _cfg?: { resources: infer R extends Record<string, any> } } ? R :
	never;

/**
 * Extract AssetTypes from a Plugin or ECSpresso instance
 */
export type AssetTypesOf<B> =
	B extends { readonly _cfg: { assets: infer A extends Record<string, unknown> } } ? A :
	B extends { readonly _cfg?: { assets: infer A extends Record<string, unknown> } } ? A :
	never;

/**
 * Extract ScreenStates from a Plugin or ECSpresso instance
 */
export type ScreenStatesOf<B> =
	B extends { readonly _cfg: { screens: infer S extends Record<string, ScreenDefinition<any, any>> } } ? S :
	B extends { readonly _cfg?: { screens: infer S extends Record<string, ScreenDefinition<any, any>> } } ? S :
	never;

// ==================== Phantom Type Extraction ====================
// These use phantom type properties for Labels, Groups, AssetGroupNames,
// and ReactiveQueryNames from Plugin instances.

/**
 * Extract the system Labels from a Plugin instance
 */
export type LabelsOf<B> = B extends { readonly _labels?: infer L } ? L extends string ? L : never : never;

/**
 * Extract the system Groups from a Plugin instance
 */
export type GroupsOf<B> = B extends { readonly _groups?: infer G } ? G extends string ? G : never : never;

/**
 * Extract the AssetGroupNames from a Plugin instance
 */
export type AssetGroupNamesOf<B> = B extends { readonly _assetGroupNames?: infer AG } ? AG extends string ? AG : never : never;

/**
 * Extract the ReactiveQueryNames from a Plugin instance
 */
export type ReactiveQueryNamesOf<B> = B extends { readonly _reactiveQueryNames?: infer RQ } ? RQ extends string ? RQ : never : never;

// ==================== World Type Extraction ====================
// Convenience aliases that read better for ECSpresso world instances.
// Structurally identical to the *Of types above since both classes
// share the same phantom property.

/**
 * Extract ComponentTypes from an ECSpresso world instance type.
 */
export type ComponentsOfWorld<W> = W extends { readonly _cfg: { components: infer C extends Record<string, any> } } ? C : never;

/**
 * Extract EventTypes from an ECSpresso world instance type.
 */
export type EventsOfWorld<W> = W extends { readonly _cfg: { events: infer E extends Record<string, any> } } ? E : never;

/**
 * Extract AssetTypes from an ECSpresso world instance type.
 */
export type AssetsOfWorld<W> = W extends { readonly _cfg: { assets: infer A extends Record<string, unknown> } } ? A : never;

/**
 * Extract ScreenStates from an ECSpresso world instance type
 */
export type ScreenStatesOfWorld<W> = W extends { readonly _cfg: { screens: infer S extends Record<string, ScreenDefinition<any, any>> } } ? S : never;

// ==================== Event Type Utilities ====================

/**
 * Extract event names from an EventTypes record whose payload extends the given shape.
 * Eliminates the need for each plugin to define its own mapped filter type.
 *
 * @example
 * ```typescript
 * interface MyEventData { entityId: number }
 * type MyEventName<ET> = EventNameMatching<ET, MyEventData>;
 * ```
 */
export type EventNameMatching<ET extends Record<string, any>, Payload> = {
	[K in keyof ET & string]: ET[K] extends Payload ? K : never
}[keyof ET & string];

// ==================== Component Type Extraction ====================

/**
 * Extract the channel type from a world's AudioSource component.
 * Falls back to `string` if the world has no audioSource component.
 */
export type ChannelOfWorld<W> =
	W extends { readonly _cfg: { components: { audioSource: { channel: infer Ch extends string } } } }
		? Ch
		: string;
