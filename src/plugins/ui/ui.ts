/**
 * UI / HUD Plugin for ECSpresso.
 *
 * Screen-space primitives:
 * - `uiElement` — anchor/pivot/offset positioning resolved against the `bounds` resource
 * - `uiLabel` — PixiJS Text
 * - `uiPanel` — PixiJS Graphics rectangle with optional border
 * - `uiProgressBar` — PixiJS Graphics value indicator with four fill directions
 *
 * Pointer interaction (buttons):
 * - `uiInteractive` (marker) opts an entity into hit-testing
 * - `uiInteraction.state` — `'none' | 'hover' | 'pressed'` (Bevy-style single enum)
 * - `uiButton` marker composes `uiInteractive` + `uiInteraction`
 * - `uiDisabled` skips hit-testing entirely
 * - Emits `uiButtonPressed` (confirmed down→up on same widget) and `uiButtonHovered`
 *
 * Depends on `renderer2D` (for the `bounds` resource + scene graph + screen-space layer),
 * the transform plugin (bundled by renderer2D), and the input plugin.
 *
 * Future phases will add the message log (Phase 3).
 */

import type { Container, Graphics, Text } from 'pixi.js';
import { definePlugin, type BasePluginOptions } from 'ecspresso';
import type { WorldConfigFrom } from '../../type-utils';
import type { Vector2D } from '../../utils/math';
import {
	DEFAULT_LOCAL_TRANSFORM,
	type LocalTransform,
	type TransformComponentTypes,
	type WorldTransform,
} from '../spatial/transform';
import type { BoundsResourceTypes } from '../spatial/bounds';
import type { InputResourceTypes } from '../input/input';

// ==================== Anchor Presets ====================

export type AnchorPreset =
	| 'top-left' | 'top-center' | 'top-right'
	| 'center-left' | 'center' | 'center-right'
	| 'bottom-left' | 'bottom-center' | 'bottom-right';

export const ANCHOR_PRESETS: Readonly<Record<AnchorPreset, Readonly<Vector2D>>> = Object.freeze({
	'top-left': Object.freeze({ x: 0, y: 0 }),
	'top-center': Object.freeze({ x: 0.5, y: 0 }),
	'top-right': Object.freeze({ x: 1, y: 0 }),
	'center-left': Object.freeze({ x: 0, y: 0.5 }),
	'center': Object.freeze({ x: 0.5, y: 0.5 }),
	'center-right': Object.freeze({ x: 1, y: 0.5 }),
	'bottom-left': Object.freeze({ x: 0, y: 1 }),
	'bottom-center': Object.freeze({ x: 0.5, y: 1 }),
	'bottom-right': Object.freeze({ x: 1, y: 1 }),
});

export type AnchorInput = AnchorPreset | Vector2D;

/** Resolve a preset string or vec2 into a mutable Vector2D copy. */
export function resolveAnchorPreset(input: AnchorInput): Vector2D {
	if (typeof input === 'string') {
		const preset = ANCHOR_PRESETS[input];
		return { x: preset.x, y: preset.y };
	}
	return { x: input.x, y: input.y };
}

/**
 * Write the top-left screen position of a widget into `out`.
 *
 * Formula: position = anchor * bounds + offset - pivot * size.
 * `anchor` specifies where on the canvas the widget attaches (0..1 normalized).
 * `pivot` specifies where on the widget that attachment point lands (0..1 normalized).
 * Writes in place to avoid per-frame allocation.
 */
export function resolveAnchorPosition(
	anchor: Readonly<Vector2D>,
	pivot: Readonly<Vector2D>,
	offset: Readonly<Vector2D>,
	bounds: Readonly<{ width: number; height: number }>,
	size: Readonly<{ width: number; height: number }>,
	out: Vector2D,
): void {
	out.x = anchor.x * bounds.width + offset.x - pivot.x * size.width;
	out.y = anchor.y * bounds.height + offset.y - pivot.y * size.height;
}

// ==================== Progress Bar Math ====================

export type ProgressDirection = 'ltr' | 'rtl' | 'ttb' | 'btt';

export interface FillRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export function clampProgressValue(value: number, max: number): number {
	if (max <= 0) return 0;
	if (value <= 0) return 0;
	if (value >= max) return max;
	return value;
}

type FillComputer = (w: number, h: number, ratio: number, out: FillRect) => void;

const FILL_COMPUTERS: Readonly<Record<ProgressDirection, FillComputer>> = {
	ltr: (w, h, r, o) => { o.x = 0; o.y = 0; o.width = w * r; o.height = h; },
	rtl: (w, h, r, o) => { o.x = w * (1 - r); o.y = 0; o.width = w * r; o.height = h; },
	ttb: (w, h, r, o) => { o.x = 0; o.y = 0; o.width = w; o.height = h * r; },
	btt: (w, h, r, o) => { o.x = 0; o.y = h * (1 - r); o.width = w; o.height = h * r; },
};

export function computeProgressFillRect(
	width: number,
	height: number,
	ratio: number,
	direction: ProgressDirection,
	out: FillRect,
): void {
	FILL_COMPUTERS[direction](width, height, ratio, out);
}

// ==================== Component Types ====================

export interface UIElement {
	anchor: Vector2D;
	pivot: Vector2D;
	offset: Vector2D;
	width: number;
	height: number;
}

export interface UITextStyle {
	fontFamily: string;
	fontSize: number;
	fill: number;
	align: 'left' | 'center' | 'right';
}

export interface UILabel {
	text: string;
	style: UITextStyle;
}

export interface UIPanel {
	fillColor: number;
	borderColor?: number;
	borderWidth: number;
}

export interface UIProgressBar {
	value: number;
	max: number;
	fillColor: number;
	bgColor: number;
	direction: ProgressDirection;
}

export type UIInteractionState = 'none' | 'hover' | 'pressed';

export interface UIInteraction {
	state: UIInteractionState;
}

export interface LogFragment {
	text: string;
	color: number;
}

export interface UIMessageLog {
	lines: LogFragment[][];
	maxLines: number;
	visibleLines: number;
	lineHeight: number;
	style: UITextStyle;
}

export interface UIComponentTypes {
	uiElement: UIElement;
	uiLabel: UILabel;
	uiPanel: UIPanel;
	uiProgressBar: UIProgressBar;
	uiButton: {};
	uiInteractive: {};
	uiInteraction: UIInteraction;
	uiDisabled: {};
	uiMessageLog: UIMessageLog;
}

// ==================== Event Types ====================

export interface UIButtonPressedEvent {
	entityId: number;
}

export interface UIButtonHoveredEvent {
	entityId: number;
	entered: boolean;
}

export interface UIMessageLogAppendedEvent {
	entityId: number;
	line: LogFragment[];
}

export interface UIEventTypes {
	uiButtonPressed: UIButtonPressedEvent;
	uiButtonHovered: UIButtonHoveredEvent;
	uiLogAppended: UIMessageLogAppendedEvent;
}

// ==================== Component Factories ====================

const DEFAULT_TEXT_STYLE: Readonly<UITextStyle> = Object.freeze({
	fontFamily: 'sans-serif',
	fontSize: 16,
	fill: 0xffffff,
	align: 'left',
});

export interface CreateUIElementInput {
	anchor: AnchorInput;
	pivot?: AnchorInput;
	offset?: Vector2D;
	width: number;
	height: number;
}

export function createUIElement(input: CreateUIElementInput): Pick<UIComponentTypes, 'uiElement'> {
	const anchor = resolveAnchorPreset(input.anchor);
	const pivot = input.pivot === undefined ? { x: anchor.x, y: anchor.y } : resolveAnchorPreset(input.pivot);
	const offset = input.offset === undefined ? { x: 0, y: 0 } : { x: input.offset.x, y: input.offset.y };
	return {
		uiElement: {
			anchor,
			pivot,
			offset,
			width: input.width,
			height: input.height,
		},
	};
}

export function createUILabel(
	text: string,
	style?: Partial<UITextStyle>,
): Pick<UIComponentTypes, 'uiLabel'> {
	return {
		uiLabel: {
			text,
			style: { ...DEFAULT_TEXT_STYLE, ...style },
		},
	};
}

export interface CreateUIPanelInput {
	fillColor: number;
	borderColor?: number;
	borderWidth?: number;
}

export function createUIPanel(input: CreateUIPanelInput): Pick<UIComponentTypes, 'uiPanel'> {
	return {
		uiPanel: {
			fillColor: input.fillColor,
			borderColor: input.borderColor,
			borderWidth: input.borderWidth ?? 0,
		},
	};
}

export interface CreateUIProgressBarInput {
	value: number;
	max: number;
	fillColor: number;
	bgColor: number;
	direction?: ProgressDirection;
}

export function createUIProgressBar(input: CreateUIProgressBarInput): Pick<UIComponentTypes, 'uiProgressBar'> {
	return {
		uiProgressBar: {
			value: input.value,
			max: input.max,
			fillColor: input.fillColor,
			bgColor: input.bgColor,
			direction: input.direction ?? 'ltr',
		},
	};
}

export interface CreateUIMessageLogInput {
	maxLines: number;
	visibleLines: number;
	lineHeight: number;
	style?: Partial<UITextStyle>;
	initialLines?: LogFragment[][];
}

export function createUIMessageLog(input: CreateUIMessageLogInput): Pick<UIComponentTypes, 'uiMessageLog'> {
	return {
		uiMessageLog: {
			lines: input.initialLines === undefined ? [] : [...input.initialLines],
			maxLines: input.maxLines,
			visibleLines: input.visibleLines,
			lineHeight: input.lineHeight,
			style: { ...DEFAULT_TEXT_STYLE, ...input.style },
		},
	};
}

export function createUIInteractive(): Pick<UIComponentTypes, 'uiInteractive'> {
	return { uiInteractive: {} };
}

export function createUIButton(): Pick<UIComponentTypes, 'uiButton'> {
	return { uiButton: {} };
}

export function createUIDisabled(): Pick<UIComponentTypes, 'uiDisabled'> {
	return { uiDisabled: {} };
}

// ==================== Message Log Helper ====================

/** Structural ECS surface for `appendLogLine`; mirrors the `CoroutineWorld` pattern. */
export interface MessageLogWorld {
	commands: {
		mutateComponent(
			entityId: number,
			componentName: 'uiMessageLog',
			mutator: (value: UIMessageLog) => void,
		): void;
	};
	eventBus: {
		publish(event: 'uiLogAppended', payload: UIMessageLogAppendedEvent): void;
	};
}

/**
 * Append a line (vector of fragments) to a `uiMessageLog` entity.
 *
 * Queues a buffered mutation that swaps `lines` for a fresh array (FIFO-truncated to
 * `maxLines`) — the array-identity change is the sync system's redraw signal — and
 * synchronously publishes `uiLogAppended` carrying the line for entry-animation
 * listeners. Safe to call from inside a system process callback.
 */
export function appendLogLine(
	ecs: MessageLogWorld,
	entityId: number,
	line: LogFragment[],
): void {
	ecs.commands.mutateComponent(entityId, 'uiMessageLog', (log) => {
		const cap = Math.max(0, log.maxLines);
		const next = [...log.lines, line];
		log.lines = next.length > cap ? next.slice(next.length - cap) : next;
	});
	ecs.eventBus.publish('uiLogAppended', { entityId, line });
}

// ==================== Runtime Data (Side Storage) ====================

interface UILabelRuntime {
	pixiText: Text;
	lastText: string;
	lastFontSize: number;
	lastFill: number;
	lastAlign: string;
	lastFontFamily: string;
}

interface UIPanelRuntime {
	pixiGraphics: Graphics;
	lastFillColor: number;
	lastBorderColor: number | undefined;
	lastBorderWidth: number;
	lastWidth: number;
	lastHeight: number;
}

interface UIProgressRuntime {
	pixiGraphics: Graphics;
	lastValue: number;
	lastMax: number;
	lastFillColor: number;
	lastBgColor: number;
	lastDirection: ProgressDirection;
	lastWidth: number;
	lastHeight: number;
}

interface UIMessageLogLineRuntime {
	container: Container;
	texts: Text[];
}

interface UIMessageLogRuntime {
	rootContainer: Container;
	lines: UIMessageLogLineRuntime[];
	lastLinesRef: LogFragment[][] | null;
	lastVisibleLines: number;
	lastLineHeight: number;
	lastFontFamily: string;
	lastFontSize: number;
	lastAlign: string;
}

// ==================== Plugin Factory ====================

type UIRequires = WorldConfigFrom<
	TransformComponentTypes,
	{},
	BoundsResourceTypes & InputResourceTypes
>;

type UILabels =
	| 'ui-anchor-resolve'
	| 'ui-interaction'
	| 'ui-label-sync'
	| 'ui-panel-sync'
	| 'ui-progress-sync'
	| 'ui-message-log-sync';

export interface UIPluginOptions<G extends string = 'ui'> extends BasePluginOptions<G> {
	/** Priority for the anchor-resolve system in preUpdate (default: 0). */
	anchorPriority?: number;
	/** Priority for the pointer hit-test system in preUpdate (default: 200, after input's 100). */
	interactionPriority?: number;
	/** Priority for render-sync systems (default: 480, just before renderer2D's 500). */
	renderSyncPriority?: number;
}

export function createUIPlugin<G extends string = 'ui'>(
	options?: UIPluginOptions<G>,
) {
	const {
		systemGroup = 'ui' as G,
		anchorPriority = 0,
		interactionPriority = 200,
		renderSyncPriority = 480,
	} = options ?? {};

	const labelPool = new Map<number, UILabelRuntime>();
	const panelPool = new Map<number, UIPanelRuntime>();
	const progressPool = new Map<number, UIProgressRuntime>();
	const messageLogPool = new Map<number, UIMessageLogRuntime>();
	const scratchPos: Vector2D = { x: 0, y: 0 };
	const scratchFill: FillRect = { x: 0, y: 0, width: 0, height: 0 };
	// Captured at init for the message-log sync, which (unlike other sync systems) must create
	// new Text/Container nodes during process() as fragments grow via appendLogLine.
	let pixiModuleForMessageLog: typeof import('pixi.js') | null = null;

	return definePlugin('ui')
		.withComponentTypes<UIComponentTypes>()
		.withEventTypes<UIEventTypes>()
		.withLabels<UILabels>()
		.withGroups<G>()
		.withReactiveQueryNames<'ui-labels' | 'ui-panels' | 'ui-progress-bars' | 'ui-message-logs'>()
		.requires<UIRequires>()
		.install((world) => {
			world.registerRequired('uiElement', 'localTransform', (): LocalTransform => ({
				x: DEFAULT_LOCAL_TRANSFORM.x,
				y: DEFAULT_LOCAL_TRANSFORM.y,
				rotation: DEFAULT_LOCAL_TRANSFORM.rotation,
				scaleX: DEFAULT_LOCAL_TRANSFORM.scaleX,
				scaleY: DEFAULT_LOCAL_TRANSFORM.scaleY,
			}));
			world.registerRequired('uiButton', 'uiInteractive', () => ({}));
			world.registerRequired('uiInteractive', 'uiInteraction', (): UIInteraction => ({ state: 'none' }));

			// Anchor resolve: writes localTransform.{x,y} from uiElement + bounds.
			world
				.addSystem('ui-anchor-resolve')
				.setPriority(anchorPriority)
				.inPhase('preUpdate')
				.inGroup(systemGroup)
				.addQuery('uiElements', {
					with: ['uiElement', 'localTransform'],
				})
				.setProcess(({ queries, ecs }) => {
					const bounds = ecs.getResource('bounds');
					for (const entity of queries.uiElements) {
						const { uiElement, localTransform } = entity.components;
						resolveAnchorPosition(
							uiElement.anchor,
							uiElement.pivot,
							uiElement.offset,
							bounds,
							uiElement,
							scratchPos,
						);
						if (localTransform.x !== scratchPos.x || localTransform.y !== scratchPos.y) {
							localTransform.x = scratchPos.x;
							localTransform.y = scratchPos.y;
							ecs.markChanged(entity.id, 'localTransform');
						}
					}
				});

			// Pointer hit-test: reads inputState.pointer, updates uiInteraction.state, emits events.
			world
				.addSystem('ui-interaction')
				.setPriority(interactionPriority)
				.inPhase('preUpdate')
				.inGroup(systemGroup)
				.addQuery('interactables', {
					with: ['uiInteractive', 'uiInteraction', 'uiElement', 'worldTransform'],
					without: ['uiDisabled'],
				})
				.setProcess(({ queries, ecs }) => {
					const pointer = ecs.getResource('inputState').pointer;
					const px = pointer.position.x;
					const py = pointer.position.y;
					const down = pointer.isDown(0);
					const justReleased = pointer.justReleased(0);
					for (const entity of queries.interactables) {
						const { uiElement, worldTransform, uiInteraction } = entity.components;
						const hit =
							px >= worldTransform.x &&
							px < worldTransform.x + uiElement.width &&
							py >= worldTransform.y &&
							py < worldTransform.y + uiElement.height;
						const prev = uiInteraction.state;
						const next: UIInteractionState =
							!hit ? 'none'
							: down ? (prev === 'none' ? 'hover' : 'pressed')
							: 'hover';

						if (prev === 'pressed' && next === 'hover' && justReleased && hit) {
							ecs.eventBus.publish('uiButtonPressed', { entityId: entity.id });
						}
						if (prev === 'none' && next !== 'none') {
							ecs.eventBus.publish('uiButtonHovered', { entityId: entity.id, entered: true });
						}
						if (prev !== 'none' && next === 'none') {
							ecs.eventBus.publish('uiButtonHovered', { entityId: entity.id, entered: false });
						}
						if (prev !== next) {
							uiInteraction.state = next;
							ecs.markChanged(entity.id, 'uiInteraction');
						}
					}
				});

			// Panel sync: lazy-initialize PixiJS Graphics, redraw when panel or size changes.
			// Registered before labels/progress so panel Graphics sits BEHIND text/fill when an
			// entity carries multiple visual components (e.g. a button with uiPanel + uiLabel).
			world
				.addSystem('ui-panel-sync')
				.setPriority(renderSyncPriority)
				.inPhase('render')
				.inGroup(systemGroup)
				.setOnInitialize(async (ecs) => {
					const pixi = await import('pixi.js');
					const rootContainer = ecs.tryGetResource<Container>('rootContainer');
					ecs.addReactiveQuery('ui-panels', {
						with: ['uiPanel', 'uiElement'],
						onEnter: (entity) => {
							const g = new pixi.Graphics();
							panelPool.set(entity.id, {
								pixiGraphics: g,
								lastFillColor: Number.NaN,
								lastBorderColor: undefined,
								lastBorderWidth: Number.NaN,
								lastWidth: Number.NaN,
								lastHeight: Number.NaN,
							});
							if (rootContainer) rootContainer.addChild(g);
						},
						onExit: (entityId) => {
							const runtime = panelPool.get(entityId);
							if (runtime) {
								runtime.pixiGraphics.removeFromParent();
								runtime.pixiGraphics.destroy();
								panelPool.delete(entityId);
							}
						},
					});
				})
				.setProcess(({ ecs }) => {
					for (const [entityId, runtime] of panelPool) {
						const panel = ecs.getComponent(entityId, 'uiPanel');
						const element = ecs.getComponent(entityId, 'uiElement');
						if (!panel || !element) continue;
						syncPanelRuntime(runtime, panel, element);
						applyTransform(runtime.pixiGraphics, ecs.getComponent(entityId, 'worldTransform'));
					}
				});

			// Progress bar sync.
			world
				.addSystem('ui-progress-sync')
				.setPriority(renderSyncPriority)
				.inPhase('render')
				.inGroup(systemGroup)
				.setOnInitialize(async (ecs) => {
					const pixi = await import('pixi.js');
					const rootContainer = ecs.tryGetResource<Container>('rootContainer');
					ecs.addReactiveQuery('ui-progress-bars', {
						with: ['uiProgressBar', 'uiElement'],
						onEnter: (entity) => {
							const g = new pixi.Graphics();
							progressPool.set(entity.id, {
								pixiGraphics: g,
								lastValue: Number.NaN,
								lastMax: Number.NaN,
								lastFillColor: Number.NaN,
								lastBgColor: Number.NaN,
								lastDirection: 'ltr',
								lastWidth: Number.NaN,
								lastHeight: Number.NaN,
							});
							if (rootContainer) rootContainer.addChild(g);
						},
						onExit: (entityId) => {
							const runtime = progressPool.get(entityId);
							if (runtime) {
								runtime.pixiGraphics.removeFromParent();
								runtime.pixiGraphics.destroy();
								progressPool.delete(entityId);
							}
						},
					});
				})
				.setProcess(({ ecs }) => {
					for (const [entityId, runtime] of progressPool) {
						const bar = ecs.getComponent(entityId, 'uiProgressBar');
						const element = ecs.getComponent(entityId, 'uiElement');
						if (!bar || !element) continue;
						syncProgressRuntime(runtime, bar, element, scratchFill);
						applyTransform(runtime.pixiGraphics, ecs.getComponent(entityId, 'worldTransform'));
					}
				});

			// Message log sync: registered between progress and label so log text sits over panels
			// but under foreground labels when widgets overlap.
			world
				.addSystem('ui-message-log-sync')
				.setPriority(renderSyncPriority)
				.inPhase('render')
				.inGroup(systemGroup)
				.setOnInitialize(async (ecs) => {
					const pixi = await import('pixi.js');
					pixiModuleForMessageLog = pixi;
					const rootContainer = ecs.tryGetResource<Container>('rootContainer');
					ecs.addReactiveQuery('ui-message-logs', {
						with: ['uiMessageLog', 'uiElement'],
						onEnter: (entity) => {
							const root = new pixi.Container();
							messageLogPool.set(entity.id, {
								rootContainer: root,
								lines: [],
								lastLinesRef: null,
								lastVisibleLines: -1,
								lastLineHeight: Number.NaN,
								lastFontFamily: '',
								lastFontSize: Number.NaN,
								lastAlign: '',
							});
							if (rootContainer) rootContainer.addChild(root);
						},
						onExit: (entityId) => {
							const runtime = messageLogPool.get(entityId);
							if (runtime) {
								runtime.rootContainer.removeFromParent();
								runtime.rootContainer.destroy({ children: true });
								messageLogPool.delete(entityId);
							}
						},
					});
				})
				.setProcess(({ ecs }) => {
					if (!pixiModuleForMessageLog) return;
					for (const [entityId, runtime] of messageLogPool) {
						const log = ecs.getComponent(entityId, 'uiMessageLog');
						if (!log) continue;
						syncMessageLogRuntime(runtime, log, pixiModuleForMessageLog);
						applyTransform(runtime.rootContainer, ecs.getComponent(entityId, 'worldTransform'));
					}
				});

			// Label sync: registered last so Text sits ON TOP of panels and progress bars when an
			// entity carries multiple visual components.
			world
				.addSystem('ui-label-sync')
				.setPriority(renderSyncPriority)
				.inPhase('render')
				.inGroup(systemGroup)
				.setOnInitialize(async (ecs) => {
					const pixi = await import('pixi.js');
					const rootContainer = ecs.tryGetResource<Container>('rootContainer');
					ecs.addReactiveQuery('ui-labels', {
						with: ['uiLabel'],
						onEnter: (entity) => {
							const label = entity.components.uiLabel;
							const text = new pixi.Text({
								text: label.text,
								style: {
									fontFamily: label.style.fontFamily,
									fontSize: label.style.fontSize,
									fill: label.style.fill,
									align: label.style.align,
								},
							});
							labelPool.set(entity.id, {
								pixiText: text,
								lastText: label.text,
								lastFontSize: label.style.fontSize,
								lastFill: label.style.fill,
								lastAlign: label.style.align,
								lastFontFamily: label.style.fontFamily,
							});
							if (rootContainer) rootContainer.addChild(text);
						},
						onExit: (entityId) => {
							const runtime = labelPool.get(entityId);
							if (runtime) {
								runtime.pixiText.removeFromParent();
								runtime.pixiText.destroy();
								labelPool.delete(entityId);
							}
						},
					});
				})
				.setProcess(({ ecs }) => {
					for (const [entityId, runtime] of labelPool) {
						const label = ecs.getComponent(entityId, 'uiLabel');
						if (!label) continue;
						syncLabelRuntime(runtime, label);
						applyTransform(runtime.pixiText, ecs.getComponent(entityId, 'worldTransform'));
					}
				});
		});
}

// ==================== Sync Helpers ====================

function applyTransform(
	obj: { position: { x: number; y: number } },
	wt: WorldTransform | undefined,
): void {
	if (!wt) return;
	if (obj.position.x !== wt.x) obj.position.x = wt.x;
	if (obj.position.y !== wt.y) obj.position.y = wt.y;
}

function syncLabelRuntime(runtime: UILabelRuntime, label: UILabel): void {
	if (runtime.lastText !== label.text) {
		runtime.pixiText.text = label.text;
		runtime.lastText = label.text;
	}
	const style = runtime.pixiText.style;
	if (runtime.lastFontSize !== label.style.fontSize) {
		style.fontSize = label.style.fontSize;
		runtime.lastFontSize = label.style.fontSize;
	}
	if (runtime.lastFill !== label.style.fill) {
		style.fill = label.style.fill;
		runtime.lastFill = label.style.fill;
	}
	if (runtime.lastAlign !== label.style.align) {
		style.align = label.style.align;
		runtime.lastAlign = label.style.align;
	}
	if (runtime.lastFontFamily !== label.style.fontFamily) {
		style.fontFamily = label.style.fontFamily;
		runtime.lastFontFamily = label.style.fontFamily;
	}
}

function syncPanelRuntime(runtime: UIPanelRuntime, panel: UIPanel, element: UIElement): void {
	const changed =
		runtime.lastFillColor !== panel.fillColor ||
		runtime.lastBorderColor !== panel.borderColor ||
		runtime.lastBorderWidth !== panel.borderWidth ||
		runtime.lastWidth !== element.width ||
		runtime.lastHeight !== element.height;
	if (!changed) return;

	const g = runtime.pixiGraphics;
	g.clear();
	g.rect(0, 0, element.width, element.height);
	g.fill({ color: panel.fillColor });
	if (panel.borderColor !== undefined && panel.borderWidth > 0) {
		g.stroke({ color: panel.borderColor, width: panel.borderWidth });
	}
	runtime.lastFillColor = panel.fillColor;
	runtime.lastBorderColor = panel.borderColor;
	runtime.lastBorderWidth = panel.borderWidth;
	runtime.lastWidth = element.width;
	runtime.lastHeight = element.height;
}

function syncProgressRuntime(
	runtime: UIProgressRuntime,
	bar: UIProgressBar,
	element: UIElement,
	scratchFill: FillRect,
): void {
	const changed =
		runtime.lastValue !== bar.value ||
		runtime.lastMax !== bar.max ||
		runtime.lastFillColor !== bar.fillColor ||
		runtime.lastBgColor !== bar.bgColor ||
		runtime.lastDirection !== bar.direction ||
		runtime.lastWidth !== element.width ||
		runtime.lastHeight !== element.height;
	if (!changed) return;

	const clamped = clampProgressValue(bar.value, bar.max);
	const ratio = bar.max > 0 ? clamped / bar.max : 0;
	computeProgressFillRect(element.width, element.height, ratio, bar.direction, scratchFill);

	const g = runtime.pixiGraphics;
	g.clear();
	g.rect(0, 0, element.width, element.height);
	g.fill({ color: bar.bgColor });
	if (scratchFill.width > 0 && scratchFill.height > 0) {
		g.rect(scratchFill.x, scratchFill.y, scratchFill.width, scratchFill.height);
		g.fill({ color: bar.fillColor });
	}

	runtime.lastValue = bar.value;
	runtime.lastMax = bar.max;
	runtime.lastFillColor = bar.fillColor;
	runtime.lastBgColor = bar.bgColor;
	runtime.lastDirection = bar.direction;
	runtime.lastWidth = element.width;
	runtime.lastHeight = element.height;
}

function syncMessageLogRuntime(
	runtime: UIMessageLogRuntime,
	log: UIMessageLog,
	pixi: typeof import('pixi.js'),
): void {
	const styleChanged =
		runtime.lastFontFamily !== log.style.fontFamily ||
		runtime.lastFontSize !== log.style.fontSize ||
		runtime.lastAlign !== log.style.align;
	const linesChanged = runtime.lastLinesRef !== log.lines;
	const layoutChanged =
		runtime.lastVisibleLines !== log.visibleLines ||
		runtime.lastLineHeight !== log.lineHeight;
	if (!linesChanged && !layoutChanged && !styleChanged) return;

	const visible = log.lines.slice(-log.visibleLines);

	while (runtime.lines.length < visible.length) {
		const container = new pixi.Container();
		runtime.rootContainer.addChild(container);
		runtime.lines.push({ container, texts: [] });
	}
	runtime.lines.forEach((line, index) => {
		if (index >= visible.length) line.container.visible = false;
	});

	visible.forEach((fragments, lineIndex) => {
		const line = runtime.lines[lineIndex];
		if (!line) return;
		line.container.visible = true;
		line.container.position.y = lineIndex * log.lineHeight;

		while (line.texts.length < fragments.length) {
			const t = new pixi.Text({
				text: '',
				style: {
					fontFamily: log.style.fontFamily,
					fontSize: log.style.fontSize,
					fill: 0xffffff,
					align: log.style.align,
				},
			});
			line.container.addChild(t);
			line.texts.push(t);
		}

		let cursorX = 0;
		line.texts.forEach((t, j) => {
			const frag = fragments[j];
			if (!frag) {
				t.visible = false;
				return;
			}
			t.visible = true;
			if (t.text !== frag.text) t.text = frag.text;
			if (t.style.fill !== frag.color) t.style.fill = frag.color;
			t.position.x = cursorX;
			cursorX += t.width;
		});
	});

	// Style fields are shared across all fragments — apply once per Text when they change,
	// keeping the per-fragment loop above limited to per-fragment text + color writes.
	if (styleChanged) {
		runtime.lines.forEach((line) => {
			line.texts.forEach((t) => {
				const s = t.style;
				if (s.fontFamily !== log.style.fontFamily) s.fontFamily = log.style.fontFamily;
				if (s.fontSize !== log.style.fontSize) s.fontSize = log.style.fontSize;
				if (s.align !== log.style.align) s.align = log.style.align;
			});
		});
	}

	runtime.lastLinesRef = log.lines;
	runtime.lastVisibleLines = log.visibleLines;
	runtime.lastLineHeight = log.lineHeight;
	runtime.lastFontFamily = log.style.fontFamily;
	runtime.lastFontSize = log.style.fontSize;
	runtime.lastAlign = log.style.align;
}
