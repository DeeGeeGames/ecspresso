/**
 * 2D Renderer Plugin for ECSpresso
 *
 * An opt-in PixiJS-based 2D rendering plugin that automates scene graph wiring.
 * Import from 'ecspresso/plugins/rendering/renderer2D'
 *
 * This plugin includes transform propagation automatically.
 */

import type { Application, ApplicationOptions, Container, Sprite, Graphics } from 'pixi.js';
import { definePlugin, type Plugin } from 'ecspresso';
import type { ComponentsConfig, EmptyConfig, EventsConfig, ResourcesConfig, WorldConfig } from '../../type-utils';
import type ECSpresso from 'ecspresso';
import {
	createTransformPlugin,
	type LocalTransform,
	type WorldTransform,
	type TransformComponentTypes,
	type TransformPluginOptions,
} from 'ecspresso/plugins/spatial/transform';
import { createBounds, type BoundsRect } from 'ecspresso/plugins/spatial/bounds';
import type { CameraResourceTypes, CameraState } from 'ecspresso/plugins/spatial/camera';

// Re-export transform and bounds types for convenience
export type { LocalTransform, WorldTransform, TransformComponentTypes };
export type { BoundsRect };
export { createTransform, createLocalTransform, createWorldTransform, DEFAULT_LOCAL_TRANSFORM, DEFAULT_WORLD_TRANSFORM } from 'ecspresso/plugins/spatial/transform';

// Dynamic import for Application to avoid requiring pixi.js at plugin creation time
// when using managed mode (pixiInit options instead of pre-initialized app)
async function createPixiApplication(options: Partial<ApplicationOptions>): Promise<Application> {
	const { Application } = await import('pixi.js');
	const app = new Application();
	await app.init({
		preference: 'webgpu',
		...options,
	});
	return app;
}

// ==================== Component Types ====================

/**
 * Visibility and alpha component
 */
export interface Visible {
	visible: boolean;
	alpha?: number;
}

/**
 * Aggregate component types for the 2D renderer plugin.
 * Included automatically via `.withPlugin(createRenderer2DPlugin({ ... }))`.
 *
 * @example
 * ```typescript
 * const ecs = ECSpresso.create()
 *   .withPlugin(createRenderer2DPlugin({ ... }))
 *   .withComponentTypes<{ velocity: { x: number; y: number }; player: true }>()
 *   .build();
 * ```
 */
export interface Renderer2DComponentTypes extends TransformComponentTypes {
	sprite: Sprite;
	graphics: Graphics;
	container: Container;
	visible: Visible;
	/** Assigns the entity to a named render layer for z-ordering */
	renderLayer: string;
}

// ==================== Event Types ====================

/**
 * Events emitted by the 2D renderer plugin
 */
export interface Renderer2DEventTypes {
	hierarchyChanged: {
		entityId: number;
		oldParent: number | null;
		newParent: number | null;
	};
}

// ==================== Resource Types ====================

/**
 * Resources provided by the 2D renderer plugin
 */
export interface Renderer2DResourceTypes {
	pixiApp: Application;
	rootContainer: Container;
	/** Screen bounds derived from PixiJS screen dimensions, updated on resize */
	bounds: BoundsRect;
}

// ==================== Scale Mode Types ====================

export type ScaleMode = 'fit' | 'cover' | 'stretch';

export interface ScreenScaleOptions {
	readonly width: number;
	readonly height: number;
	readonly mode?: ScaleMode;
}

export interface ViewportScale {
	scaleX: number;
	scaleY: number;
	offsetX: number;
	offsetY: number;
	physicalWidth: number;
	physicalHeight: number;
	/** Current scale mode. Mutable — call `reapplyViewportScale(pixiApp)` after changing to re-apply immediately. */
	mode: ScaleMode;
	readonly designWidth: number;
	readonly designHeight: number;
}

export interface ViewportScaleResourceTypes {
	viewportScale: ViewportScale;
}

// ==================== Plugin Options ====================

/**
 * Common options shared between both initialization modes
 */
interface Renderer2DPluginCommonOptions<G extends string = 'renderer2d'> {
	/** Optional custom root container (defaults to app.stage) */
	rootContainer?: Container;
	/** System group name (default: 'renderer2d') */
	systemGroup?: G;
	/** Priority for render sync system (default: 500) */
	renderSyncPriority?: number;
	/** Options for the included transform plugin */
	transform?: TransformPluginOptions;
	/** When true, wires up pixiApp.ticker to drive ecs.update() automatically (default: true) */
	startLoop?: boolean;
	/** Ordered render layer names (back-to-front). Entities with a renderLayer component are placed in the corresponding container. */
	renderLayers?: string[];
	/** Render layers that should not be affected by camera transforms.
	 *  These layers are placed outside rootContainer so camera zoom/pan/rotation does not apply.
	 *  Only relevant when `camera: true`. Layer names listed here must also appear in `renderLayers`. */
	screenSpaceLayers?: string[];
	/** Automatically apply cameraState resource to rootContainer each frame.
	 *  Requires the camera plugin to be installed. (default: false) */
	camera?: boolean;
	/** Enforce a logical design resolution with automatic aspect-ratio-aware scaling.
	 *  When set, systems work in design-resolution coordinate space. */
	screenScale?: ScreenScaleOptions;
}

/**
 * Options when providing a pre-initialized PixiJS Application
 */
export interface Renderer2DPluginAppOptions<G extends string = 'renderer2d'> extends Renderer2DPluginCommonOptions<G> {
	/** The PixiJS Application instance (already initialized) */
	app: Application;
	pixiInit?: never;
	container?: never;
	background?: never;
	width?: never;
	height?: never;
}

/**
 * Options when letting the plugin create and manage the PixiJS Application
 */
export interface Renderer2DPluginManagedOptions<G extends string = 'renderer2d'> extends Renderer2DPluginCommonOptions<G> {
	app?: never;
	/** Container element to append the canvas to (or CSS selector string). Defaults to `document.body`.
	 *  The canvas also auto-resizes to this element unless `width`/`height` are set or `pixiInit.resizeTo` is set explicitly. */
	container?: HTMLElement | string;
	/** Canvas background color. */
	background?: ApplicationOptions['background'];
	/** Fixed canvas width. When set (with `height`), the canvas is fixed-size and the auto-resize default is suppressed. */
	width?: ApplicationOptions['width'];
	/** Fixed canvas height. When set (with `width`), the canvas is fixed-size and the auto-resize default is suppressed. */
	height?: ApplicationOptions['height'];
	/** Escape hatch for raw PixiJS ApplicationOptions not otherwise exposed at the top level.
	 *  Top-level fields (`background`, `width`, `height`) take precedence when both are set. */
	pixiInit?: Partial<ApplicationOptions>;
}

/**
 * Configuration options for the 2D renderer plugin.
 *
 * Supports two modes:
 * 1. **Pre-initialized**: Pass an already-initialized Application via `app`
 * 2. **Managed**: Omit `app` and the plugin creates the Application during `ecs.initialize()`.
 *    The canvas is appended to `container` (defaults to `document.body`) and auto-resizes to
 *    match it. Pass `pixiInit: { width, height }` for a fixed-size canvas instead.
 *
 * This plugin includes transform propagation automatically - no need to add createTransformPlugin() separately.
 *
 * @example Pre-initialized mode (full control)
 * ```typescript
 * const app = new Application();
 * await app.init({ resizeTo: window });
 * const ecs = ECSpresso.create()
 *   .withPlugin(createRenderer2DPlugin({ app }))
 *   .withComponentTypes<{ player: true }>()
 *   .build();
 * ```
 *
 * @example Managed mode (convenience)
 * ```typescript
 * const ecs = ECSpresso.create()
 *   .withPlugin(createRenderer2DPlugin({
 *     background: '#1099bb',
 *   }))
 *   .withComponentTypes<{ player: true }>()
 *   .build();
 * await ecs.initialize(); // Application created here
 * ```
 */
export type Renderer2DPluginOptions<G extends string = 'renderer2d'> = Renderer2DPluginAppOptions<G> | Renderer2DPluginManagedOptions<G>;

// ==================== Helper Utilities ====================

interface PositionOption {
	x?: number;
	y?: number;
}

interface TransformOptions {
	rotation?: number;
	scale?: number | { x: number; y: number };
	visible?: boolean;
	alpha?: number;
}

function createTransformInternal(
	position?: PositionOption,
	options?: TransformOptions
): LocalTransform & WorldTransform {
	const scaleValue = options?.scale;
	const scaleX = typeof scaleValue === 'number'
		? scaleValue
		: scaleValue?.x ?? 1;
	const scaleY = typeof scaleValue === 'number'
		? scaleValue
		: scaleValue?.y ?? 1;

	return {
		x: position?.x ?? 0,
		y: position?.y ?? 0,
		rotation: options?.rotation ?? 0,
		scaleX,
		scaleY,
	};
}

function createVisibleComponent(options?: TransformOptions): Visible {
	return {
		visible: options?.visible ?? true,
		alpha: options?.alpha,
	};
}

/**
 * Create components for a sprite entity.
 * Returns an object suitable for spreading into spawn().
 *
 * @example
 * ```typescript
 * const player = ecs.spawn({
 *   ...createSpriteComponents(new Sprite(texture), { x: 100, y: 100 }),
 *   velocity: { x: 0, y: 0 },
 * });
 * ```
 */
export function createSpriteComponents(
	sprite: Sprite,
	position?: PositionOption,
	options?: TransformOptions & { anchor?: { x: number; y: number } }
): Pick<Renderer2DComponentTypes, 'sprite' | 'localTransform' | 'worldTransform' | 'visible'> {
	if (options?.anchor) {
		sprite.anchor.set(options.anchor.x, options.anchor.y);
	}
	return {
		sprite,
		localTransform: createTransformInternal(position, options),
		worldTransform: createTransformInternal(position, options),
		visible: createVisibleComponent(options),
	};
}

/**
 * Create components for a graphics entity.
 * Returns an object suitable for spreading into spawn().
 *
 * @example
 * ```typescript
 * const rect = ecs.spawn({
 *   ...createGraphicsComponents(graphics, { x: 50, y: 50 }),
 * });
 * ```
 */
export function createGraphicsComponents(
	graphics: Graphics,
	position?: PositionOption,
	options?: TransformOptions
): Pick<Renderer2DComponentTypes, 'graphics' | 'localTransform' | 'worldTransform' | 'visible'> {
	return {
		graphics,
		localTransform: createTransformInternal(position, options),
		worldTransform: createTransformInternal(position, options),
		visible: createVisibleComponent(options),
	};
}

/**
 * Create components for a container entity.
 * Returns an object suitable for spreading into spawn().
 *
 * @example
 * ```typescript
 * const group = ecs.spawn({
 *   ...createContainerComponents(new Container(), { x: 0, y: 0 }),
 * });
 * ```
 */
export function createContainerComponents(
	container: Container,
	position?: PositionOption,
	options?: TransformOptions
): Pick<Renderer2DComponentTypes, 'container' | 'localTransform' | 'worldTransform' | 'visible'> {
	return {
		container,
		localTransform: createTransformInternal(position, options),
		worldTransform: createTransformInternal(position, options),
		visible: createVisibleComponent(options),
	};
}

// ==================== Viewport Scale Utilities ====================

const scaleModeStrategy: Record<ScaleMode, (ratioX: number, ratioY: number) => { scaleX: number; scaleY: number }> = {
	fit: (ratioX, ratioY) => {
		const s = Math.min(ratioX, ratioY);
		return { scaleX: s, scaleY: s };
	},
	cover: (ratioX, ratioY) => {
		const s = Math.max(ratioX, ratioY);
		return { scaleX: s, scaleY: s };
	},
	stretch: (ratioX, ratioY) => ({ scaleX: ratioX, scaleY: ratioY }),
};

export function computeViewportScale(
	physicalW: number,
	physicalH: number,
	designW: number,
	designH: number,
	mode: ScaleMode,
): ViewportScale {
	const ratioX = physicalW / designW;
	const ratioY = physicalH / designH;
	const { scaleX, scaleY } = scaleModeStrategy[mode](ratioX, ratioY);

	return {
		scaleX,
		scaleY,
		offsetX: (physicalW - designW * scaleX) / 2,
		offsetY: (physicalH - designH * scaleY) / 2,
		physicalWidth: physicalW,
		physicalHeight: physicalH,
		mode,
		designWidth: designW,
		designHeight: designH,
	};
}

/**
 * Convert physical canvas pixel coordinates to design-resolution (logical) coordinates.
 * Compose with camera `screenToWorld()` for full physical→world conversion.
 */
export function physicalToLogical(
	physicalX: number,
	physicalY: number,
	viewport: ViewportScale,
): { x: number; y: number } {
	return {
		x: (physicalX - viewport.offsetX) / viewport.scaleX,
		y: (physicalY - viewport.offsetY) / viewport.scaleY,
	};
}

/**
 * Convert a DOM pointer event's client coordinates to design-resolution (logical) coordinates.
 * Handles canvas offset, CSS-pixel to physical-pixel scaling, and viewport letterbox/crop offsets.
 * Suitable for wiring into the input plugin's `coordinateTransform` option.
 */
export function clientToLogical(
	clientX: number,
	clientY: number,
	canvas: HTMLCanvasElement,
	viewport: ViewportScale,
): { x: number; y: number } {
	const rect = canvas.getBoundingClientRect();
	const physicalX = (clientX - rect.left) * (viewport.physicalWidth / rect.width);
	const physicalY = (clientY - rect.top) * (viewport.physicalHeight / rect.height);
	return physicalToLogical(physicalX, physicalY, viewport);
}

/**
 * Re-apply the current viewport scale using the latest `mode` from the `viewportScale` resource.
 * Call after mutating `viewportScale.mode` to take effect immediately without waiting for a window resize.
 */
export function reapplyViewportScale(pixiApp: Application): void {
	pixiApp.renderer.emit('resize', pixiApp.screen.width, pixiApp.screen.height, pixiApp.renderer.resolution);
}

// ==================== Plugin Factory ====================

/**
 * Create a 2D rendering plugin for ECSpresso.
 *
 * This plugin provides:
 * - Transform propagation (localTransform -> worldTransform)
 * - Render sync system (updates PixiJS objects from ECS components)
 * - Scene graph management (mirrors ECS hierarchy in PixiJS scene graph)
 *
 * Managed mode owns and destroys its PixiJS application when the world is
 * disposed. With a supplied application, the caller retains application
 * ownership. Display objects and their textures remain caller-owned in both
 * modes; the plugin detaches them without destroying shared GPU assets.
 *
 * @example Pre-initialized mode
 * ```typescript
 * const app = new Application();
 * await app.init({ resizeTo: window });
 *
 * const ecs = ECSpresso.create<GameComponents, {}, {}>()
 *   .withPlugin(createRenderer2DPlugin({ app }))
 *   .build();
 * ```
 *
 * @example Managed mode
 * ```typescript
 * const ecs = ECSpresso.create<GameComponents, {}, {}>()
 *   .withPlugin(createRenderer2DPlugin({
 *     background: '#1099bb',
 *   }))
 *   .build();
 * await ecs.initialize();
 * ```
 */
type Renderer2DLabels = 'renderer2d-sync' | 'renderer2d-scene-graph' | 'renderer2d-camera-sync' | 'transform-propagation';
type Renderer2DReactiveQueryNames = 'renderer2d-sprites' | 'renderer2d-graphics' | 'renderer2d-containers';
type Renderer2DWorldConfig<R extends WorldConfig['resources'] = Renderer2DResourceTypes> =
	ComponentsConfig<Renderer2DComponentTypes>
	& EventsConfig<Renderer2DEventTypes>
	& ResourcesConfig<R>;

export function createRenderer2DPlugin<G extends string = 'renderer2d'>(
	options: Renderer2DPluginOptions<G> & { screenScale: ScreenScaleOptions; camera: true }
): Plugin<Renderer2DWorldConfig<Renderer2DResourceTypes & ViewportScaleResourceTypes & CameraResourceTypes>, EmptyConfig, Renderer2DLabels, G, never, Renderer2DReactiveQueryNames>;
export function createRenderer2DPlugin<G extends string = 'renderer2d'>(
	options: Renderer2DPluginOptions<G> & { screenScale: ScreenScaleOptions }
): Plugin<Renderer2DWorldConfig<Renderer2DResourceTypes & ViewportScaleResourceTypes>, EmptyConfig, Renderer2DLabels, G, never, Renderer2DReactiveQueryNames>;
export function createRenderer2DPlugin<G extends string = 'renderer2d'>(
	options: Renderer2DPluginOptions<G> & { camera: true }
): Plugin<Renderer2DWorldConfig<Renderer2DResourceTypes & CameraResourceTypes>, EmptyConfig, Renderer2DLabels, G, never, Renderer2DReactiveQueryNames>;
export function createRenderer2DPlugin<G extends string = 'renderer2d'>(
	options: Renderer2DPluginOptions<G>
): Plugin<Renderer2DWorldConfig, EmptyConfig, Renderer2DLabels, G, never, Renderer2DReactiveQueryNames>;
export function createRenderer2DPlugin<G extends string = 'renderer2d'>(
	options: Renderer2DPluginOptions<G> & { camera?: boolean; screenScale?: ScreenScaleOptions }
): Plugin<Renderer2DWorldConfig, EmptyConfig, Renderer2DLabels, G, never, Renderer2DReactiveQueryNames>
| Plugin<Renderer2DWorldConfig<Renderer2DResourceTypes & CameraResourceTypes>, EmptyConfig, Renderer2DLabels, G, never, Renderer2DReactiveQueryNames>
| Plugin<Renderer2DWorldConfig<Renderer2DResourceTypes & ViewportScaleResourceTypes>, EmptyConfig, Renderer2DLabels, G, never, Renderer2DReactiveQueryNames>
| Plugin<Renderer2DWorldConfig<Renderer2DResourceTypes & ViewportScaleResourceTypes & CameraResourceTypes>, EmptyConfig, Renderer2DLabels, G, never, Renderer2DReactiveQueryNames> {
	const {
		rootContainer: customRootContainer,
		systemGroup = 'renderer2d',
		renderSyncPriority = 500,
		transform: transformOptions,
		startLoop = true,
		renderLayers = [],
		screenSpaceLayers = [],
		camera = false,
		screenScale,
	} = options;

	const hasScreenScale = screenScale !== undefined;
	const designWidth = screenScale?.width ?? 0;
	const designHeight = screenScale?.height ?? 0;
	const screenScaleMode: ScaleMode = screenScale?.mode ?? 'fit';

	type PluginResourceTypes = Renderer2DResourceTypes & ViewportScaleResourceTypes;
	type PluginECS = ECSpresso<Renderer2DWorldConfig<PluginResourceTypes>>;

	// Determine mode: pre-initialized if an Application instance was provided, otherwise managed
	const isManaged = !('app' in options && options.app !== undefined);

	return definePlugin('renderer2d')
		.withComponentTypes<Renderer2DComponentTypes>()
		.withEventTypes<Renderer2DEventTypes>()
		.withResourceTypes<PluginResourceTypes>()
		.withLabels<Renderer2DLabels>()
		.withGroups<G>()
		.withReactiveQueryNames<Renderer2DReactiveQueryNames>()
		.install((world) => {
			// Entity ID -> PixiJS Container mapping for scene graph management
			const entityToPixiObject = new Map<number, Container>();

			// Render layer name -> PixiJS Container mapping
			const layerContainers = new Map<string, Container>();
			const pluginContainers = new Set<Container>();
			const screenSpaceLayerSet = new Set(screenSpaceLayers);
			let detachRendererHooks = () => {};
			let detachSceneGraphEvents = () => {};

			function disposePluginContainers(): void {
				Array.from(pluginContainers).reverse().forEach((container) => {
					container.removeFromParent();
					container.destroy({ children: false });
				});
				pluginContainers.clear();
				layerContainers.clear();
				entityToPixiObject.clear();
				screenSpaceParent = null;
			}

			// Container constructor captured during initialization via dynamic import
			// Used by getOrCreateLayerContainer for lazy layer creation
			let createLayerContainer: (label: string) => Container = () => {
				throw new Error('renderer2D: createLayerContainer called before initialization');
			};

			// Parent container for screen-space layers (set during init when camera + screenSpaceLayers)
			let screenSpaceParent: Container | null = null;

			// Helper to get or create a render layer container
			function getOrCreateLayerContainer(
				layerName: string,
				rootCont: Container
			): Container {
				const existing = layerContainers.get(layerName);
				if (existing) return existing;

				// Lazy-create for undeclared layers, appended to end
				const cont = createLayerContainer(`layer:${layerName}`);
				pluginContainers.add(cont);
				layerContainers.set(layerName, cont);
				const parent = (screenSpaceParent && screenSpaceLayerSet.has(layerName))
					? screenSpaceParent
					: rootCont;
				parent.addChild(cont);
				return cont;
			}

			// Helper to resolve the target container for an entity.
			// Scene graph stays flat (rootContainer or render layer) because the render
			// sync positions objects using absolute worldTransform.  Nesting under a
			// parent's display object would double-apply the parent's transform.
			function resolveTargetContainer(
				entityId: number,
				ecs: PluginECS
			): Container {
				const rootCont = ecs.getResource('rootContainer');

				// 1. Check render layer component
				const layerName = ecs.getComponent(entityId, 'renderLayer');
				if (layerName) return getOrCreateLayerContainer(layerName, rootCont);

				// 2. Fall back to root container
				return rootCont;
			}

			// Helper to add a PixiJS object to the scene graph
			function addToSceneGraph(
				entityId: number,
				pixiObject: Container,
				ecs: PluginECS
			): void {
				const targetContainer = resolveTargetContainer(entityId, ecs);

				// Only add if not already a child
				if (pixiObject.parent !== targetContainer) {
					targetContainer.addChild(pixiObject);
				}
			}

			// Helper to update parent in scene graph
			function updateSceneGraphParent(
				entityId: number,
				ecs: PluginECS
			): void {
				const pixiObject = entityToPixiObject.get(entityId);
				if (!pixiObject) return;

				const targetContainer = resolveTargetContainer(entityId, ecs);

				if (pixiObject.parent !== targetContainer) {
					pixiObject.removeFromParent();
					targetContainer.addChild(pixiObject);
				}
			}

			// Install transform plugin (deduplicates if already installed)
			world.installPlugin(createTransformPlugin(transformOptions));

			// Register resources based on mode
			if (isManaged) {
				const managedOptions = options as Renderer2DPluginManagedOptions<G>;
				const { pixiInit, background, width, height } = managedOptions;
				const containerOption = managedOptions.container ?? document.body;

				const containerEl: HTMLElement | null = typeof containerOption === 'string'
					? document.querySelector<HTMLElement>(containerOption)
					: containerOption;

				// Top-level background/width/height override pixiInit equivalents.
				const mergedPixiInit: Partial<ApplicationOptions> = {
					...pixiInit,
					...(background !== undefined && { background }),
					...(width !== undefined && { width }),
					...(height !== undefined && { height }),
				};

				// Default resizeTo to the resolved container unless the caller opted into a
				// fixed-size canvas via width/height, or set pixiInit.resizeTo directly.
				const shouldDefaultResizeTo = containerEl !== null
					&& mergedPixiInit.resizeTo === undefined
					&& mergedPixiInit.width === undefined
					&& mergedPixiInit.height === undefined;

				const finalInitOptions: Partial<ApplicationOptions> = {
					...mergedPixiInit,
					...(shouldDefaultResizeTo && { resizeTo: containerEl }),
				};

				world.addResource('pixiApp', {
					factory: async () => {
						const app = await createPixiApplication(finalInitOptions);

						if (containerEl) {
							containerEl.appendChild(app.canvas);
						} else if (typeof containerOption === 'string') {
							console.warn(`Renderer2D plugin: container selector "${containerOption}" not found`);
						}

						return app;
					},
					onDispose: (app) => {
						detachRendererHooks();
						disposePluginContainers();
						app.destroy({ removeView: true }, { children: false });
					},
				});

				world.addResource('rootContainer', {
					dependsOn: ['pixiApp'],
					factory: (ecs) => customRootContainer ?? ecs.getResource('pixiApp').stage,
				});

				world.addResource('bounds', {
					dependsOn: ['pixiApp'],
					factory: (ecs) => {
						if (hasScreenScale) return createBounds(designWidth, designHeight);
						const pixiApp = ecs.getResource('pixiApp');
						return createBounds(pixiApp.screen.width, pixiApp.screen.height);
					},
				});

				if (hasScreenScale) {
					world.addResource('viewportScale', {
						dependsOn: ['pixiApp'],
						factory: (ecs) => {
							const pixiApp = ecs.getResource('pixiApp');
							return computeViewportScale(pixiApp.screen.width, pixiApp.screen.height, designWidth, designHeight, screenScaleMode);
						},
					});
				}
			} else {
				const app = (options as Renderer2DPluginAppOptions<G>).app;
				world.addResource('pixiApp', {
					factory: () => app,
					onDispose: () => {
						detachRendererHooks();
						disposePluginContainers();
					},
				});
				world.addResource('rootContainer', customRootContainer ?? app.stage);
				world.addResource('bounds', hasScreenScale
					? createBounds(designWidth, designHeight)
					: createBounds(app.screen.width, app.screen.height));

				if (hasScreenScale) {
					world.addResource('viewportScale',
						computeViewportScale(app.screen.width, app.screen.height, designWidth, designHeight, screenScaleMode));
				}
			}

			// Register dispose callbacks for display object components
			world.registerDispose('sprite', ({ value: sprite }) => {
				sprite.removeFromParent();
			});
			world.registerDispose('graphics', ({ value: graphics }) => {
				graphics.removeFromParent();
			});
			world.registerDispose('container', ({ value: container }) => {
				container.removeFromParent();
			});

			// Display objects require localTransform and visible
			world.registerRequired('sprite', 'localTransform', () => createTransformInternal());
			world.registerRequired('sprite', 'visible', () => createVisibleComponent());
			world.registerRequired('graphics', 'localTransform', () => createTransformInternal());
			world.registerRequired('graphics', 'visible', () => createVisibleComponent());
			world.registerRequired('container', 'localTransform', () => createTransformInternal());
			world.registerRequired('container', 'visible', () => createVisibleComponent());

			// ==================== Render Sync System ====================
			world
				.addSystem('renderer2d-sync')
				.setPriority(renderSyncPriority)
				.inPhase('render')
				.inGroup(systemGroup)
				.addQuery('sprites', {
					with: ['sprite', 'worldTransform', 'visible'],
					changed: ['worldTransform'],
				})
				.addQuery('graphics', {
					with: ['graphics', 'worldTransform', 'visible'],
					changed: ['worldTransform'],
				})
				.addQuery('containers', {
					with: ['container', 'worldTransform', 'visible'],
					changed: ['worldTransform'],
				})
				.setProcess(({ queries }) => {
					for (const entity of queries.sprites) {
						const { sprite, worldTransform, visible: vis } = entity.components;
						sprite.position.set(worldTransform.x, worldTransform.y);
						sprite.rotation = worldTransform.rotation;
						sprite.scale.set(worldTransform.scaleX, worldTransform.scaleY);
						sprite.visible = vis.visible;
						if (vis.alpha !== undefined) sprite.alpha = vis.alpha;
					}

					for (const entity of queries.graphics) {
						const { graphics, worldTransform, visible: vis } = entity.components;
						graphics.position.set(worldTransform.x, worldTransform.y);
						graphics.rotation = worldTransform.rotation;
						graphics.scale.set(worldTransform.scaleX, worldTransform.scaleY);
						graphics.visible = vis.visible;
						if (vis.alpha !== undefined) graphics.alpha = vis.alpha;
					}

					for (const entity of queries.containers) {
						const { container, worldTransform, visible: vis } = entity.components;
						container.position.set(worldTransform.x, worldTransform.y);
						container.rotation = worldTransform.rotation;
						container.scale.set(worldTransform.scaleX, worldTransform.scaleY);
						container.visible = vis.visible;
						if (vis.alpha !== undefined) container.alpha = vis.alpha;
					}
				});

			// ==================== Scene Graph Manager System ====================
			world
				.addSystem('renderer2d-scene-graph')
				.setPriority(9999)
				.inGroup(systemGroup)
				.setOnInitialize(async (ecs) => {
					const pixiApp = ecs.getResource('pixiApp');
					let rootCont = ecs.getResource('rootContainer');

					const { Container: ContainerClass } = await import('pixi.js');
					createLayerContainer = (label: string) => {
						const cont = new ContainerClass();
						cont.label = label;
						pluginContainers.add(cont);
						return cont;
					};

					let viewportContainer: Container | undefined;
					if (hasScreenScale) {
						viewportContainer = new ContainerClass();
						pluginContainers.add(viewportContainer);
						viewportContainer.label = 'viewportContainer';

						const vs = ecs.tryGetResource('viewportScale');
						if (!vs) throw new Error('renderer2D: viewportScale resource not found');
						viewportContainer.position.set(vs.offsetX, vs.offsetY);
						viewportContainer.scale.set(vs.scaleX, vs.scaleY);

						const newRoot = new ContainerClass();
						pluginContainers.add(newRoot);
						newRoot.label = 'rootContainer';

						pixiApp.stage.addChild(viewportContainer);
						viewportContainer.addChild(newRoot);

						ecs.updateResource('rootContainer', () => newRoot);
						rootCont = newRoot;
					}

					// When camera + screenSpaceLayers are active, ensure rootContainer is
					// not the stage itself so camera transforms don't affect screen-space layers.
					if (camera && screenSpaceLayerSet.size > 0) {
						if (rootCont === pixiApp.stage) {
							const worldContainer = new ContainerClass();
							pluginContainers.add(worldContainer);
							worldContainer.label = 'rootContainer';
							pixiApp.stage.addChild(worldContainer);
							ecs.updateResource('rootContainer', () => worldContainer);
							rootCont = worldContainer;
						}
						// Screen-space layers are siblings of rootContainer
						screenSpaceParent = rootCont.parent ?? pixiApp.stage;
					}

					for (const layerName of renderLayers) {
						getOrCreateLayerContainer(layerName, rootCont);
					}

					ecs.addReactiveQuery('renderer2d-sprites', {
						with: ['sprite'],
						onEnter: ({ entity }) => {
							const pixiObject = entity.components.sprite;
							entityToPixiObject.set(entity.id, pixiObject);
							addToSceneGraph(entity.id, pixiObject, ecs);
						},
						onExit: ({ entityId }) => {
							entityToPixiObject.delete(entityId);
						},
					});

					ecs.addReactiveQuery('renderer2d-graphics', {
						with: ['graphics'],
						onEnter: ({ entity }) => {
							const pixiObject = entity.components.graphics;
							entityToPixiObject.set(entity.id, pixiObject);
							addToSceneGraph(entity.id, pixiObject, ecs);
						},
						onExit: ({ entityId }) => {
							entityToPixiObject.delete(entityId);
						},
					});

					ecs.addReactiveQuery('renderer2d-containers', {
						with: ['container'],
						onEnter: ({ entity }) => {
							const pixiObject = entity.components.container;
							entityToPixiObject.set(entity.id, pixiObject);
							addToSceneGraph(entity.id, pixiObject, ecs);
						},
						onExit: ({ entityId }) => {
							entityToPixiObject.delete(entityId);
						},
					});

					const unsubscribeHierarchy = ecs.on('hierarchyChanged', ({ entityId }) => {
						updateSceneGraphParent(entityId, ecs);
					});

					const unsubscribeRenderLayerAdded = ecs.onComponentAdded('renderLayer', ({ entity }) => {
						updateSceneGraphParent(entity.id, ecs);
					});

					const unsubscribeRenderLayerRemoved = ecs.onComponentRemoved('renderLayer', ({ entity }) => {
						updateSceneGraphParent(entity.id, ecs);
					});
					detachSceneGraphEvents = () => {
						unsubscribeHierarchy();
						unsubscribeRenderLayerAdded();
						unsubscribeRenderLayerRemoved();
					};

					if (camera) {
						const cameraState = ecs.tryGetResource<CameraState>('cameraState');
						if (!cameraState) throw new Error('renderer2D: cameraState resource not found');
						cameraState.viewportWidth = hasScreenScale ? designWidth : pixiApp.screen.width;
						cameraState.viewportHeight = hasScreenScale ? designHeight : pixiApp.screen.height;
					}

					const resizeHandler = (width: number, height: number) => {
						if (hasScreenScale) {
							const vpResource = ecs.tryGetResource('viewportScale');
							if (!vpResource) throw new Error('renderer2D: viewportScale resource not found');
							const vs = computeViewportScale(width, height, designWidth, designHeight, vpResource.mode);
							vpResource.scaleX = vs.scaleX;
							vpResource.scaleY = vs.scaleY;
							vpResource.offsetX = vs.offsetX;
							vpResource.offsetY = vs.offsetY;
							vpResource.physicalWidth = width;
							vpResource.physicalHeight = height;

							if (viewportContainer) {
								viewportContainer.position.set(vs.offsetX, vs.offsetY);
								viewportContainer.scale.set(vs.scaleX, vs.scaleY);
							}
						} else {
							const bounds = ecs.getResource('bounds');
							bounds.width = width;
							bounds.height = height;

							if (camera) {
								const cameraState = ecs.tryGetResource<CameraState>('cameraState');
								if (!cameraState) throw new Error('renderer2D: cameraState resource not found');
								cameraState.viewportWidth = width;
								cameraState.viewportHeight = height;
							}
						}
					};
					pixiApp.renderer.on('resize', resizeHandler);
					const updateFromTicker = (ticker: { deltaMS: number }) => {
						ecs.update(ticker.deltaMS / 1_000);
					};

					if (startLoop) {
						pixiApp.ticker.add(updateFromTicker);
					}
					detachRendererHooks = () => {
						pixiApp.renderer.off('resize', resizeHandler);
						if (startLoop) pixiApp.ticker.remove(updateFromTicker);
					};
				})

				.setOnDetach(() => {
					detachRendererHooks();
					detachSceneGraphEvents();
				});

			// ==================== Camera Sync System (opt-in) ====================
			if (camera) {
				world
					.addSystem('renderer2d-camera-sync')
					.setPriority(900)
					.inPhase('render')
					.inGroup(systemGroup)
					.setProcess(({ ecs }) => {
						const state = ecs.tryGetResource<CameraState>('cameraState');
						if (!state) throw new Error('renderer2D: cameraState resource not found');
						const root = ecs.getResource('rootContainer');
						const [centerW, centerH] = hasScreenScale
							? [designWidth, designHeight]
							: [ecs.getResource('pixiApp').screen.width, ecs.getResource('pixiApp').screen.height];

						root.position.set(
							centerW / 2 - (state.x + state.shakeOffsetX) * state.zoom,
							centerH / 2 - (state.y + state.shakeOffsetY) * state.zoom,
						);
						root.scale.set(state.zoom);
						root.rotation = -(state.rotation + state.shakeRotation);
					});
			}
		});
}
