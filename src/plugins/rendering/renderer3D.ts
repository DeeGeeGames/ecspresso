/**
 * 3D Renderer Plugin for ECSpresso
 *
 * An opt-in Three.js-based 3D rendering plugin that automates scene graph wiring.
 * Import from 'ecspresso/plugins/rendering/renderer3D'
 *
 * This plugin includes 3D transform propagation automatically.
 */

import type {
	WebGLRenderer,
	WebGLRendererParameters,
	Scene,
	Camera,
	PerspectiveCamera,
	OrthographicCamera,
	Object3D,
	Mesh,
	Group,
	ColorRepresentation,
	Vector3,
	Euler,
	Quaternion,
} from 'three';
import { definePlugin, type Plugin } from 'ecspresso';
import type { ComponentsConfig, EmptyConfig, EventsConfig, ResourcesConfig } from '../../type-utils';
import type ECSpresso from 'ecspresso';
import {
	createTransform3DPlugin,
	createTransform3D,
	type LocalTransform3D,
	type WorldTransform3D,
	type Transform3DComponentTypes,
	type Transform3DPluginOptions,
	DEFAULT_LOCAL_TRANSFORM_3D,
} from 'ecspresso/plugins/spatial/transform3D';

// Re-export transform types for convenience
export type { LocalTransform3D, WorldTransform3D, Transform3DComponentTypes };
export {
	createTransform3D,
	createLocalTransform3D,
	createWorldTransform3D,
	DEFAULT_LOCAL_TRANSFORM_3D,
	DEFAULT_WORLD_TRANSFORM_3D,
} from 'ecspresso/plugins/spatial/transform3D';

// ==================== Component Types ====================

/**
 * Visibility component for 3D entities.
 */
export interface Visible3D {
	visible: boolean;
}

/**
 * Aggregate component types for the 3D renderer plugin.
 * Included automatically via `.withPlugin(createRenderer3DPlugin({ ... }))`.
 */
export interface Renderer3DComponentTypes extends Transform3DComponentTypes {
	mesh: Mesh;
	group: Group;
	object3d: Object3D;
	visible3d: Visible3D;
	/** Controls Three.js Object3D.renderOrder for manual z-ordering */
	renderOrder: number;
}

// ==================== Event Types ====================

/**
 * Events emitted by the 3D renderer plugin.
 */
export interface Renderer3DEventTypes {
	hierarchyChanged: {
		entityId: number;
		oldParent: number | null;
		newParent: number | null;
	};
}

// ==================== Resource Types ====================

/**
 * Resources provided by the 3D renderer plugin.
 */
export interface Renderer3DResourceTypes {
	threeRenderer: WebGLRenderer;
	scene: Scene;
	camera: Camera;
}

// ==================== Plugin Options ====================

/**
 * Common options shared between both initialization modes.
 */
interface Renderer3DPluginCommonOptions<G extends string = 'renderer3d'> {
	/** System group name (default: 'renderer3d') */
	systemGroup?: G;
	/** Priority for render sync system (default: 500) */
	renderSyncPriority?: number;
	/** Options for the included 3D transform plugin */
	transform?: Transform3DPluginOptions;
	/** When true, starts a requestAnimationFrame loop to drive ecs.update() automatically (default: true) */
	startLoop?: boolean;
}

/**
 * Options when providing pre-initialized Three.js objects.
 */
export interface Renderer3DPluginPreInitOptions<G extends string = 'renderer3d'> extends Renderer3DPluginCommonOptions<G> {
	/** Pre-initialized WebGLRenderer */
	renderer: WebGLRenderer;
	/** Pre-initialized Scene */
	scene: Scene;
	/** Pre-initialized Camera */
	camera: Camera;
	container?: never;
	background?: never;
	width?: never;
	height?: never;
	antialias?: never;
	shadows?: never;
	cameraOptions?: never;
	threeInit?: never;
}

/**
 * Camera configuration for managed mode.
 *
 * Discriminated on `projection`. Defaults to `'perspective'` when omitted.
 * Orthographic cameras use `viewSize` (world-unit height at zoom=1) to define
 * the base frustum; `zoom` maps directly to Three.js's `OrthographicCamera.zoom`.
 */
export type CameraOptions =
	| {
		projection?: 'perspective';
		fov?: number;
		near?: number;
		far?: number;
		position?: { x: number; y: number; z: number };
		lookAt?: { x: number; y: number; z: number };
	}
	| {
		projection: 'orthographic';
		viewSize?: number;
		zoom?: number;
		near?: number;
		far?: number;
		position?: { x: number; y: number; z: number };
		lookAt?: { x: number; y: number; z: number };
	};

/**
 * Options when letting the plugin create and manage Three.js objects.
 */
export interface Renderer3DPluginManagedOptions<G extends string = 'renderer3d'> extends Renderer3DPluginCommonOptions<G> {
	renderer?: never;
	scene?: never;
	camera?: never;
	/** Container element to append the canvas to (or CSS selector string). Defaults to `document.body`. */
	container?: HTMLElement | string;
	/** Scene background color. */
	background?: ColorRepresentation;
	/** Canvas width. When omitted, auto-sizes to container. */
	width?: number;
	/** Canvas height. When omitted, auto-sizes to container. */
	height?: number;
	/** Enable antialiasing (default: true) */
	antialias?: boolean;
	/** Enable shadow mapping (default: false) */
	shadows?: boolean;
	/** Camera configuration */
	cameraOptions?: CameraOptions;
	/** Escape hatch for raw WebGLRendererParameters not otherwise exposed. */
	threeInit?: Partial<WebGLRendererParameters>;
}

/**
 * Configuration options for the 3D renderer plugin.
 *
 * Supports two modes:
 * 1. **Pre-initialized**: Pass already-initialized renderer, scene, camera
 * 2. **Managed**: Omit them and the plugin creates everything during `ecs.initialize()`
 *
 * This plugin includes 3D transform propagation automatically.
 *
 * @example Pre-initialized mode
 * ```typescript
 * const renderer = new WebGLRenderer({ antialias: true });
 * const scene = new Scene();
 * const camera = new PerspectiveCamera(75, w / h, 0.1, 1000);
 *
 * const ecs = ECSpresso.create()
 *   .withPlugin(createRenderer3DPlugin({ renderer, scene, camera }))
 *   .build();
 * ```
 *
 * @example Managed mode
 * ```typescript
 * const ecs = ECSpresso.create()
 *   .withPlugin(createRenderer3DPlugin({
 *     container: '#game',
 *     background: 0x1099bb,
 *     antialias: true,
 *     cameraOptions: { fov: 75, position: { x: 0, y: 5, z: 10 } },
 *   }))
 *   .build();
 * await ecs.initialize();
 * ```
 */
export type Renderer3DPluginOptions<G extends string = 'renderer3d'> =
	Renderer3DPluginPreInitOptions<G> | Renderer3DPluginManagedOptions<G>;

// ==================== Helper Utilities ====================

interface PositionOption3D {
	x?: number;
	y?: number;
	z?: number;
}

interface TransformOptions3D {
	rotation?: { x?: number; y?: number; z?: number };
	scale?: number | { x: number; y: number; z: number };
	visible?: boolean;
}

function buildTransformComponents(
	position?: PositionOption3D,
	options?: TransformOptions3D,
): Transform3DComponentTypes {
	const scaleValue = options?.scale;
	const scaleOpts = typeof scaleValue === 'number'
		? { scale: scaleValue }
		: scaleValue
			? { scaleX: scaleValue.x, scaleY: scaleValue.y, scaleZ: scaleValue.z }
			: undefined;

	return createTransform3D(
		position?.x ?? 0,
		position?.y ?? 0,
		position?.z ?? 0,
		{ rotation: options?.rotation, ...scaleOpts },
	);
}

/**
 * Create components for a mesh entity.
 * Returns an object suitable for spreading into spawn().
 *
 * @example
 * ```typescript
 * const player = ecs.spawn({
 *   ...createMeshComponents(myMesh, { x: 10, y: 0, z: -5 }),
 *   velocity: { x: 0, y: 0, z: 0 },
 * });
 * ```
 */
export function createMeshComponents(
	mesh: Mesh,
	position?: PositionOption3D,
	options?: TransformOptions3D,
): Pick<Renderer3DComponentTypes, 'mesh' | 'localTransform3D' | 'worldTransform3D' | 'visible3d'> {
	return {
		mesh,
		...buildTransformComponents(position, options),
		visible3d: { visible: options?.visible ?? true },
	};
}

/**
 * Create components for a group entity.
 * Returns an object suitable for spreading into spawn().
 *
 * @example
 * ```typescript
 * const enemies = ecs.spawn({
 *   ...createGroupComponents(enemyGroup, { x: 50, y: 0, z: -30 }),
 * });
 * ```
 */
export function createGroupComponents(
	group: Group,
	position?: PositionOption3D,
	options?: TransformOptions3D,
): Pick<Renderer3DComponentTypes, 'group' | 'localTransform3D' | 'worldTransform3D' | 'visible3d'> {
	return {
		group,
		...buildTransformComponents(position, options),
		visible3d: { visible: options?.visible ?? true },
	};
}

/**
 * Create components for a generic Object3D entity.
 * Returns an object suitable for spreading into spawn().
 *
 * @example
 * ```typescript
 * const obj = ecs.spawn({
 *   ...createObject3DComponents(myObject, { x: 0, y: 0, z: 0 }),
 * });
 * ```
 */
export function createObject3DComponents(
	object3d: Object3D,
	position?: PositionOption3D,
	options?: TransformOptions3D,
): Pick<Renderer3DComponentTypes, 'object3d' | 'localTransform3D' | 'worldTransform3D' | 'visible3d'> {
	return {
		object3d,
		...buildTransformComponents(position, options),
		visible3d: { visible: options?.visible ?? true },
	};
}

// ==================== Sync Helper ====================

/**
 * Apply worldTransform3D and visible3d to a Three.js Object3D.
 *
 * Managed objects have matrixAutoUpdate / matrixWorldAutoUpdate disabled
 * (see addToScene), so we recompose obj.matrix and refresh obj.matrixWorld
 * ourselves. Because the plugin keeps a flat scene graph AND assumes the scene
 * root stays at identity, world = local — so we skip a 4x4 matmul and copy.
 *
 * Note: obj.position / obj.rotation / obj.scale are NOT kept in sync — read
 * worldTransform3D from the ECS component if you need current values.
 */
function syncObject3D(
	obj: Object3D,
	wt: WorldTransform3D,
	vis: Visible3D,
	pos: Vector3,
	euler: Euler,
	quat: Quaternion,
	scale: Vector3,
): void {
	pos.set(wt.x, wt.y, wt.z);
	euler.set(wt.rx, wt.ry, wt.rz, 'XYZ');
	quat.setFromEuler(euler);
	scale.set(wt.sx, wt.sy, wt.sz);
	obj.matrix.compose(pos, quat, scale);
	obj.matrixWorld.copy(obj.matrix);
	obj.visible = vis.visible;
}

// ==================== Plugin Factory ====================

type Renderer3DLabels = 'renderer3d-sync' | 'renderer3d-scene-graph' | 'renderer3d-render' | 'transform3d-propagation';
type Renderer3DReactiveQueryNames = 'renderer3d-meshes' | 'renderer3d-groups' | 'renderer3d-objects';
type Renderer3DWorldConfig =
	ComponentsConfig<Renderer3DComponentTypes>
	& EventsConfig<Renderer3DEventTypes>
	& ResourcesConfig<Renderer3DResourceTypes>;

/**
 * Create a 3D rendering plugin for ECSpresso.
 *
 * This plugin provides:
 * - 3D transform propagation (localTransform3D -> worldTransform3D)
 * - Render sync system (updates Three.js objects from ECS components)
 * - Scene graph management (auto-adds/removes Three.js objects)
 * - Render call (renderer.render(scene, camera) each frame)
 * - Optional requestAnimationFrame loop
 *
 * Managed mode owns and disposes its WebGLRenderer when the world is disposed.
 * With supplied Three.js objects, the caller retains renderer ownership. Meshes,
 * geometries, and materials remain caller-owned in both modes; the plugin
 * detaches objects without destroying shared GPU assets.
 */
export function createRenderer3DPlugin<G extends string = 'renderer3d'>(
	options: Renderer3DPluginOptions<G>,
): Plugin<Renderer3DWorldConfig, EmptyConfig, Renderer3DLabels, G, never, Renderer3DReactiveQueryNames> {
	const {
		systemGroup = 'renderer3d',
		renderSyncPriority = 500,
		transform: transformOptions,
		startLoop = true,
	} = options;

	// Determine mode: pre-initialized if renderer was provided
	const isManaged = !('renderer' in options && options.renderer !== undefined);

	type PluginECS = ECSpresso<Renderer3DWorldConfig>;

	return definePlugin('renderer3d')
		.withComponentTypes<Renderer3DComponentTypes>()
		.withEventTypes<Renderer3DEventTypes>()
		.withResourceTypes<Renderer3DResourceTypes>()
		.withLabels<Renderer3DLabels>()
		.withGroups<G>()
		.withReactiveQueryNames<Renderer3DReactiveQueryNames>()
		.install((world) => {
			// Entity ID -> Three.js Object3D mapping for scene graph management
			const entityToThreeObject = new Map<number, Object3D>();

			// Cached resource references, set during scene-graph init for hot-path access
			let cachedRenderer: WebGLRenderer | null = null;
			let cachedScene: Scene | null = null;
			let cachedCamera: Camera | null = null;
			let detachRendererHooks = () => {};
			let detachSceneGraphEvents = () => {};

			// Preallocated math temporaries for syncObject3D, allocated during scene-graph init.
			let tmpPos: Vector3 | null = null;
			let tmpEuler: Euler | null = null;
			let tmpQuat: Quaternion | null = null;
			let tmpScale: Vector3 | null = null;

			// Install 3D transform plugin (deduplicates if already installed)
			world.installPlugin(createTransform3DPlugin(transformOptions));

			// Register resources based on mode
			if (isManaged) {
				const managedOptions = options as Renderer3DPluginManagedOptions<G>;
				const {
					background,
					width,
					height,
					antialias = true,
					shadows = false,
					cameraOptions,
					threeInit,
				} = managedOptions;
				const containerOption = managedOptions.container ?? document.body;

				world.addResource('threeRenderer', {
					factory: async () => {
						const { WebGLRenderer: WebGLRendererClass } = await import('three');

						const containerEl: HTMLElement | null = typeof containerOption === 'string'
							? document.querySelector<HTMLElement>(containerOption)
							: containerOption;

						const rendererParams: WebGLRendererParameters = {
							antialias,
							powerPreference: 'high-performance',
							...threeInit,
						};

						const renderer = new WebGLRendererClass(rendererParams);

						if (shadows) {
							renderer.shadowMap.enabled = true;
						}

						const w = width ?? containerEl?.clientWidth ?? window.innerWidth;
						const h = height ?? containerEl?.clientHeight ?? window.innerHeight;
						renderer.setSize(w, h);

						if (containerEl) {
							containerEl.appendChild(renderer.domElement);
						} else if (typeof containerOption === 'string') {
							console.warn(`Renderer3D plugin: container selector "${containerOption}" not found`);
						}

						return renderer;
					},
					onDispose: (renderer) => {
						detachRendererHooks();
						detachSceneGraphEvents();
						entityToThreeObject.clear();
						renderer.setAnimationLoop(null);
						renderer.dispose();
						renderer.domElement.remove();
					},
				});

				world.addResource('scene', {
					dependsOn: ['threeRenderer'],
					factory: async () => {
						const { Scene: SceneClass, Color } = await import('three');
						const scene = new SceneClass();
						if (background !== undefined) {
							scene.background = new Color(background);
						}
						return scene;
					},
				});

				world.addResource('camera', {
					dependsOn: ['threeRenderer'],
					factory: async (ecs) => {
						const renderer = ecs.getResource('threeRenderer');
						const aspect = renderer.domElement.width / renderer.domElement.height;
						const near = cameraOptions?.near ?? 0.1;
						const far = cameraOptions?.far ?? 1000;

						let cam: Camera;
						if (cameraOptions?.projection === 'orthographic') {
							const { OrthographicCamera: OrthographicCameraClass } = await import('three');
							const viewSize = cameraOptions.viewSize ?? 10;
							const halfH = viewSize / 2;
							const halfW = halfH * aspect;
							const ortho = new OrthographicCameraClass(-halfW, halfW, halfH, -halfH, near, far);
							ortho.zoom = cameraOptions.zoom ?? 1;
							ortho.updateProjectionMatrix();
							cam = ortho;
						} else {
							const { PerspectiveCamera: PerspectiveCameraClass } = await import('three');
							const fov = cameraOptions?.fov ?? 75;
							cam = new PerspectiveCameraClass(fov, aspect, near, far);
						}

						if (cameraOptions?.position) {
							cam.position.set(
								cameraOptions.position.x,
								cameraOptions.position.y,
								cameraOptions.position.z,
							);
						}
						if (cameraOptions?.lookAt) {
							cam.lookAt(
								cameraOptions.lookAt.x,
								cameraOptions.lookAt.y,
								cameraOptions.lookAt.z,
							);
						}

						return cam;
					},
				});
			} else {
				const preInit = options as Renderer3DPluginPreInitOptions<G>;
				world.addResource('threeRenderer', {
					factory: () => preInit.renderer,
					onDispose: () => {
						detachRendererHooks();
						detachSceneGraphEvents();
						entityToThreeObject.clear();
					},
				});
				world.addResource('scene', preInit.scene);
				world.addResource('camera', preInit.camera);
			}

			// Register dispose callbacks for 3D object components
			world.registerDispose('mesh', ({ value }) => {
				if (value.parent) value.parent.remove(value);
			});
			world.registerDispose('group', ({ value }) => {
				if (value.parent) value.parent.remove(value);
			});
			world.registerDispose('object3d', ({ value }) => {
				if (value.parent) value.parent.remove(value);
			});

			// 3D objects require localTransform3D and visible3d
			world.registerRequired('mesh', 'localTransform3D', () => ({ ...DEFAULT_LOCAL_TRANSFORM_3D }));
			world.registerRequired('mesh', 'visible3d', () => ({ visible: true }));
			world.registerRequired('group', 'localTransform3D', () => ({ ...DEFAULT_LOCAL_TRANSFORM_3D }));
			world.registerRequired('group', 'visible3d', () => ({ visible: true }));
			world.registerRequired('object3d', 'localTransform3D', () => ({ ...DEFAULT_LOCAL_TRANSFORM_3D }));
			world.registerRequired('object3d', 'visible3d', () => ({ visible: true }));

			// ==================== Render Sync System ====================
			world
				.addSystem('renderer3d-sync')
				.setPriority(renderSyncPriority)
				.inPhase('render')
				.inGroup(systemGroup)
				.addQuery('meshes', {
					with: ['mesh', 'worldTransform3D', 'visible3d'],
					changed: ['worldTransform3D'],
				})
				.addQuery('groups', {
					with: ['group', 'worldTransform3D', 'visible3d'],
					changed: ['worldTransform3D'],
				})
				.addQuery('objects', {
					with: ['object3d', 'worldTransform3D', 'visible3d'],
					changed: ['worldTransform3D'],
				})
				.setProcess(({ queries }) => {
					const pos = tmpPos;
					const euler = tmpEuler;
					const quat = tmpQuat;
					const scale = tmpScale;
					if (!pos || !euler || !quat || !scale) return;

					for (const entity of queries.meshes) {
						const { mesh, worldTransform3D, visible3d } = entity.components;
						syncObject3D(mesh, worldTransform3D, visible3d, pos, euler, quat, scale);
					}

					for (const entity of queries.groups) {
						const { group, worldTransform3D, visible3d } = entity.components;
						syncObject3D(group, worldTransform3D, visible3d, pos, euler, quat, scale);
					}

					for (const entity of queries.objects) {
						const { object3d, worldTransform3D, visible3d } = entity.components;
						syncObject3D(object3d, worldTransform3D, visible3d, pos, euler, quat, scale);
					}
				});

			// ==================== Scene Graph Manager System ====================
			world
				.addSystem('renderer3d-scene-graph')
				.setPriority(9999)
				.inGroup(systemGroup)
				.setOnInitialize(async (ecs: PluginECS) => {
					const { Vector3: Vector3Class, Euler: EulerClass, Quaternion: QuaternionClass } = await import('three');
					tmpPos = new Vector3Class();
					tmpEuler = new EulerClass();
					tmpQuat = new QuaternionClass();
					tmpScale = new Vector3Class();

					const scene = ecs.getResource('scene');
					const threeRenderer = ecs.getResource('threeRenderer');
					const camera = ecs.getResource('camera');

					// Cache for hot-path render system
					cachedRenderer = threeRenderer;
					cachedScene = scene;
					cachedCamera = camera;

					// Helper to add a Three.js object to the scene.
					// Disable Three.js's per-frame matrix bookkeeping for managed objects:
					// the sync system writes obj.matrix and obj.matrixWorld manually only when
					// worldTransform3D actually changes, skipping the work for static frames.
					function addToScene(entityId: number, obj: Object3D): void {
						obj.matrixAutoUpdate = false;
						obj.matrixWorldAutoUpdate = false;
						entityToThreeObject.set(entityId, obj);
						scene.add(obj);
					}

					ecs.addReactiveQuery('renderer3d-meshes', {
						with: ['mesh'],
						onEnter: ({ entity }) => {
							addToScene(entity.id, entity.components.mesh);
						},
						onExit: ({ entityId }) => {
							entityToThreeObject.delete(entityId);
						},
					});

					ecs.addReactiveQuery('renderer3d-groups', {
						with: ['group'],
						onEnter: ({ entity }) => {
							addToScene(entity.id, entity.components.group);
						},
						onExit: ({ entityId }) => {
							entityToThreeObject.delete(entityId);
						},
					});

					ecs.addReactiveQuery('renderer3d-objects', {
						with: ['object3d'],
						onEnter: ({ entity }) => {
							addToScene(entity.id, entity.components.object3d);
						},
						onExit: ({ entityId }) => {
							entityToThreeObject.delete(entityId);
						},
					});

						// Resize handler
					const resizeHandler = () => {
						const w = threeRenderer.domElement.parentElement?.clientWidth ?? window.innerWidth;
						const h = threeRenderer.domElement.parentElement?.clientHeight ?? window.innerHeight;
						threeRenderer.setSize(w, h);
						if ((camera as PerspectiveCamera).isPerspectiveCamera) {
							const perspCam = camera as PerspectiveCamera;
							perspCam.aspect = w / h;
							perspCam.updateProjectionMatrix();
						} else if ((camera as OrthographicCamera).isOrthographicCamera) {
							const orthoCam = camera as OrthographicCamera;
							const halfH = (orthoCam.top - orthoCam.bottom) / 2;
							const halfW = halfH * (w / h);
							orthoCam.left = -halfW;
							orthoCam.right = halfW;
							orthoCam.top = halfH;
							orthoCam.bottom = -halfH;
							orthoCam.updateProjectionMatrix();
						}
					};
					window.addEventListener('resize', resizeHandler);
					let animationFrameId: number | null = null;

					// Animation loop
					if (startLoop) {
						let lastTime = 0;
						const animate = (time: number) => {
							animationFrameId = requestAnimationFrame(animate);
							const dt = lastTime === 0 ? 0 : (time - lastTime) / 1000;
							lastTime = time;
							ecs.update(dt);
						};
						animationFrameId = requestAnimationFrame(animate);
					}
					detachRendererHooks = () => {
						window.removeEventListener('resize', resizeHandler);
						if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
					};

					const unsubscribeHierarchy = ecs.on('hierarchyChanged', ({ entityId }) => {
						const obj = entityToThreeObject.get(entityId);
						if (!obj) return;
						// Scene graph stays flat — all objects are children of scene directly.
						// Re-add to scene if somehow removed.
						if (obj.parent !== scene) scene.add(obj);
					});
					detachSceneGraphEvents = unsubscribeHierarchy;
					})

					.setOnDetach(() => {
						detachRendererHooks();
						detachSceneGraphEvents();
						cachedRenderer = null;
						cachedScene = null;
						cachedCamera = null;
						tmpPos = null;
						tmpEuler = null;
						tmpQuat = null;
						tmpScale = null;
					});

			// ==================== Render System ====================
			world
				.addSystem('renderer3d-render')
				.setPriority(0)
				.inPhase('render')
				.inGroup(systemGroup)
				.setProcess(() => {
					if (cachedRenderer && cachedScene && cachedCamera) {
						cachedRenderer.render(cachedScene, cachedCamera);
					}
				});
		});
}
