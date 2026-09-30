/**
 * Behavior Tree Plugin for ECSpresso
 *
 * Provides composable, priority-driven AI via behavior trees. Shared immutable
 * tree definitions drive per-entity runtime state. Uses hybrid traversal
 * (Approach C): re-evaluate from root each tick to preserve priority, resume
 * running leaves, and abort diverged running nodes via `onAbort`.
 *
 * Each entity gets a `behaviorTree` component referencing a shared definition
 * plus a typed blackboard for per-entity AI memory. One system processes all
 * behavior-tree entities each tick.
 *
 * Top-level node helpers such as `action(...)` and `condition(...)` type the
 * callback ECS as the behavior-tree plugin world. If a leaf needs app-specific
 * components, resources, or events, use `ecs.getHelpers(createBehaviorTreeHelpers)`
 * after `.build()` and destructure helpers from that bound result.
 *
 * Node types:
 *   Composites — sequence, selector, parallel
 *   Decorators — inverter, repeat, cooldown, guard
 *   Leaves     — action (tick → NodeStatus, optional onAbort), condition (predicate)
 */

import { definePlugin, type BasePluginOptions, type BaseWorld, type ComponentsConfig, type EventsConfig } from 'ecspresso';

// ==================== NodeStatus ====================

/**
 * Return value from behavior tree node ticks.
 *
 * - `Success` (0) — node completed successfully
 * - `Failure` (1) — node failed
 * - `Running` (2) — node still executing, will resume next tick
 */
export const NodeStatus = { Success: 0, Failure: 1, Running: 2 } as const;
export type NodeStatus = (typeof NodeStatus)[keyof typeof NodeStatus];

// ==================== Callback Context ====================

/** BaseWorld narrowed to behavior-tree components for typed access in helpers. */
type BehaviorTreeWorld = BaseWorld<BehaviorTreeComponentTypes>;

/**
 * Context passed to all leaf node callbacks (action tick, condition check,
 * onAbort, guard predicates).
 *
 * @template BB - Blackboard type for per-entity AI memory
 * @template W  - World interface type (default: BehaviorTreeWorld)
 */
export interface BehaviorTreeContext<
	BB extends object = Record<string, unknown>,
	W extends BaseWorld<BehaviorTreeComponentTypes> = BehaviorTreeWorld,
> {
	readonly ecs: W;
	readonly entityId: number;
	readonly dt: number;
	readonly blackboard: BB;
}

// ==================== Node Types ====================

/**
 * Action leaf — executes behavior each tick.
 * Returns `Running` for multi-frame actions. Optional `onAbort` fires
 * when a higher-priority branch preempts this running action.
 */
export interface ActionNode<BB extends object = Record<string, unknown>> {
	readonly type: 'action';
	readonly name: string;
	readonly tick: (ctx: BehaviorTreeContext<BB>) => NodeStatus;
	readonly onAbort?: (ctx: BehaviorTreeContext<BB>) => void;
	nodeIndex: number;
}

/**
 * Condition leaf — checks a predicate. Returns Success or Failure, never Running.
 */
export interface ConditionNode<BB extends object = Record<string, unknown>> {
	readonly type: 'condition';
	readonly name: string;
	readonly check: (ctx: BehaviorTreeContext<BB>) => boolean;
	nodeIndex: number;
}

/**
 * Sequence composite — runs children left-to-right.
 * Fails on first failure, succeeds when all succeed.
 * Resumes from stored child index when a running node exists.
 */
export interface SequenceNode<BB extends object = Record<string, unknown>> {
	readonly type: 'sequence';
	readonly children: readonly BehaviorTreeNode<BB>[];
	nodeIndex: number;
}

/**
 * Selector composite — runs children left-to-right.
 * Succeeds on first success, fails when all fail.
 * Always re-evaluates from child 0 to preserve priority ordering.
 */
export interface SelectorNode<BB extends object = Record<string, unknown>> {
	readonly type: 'selector';
	readonly children: readonly BehaviorTreeNode<BB>[];
	nodeIndex: number;
}

/**
 * Parallel composite — ticks all children each frame.
 * Configurable success/failure thresholds.
 *
 * Limitation (v1): only one running leaf is tracked for abort.
 * Other running children in a parallel stop being ticked if the
 * tree path diverges but do not receive an `onAbort` call.
 */
export interface ParallelNode<BB extends object = Record<string, unknown>> {
	readonly type: 'parallel';
	readonly children: readonly BehaviorTreeNode<BB>[];
	readonly successThreshold: number;
	readonly failureThreshold: number;
	nodeIndex: number;
}

/** Decorator — inverts child result (Success↔Failure), passes Running through. */
export interface InverterNode<BB extends object = Record<string, unknown>> {
	readonly type: 'inverter';
	readonly child: BehaviorTreeNode<BB>;
	nodeIndex: number;
}

/** Decorator — repeats child `count` times (or forever when count is -1). */
export interface RepeatNode<BB extends object = Record<string, unknown>> {
	readonly type: 'repeat';
	readonly child: BehaviorTreeNode<BB>;
	readonly count: number;
	nodeIndex: number;
}

/** Decorator — prevents child re-entry for `duration` seconds after completion. */
export interface CooldownNode<BB extends object = Record<string, unknown>> {
	readonly type: 'cooldown';
	readonly child: BehaviorTreeNode<BB>;
	readonly duration: number;
	nodeIndex: number;
}

/** Decorator — conditional gate. Ticks child only when condition passes. */
export interface GuardNode<BB extends object = Record<string, unknown>> {
	readonly type: 'guard';
	readonly child: BehaviorTreeNode<BB>;
	readonly condition: (ctx: BehaviorTreeContext<BB>) => boolean;
	nodeIndex: number;
}

/** Union of all behavior tree node types. */
export type BehaviorTreeNode<BB extends object = Record<string, unknown>> =
	| ActionNode<BB>
	| ConditionNode<BB>
	| SequenceNode<BB>
	| SelectorNode<BB>
	| ParallelNode<BB>
	| InverterNode<BB>
	| RepeatNode<BB>
	| CooldownNode<BB>
	| GuardNode<BB>;

// ==================== Builder Functions ====================

/**
 * Create an action leaf node.
 *
 * @param name   - Human-readable name (used in abort events)
 * @param tick   - Called each frame while this node is active; return NodeStatus
 * @param options - Optional `onAbort` callback fired when preempted by a higher-priority branch
 */
export function action<BB extends object>(
	name: string,
	tick: (ctx: BehaviorTreeContext<BB>) => NodeStatus,
	options?: { onAbort?: (ctx: BehaviorTreeContext<BB>) => void },
): ActionNode<BB> {
	return { type: 'action', name, tick, onAbort: options?.onAbort, nodeIndex: -1 };
}

/**
 * Create a condition leaf node.
 *
 * @param name  - Human-readable name
 * @param check - Predicate returning true (Success) or false (Failure). Never Running.
 */
export function condition<BB extends object>(
	name: string,
	check: (ctx: BehaviorTreeContext<BB>) => boolean,
): ConditionNode<BB> {
	return { type: 'condition', name, check, nodeIndex: -1 };
}

/**
 * Create a sequence composite. Runs children L→R, fails on first failure.
 */
export function sequence<BB extends object>(
	children: BehaviorTreeNode<BB>[],
): SequenceNode<BB> {
	return { type: 'sequence', children, nodeIndex: -1 };
}

/**
 * Create a selector composite. Runs children L→R, succeeds on first success.
 * Always starts from child 0 to re-evaluate priority.
 */
export function selector<BB extends object>(
	children: BehaviorTreeNode<BB>[],
): SelectorNode<BB> {
	return { type: 'selector', children, nodeIndex: -1 };
}

/**
 * Create a parallel composite. Ticks all children each frame.
 *
 * @param children         - Child nodes to tick in parallel
 * @param options.successThreshold - Successes needed for parallel to succeed (default: all)
 * @param options.failureThreshold - Failures needed for parallel to fail (default: all)
 */
export function parallel<BB extends object>(
	children: BehaviorTreeNode<BB>[],
	options?: { successThreshold?: number; failureThreshold?: number },
): ParallelNode<BB> {
	return {
		type: 'parallel',
		children,
		successThreshold: options?.successThreshold ?? children.length,
		failureThreshold: options?.failureThreshold ?? children.length,
		nodeIndex: -1,
	};
}

/** Create an inverter decorator. Flips Success↔Failure, passes Running. */
export function inverter<BB extends object>(
	child: BehaviorTreeNode<BB>,
): InverterNode<BB> {
	return { type: 'inverter', child, nodeIndex: -1 };
}

/**
 * Create a repeat decorator.
 *
 * @param child - Node to repeat
 * @param count - Number of repetitions, or -1 for infinite (default: -1)
 */
export function repeat<BB extends object>(
	child: BehaviorTreeNode<BB>,
	count = -1,
): RepeatNode<BB> {
	return { type: 'repeat', child, count, nodeIndex: -1 };
}

/**
 * Create a cooldown decorator. Prevents re-entry for `duration` seconds
 * after child completes (Success or Failure).
 */
export function cooldown<BB extends object>(
	child: BehaviorTreeNode<BB>,
	duration: number,
): CooldownNode<BB> {
	return { type: 'cooldown', child, duration, nodeIndex: -1 };
}

/**
 * Create a guard decorator. Ticks child only when condition returns true.
 * Returns Failure when condition is false.
 */
export function guard<BB extends object>(
	cond: (ctx: BehaviorTreeContext<BB>) => boolean,
	child: BehaviorTreeNode<BB>,
): GuardNode<BB> {
	return { type: 'guard', condition: cond, child, nodeIndex: -1 };
}

// ==================== Definition ====================

/**
 * Immutable behavior tree definition. Shared across entities.
 *
 * @template BB - Blackboard type for per-entity AI memory
 */
export interface BehaviorTreeDefinition<BB extends object = Record<string, unknown>> {
	readonly id: string;
	readonly root: BehaviorTreeNode<BB>;
	readonly nodeCount: number;
}

/** Internal storage for definition data not exposed on the public interface. */
const defFlatNodes = new WeakMap<BehaviorTreeDefinition<object>, readonly BehaviorTreeNode<object>[]>();
const defDefaultBB = new WeakMap<BehaviorTreeDefinition<object>, object>();

/**
 * Define a behavior tree with a typed blackboard.
 *
 * The `blackboard` value serves as both the type source and the default
 * initial state shallow-copied for each entity via `createBehaviorTree`.
 * Nested objects and arrays remain shared unless an entity-specific override
 * replaces them; provide fresh mutable nested values when entities need
 * independent state.
 *
 * @param id     - Unique identifier for this tree definition
 * @param config - `{ blackboard, root }` — default blackboard + root node
 * @returns Frozen BehaviorTreeDefinition
 *
 * @example
 * ```typescript
 * const tree = defineBehaviorTree('patrol', {
 *   blackboard: { targetId: null as number | null, timer: 0 },
 *   root: selector([
 *     guard(ctx => ctx.blackboard.targetId !== null, action('chase', ...)),
 *     action('wander', ...),
 *   ]),
 * });
 * ```
 */
export function defineBehaviorTree<BB extends object>(
	id: string,
	config: { blackboard: BB; root: BehaviorTreeNode<BB> },
): BehaviorTreeDefinition<BB> {
	let nextIndex = 0;
	const flatNodes: BehaviorTreeNode<BB>[] = [];

	function indexTree(node: BehaviorTreeNode<BB>): void {
		node.nodeIndex = nextIndex;
		flatNodes[nextIndex] = node;
		nextIndex++;
		if ('children' in node) {
			for (const child of node.children) indexTree(child);
		}
		if ('child' in node) {
			indexTree(node.child);
		}
	}
	indexTree(config.root);

	const def: BehaviorTreeDefinition<BB> = Object.freeze({ id, root: config.root, nodeCount: nextIndex });
	defFlatNodes.set(def as BehaviorTreeDefinition<object>, flatNodes as readonly BehaviorTreeNode<object>[]);
	defDefaultBB.set(def as BehaviorTreeDefinition<object>, config.blackboard);
	return def;
}

// ==================== Per-Entity Component ====================

/**
 * Runtime behavior tree state stored on each entity.
 *
 * The `blackboard` is typed as `object` at the component level.
 * Inside tree callbacks, the `BehaviorTreeContext<BB>` provides
 * typed access to the blackboard via the tree definition's generic.
 * Outside the tree, cast the blackboard to the specific BB type.
 */
export interface BehaviorTreeComponent {
	readonly definition: BehaviorTreeDefinition<Record<string, unknown>>;
	blackboard: object;
	/** Index of the currently running leaf, or -1 if none. */
	runningNodeIndex: number;
	/**
	 * Dense per-node state array (sized to `definition.nodeCount`).
	 * Semantics vary by node type:
	 * - sequence/selector: child progress index
	 * - repeat: completed iteration count
	 * - cooldown: expiry timestamp (elapsedTime when cooldown ends)
	 */
	nodeState: Float64Array;
	/** Accumulated time (seconds) for cooldown tracking. */
	elapsedTime: number;
}

/**
 * Component types provided by the behavior tree plugin.
 */
export interface BehaviorTreeComponentTypes {
	behaviorTree: BehaviorTreeComponent;
}

// ==================== Event Types ====================

/**
 * Event published when a running action is preempted (aborted) by a
 * higher-priority branch taking over.
 */
export interface BehaviorTreeAbortEvent {
	entityId: number;
	/** nodeIndex of the aborted action */
	nodeIndex: number;
	/** Human-readable name of the aborted action */
	nodeName: string;
	/** Definition id of the behavior tree */
	definitionId: string;
}

/**
 * Event types provided by the behavior tree plugin.
 */
export interface BehaviorTreeEventTypes {
	behaviorTreeAbort: BehaviorTreeAbortEvent;
}

// ==================== WorldConfig ====================

/**
 * WorldConfig representing the behavior tree plugin's provided types.
 */
export type BehaviorTreeWorldConfig =
	ComponentsConfig<BehaviorTreeComponentTypes>
	& EventsConfig<BehaviorTreeEventTypes>;

// ==================== Helper Functions ====================

/**
 * Create a `behaviorTree` component from a definition.
 *
 * @param definition - Shared tree definition
 * @param blackboard - Optional partial overrides for the default blackboard.
 *   The top-level object is copied; nested object values are shared by reference
 *   unless replaced with entity-specific overrides.
 * @returns Component object suitable for spreading into spawn()
 *
 * @example
 * ```typescript
 * ecs.spawn({
 *   ...createBehaviorTree(villagerTree, { hunger: 80 }),
 *   ...createLocalTransform(100, 200),
 * });
 * ```
 */
export function createBehaviorTree<BB extends object>(
	definition: BehaviorTreeDefinition<BB>,
	blackboard?: Partial<BB>,
): Pick<BehaviorTreeComponentTypes, 'behaviorTree'> {
	const defaultBB = defDefaultBB.get(definition as BehaviorTreeDefinition<object>) as BB;
	const bb = { ...defaultBB, ...blackboard };
	return {
		behaviorTree: {
			definition: definition as BehaviorTreeDefinition<Record<string, unknown>>,
			blackboard: bb,
			runningNodeIndex: -1,
			nodeState: new Float64Array(definition.nodeCount),
			elapsedTime: 0,
		},
	};
}

/**
 * Check whether an entity's behavior tree has a running action.
 */
export function isBehaviorTreeRunning(
	ecs: { getComponent(entityId: number, name: 'behaviorTree'): BehaviorTreeComponent | undefined },
	entityId: number,
): boolean {
	const bt = ecs.getComponent(entityId, 'behaviorTree');
	return bt !== undefined && bt.runningNodeIndex !== -1;
}

/**
 * Reset an entity's behavior tree: abort any running action, clear all
 * composite progress, and optionally reset the blackboard.
 */
export function resetBehaviorTree(
	ecs: BehaviorTreeWorld,
	entityId: number,
	blackboard?: Partial<Record<string, unknown>>,
): void {
	const bt = ecs.getComponent(entityId, 'behaviorTree');
	if (!bt) return;

	if (bt.runningNodeIndex !== -1) {
		const flatNodes = defFlatNodes.get(bt.definition as BehaviorTreeDefinition<object>);
		const node = flatNodes?.[bt.runningNodeIndex];
		if (node && node.type === 'action' && node.onAbort) {
			node.onAbort({ ecs, entityId, dt: 0, blackboard: bt.blackboard as Record<string, unknown> });
		}
		bt.runningNodeIndex = -1;
	}
	bt.nodeState.fill(0);
	bt.elapsedTime = 0;

	if (blackboard) {
		Object.assign(bt.blackboard, blackboard);
	}
}

// ==================== Internal: Traversal ====================

/** Internal shorthand — all runtime traversal uses the erased base types. */
type AnyNode = BehaviorTreeNode<Record<string, unknown>>;

/** Mutable version of context for pre-allocation in the system loop. */
interface MutableCtx {
	ecs: BehaviorTreeWorld;
	entityId: number;
	dt: number;
	blackboard: Record<string, unknown>;
}

function abortRunningNode(bt: BehaviorTreeComponent, ctx: MutableCtx): void {
	const flatNodes = defFlatNodes.get(bt.definition as BehaviorTreeDefinition<object>);
	const node = flatNodes?.[bt.runningNodeIndex] as AnyNode | undefined;
	if (node && node.type === 'action') {
		node.onAbort?.(ctx);
		ctx.ecs.eventBus.publish('behaviorTreeAbort', {
			entityId: ctx.entityId,
			nodeIndex: bt.runningNodeIndex,
			nodeName: node.name,
			definitionId: bt.definition.id,
		} satisfies BehaviorTreeAbortEvent);
	}
	bt.nodeState.fill(0);
	bt.runningNodeIndex = -1;
}

function tickNode(node: AnyNode, bt: BehaviorTreeComponent, ctx: MutableCtx): NodeStatus {
	switch (node.type) {
		case 'condition':
			return node.check(ctx) ? NodeStatus.Success : NodeStatus.Failure;

		case 'action': {
			const result = node.tick(ctx);
			if (result === NodeStatus.Running) {
				if (bt.runningNodeIndex !== -1 && bt.runningNodeIndex !== node.nodeIndex) {
					abortRunningNode(bt, ctx);
				}
				bt.runningNodeIndex = node.nodeIndex;
			} else if (bt.runningNodeIndex === node.nodeIndex) {
				bt.runningNodeIndex = -1;
			}
			return result;
		}

		case 'sequence': {
			const startChild = (bt.runningNodeIndex !== -1)
				? (bt.nodeState[node.nodeIndex] ?? 0)
				: 0;
			for (let i = startChild; i < node.children.length; i++) {
				const status = tickNode(node.children[i]!, bt, ctx);
				if (status === NodeStatus.Failure) {
					bt.nodeState[node.nodeIndex] = 0;
					return NodeStatus.Failure;
				}
				if (status === NodeStatus.Running) {
					bt.nodeState[node.nodeIndex] = i;
					return NodeStatus.Running;
				}
			}
			bt.nodeState[node.nodeIndex] = 0;
			return NodeStatus.Success;
		}

		case 'selector': {
			for (let i = 0; i < node.children.length; i++) {
				const status = tickNode(node.children[i]!, bt, ctx);
				if (status === NodeStatus.Success) return NodeStatus.Success;
				if (status === NodeStatus.Running) return NodeStatus.Running;
			}
			return NodeStatus.Failure;
		}

		case 'parallel': {
			let successCount = 0;
			let failureCount = 0;
			let anyRunning = false;
			for (let i = 0; i < node.children.length; i++) {
				const status = tickNode(node.children[i]!, bt, ctx);
				if (status === NodeStatus.Success) successCount++;
				else if (status === NodeStatus.Failure) failureCount++;
				else anyRunning = true;
			}
			if (successCount >= node.successThreshold) return NodeStatus.Success;
			if (failureCount >= node.failureThreshold) return NodeStatus.Failure;
			if (anyRunning) return NodeStatus.Running;
			return NodeStatus.Failure;
		}

		case 'inverter': {
			const status = tickNode(node.child, bt, ctx);
			if (status === NodeStatus.Success) return NodeStatus.Failure;
			if (status === NodeStatus.Failure) return NodeStatus.Success;
			return NodeStatus.Running;
		}

		case 'repeat': {
			const iteration = bt.nodeState[node.nodeIndex] ?? 0;
			const status = tickNode(node.child, bt, ctx);
			if (status === NodeStatus.Failure) {
				bt.nodeState[node.nodeIndex] = 0;
				return NodeStatus.Failure;
			}
			if (status === NodeStatus.Running) return NodeStatus.Running;
			const next = iteration + 1;
			if (node.count !== -1 && next >= node.count) {
				bt.nodeState[node.nodeIndex] = 0;
				return NodeStatus.Success;
			}
			bt.nodeState[node.nodeIndex] = next;
			return NodeStatus.Running;
		}

		case 'cooldown': {
			const expiresAt = bt.nodeState[node.nodeIndex] ?? 0;
			if (expiresAt > 0 && bt.elapsedTime < expiresAt) return NodeStatus.Failure;
			const status = tickNode(node.child, bt, ctx);
			if (status !== NodeStatus.Running) {
				bt.nodeState[node.nodeIndex] = bt.elapsedTime + node.duration;
			}
			return status;
		}

		case 'guard': {
			if (!node.condition(ctx)) return NodeStatus.Failure;
			return tickNode(node.child, bt, ctx);
		}
	}
}

// ==================== Typed Helpers ====================

/**
 * Typed helpers for the behavior tree plugin.
 * Creates helpers that validate callback parameters against the world type W.
 * Call after `.build()` so behavior-tree leaves can access app-specific
 * components, resources, and events through the full built ECS type.
 */
export interface BehaviorTreeHelpers<W extends BaseWorld<BehaviorTreeComponentTypes>> {
	defineBehaviorTree: <BB extends object>(
		id: string,
		config: { blackboard: BB; root: BehaviorTreeNode<BB> },
	) => BehaviorTreeDefinition<BB>;
	action: <BB extends object>(
		name: string,
		tick: (ctx: BehaviorTreeContext<BB, W>) => NodeStatus,
		options?: { onAbort?: (ctx: BehaviorTreeContext<BB, W>) => void },
	) => ActionNode<BB>;
	condition: <BB extends object>(
		name: string,
		check: (ctx: BehaviorTreeContext<BB, W>) => boolean,
	) => ConditionNode<BB>;
	guard: <BB extends object>(
		cond: (ctx: BehaviorTreeContext<BB, W>) => boolean,
		child: BehaviorTreeNode<BB>,
	) => GuardNode<BB>;
}

/**
 * Create typed behavior tree helpers bound to a specific world type.
 *
 * @example
 * ```typescript
 * const ecs = ECSpresso.create()
 *   .withPlugin(createBehaviorTreePlugin())
 *   .withComponentTypes<{ enemy: { hp: number } }>()
 *   .build();
 *
 * const { defineBehaviorTree, action, condition, guard } = ecs.getHelpers(createBehaviorTreeHelpers);
 *
 * action('read enemy', ({ ecs, entityId }) => {
 *   const enemy = ecs.getComponent(entityId, 'enemy');
 *   return enemy ? NodeStatus.Success : NodeStatus.Failure;
 * });
 * ```
 */
export function createBehaviorTreeHelpers<
	W extends BaseWorld<BehaviorTreeComponentTypes> = BehaviorTreeWorld,
>(_world?: W): BehaviorTreeHelpers<W> {
	return {
		defineBehaviorTree: defineBehaviorTree as BehaviorTreeHelpers<W>['defineBehaviorTree'],
		action: action as BehaviorTreeHelpers<W>['action'],
		condition: condition as BehaviorTreeHelpers<W>['condition'],
		guard: guard as BehaviorTreeHelpers<W>['guard'],
	};
}

// ==================== Plugin Options ====================

/**
 * Configuration options for the behavior tree plugin.
 */
export interface BehaviorTreePluginOptions<G extends string = 'ai'> extends BasePluginOptions<G> {}

// ==================== Plugin Factory ====================

/**
 * Create a behavior tree plugin for ECSpresso.
 *
 * Provides composable, priority-driven AI via behavior trees with:
 * - Hybrid traversal: re-evaluate from root each tick, resume running leaves
 * - Automatic abort with `onAbort` callback when preempted
 * - Typed blackboard for per-entity AI memory
 * - `behaviorTreeAbort` events on preemption
 *
 * @example
 * ```typescript
 * const ecs = ECSpresso.create()
 *   .withPlugin(createBehaviorTreePlugin())
 *   .build();
 *
 * const { defineBehaviorTree, action, condition, guard } = ecs.getHelpers(createBehaviorTreeHelpers);
 *
 * const tree = defineBehaviorTree('villager', {
 *   blackboard: { hunger: 100, targetId: null as number | null },
 *   root: selector([
 *     guard(ctx => ctx.blackboard.hunger < 30, action('eat', ...)),
 *     action('wander', ...),
 *   ]),
 * });
 *
 * ecs.spawn({
 *   ...createBehaviorTree(tree),
 *   ...createLocalTransform(100, 200),
 * });
 * ```
 */
export function createBehaviorTreePlugin<G extends string = 'ai'>(
	options?: BehaviorTreePluginOptions<G>,
) {
	const {
		systemGroup = 'ai',
		priority = 0,
		phase = 'update',
	} = options ?? {};

	return definePlugin('behaviorTree')
		.withComponentTypes<BehaviorTreeComponentTypes>()
		.withEventTypes<BehaviorTreeEventTypes>()
		.withLabels<'behavior-tree-update'>()
		.withGroups<G>()
		.install((world) => {
			// Dispose: abort running node on entity removal
			world.registerDispose('behaviorTree', ({ value, entityId }) => {
				if (value.runningNodeIndex !== -1) {
					const flatNodes = defFlatNodes.get(value.definition as BehaviorTreeDefinition<object>);
					const node = flatNodes?.[value.runningNodeIndex] as AnyNode | undefined;
					if (node && node.type === 'action' && node.onAbort) {
						node.onAbort({
							ecs: world as unknown as BehaviorTreeWorld,
							entityId,
							dt: 0,
							blackboard: value.blackboard as Record<string, unknown>,
						});
					}
				}
			});

			world
				.addSystem('behavior-tree-update')
				.setPriority(priority)
				.inPhase(phase)
				.inGroup(systemGroup)
				.addQuery('trees', {
					with: ['behaviorTree'],
				})
				.setProcess(({ queries, dt, ecs: ecsWorld }) => {
					const ctx: MutableCtx = {
						ecs: ecsWorld as unknown as BehaviorTreeWorld,
						entityId: 0,
						dt: 0,
						blackboard: {},
					};

					for (const entity of queries.trees) {
						const bt = entity.components.behaviorTree;
						ctx.entityId = entity.id;
						ctx.dt = dt;
						ctx.blackboard = bt.blackboard as Record<string, unknown>;
						bt.elapsedTime += dt;

						const result = tickNode(bt.definition.root as AnyNode, bt, ctx);

						if (result !== NodeStatus.Running && bt.runningNodeIndex !== -1) {
							abortRunningNode(bt, ctx);
						}
					}
				});
		});
}
