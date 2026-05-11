/**
 * Timer Plugin for ECSpresso
 *
 * ECS-native timers as pure data. An entity may carry multiple named timer
 * slots; the plugin's update system ticks every slot each frame and exposes
 * `justFinished` for the frame a slot crosses its duration. The plugin never
 * touches entity lifecycle — callers despawn (or do anything else) themselves
 * by reacting to `justFinished` or in the slot's `onComplete` callback.
 */

import { definePlugin, type BasePluginOptions } from 'ecspresso';

// ==================== Event Types ====================

/**
 * Data passed to a slot's `onComplete` callback when its timer completes.
 *
 * @example
 * ```typescript
 * timers: {
 *   launch: createTimer(1.5, {
 *     onComplete: ({ entityId, slot, elapsed }) => {
 *       console.log(`Slot ${slot} on entity ${entityId} finished after ${elapsed}s`);
 *     },
 *   }),
 * }
 * ```
 */
export interface TimerEventData<Slots extends string = string> {
	/** The entity ID that owns the timer slot */
	entityId: number;
	/** The slot name within the entity's `timers` map */
	slot: Slots;
	/** The slot's configured duration in seconds */
	duration: number;
	/** The actual elapsed time (may exceed duration slightly) */
	elapsed: number;
}

// ==================== Component Types ====================

/**
 * A single timer's data. Multiple of these can live on one entity, keyed by slot name.
 * Use `justFinished` to detect completion in your systems.
 */
export interface Timer<Slots extends string = string> {
	/** Time accumulated so far (seconds) */
	elapsed: number;
	/** Target duration (seconds) */
	duration: number;
	/** Whether the timer repeats after completion */
	repeat: boolean;
	/** Whether the timer is currently running */
	active: boolean;
	/** True for one frame after the timer completes */
	justFinished: boolean;
	/** Optional callback invoked when the timer completes */
	onComplete?: (data: TimerEventData<Slots>) => void;
}

/**
 * Component types provided by the timer plugin.
 *
 * Each entity carries a single `timers` component whose value is a map of
 * named slots. This lets one entity host independent phase clocks
 * (e.g. `{ launch: ..., shieldDepletion: ..., hangarCycle: ... }`) without
 * one timer's lifecycle constraining another.
 *
 * @example
 * ```typescript
 * const ecs = ECSpresso.create()
 *   .withPlugin(createTimerPlugin())
 *   .withComponentTypes<{ fighter: true }>()
 *   .build();
 *
 * ecs.spawn({
 *   fighter: true,
 *   timers: { launch: createTimer(2.0) },
 * });
 * ```
 */
export interface TimerComponentTypes<Slots extends string = string> {
	timers: Partial<Record<Slots, Timer<Slots>>>;
}

// ==================== Plugin Options ====================

export interface TimerPluginOptions<G extends string = 'timers'> extends BasePluginOptions<G> {}

// ==================== Helper Functions ====================

export interface TimerOptions<Slots extends string = string> {
	/** Callback invoked when the timer completes */
	onComplete?: (data: TimerEventData<Slots>) => void;
}

/**
 * Create a one-shot `Timer` to drop into a `timers` slot.
 *
 * The timer fires `justFinished` for one frame on completion and then idles
 * (`active = false`). The entity is left alone — if the slot's lifetime
 * coincides with the entity's lifetime (vfx, blasts, summon-anim), despawn
 * the host yourself in `onComplete` or in a system that watches `justFinished`.
 *
 * @example
 * ```typescript
 * ecs.spawn({
 *   fighter: true,
 *   timers: { launch: createTimer(2.0) },
 * });
 *
 * // Self-destructing vfx — caller owns the despawn:
 * ecs.spawn({
 *   timers: {
 *     fade: createTimer(1.0, {
 *       onComplete: ({ entityId }) => ecs.commands.removeEntity(entityId),
 *     }),
 *   },
 * });
 * ```
 */
export function createTimer<Slots extends string = string>(duration: number, options?: TimerOptions<Slots>): Timer<Slots> {
	return {
		elapsed: 0,
		duration,
		repeat: false,
		active: true,
		justFinished: false,
		onComplete: options?.onComplete,
	};
}

/**
 * Create a repeating `Timer` to drop into a `timers` slot. Fires
 * `justFinished` once per cycle and continues running.
 *
 * @example
 * ```typescript
 * ecs.spawn({
 *   carrier: true,
 *   timers: { hangarCycle: createRepeatingTimer(5.0) },
 * });
 * ```
 */
export function createRepeatingTimer<Slots extends string = string>(duration: number, options?: TimerOptions<Slots>): Timer<Slots> {
	return {
		elapsed: 0,
		duration,
		repeat: true,
		active: true,
		justFinished: false,
		onComplete: options?.onComplete,
	};
}

// ==================== Plugin Factory ====================

/**
 * Create a timer plugin for ECSpresso.
 *
 * The plugin installs one update system that ticks every slot of every
 * `timers` component each frame. It does not touch entity lifecycle —
 * react to `justFinished` (or use `onComplete`) and despawn yourself if needed.
 *
 * @example
 * ```typescript
 * const ecs = ECSpresso.create()
 *   .withPlugin(createTimerPlugin())
 *   .withComponentTypes<{ spawner: true }>()
 *   .build();
 *
 * ecs.spawn({
 *   spawner: true,
 *   timers: { wave: createRepeatingTimer(5.0) },
 * });
 *
 * ecs.addSystem('spawn-on-timer')
 *   .addQuery('spawners', { with: ['timers', 'spawner'] })
 *   .setProcess(({ queries, ecs }) => {
 *     for (const { components } of queries.spawners) {
 *       if (components.timers.wave?.justFinished) {
 *         ecs.spawn({ enemy: true });
 *       }
 *     }
 *   });
 * ```
 *
 * @example
 * Typed slot names — pass a string-union generic to lock the set of legal
 * slot names. Spawn sites reject typos, autocomplete works on slot access,
 * and `slot` is narrowed in `onComplete` callbacks. Defaults to `string`
 * (any slot name) when omitted.
 *
 * ```typescript
 * const ecs = ECSpresso.create()
 *   .withPlugin(createTimerPlugin<'launch' | 'hangarCycle'>())
 *   .build();
 *
 * ecs.spawn({ timers: { launch: createTimer(2.0) } });   // ok
 * ecs.spawn({ timers: { typo:   createTimer(2.0) } });   // type error
 *
 * createTimer<'launch' | 'hangarCycle'>(1.0, {
 *   onComplete: ({ slot }) => {
 *     // slot is 'launch' | 'hangarCycle', not string
 *   },
 * });
 * ```
 *
 * Only one timer plugin can be installed per world. Feature plugins should
 * re-export their slot union as a type so the app can assemble them:
 * `createTimerPlugin<FighterSlots | CarrierSlots>()`.
 */
export function createTimerPlugin<
	Slots extends string = string,
	G extends string = 'timers',
>(
	options?: TimerPluginOptions<G>
) {
	const {
		systemGroup = 'timers',
		priority = 0,
		phase = 'preUpdate',
	} = options ?? {};

	return definePlugin('timers')
		.withComponentTypes<TimerComponentTypes<Slots>>()
		.withLabels<'timer-update'>()
		.withGroups<G>()
		.install((world) => {
			world
				.addSystem('timer-update')
				.setPriority(priority)
				.inPhase(phase)
				.inGroup(systemGroup)
				.addQuery('timers', { with: ['timers'] })
				.setProcess(({ queries, dt }) => {
					for (const entity of queries.timers) {
						const slots = entity.components.timers;
						for (const slot in slots) {
							const timer = slots[slot];
							if (!timer) continue;

							timer.justFinished = false;
							if (!timer.active) continue;

							timer.elapsed += dt;
							if (timer.elapsed < timer.duration) continue;

							if (timer.repeat) {
								while (timer.elapsed >= timer.duration) {
									timer.justFinished = true;
									timer.onComplete?.({
										entityId: entity.id,
										slot,
										duration: timer.duration,
										elapsed: timer.elapsed,
									});
									timer.elapsed -= timer.duration;
								}
							} else {
								timer.justFinished = true;
								timer.onComplete?.({
									entityId: entity.id,
									slot,
									duration: timer.duration,
									elapsed: timer.elapsed,
								});
								timer.active = false;
							}
						}
					}
				});
		});
}
