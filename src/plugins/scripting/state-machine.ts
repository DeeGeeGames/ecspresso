/**
 * State Machine Plugin for ECSpresso
 *
 * Provides ECS-native finite state machines with guard-based transitions,
 * event-driven transitions, and lifecycle hooks (onEnter, onExit, onUpdate).
 *
 * Each entity gets a `stateMachine` component referencing a shared definition.
 * One system processes all state machine entities each tick.
 */

import { definePlugin, type BasePluginOptions } from 'ecspresso';
import type { BaseWorld } from 'ecspresso';

/** BaseWorld narrowed to state-machine components for typed access in helpers. */
type StateMachineWorld = BaseWorld<StateMachineComponentTypes>;

// ==================== State Config ====================

/**
 * Configuration for a single state in a state machine definition.
 *
 * @template S - Union of state name strings
 * @template W - World interface type for hooks/guards (default: StateMachineWorld)
 */
export interface StateConfig<S extends string, W extends BaseWorld<StateMachineComponentTypes> = StateMachineWorld> {
	/** Called when entering this state */
	onEnter?(ctx: { ecs: W; entityId: number }): void;
	/** Called when exiting this state */
	onExit?(ctx: { ecs: W; entityId: number }): void;
	/** Called each tick while in this state */
	onUpdate?(ctx: { ecs: W; entityId: number; dt: number }): void;
	/** Guard-based transitions evaluated each tick. First passing guard wins. */
	transitions?: ReadonlyArray<{
		target: S;
		guard(ctx: { ecs: W; entityId: number }): boolean;
	}>;
	/** Event-based transition map: eventName → target state or guarded transition */
	on?: Record<string, S | { target: S; guard(ctx: { ecs: W; entityId: number }): boolean }>;
}

// ==================== State Machine Definition ====================

/**
 * Immutable definition of a state machine. Shared across entities.
 *
 * @template S - Union of state name strings
 */
export interface StateMachineDefinition<S extends string> {
	readonly id: string;
	readonly initial: S;
	readonly states: { readonly [K in S]: StateConfig<S> };
}

// ==================== Component ====================

/**
 * Runtime state machine component stored on each entity.
 *
 * @template S - Union of state name strings (default: string)
 */
export interface StateMachine<S extends string = string> {
	readonly definition: StateMachineDefinition<string>;
	current: S;
	previous: S | null;
	stateTime: number;
}

/**
 * Component types provided by the state machine plugin.
 *
 * @template S - Union of state name strings (default: string)
 */
export interface StateMachineComponentTypes<S extends string = string> {
	stateMachine: StateMachine<S>;
}

// ==================== Event Types ====================

/**
 * Event published on every state transition.
 *
 * @template S - Union of state name strings (default: string)
 */
export interface StateTransitionEvent<S extends string = string> {
	entityId: number;
	from: S;
	to: S;
	definitionId: string;
}

/**
 * Event types provided by the state machine plugin.
 *
 * @template S - Union of state name strings (default: string)
 */
export interface StateMachineEventTypes<S extends string = string> {
	stateTransition: StateTransitionEvent<S>;
}

/**
 * Extract the state name union from a StateMachineDefinition.
 *
 * @example
 * ```typescript
 * const enemyFSM = defineStateMachine('enemy', { initial: 'idle', states: { idle: {}, chase: {} } });
 * type EnemyStates = StatesOf<typeof enemyFSM>; // 'idle' | 'chase'
 * type AllStates = StatesOf<typeof enemyFSM> | StatesOf<typeof playerFSM>;
 * ```
 */
export type StatesOf<D> = D extends StateMachineDefinition<infer S> ? S : never;

// ==================== Plugin Options ====================

/**
 * Configuration options for the state machine plugin.
 */
export interface StateMachinePluginOptions<G extends string = 'stateMachine'> extends BasePluginOptions<G> {}

// ==================== Helper Functions ====================

/**
 * Define a state machine with type-safe state names.
 *
 * @template S - Union of state name strings, inferred from `states` keys
 * @param id - Unique identifier for this definition
 * @param config - Initial state and state configurations
 * @returns A frozen StateMachineDefinition
 *
 * @example
 * ```typescript
 * const enemyFSM = defineStateMachine('enemy', {
 *   initial: 'idle',
 *   states: {
 *     idle: {
 *       onEnter: ({ ecs, entityId }) => { ... },
 *       transitions: [{ target: 'chase', guard: ({ ecs, entityId }) => playerNearby(ecs, entityId) }],
 *     },
 *     chase: {
 *       onUpdate: ({ ecs, entityId, dt }) => { ... },
 *       on: { playerLost: 'idle' },
 *     },
 *   },
 * });
 * ```
 */
export function defineStateMachine<S extends string>(
	id: string,
	config: { initial: NoInfer<S>; states: Record<S, StateConfig<NoInfer<S>>> },
): StateMachineDefinition<S> {
	return Object.freeze({
		id,
		initial: config.initial,
		states: Object.freeze(config.states),
	}) as StateMachineDefinition<S>;
}

/**
 * Create a stateMachine component from a definition.
 *
 * @param definition - The state machine definition to use
 * @param options - Optional overrides (e.g., initial state)
 * @returns Component object suitable for spreading into spawn()
 *
 * @example
 * ```typescript
 * ecs.spawn({
 *   ...createStateMachine(enemyFSM),
 *   position: { x: 100, y: 200 },
 * });
 * ```
 */
export function createStateMachine<S extends string>(
	definition: StateMachineDefinition<S>,
	options?: { initial?: S },
): Pick<StateMachineComponentTypes<S>, 'stateMachine'> {
	const initial = options?.initial ?? definition.initial;
	return {
		stateMachine: {
			definition,
			current: initial,
			previous: null,
			stateTime: 0,
		},
	};
}

// ==================== Internal: Shared Transition Logic ====================

/**
 * Perform a state transition: onExit → update fields → onEnter → markChanged → publish event.
 * Returns true if the target state exists, false otherwise.
 */
function performTransition(
	ecs: StateMachineWorld,
	entityId: number,
	sm: StateMachine,
	targetState: string,
): boolean {
	const states = sm.definition.states as Record<string, StateConfig<string>>;
	const currentConfig = states[sm.current];
	const targetConfig = states[targetState];

	if (!targetConfig) return false;

	currentConfig?.onExit?.({ ecs, entityId });

	sm.previous = sm.current;
	sm.current = targetState;
	sm.stateTime = 0;

	targetConfig.onEnter?.({ ecs, entityId });

	ecs.markChanged(entityId, 'stateMachine');
	ecs.eventBus.publish('stateTransition', {
		entityId,
		from: sm.previous,
		to: sm.current,
		definitionId: sm.definition.id,
	} satisfies StateTransitionEvent);

	return true;
}

// ==================== Utility Functions ====================

/**
 * Directly transition an entity's state machine to a target state.
 * Fires onExit, onEnter hooks and publishes stateTransition event.
 *
 * @param ecs - ECS instance (structural typing)
 * @param entityId - Entity to transition
 * @param targetState - State to transition to
 * @returns true if transition succeeded, false if entity has no stateMachine or target state doesn't exist
 */
export function transitionTo(
	ecs: StateMachineWorld,
	entityId: number,
	targetState: string,
): boolean {
	const sm = ecs.getComponent(entityId, 'stateMachine');
	if (!sm) return false;
	return performTransition(ecs, entityId, sm, targetState);
}

/**
 * Send a named event to an entity's state machine.
 * Checks the current state's `on` handlers for a matching event.
 *
 * @param ecs - ECS instance (structural typing)
 * @param entityId - Entity to send event to
 * @param eventName - Event name to match against `on` handlers
 * @returns true if a transition occurred, false otherwise
 */
export function sendEvent(
	ecs: StateMachineWorld,
	entityId: number,
	eventName: string,
): boolean {
	const sm = ecs.getComponent(entityId, 'stateMachine');
	if (!sm) return false;

	const states = sm.definition.states as Record<string, StateConfig<string>>;
	const currentConfig = states[sm.current];
	if (!currentConfig?.on) return false;

	const handler = currentConfig.on[eventName];
	if (handler === undefined) return false;

	if (typeof handler === 'string') {
		return performTransition(ecs, entityId, sm, handler);
	}

	if (!handler.guard({ ecs, entityId })) return false;
	return performTransition(ecs, entityId, sm, handler.target);
}

/**
 * Get the current state of an entity's state machine.
 *
 * @param ecs - ECS instance (structural typing)
 * @param entityId - Entity to query
 * @returns The current state string, or undefined if entity has no stateMachine
 */
export function getStateMachineState(
	ecs: StateMachineWorld,
	entityId: number,
): string | undefined {
	const sm = ecs.getComponent(entityId, 'stateMachine');
	return sm?.current;
}

// ==================== State Machine Helpers ====================

/**
 * Typed helpers for the state machine plugin.
 * Creates helpers that validate hook parameters against the world type W.
 * Call after .build() using typeof ecs.
 */
export interface StateMachineHelpers<W extends BaseWorld<StateMachineComponentTypes>> {
	defineStateMachine: <S extends string>(
		id: string,
		config: { initial: NoInfer<S>; states: Record<S, StateConfig<NoInfer<S>, W>> },
	) => StateMachineDefinition<S>;
}

export function createStateMachineHelpers<W extends BaseWorld<StateMachineComponentTypes> = StateMachineWorld>(_world?: W): StateMachineHelpers<W> {
	return {
		defineStateMachine: defineStateMachine as StateMachineHelpers<W>['defineStateMachine'],
	};
}

// ==================== Plugin Factory ====================

/**
 * Create a state machine plugin for ECSpresso.
 *
 * Provides:
 * - Lifecycle hooks (onEnter, onExit, onUpdate) per state
 * - Guard-based automatic transitions evaluated each tick
 * - Event-based transitions via `sendEvent()`
 * - Direct transitions via `transitionTo()`
 * - stateTransition events published on every transition
 *
 * @example
 * ```typescript
 * const ecs = ECSpresso.create()
 *   .withPlugin(createStateMachinePlugin())
 *   .build();
 *
 * const fsm = defineStateMachine('enemy', {
 *   initial: 'idle',
 *   states: {
 *     idle: {
 *       transitions: [{ target: 'chase', guard: ({ ecs, entityId }) => playerNearby(ecs, entityId) }],
 *     },
 *     chase: {
 *       onUpdate: ({ ecs, entityId, dt }) => moveTowardPlayer(ecs, entityId, dt),
 *       on: { playerLost: 'idle' },
 *     },
 *   },
 * });
 *
 * ecs.spawn({
 *   ...createStateMachine(fsm),
 *   position: { x: 0, y: 0 },
 * });
 * ```
 */
export function createStateMachinePlugin<S extends string = string, G extends string = 'stateMachine'>(
	options?: StateMachinePluginOptions<G>,
) {
	const {
		systemGroup = 'stateMachine',
		priority = 0,
		phase = 'update',
	} = options ?? {};

	return definePlugin('stateMachine')
		.withComponentTypes<StateMachineComponentTypes<S>>()
		.withEventTypes<StateMachineEventTypes<S>>()
		.withLabels<'state-machine-update'>()
		.withGroups<G>()
		.install((world) => {
			world
				.addSystem('state-machine-update')
				.setPriority(priority)
				.inPhase(phase)
				.inGroup(systemGroup)
				.addQuery('machines', {
					with: ['stateMachine'],
				})
				.setOnEntityEnter('machines', ({ entity, ecs }) => {
					const sm = entity.components.stateMachine;
					const states = sm.definition.states as Record<string, StateConfig<string>>;
					const world: StateMachineWorld = ecs;
					states[sm.current]?.onEnter?.({ ecs: world, entityId: entity.id });
				})
				.setProcess(({ queries, dt, ecs }) => {
					// Pre-allocated context reused across entities to avoid per-entity-per-frame allocations
					const world: StateMachineWorld = ecs;
					const hookCtx = { ecs: world, entityId: 0, dt: 0 };

					for (const entity of queries.machines) {
						const sm = entity.components.stateMachine;
						const states = sm.definition.states as Record<string, StateConfig<string>>;

						hookCtx.entityId = entity.id;
						hookCtx.dt = dt;

						// Accumulate state time
						sm.stateTime += dt;

						// onUpdate hook
						states[sm.current]?.onUpdate?.(hookCtx);

						// Evaluate guard transitions (first passing guard wins)
						const currentConfig = states[sm.current];
						if (currentConfig?.transitions) {
							for (const transition of currentConfig.transitions) {
								if (transition.guard(hookCtx)) {
									performTransition(hookCtx.ecs, entity.id, sm, transition.target);
									break;
								}
							}
						}
					}
				});
		});
}
