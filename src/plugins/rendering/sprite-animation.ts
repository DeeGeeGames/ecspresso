/**
 * Sprite Animation Plugin for ECSpresso
 *
 * ECS-native frame-based sprite animation. Advances through spritesheet frames,
 * handles loop modes (once, loop, pingPong), publishes completion events, and
 * syncs the current frame's texture to the PixiJS Sprite via structural access.
 *
 * Renderer2D is a required dependency — the `sprite` component comes from that plugin.
 * This plugin declares only `spriteAnimation` as its component type.
 */

import { defineSystemRef, type SystemOrderingOptions, definePlugin, type BasePluginOptions } from 'ecspresso';
import type { BaseWorld } from 'ecspresso';
import type { Spritesheet, SpritesheetData, Texture, TextureSource } from 'pixi.js';

/** BaseWorld narrowed to sprite-animation components for typed access in helpers. */
type SpriteAnimationWorld = BaseWorld<SpriteAnimationComponentTypes>;

// ==================== Loop Mode ====================

export type AnimationLoopMode = 'once' | 'loop' | 'pingPong';

// ==================== Clip Types ====================

/**
 * A single animation clip: an ordered sequence of texture frames with timing.
 * Immutable and shared across entities.
 */
export interface SpriteAnimationClip {
	readonly frames: readonly unknown[];
	readonly frameDuration: number;
	readonly frameDurations: readonly number[] | null;
	readonly loop: AnimationLoopMode;
}

/**
 * Input format for defining a clip. Accepts either uniform or per-frame timing.
 */
export interface SpriteAnimationClipInput {
	/** Array of PixiJS Texture objects */
	frames: readonly unknown[];
	/** Uniform seconds-per-frame (used when frameDurations is not provided) */
	frameDuration?: number;
	/** Per-frame durations in seconds (overrides frameDuration) */
	frameDurations?: readonly number[];
	/** Loop mode (default: 'loop') */
	loop?: AnimationLoopMode;
}

// ==================== Animation Set ====================

/**
 * A named collection of animation clips. Immutable and shared across entities.
 * Parameterized by A (animation name union) for compile-time validation.
 */
export interface SpriteAnimationSet<A extends string = string> {
	readonly id: string;
	readonly clips: { readonly [K in A]: SpriteAnimationClip };
	readonly defaultClip: A;
}

// ==================== Component ====================

/**
 * Per-entity runtime animation state.
 */
export interface SpriteAnimation<A extends string = string> {
	readonly set: SpriteAnimationSet<A>;
	current: A;
	currentFrame: number;
	elapsed: number;
	playing: boolean;
	speed: number;
	direction: 1 | -1;
	totalLoops: number;
	completedLoops: number;
	justFinished: boolean;
	onComplete?: (data: SpriteAnimationEventData) => void;
}

/**
 * Component types provided by the sprite animation plugin.
 */
export interface SpriteAnimationComponentTypes<A extends string = string> {
	spriteAnimation: SpriteAnimation<A>;
}

// ==================== Event Types ====================

/**
 * Data published when an animation completes.
 */
export interface SpriteAnimationEventData {
	entityId: number;
	animation: string;
}

// ==================== Plugin Options ====================

/** Public processing references. Factory before/after options target `update` only. */
export const spriteAnimationSystems = Object.freeze({
	update: defineSystemRef('rendering.sprite-animation.update'),
});

export interface SpriteAnimationPluginOptions<G extends string = 'spriteAnimation'> extends BasePluginOptions<G>, SystemOrderingOptions {}

// ==================== Helper Functions ====================

function buildClip(input: SpriteAnimationClipInput): SpriteAnimationClip {
	return Object.freeze({
		frames: Object.freeze([...input.frames]),
		frameDuration: input.frameDuration ?? (1 / 10),
		frameDurations: input.frameDurations
			? Object.freeze([...input.frameDurations])
			: null,
		loop: input.loop ?? 'loop',
	});
}

/**
 * Define a single-clip animation set named 'default'.
 * For simple use cases like spinning coins, pulsing effects, etc.
 *
 * @param id Unique identifier for this animation set
 * @param clip Clip definition
 * @returns A frozen SpriteAnimationSet with one clip named 'default'
 */
export function defineSpriteAnimation(
	id: string,
	clip: SpriteAnimationClipInput,
): SpriteAnimationSet<'default'> {
	return Object.freeze({
		id,
		clips: Object.freeze({ default: buildClip(clip) }),
		defaultClip: 'default' as const,
	});
}

/**
 * Define a multi-clip animation set with named animations.
 * Animation names are inferred from the keys of the clips object.
 *
 * @param id Unique identifier for this animation set
 * @param clips Object mapping animation names to clip definitions
 * @param options Optional configuration (defaultClip)
 * @returns A frozen SpriteAnimationSet with inferred animation name union
 */
export function defineSpriteAnimations<A extends string>(
	id: string,
	clips: Record<A, SpriteAnimationClipInput>,
	options?: { defaultClip?: NoInfer<A> },
): SpriteAnimationSet<A> {
	const builtClips = {} as Record<A, SpriteAnimationClip>;
	const keys = Object.keys(clips) as A[];

	for (const key of keys) {
		builtClips[key] = buildClip(clips[key]);
	}

	const firstKey = keys[0];
	if (!firstKey) {
		throw new Error(`defineSpriteAnimations: clips object must have at least one key`);
	}

	return Object.freeze({
		id,
		clips: Object.freeze(builtClips),
		defaultClip: options?.defaultClip ?? firstKey,
	});
}

/**
 * Create a spriteAnimation component from an animation set.
 *
 * @param set The animation set to use
 * @param options Optional configuration (initial clip, speed, onComplete event)
 * @returns Component object suitable for spreading into spawn()
 */
export function createSpriteAnimation<A extends string>(
	set: SpriteAnimationSet<A>,
	options?: {
		initial?: A;
		speed?: number;
		totalLoops?: number;
		onComplete?: (data: SpriteAnimationEventData) => void;
	},
): Pick<SpriteAnimationComponentTypes<A>, 'spriteAnimation'> {
	const initial = options?.initial ?? set.defaultClip;
	return {
		spriteAnimation: {
			set,
			current: initial,
			currentFrame: 0,
			elapsed: 0,
			playing: true,
			speed: options?.speed ?? 1,
			direction: 1,
			totalLoops: options?.totalLoops ?? -1,
			completedLoops: 0,
			justFinished: false,
			onComplete: options?.onComplete,
		},
	};
}

/**
 * Switch an entity's current animation at runtime.
 * Resets state if switching to a different animation (or restart=true).
 *
 * @returns false if entity has no spriteAnimation or animation name doesn't exist
 */
export function playAnimation(
	ecs: SpriteAnimationWorld,
	entityId: number,
	animation: string,
	options?: { restart?: boolean; speed?: number },
): boolean {
	const anim = ecs.getComponent(entityId, 'spriteAnimation');
	if (!anim) return false;
	if (!(animation in anim.set.clips)) return false;

	const shouldReset = animation !== anim.current || options?.restart === true;

	if (shouldReset) {
		anim.current = animation;
		anim.currentFrame = 0;
		anim.elapsed = 0;
		anim.direction = 1;
		anim.completedLoops = 0;
		anim.justFinished = false;
	}

	anim.playing = true;

	if (options?.speed !== undefined) {
		anim.speed = options.speed;
	}

	ecs.markChanged(entityId, 'spriteAnimation');
	return true;
}

/**
 * Pause an entity's animation.
 *
 * @returns false if entity has no spriteAnimation
 */
export function stopAnimation(
	ecs: SpriteAnimationWorld,
	entityId: number,
): boolean {
	const anim = ecs.getComponent(entityId, 'spriteAnimation');
	if (!anim) return false;

	anim.playing = false;
	return true;
}

/**
 * Resume a paused animation.
 *
 * @returns false if entity has no spriteAnimation
 */
export function resumeAnimation(
	ecs: SpriteAnimationWorld,
	entityId: number,
): boolean {
	const anim = ecs.getComponent(entityId, 'spriteAnimation');
	if (!anim) return false;

	anim.playing = true;
	return true;
}

// ==================== Animation Processing Helpers ====================

function completeAnimation(
	anim: SpriteAnimation,
	entityId: number,
	ecs: SpriteAnimationWorld,
): void {
	anim.playing = false;
	anim.justFinished = true;

	anim.onComplete?.({ entityId, animation: anim.current });

	ecs.commands.removeComponent(entityId, 'spriteAnimation');
}

function handleBoundary(
	anim: SpriteAnimation,
	clip: SpriteAnimationClip,
	entityId: number,
	ecs: SpriteAnimationWorld,
): boolean {
	anim.completedLoops++;

	if (clip.loop === 'once') {
		completeAnimation(anim, entityId, ecs);
		return false;
	}

	// Check finite loop count
	if (anim.totalLoops > 0 && anim.completedLoops >= anim.totalLoops) {
		completeAnimation(anim, entityId, ecs);
		return false;
	}

	if (clip.loop === 'pingPong') {
		anim.direction = anim.direction === 1 ? -1 : 1;
		// Step one frame in the new direction from the boundary
		anim.currentFrame += anim.direction;
		return anim.elapsed > 0;
	}

	// loop mode: wrap to frame 0
	anim.currentFrame = 0;
	return anim.elapsed > 0;
}

/**
 * Advance to next frame. Returns true if processing should continue (more overflow),
 * false if animation completed or reached a boundary.
 */
function advanceFrame(
	anim: SpriteAnimation,
	clip: SpriteAnimationClip,
	entityId: number,
	ecs: SpriteAnimationWorld,
): boolean {
	const nextFrame = anim.currentFrame + anim.direction;

	// Check boundary
	if (nextFrame >= clip.frames.length || nextFrame < 0) {
		return handleBoundary(anim, clip, entityId, ecs);
	}

	anim.currentFrame = nextFrame;
	return true;
}

function processFrameAdvancement(
	anim: SpriteAnimation,
	clip: SpriteAnimationClip,
	entityId: number,
	ecs: SpriteAnimationWorld,
): void {
	// Process frame overflow
	// eslint-disable-next-line no-constant-condition
	while (true) {
		const frameDuration = clip.frameDurations !== null
			? (clip.frameDurations[anim.currentFrame] ?? clip.frameDuration)
			: clip.frameDuration;

		if (frameDuration <= 0) {
			// Zero-duration frame: advance immediately
			if (!advanceFrame(anim, clip, entityId, ecs)) return;
			continue;
		}

		// Floating-point-safe comparison: treat elapsed within 1μs of
		// frameDuration as having reached the boundary.
		const remaining = frameDuration - anim.elapsed;
		if (remaining > 1e-6) return;

		// Frame complete — carry overflow (clamp negative remainders to 0)
		anim.elapsed = remaining < 0 ? -remaining : 0;

		if (!advanceFrame(anim, clip, entityId, ecs)) return;
	}
}

// ==================== Plugin Factory ====================

/**
 * Create a sprite animation plugin for ECSpresso.
 *
 * Provides:
 * - Frame-based animation system processing spriteAnimation components
 * - Loop modes: once, loop, pingPong
 * - justFinished one-frame flag for completion detection
 * - onComplete event publishing
 * - Sprite texture sync via structural cross-plugin access
 * - Change detection via markChanged
 */
export function createSpriteAnimationPlugin<
	G extends string = 'spriteAnimation',
>(
	options?: SpriteAnimationPluginOptions<G>,
) {
	const {
		systemGroup = 'spriteAnimation',
		priority = 0,
		phase = 'update',
	} = options ?? {};

	return definePlugin('spriteAnimation')
		.withComponentTypes<SpriteAnimationComponentTypes>()
		.withLabels<'sprite-animation-update'>()
		.withGroups<G>()
		.install((world) => {
			world
				.addSystem('sprite-animation-update')
				.withRef(spriteAnimationSystems.update)
				.before(...options?.before ?? [])
				.after(...options?.after ?? [])
				.setPriority(priority)
				.inPhase(phase)
				.inGroup(systemGroup)
				.addQuery('animations', {
					with: ['spriteAnimation'],
				})
				.setProcess(({ queries, dt, ecs }) => {
					for (const entity of queries.animations) {
						const anim = entity.components.spriteAnimation as SpriteAnimation;
						const clip = anim.set.clips[anim.current];
						if (!clip) continue;

						// Clear justFinished from previous frame
						if (anim.justFinished) {
							anim.justFinished = false;
							continue;
						}

						// Skip paused animations
						if (!anim.playing) continue;

						// Skip single-frame clips
						if (clip.frames.length <= 1) continue;

						const previousFrame = anim.currentFrame;
						anim.elapsed += dt * anim.speed;

						processFrameAdvancement(anim, clip, entity.id, ecs);

						// Sync sprite texture if frame changed
						if (anim.currentFrame !== previousFrame || previousFrame === 0) {
							syncSpriteTexture(entity.components as Record<string, unknown>, anim, clip);
						}

						if (anim.currentFrame !== previousFrame) {
							ecs.markChanged(entity.id, 'spriteAnimation');
						}
					}
				});
		});
}

// ==================== Internal: Sprite Texture Sync ====================

/**
 * Sync the sprite's texture to the current frame. Uses structural access
 * following the tween plugin's cross-component pattern.
 */
function syncSpriteTexture(
	entityComponents: Record<string, unknown>,
	anim: SpriteAnimation,
	clip: SpriteAnimationClip,
): void {
	const sprite = entityComponents['sprite'];
	if (sprite && typeof sprite === 'object' && 'texture' in sprite) {
		(sprite as { texture: unknown }).texture = clip.frames[anim.currentFrame];
	}
}

// ==================== Spritesheet Helpers ====================

/**
 * Per-clip timing/loop overrides keyed by animation name. Each entry tweaks
 * a single clip; omitted entries fall back to the top-level defaults.
 */
export type SheetClipOverrides<A extends string> = {
	readonly [K in A]?: Omit<SpriteAnimationClipInput, 'frames'>;
};

/**
 * Extract the animation-name union from a typed SpritesheetData. Falls back
 * to `string` for untyped sheets.
 */
export type SheetAnimationKeys<S extends SpritesheetData> =
	S extends { animations: infer A }
		? A extends Record<infer K, unknown>
			? K extends string ? K : never
			: string
		: string;

/**
 * Build a clip from a named animation in a loaded PixiJS Spritesheet.
 *
 * @example
 *   const sheet = await Assets.load<Spritesheet>('/hero.json');
 *   const idle = clipFromSheet(sheet, 'idle', { frameDuration: 1 / 12 });
 */
export function clipFromSheet(
	sheet: Spritesheet,
	animationName: string,
	options?: Omit<SpriteAnimationClipInput, 'frames'>,
): SpriteAnimationClip {
	const frames = sheet.animations[animationName];
	if (!frames || frames.length === 0) {
		const available = Object.keys(sheet.animations).join(', ') || '(none)';
		throw new Error(
			`clipFromSheet: animation "${animationName}" not found on sheet (or has no frames). Available: ${available}`,
		);
	}
	return buildClip({ ...options, frames });
}

/**
 * Build an animation set from every named animation in a PixiJS Spritesheet.
 * When the sheet is typed as `Spritesheet<MyData>`, animation names and
 * `defaultClip` / `perClip` keys are inferred at compile time.
 *
 * @example
 *   const sheet = ecs.assets.get('hero'); // Spritesheet<HeroData>
 *   const set = animationSetFromSheet('hero', sheet, {
 *     defaultClip: 'idle',
 *     frameDuration: 1 / 12,
 *     perClip: { attack: { loop: 'once' } },
 *   });
 */
export function animationSetFromSheet<S extends SpritesheetData = SpritesheetData>(
	id: string,
	sheet: Spritesheet<S>,
	options?: {
		defaultClip?: SheetAnimationKeys<S>;
		frameDuration?: number;
		loop?: AnimationLoopMode;
		perClip?: SheetClipOverrides<SheetAnimationKeys<S>>;
	},
): SpriteAnimationSet<SheetAnimationKeys<S>> {
	type A = SheetAnimationKeys<S>;
	const entries = Object.entries(sheet.animations) as unknown as [A, readonly unknown[]][];
	const firstEntry = entries[0];
	if (!firstEntry) {
		throw new Error(`animationSetFromSheet: sheet "${id}" has no animations defined`);
	}

	const clips = entries.reduce((acc, [name, sheetFrames]) => {
		if (!Array.isArray(sheetFrames) || sheetFrames.length === 0) {
			throw new Error(`animationSetFromSheet: animation "${String(name)}" on sheet "${id}" has no frames (got ${sheetFrames === null ? 'null' : Array.isArray(sheetFrames) ? 'empty array' : typeof sheetFrames})`);
		}
		const override = options?.perClip?.[name];
		acc[name] = buildClip({
			frames: sheetFrames,
			frameDuration: override?.frameDuration ?? options?.frameDuration,
			frameDurations: override?.frameDurations,
			loop: override?.loop ?? options?.loop,
		});
		return acc;
	}, {} as Record<A, SpriteAnimationClip>);

	return Object.freeze({
		id,
		clips: Object.freeze(clips),
		defaultClip: options?.defaultClip ?? firstEntry[0],
	});
}

/**
 * Slice a grid-arranged sprite sheet into a clip. Use when you don't have a
 * TexturePacker JSON — just an image and uniform cell dimensions. Cells are
 * walked row-major.
 *
 * Specify exactly one of `rows`, `count`, or `indices` to define the cell set
 * (along with `columns`). Combining `count` and `indices` is rejected.
 *
 * Returns a `Promise` because pixi.js is imported lazily — keeps the static
 * module graph free of a runtime pixi dependency for consumers who only use
 * the sheet-based helpers.
 *
 * @example
 *   const tex = await Assets.load<Texture>('/coin.png');
 *   const clip = await clipFromGrid({
 *     source: tex.source,
 *     frameWidth: 16, frameHeight: 16,
 *     columns: 8, count: 8,
 *     frameDuration: 1 / 10,
 *   });
 */
export async function clipFromGrid(input: {
	source: TextureSource;
	frameWidth: number;
	frameHeight: number;
	columns: number;
	rows?: number;
	/** Explicit row-major, 0-based cell indices. Mutually exclusive with `count`. */
	indices?: readonly number[];
	/** Number of cells to use, walked row-major. Mutually exclusive with `indices`. */
	count?: number;
	/** Pixels between cells. */
	spacing?: number;
	/** Pixels around the sheet edge. */
	margin?: number;
	frameDuration?: number;
	frameDurations?: readonly number[];
	loop?: AnimationLoopMode;
}): Promise<SpriteAnimationClip> {
	const { source, frameWidth, frameHeight, columns, rows, indices, count, spacing = 0, margin = 0 } = input;

	if (!source) {
		throw new Error(`clipFromGrid: source is required`);
	}
	if (!Number.isInteger(columns) || columns <= 0) {
		throw new Error(`clipFromGrid: columns must be a positive integer, got ${columns}`);
	}
	if (rows !== undefined && (!Number.isInteger(rows) || rows <= 0)) {
		throw new Error(`clipFromGrid: rows must be a positive integer, got ${rows}`);
	}
	if (count !== undefined && (!Number.isInteger(count) || count < 0)) {
		throw new Error(`clipFromGrid: count must be a non-negative integer, got ${count}`);
	}
	if (indices !== undefined && count !== undefined) {
		throw new Error(`clipFromGrid: pass either 'indices' or 'count', not both`);
	}
	if (indices === undefined && count === undefined && rows === undefined) {
		throw new Error(`clipFromGrid: specify 'rows', 'count', or 'indices' to define the cell set (only 'columns' is ambiguous)`);
	}

	const gridTotal = rows !== undefined ? columns * rows : undefined;
	const chosen: readonly number[] = indices ?? Array.from(
		{ length: gridTotal !== undefined && count !== undefined ? Math.min(count, gridTotal) : (count ?? gridTotal ?? 0) },
		(_, i) => i,
	);

	if (chosen.length === 0) {
		throw new Error(`clipFromGrid: resolved to zero cells (empty indices array or count: 0)`);
	}

	const upperBound = gridTotal ?? Infinity;
	const invalid = chosen.find(idx => !Number.isInteger(idx) || idx < 0 || idx >= upperBound);
	if (invalid !== undefined) {
		const bounds = gridTotal !== undefined ? `[0, ${gridTotal})` : `[0, ∞) — pass 'rows' to enable upper-bound checking`;
		throw new Error(`clipFromGrid: invalid cell index ${invalid}; expected integer in ${bounds}`);
	}

	const { Texture, Rectangle } = await import('pixi.js');

	const frames: Texture[] = chosen.map(idx => {
		const col = idx % columns;
		const row = Math.floor(idx / columns);
		const x = margin + col * (frameWidth + spacing);
		const y = margin + row * (frameHeight + spacing);
		return new Texture({
			source,
			frame: new Rectangle(x, y, frameWidth, frameHeight),
		});
	});

	return buildClip({
		frames,
		frameDuration: input.frameDuration,
		frameDurations: input.frameDurations,
		loop: input.loop,
	});
}

/**
 * Build an asset-manager-compatible loader for a PixiJS spritesheet atlas
 * (TexturePacker JSON, etc.). Returns the fully-parsed `Spritesheet` object
 * with `.animations` and `.textures` populated.
 *
 * The loader performs a runtime shape check on the resolved value — `Assets.load<T>`
 * is purely nominal in PixiJS, so pointing this at a non-atlas URL would
 * otherwise surface as a misleading 'animation not found' error deep in
 * `clipFromSheet`/`animationSetFromSheet`. The shape check turns that into a
 * load-time error with a clear message.
 *
 * To get literal animation-name inference, declare `S` as an
 * `interface ... extends SpritesheetData` (a `type` alias re-widens via
 * `SpritesheetData.animations`'s `Dict<string[]>` string index signature).
 *
 * @example
 *   interface HeroData extends SpritesheetData {
 *     animations: { idle: string[]; walk: string[]; attack: string[] };
 *   }
 *
 *   ecs.builder.withAssets(a => a
 *     .add('hero', spritesheetLoader<HeroData>('/hero.json'))
 *   );
 *
 *   // Later:
 *   const sheet = ecs.assets.get('hero');           // Spritesheet<HeroData>
 *   const set = animationSetFromSheet('hero', sheet); // names inferred
 */
export function spritesheetLoader<S extends SpritesheetData = SpritesheetData>(
	url: string,
): () => Promise<Spritesheet<S>> {
	return async () => {
		const { Assets } = await import('pixi.js');
		const result = await Assets.load<Spritesheet<S>>(url);
		// Verify properties exist AND are non-null objects — `'animations' in result`
		// alone would pass for { animations: undefined }, defeating the load-time guard.
		if (
			!result || typeof result !== 'object'
			|| typeof (result as { animations?: unknown }).animations !== 'object'
			|| (result as { animations: unknown }).animations === null
			|| typeof (result as { textures?: unknown }).textures !== 'object'
			|| (result as { textures: unknown }).textures === null
		) {
			throw new Error(
				`spritesheetLoader: resource at "${url}" did not resolve to a Spritesheet ` +
				`(expected non-null 'animations' and 'textures' objects). Check that the URL points to a TexturePacker-style JSON atlas, not a raw image.`,
			);
		}
		return result;
	};
}
