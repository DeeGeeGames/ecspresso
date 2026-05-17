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

import { definePlugin, type BasePluginOptions } from 'ecspresso';
import type { BaseWorld } from 'ecspresso';

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

export interface SpriteAnimationPluginOptions<G extends string = 'spriteAnimation'> extends BasePluginOptions<G> {}

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
