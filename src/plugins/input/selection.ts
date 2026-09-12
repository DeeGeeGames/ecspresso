/**
 * Selection Plugin for ECSpresso
 *
 * Provides pointer-driven entity selection via box-drag and click.
 * Entities with a `selectable` component can be selected by the user.
 * Selected entities receive a `selected` component that other systems
 * can query for.
 *
 * Requires the input plugin (for pointer state) and the renderer2D plugin
 * (for graphics rendering of the selection box).
 *
 * Camera-aware: when a `cameraState` resource is present (from the camera
 * plugin), pointer coordinates are automatically converted to world space
 * for hit-testing. The selection box overlay remains in screen space.
 */

import { Graphics } from 'pixi.js';
import { definePlugin, type BasePluginOptions } from 'ecspresso';
import type { ComponentsConfig, ResourcesConfig } from 'ecspresso';
import type { InputResourceTypes } from './input';
import type { Renderer2DComponentTypes, Renderer2DResourceTypes } from '../rendering/renderer2D';
import type { CameraState } from '../spatial/camera';
import { screenToWorld } from '../spatial/camera';

// ==================== Component Types ====================

/**
 * Component types provided by the selection plugin.
 */
export interface SelectionComponentTypes {
	/** Tag marking an entity as eligible for selection */
	selectable: true;
	/** Tag marking an entity as currently selected (added/removed dynamically) */
	selected: true;
}

// ==================== Resource Types ====================

/**
 * Internal state tracking the current drag selection.
 */
export interface SelectionState {
	dragStart: { x: number; y: number };
	boxEntityId: number | null;
}

/**
 * Resource types provided by the selection plugin.
 */
export interface SelectionResourceTypes {
	selectionState: SelectionState;
}

// ==================== WorldConfig ====================

/**
 * WorldConfig representing the selection plugin's provided types.
 */
export type SelectionWorldConfig =
	ComponentsConfig<SelectionComponentTypes>
	& ResourcesConfig<SelectionResourceTypes>;

// ==================== Dependency Types ====================

type SelectionRequires<A extends string = string> =
	ComponentsConfig<Renderer2DComponentTypes>
	& ResourcesConfig<InputResourceTypes<A> & Renderer2DResourceTypes>;

// ==================== Plugin Options ====================

/**
 * Configuration options for the selection plugin.
 */
export interface SelectionPluginOptions<G extends string = 'selection'> extends BasePluginOptions<G> {
	/** Minimum drag distance (px) to trigger box select vs click select (default: 5) */
	clickThreshold?: number;
	/** Selection box fill color (default: 0x00FF00) */
	boxFillColor?: number;
	/** Selection box fill alpha (default: 0.15) */
	boxFillAlpha?: number;
	/** Selection box stroke color (default: 0x00FF00) */
	boxStrokeColor?: number;
	/** Selection box stroke alpha (default: 0.8) */
	boxStrokeAlpha?: number;
	/** Tint applied to selected entities' sprites (default: 0x44FF44) */
	selectedTint?: number;
	/** Render layer for the selection box entity (default: undefined) */
	renderLayer?: string;
}

// ==================== Helper Functions ====================

/**
 * Create a selectable component.
 *
 * @returns Component object suitable for spreading into spawn()
 *
 * @example
 * ```typescript
 * ecs.spawn({
 *   ...createTransform(100, 200),
 *   sprite,
 *   ...createSelectable(),
 * });
 * ```
 */
export function createSelectable(): Pick<SelectionComponentTypes, 'selectable'> {
	return { selectable: true };
}

// ==================== Plugin Factory ====================

/**
 * Create a selection plugin for ECSpresso.
 *
 * Provides:
 * - Box-drag selection (left-click drag to select multiple entities)
 * - Click selection (left-click to select a single entity)
 * - Visual feedback (configurable sprite tint for selected entities)
 * - Selection box overlay (rendered as a PixiJS Graphics entity)
 * - Automatic camera-awareness when cameraState resource is present
 *
 * If the input plugin is configured with a literal action-name union, pass
 * that union as the second generic parameter so the writable input resource
 * requirement remains exact.
 *
 * Requires the input plugin and renderer2D plugin to be installed.
 *
 * @example
 * ```typescript
 * const ecs = ECSpresso.create()
 *   .withPlugin(createRenderer2DPlugin({ renderLayers: ['game', 'ui'] }))
 *   .withPlugin(createInputPlugin())
 *   .withPlugin(createSelectionPlugin({ renderLayer: 'ui' }))
 *   .build();
 *
 * await ecs.initialize();
 *
 * ecs.spawn({
 *   sprite,
 *   ...createTransform(100, 200),
 *   ...createSelectable(),
 * });
 * ```
 */
export function createSelectionPlugin<G extends string = 'selection', A extends string = string>(
	options?: SelectionPluginOptions<G>
) {
	const {
		systemGroup = 'selection',
		priority = 100,
		phase = 'preUpdate',
		clickThreshold = 5,
		boxFillColor = 0x00FF00,
		boxFillAlpha = 0.15,
		boxStrokeColor = 0x00FF00,
		boxStrokeAlpha = 0.8,
		selectedTint = 0x44FF44,
		renderLayer,
	} = options ?? {};

	// Pre-allocate draw options to avoid per-frame allocations during drag
	const fillOptions = { color: boxFillColor, alpha: boxFillAlpha };
	const strokeOptions = { color: boxStrokeColor, width: 1.5, alpha: boxStrokeAlpha };

	return definePlugin('selection')
		.withComponentTypes<SelectionComponentTypes>()
		.withResourceTypes<SelectionResourceTypes>()
		.withLabels<'selection-input' | 'selection-visual'>()
		.withGroups<G>()
		.requires<SelectionRequires<A>>()
		.install((world) => {
			world.addResource('selectionState', {
				dragStart: { x: 0, y: 0 },
				boxEntityId: null,
			});

			let preventContextMenu: ((e: Event) => void) | null = null;

			world
				.addSystem('selection-input')
				.setPriority(priority)
				.inPhase(phase)
				.inGroup(systemGroup)
				.addQuery('selectables', {
					with: ['selectable', 'worldTransform'],
				})
				.addQuery('currentlySelected', {
					with: ['selected'],
				})
				.withResources(['inputState', 'selectionState', 'pixiApp'])
				.setOnInitialize((ecs) => {
					const pixiApp = ecs.getResource('pixiApp');
					preventContextMenu = (e: Event) => e.preventDefault();
					pixiApp.canvas.addEventListener('contextmenu', preventContextMenu);
				})
				.setOnDetach((ecs) => {
					if (!preventContextMenu) return;
					const pixiApp = ecs.getResource('pixiApp');
					pixiApp.canvas.removeEventListener('contextmenu', preventContextMenu);
					preventContextMenu = null;
				})
				.setProcess(({ queries, ecs, resources }) => {
					const { inputState: input, selectionState } = resources;
					const pointer = input.pointer;

					// Start drag
					if (pointer.justPressed(0)) {
						// Clean up any orphaned box entity from an interrupted drag
						if (selectionState.boxEntityId !== null) {
							ecs.commands.removeEntity(selectionState.boxEntityId);
						}

						selectionState.dragStart.x = pointer.position.x;
						selectionState.dragStart.y = pointer.position.y;

						const boxEntity = ecs.spawn({
							graphics: new Graphics(),
						});
						if (renderLayer) {
							ecs.addComponent(boxEntity.id, 'renderLayer', renderLayer);
						}
						selectionState.boxEntityId = boxEntity.id;
					}

					// Update drag visual (screen-space — no camera conversion)
					if (pointer.isDown(0) && selectionState.boxEntityId !== null) {
						const g = ecs.getComponent(selectionState.boxEntityId, 'graphics');
						if (!g) return;

						const startX = selectionState.dragStart.x;
						const startY = selectionState.dragStart.y;
						const curX = pointer.position.x;
						const curY = pointer.position.y;
						const minX = Math.min(startX, curX);
						const minY = Math.min(startY, curY);
						const w = Math.abs(curX - startX);
						const h = Math.abs(curY - startY);

						g.clear();
						g.rect(minX, minY, w, h);
						g.fill(fillOptions);
						g.stroke(strokeOptions);
					}

					// End drag — perform selection
					if (!pointer.justReleased(0) || selectionState.boxEntityId === null) return;

					const startX = selectionState.dragStart.x;
					const startY = selectionState.dragStart.y;
					const endX = pointer.position.x;
					const endY = pointer.position.y;

					const w = Math.abs(endX - startX);
					const h = Math.abs(endY - startY);

					// Clear current selection
					for (const entity of queries.currentlySelected) {
						ecs.removeComponent(entity.id, 'selected');
					}

					const isClick = w < clickThreshold && h < clickThreshold;

					// Convert screen coords to world space for hit-testing
					const camState = ecs.tryGetResource('cameraState') as CameraState | undefined;
					const worldEnd = camState
						? screenToWorld(endX, endY, camState)
						: { x: endX, y: endY };

					if (isClick) {
						const clickRadiusSq = 400; // 20px radius in world space
						let nearestId: number | null = null;
						let nearestDistSq = Infinity;

						for (const entity of queries.selectables) {
							const { worldTransform } = entity.components;
							const dx = worldTransform.x - worldEnd.x;
							const dy = worldTransform.y - worldEnd.y;
							const distSq = dx * dx + dy * dy;
							if (distSq < clickRadiusSq && distSq < nearestDistSq) {
								nearestDistSq = distSq;
								nearestId = entity.id;
							}
						}

						if (nearestId !== null) {
							ecs.addComponent(nearestId, 'selected', true);
						}
					} else {
						const worldStart = camState
							? screenToWorld(startX, startY, camState)
							: { x: startX, y: startY };
						const minWX = Math.min(worldStart.x, worldEnd.x);
						const maxWX = Math.max(worldStart.x, worldEnd.x);
						const minWY = Math.min(worldStart.y, worldEnd.y);
						const maxWY = Math.max(worldStart.y, worldEnd.y);

						for (const entity of queries.selectables) {
							const { worldTransform } = entity.components;
							if (
								worldTransform.x >= minWX &&
								worldTransform.x <= maxWX &&
								worldTransform.y >= minWY &&
								worldTransform.y <= maxWY
							) {
								ecs.addComponent(entity.id, 'selected', true);
							}
						}
					}

					ecs.commands.removeEntity(selectionState.boxEntityId);
					selectionState.boxEntityId = null;
				});

			// Visual feedback via enter/exit callbacks — only fires on selection change
			world
				.addSystem('selection-visual')
				.setPriority(priority)
				.inPhase('render')
				.inGroup(systemGroup)
				.addQuery('selectedUnits', {
					with: ['selected', 'sprite'],
				})
				.setOnEntityEnter('selectedUnits', ({ entity }) => {
					entity.components.sprite.tint = selectedTint;
				})
				.addQuery('deselectedUnits', {
					with: ['selectable', 'sprite'],
					without: ['selected'],
				})
				.setOnEntityEnter('deselectedUnits', ({ entity }) => {
					entity.components.sprite.tint = 0xFFFFFF;
				});
		});
}
