/**
 * Coroutine Plugin for ECSpresso
 *
 * ES6 generator-based coroutines for multi-step, frame-spanning scripted sequences.
 * A `coroutine` component holds a live generator. A system ticks all generators each
 * frame via `.next(dt)`. Helper generators (`waitSeconds`, `waitFrames`, `waitUntil`,
 * `waitForEvent`, `parallel`, `race`) compose via `yield*`.
 */

import { definePlugin, type BasePluginOptions } from 'ecspresso';
import type { EventsOfWorld, AnyECSpresso } from 'ecspresso';

// ==================== Generator Protocol ====================

/**
 * Yields void, returns void, receives deltaTime (number) via `.next(dt)`.
 * First `.next(dt)` initializes the generator (runs to first yield, dt discarded per JS spec).
 * Subsequent `.next(dt)` resume from yield with dt as the yield expression value.
 */
export type CoroutineGenerator = Generator<void, void, number>;

// ==================== Event Types ====================

export interface CoroutineEventData {
	entityId: number;
}


// ==================== Component Types ====================

export interface CoroutineState {
	generator: CoroutineGenerator;
	onComplete?: (data: CoroutineEventData) => void;
}

export interface CoroutineComponentTypes {
	coroutine: CoroutineState;
}

// ==================== Plugin Options ====================

export interface CoroutinePluginOptions<G extends string = 'coroutines'> extends BasePluginOptions<G> {}

// ==================== Component Factory ====================

export interface CoroutineOptions {
	onComplete?: (data: CoroutineEventData) => void;
}

/**
 * Create a coroutine component for spawning or adding to an entity.
 *
 * @param generator - The generator function to drive
 * @param options - Optional configuration (onComplete event)
 * @returns Component object suitable for spreading into spawn()
 */
export function createCoroutine(
	generator: CoroutineGenerator,
	options?: CoroutineOptions,
): Pick<CoroutineComponentTypes, 'coroutine'> {
	return {
		coroutine: {
			generator,
			onComplete: options?.onComplete,
		},
	};
}

// ==================== Helper Generators (standalone) ====================

/**
 * Wait for a specified number of seconds. Accumulates dt until elapsed >= seconds.
 * If seconds <= 0, returns immediately.
 */
export function* waitSeconds(seconds: number): CoroutineGenerator {
	if (seconds <= 0) return;
	let elapsed = 0;
	while (elapsed < seconds) {
		const dt: number = yield;
		elapsed += dt;
	}
}

/**
 * Wait for a specified number of frames. Yields `frames` times.
 * If frames <= 0, returns immediately.
 */
export function* waitFrames(frames: number): CoroutineGenerator {
	for (let i = 0; i < frames; i++) {
		yield;
	}
}

/**
 * Wait until a predicate returns true. Yields each frame until predicate is satisfied.
 * User closes over ecs if needed for state checks.
 */
export function* waitUntil(predicate: () => boolean): CoroutineGenerator {
	while (!predicate()) {
		yield;
	}
}

/**
 * Run multiple coroutines in parallel. Completes when all finish.
 * Initializes all sub-generators, ticks all each frame.
 * Empty array = immediate return.
 */
export function* parallel(...coroutines: CoroutineGenerator[]): CoroutineGenerator {
	if (coroutines.length === 0) return;

	// Initialize all generators
	const active = coroutines.map(gen => {
		gen.next(0);
		return { gen, done: false };
	});

	while (active.some(entry => !entry.done)) {
		const dt: number = yield;
		for (const entry of active) {
			if (entry.done) continue;
			const result = entry.gen.next(dt);
			if (result.done) {
				entry.done = true;
			}
		}
	}
}

/**
 * Run multiple coroutines, completing when the first one finishes.
 * Calls `.return()` on remaining generators (triggers finally blocks).
 * Empty array = immediate return.
 */
export function* race(...coroutines: CoroutineGenerator[]): CoroutineGenerator {
	if (coroutines.length === 0) return;

	// Initialize all generators
	const entries = coroutines.map(gen => {
		gen.next(0);
		return { gen, done: false };
	});

	try {
		while (true) {
			const dt: number = yield;
			for (const entry of entries) {
				if (entry.done) continue;
				const result = entry.gen.next(dt);
				if (result.done) {
					entry.done = true;
					// Cancel all others
					for (const other of entries) {
						if (!other.done) {
							other.gen.return();
							other.done = true;
						}
					}
					return;
				}
			}
		}
	} finally {
		// Clean up all on external cancellation
		for (const entry of entries) {
			if (!entry.done) {
				entry.gen.return();
				entry.done = true;
			}
		}
	}
}

// ==================== Helper Generator (ECS-dependent) ====================

/**
 * Wait until a matching event fires on the event bus.
 * Subscribes via eventBus.subscribe, yields until event received, unsubscribes in finally block.
 *
 * @param eventBus - Object with subscribe method (typically ecs.eventBus)
 * @param eventType - Event type name to listen for
 * @param filter - Optional predicate to filter events
 */
export function* waitForEvent<ET extends Record<string, any>, E extends keyof ET & string>(
	eventBus: { subscribe(type: E, cb: (data: ET[E]) => void): () => void },
	eventType: E,
	filter?: (data: ET[E]) => boolean,
): CoroutineGenerator {
	let received = false;
	const unsubscribe = eventBus.subscribe(eventType, (data: ET[E]) => {
		if (!filter || filter(data)) {
			received = true;
		}
	});
	try {
		while (!received) {
			yield;
		}
	} finally {
		unsubscribe();
	}
}

// ==================== Cancellation ====================

/**
 * Structural interface for ECS methods used by cancelCoroutine.
 */
export interface CoroutineWorld {
	getComponent(entityId: number, componentName: string): unknown | undefined;
	commands: {
		removeComponent(entityId: number, componentName: string): void;
	};
}

/**
 * Cancel a running coroutine on an entity. Calls generator.return() (triggers finally blocks)
 * and queues component removal.
 *
 * @returns true if the entity had a coroutine that was cancelled, false otherwise
 */
export function cancelCoroutine(ecs: CoroutineWorld, entityId: number): boolean {
	const state = ecs.getComponent(entityId, 'coroutine') as CoroutineState | undefined;
	if (!state) return false;
	state.generator.return();
	ecs.commands.removeComponent(entityId, 'coroutine');
	return true;
}

// ==================== Typed Helpers (replaces Kit Pattern) ====================

/**
 * Type-safe coroutine helpers that validate event names against a world's event types.
 * Use `createCoroutineHelpers<typeof ecs>()` to get compile-time validation.
 */
export interface CoroutineHelpers<W extends AnyECSpresso> {
	createCoroutine: (
		generator: CoroutineGenerator,
		options?: { onComplete?: (data: CoroutineEventData) => void },
	) => Pick<CoroutineComponentTypes, 'coroutine'>;
	waitForEvent: <E extends keyof EventsOfWorld<W> & string>(
		eventBus: { subscribe(type: E, cb: (data: EventsOfWorld<W>[E]) => void): () => void },
		eventType: E,
		filter?: (data: EventsOfWorld<W>[E]) => boolean,
	) => CoroutineGenerator;
}

/**
 * Create typed coroutine helpers that validate event names at compile time.
 *
 * @example
 * ```typescript
 * const { createCoroutine, waitForEvent } = createCoroutineHelpers<typeof ecs>();
 * ecs.spawn({ ...createCoroutine(myGen(), { onComplete: (data) => console.log(data.entityId) }) });
 * ```
 */
export function createCoroutineHelpers<W extends AnyECSpresso>(_world?: W): CoroutineHelpers<W> {
	return {
		createCoroutine: createCoroutine as CoroutineHelpers<W>['createCoroutine'],
		waitForEvent: waitForEvent as CoroutineHelpers<W>['waitForEvent'],
	};
}

// ==================== Plugin Factory ====================

/**
 * Create a coroutine plugin for ECSpresso.
 *
 * This plugin provides:
 * - Coroutine system that ticks all generator-based coroutines each frame
 * - Automatic cleanup via dispose callback (triggers generator finally blocks)
 * - `onComplete` callback invocation
 * - Component removal on completion
 */
export function createCoroutinePlugin<G extends string = 'coroutines'>(
	options?: CoroutinePluginOptions<G>,
) {
	const {
		systemGroup = 'coroutines',
		priority = 0,
		phase = 'update',
	} = options ?? {};

	return definePlugin('coroutines')
		.withComponentTypes<CoroutineComponentTypes>()
		.withLabels<'coroutine-update'>()
		.withGroups<G>()
		.install((world) => {
			// Tracks entities whose coroutine completed this frame to prevent re-ticking
			// before the command buffer removes the component.
			const finished = new Set<number>();

			world.registerDispose('coroutine', ({ value, entityId }) => {
				value.generator.return();
				finished.delete(entityId);
			});

			world
				.addSystem('coroutine-update')
				.setPriority(priority)
				.inPhase(phase)
				.inGroup(systemGroup)
				.addQuery('coroutines', {
					with: ['coroutine'],
				})
				.setOnEntityEnter('coroutines', ({ entity }) => {
					entity.components.coroutine.generator.next(0);
				})
				.setProcess(({ queries, dt, ecs }) => {
					for (const entity of queries.coroutines) {
						// Already completed — skip until command buffer removes the component
						if (finished.has(entity.id)) {
							finished.delete(entity.id);
							continue;
						}

						const state = entity.components.coroutine;

						// Tick the generator
						try {
							const result = state.generator.next(dt);
							if (result.done) {
								finished.add(entity.id);
								state.onComplete?.({ entityId: entity.id });
								ecs.commands.removeComponent(entity.id, 'coroutine');
							}
						} catch (error) {
							console.warn(`Coroutine error on entity ${entity.id}:`, error);
							finished.add(entity.id);
							ecs.commands.removeComponent(entity.id, 'coroutine');
						}
					}
				});
		});
}
