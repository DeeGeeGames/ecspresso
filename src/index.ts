import ECSpresso from './ecspresso';
import { SystemBuilder, type ProcessContext, type SystemDetachFn, type SystemLifecycleFn, type SystemProcessFn } from './system-builder';
import { type Plugin, type BasePluginOptions, type PluginCleanup, type PluginCleanupRegistrar, definePlugin } from './plugin';

export * from './types';
export * from './asset-types';
export * from './screen-types';
export * from './utils/math';
export type { ReactiveQueryDefinition, ReactiveQueryEnterContext, ReactiveQueryExitContext } from './reactive-query-manager';
export { default as AssetManager, createAssetConfigurator } from './asset-manager';
export { default as ScreenManager, createScreenConfigurator } from './screen-manager';
export { SystemBuilder, type ProcessContext, type SystemDetachFn, type SystemLifecycleFn, type SystemProcessFn };
export { type Plugin, type BasePluginOptions, type PluginCleanup, type PluginCleanupRegistrar, definePlugin };
export type { CleanupControl } from './cleanup-control';
export type { SystemDefaults, SystemRegistrar, SystemRegistrarOf } from './system-registrar';
export { defineSystemRef, type SystemRef, type SystemOrderingOptions } from './system-ref';
export { directValue, type ResourceDirectValue } from './resource-manager';
export default ECSpresso;
