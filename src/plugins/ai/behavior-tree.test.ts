import { describe, test, expect } from 'bun:test';
import ECSpresso from '../../ecspresso';
import {
	NodeStatus,
	action,
	condition,
	sequence,
	selector,
	parallel,
	inverter,
	repeat,
	cooldown,
	guard,
	defineBehaviorTree,
	createBehaviorTree,
	createBehaviorTreePlugin,
	createBehaviorTreeHelpers,
	isBehaviorTreeRunning,
	resetBehaviorTree,
	type BehaviorTreeAbortEvent,
} from './behavior-tree';

// ==================== Test Types ====================

interface TestBB {
	counter: number;
	log: string[];
}

function defaultBB(): TestBB {
	return { counter: 0, log: [] };
}

// ==================== Typed Builders (bound to TestBB) ====================

const tAction = action<TestBB>;
const tCondition = condition<TestBB>;
const tSequence = sequence<TestBB>;
const tSelector = selector<TestBB>;
const tGuard = guard<TestBB>;
const tInverter = inverter<TestBB>;
const tRepeat = repeat<TestBB>;
const tCooldown = cooldown<TestBB>;
const tParallel = parallel<TestBB>;
const tDefine = defineBehaviorTree<TestBB>;

// ==================== Test Helpers ====================

function createTestEcs() {
	return ECSpresso
		.create()
		.withPlugin(createBehaviorTreePlugin())
		.build();
}

function tick(ecs: ReturnType<typeof createTestEcs>, dt = 1 / 60) {
	ecs.update(dt);
}

/** Read the blackboard from an entity's behaviorTree component, cast to TestBB. */
function getBB(ecs: ReturnType<typeof createTestEcs>, entityId: number): TestBB {
	const bt = ecs.getComponent(entityId, 'behaviorTree');
	if (!bt) throw new Error(`entity ${entityId} has no behaviorTree`);
	return bt.blackboard as unknown as TestBB;
}

// ==================== Tests ====================

describe('Behavior Tree Plugin', () => {

	// --- NodeStatus ---

	describe('NodeStatus', () => {
		test('values are distinct numbers', () => {
			expect(NodeStatus.Success).toBe(0);
			expect(NodeStatus.Failure).toBe(1);
			expect(NodeStatus.Running).toBe(2);
		});
	});

	// --- defineBehaviorTree ---

	describe('defineBehaviorTree', () => {
		test('assigns sequential nodeIndex values', () => {
			const tree = tDefine('test', {
				blackboard: defaultBB(),
				root: tSequence([
					tAction('a', () => NodeStatus.Success),
					tAction('b', () => NodeStatus.Success),
				]),
			});

			expect(tree.nodeCount).toBe(3); // sequence + 2 actions
			expect(tree.root.nodeIndex).toBe(0);

			const seq = tree.root;
			if (seq.type !== 'sequence') throw new Error('expected sequence');
			expect(seq.children[0]!.nodeIndex).toBe(1);
			expect(seq.children[1]!.nodeIndex).toBe(2);
		});

		test('freezes the definition', () => {
			const tree = tDefine('frozen', {
				blackboard: defaultBB(),
				root: tAction('a', () => NodeStatus.Success),
			});
			expect(Object.isFrozen(tree)).toBe(true);
		});
	});

	// --- createBehaviorTree ---

	describe('createBehaviorTree', () => {
		test('creates component with default blackboard', () => {
			const tree = tDefine('test', {
				blackboard: { counter: 42, log: [] } as TestBB,
				root: tAction('a', () => NodeStatus.Success),
			});

			const { behaviorTree } = createBehaviorTree(tree);
			expect((behaviorTree.blackboard as unknown as TestBB).counter).toBe(42);
			expect(behaviorTree.runningNodeIndex).toBe(-1);
			expect(behaviorTree.nodeState.length).toBe(tree.nodeCount);
		});

		test('applies partial blackboard overrides', () => {
			const tree = tDefine('test', {
				blackboard: { counter: 0, log: [] } as TestBB,
				root: tAction('a', () => NodeStatus.Success),
			});

			const { behaviorTree } = createBehaviorTree(tree, { counter: 99 });
			expect((behaviorTree.blackboard as unknown as TestBB).counter).toBe(99);
			expect((behaviorTree.blackboard as unknown as TestBB).log).toEqual([]);
		});

		test('copies the blackboard shell and shares nested defaults', () => {
			const tree = tDefine('test', {
				blackboard: { counter: 0, log: [] } as TestBB,
				root: tAction('a', () => NodeStatus.Success),
			});

			const a = createBehaviorTree(tree);
			const b = createBehaviorTree(tree);
			(a.behaviorTree.blackboard as TestBB).counter = 10;
			expect((b.behaviorTree.blackboard as TestBB).counter).toBe(0);
			expect(a.behaviorTree.blackboard).not.toBe(b.behaviorTree.blackboard);
			expect((a.behaviorTree.blackboard as TestBB).log).toBe((b.behaviorTree.blackboard as TestBB).log);
		});

		test('accepts fresh nested values for per-entity mutable state', () => {
			const tree = tDefine('test', {
				blackboard: { counter: 0, log: [] },
				root: tAction('a', () => NodeStatus.Success),
			});

			const a = createBehaviorTree(tree, { log: [] });
			const b = createBehaviorTree(tree, { log: [] });
			expect((a.behaviorTree.blackboard as TestBB).log).not.toBe((b.behaviorTree.blackboard as TestBB).log);
		});
	});

	// --- Condition ---

	describe('condition node', () => {
		test('returns Success when check is true', () => {
			const tree = tDefine('test', {
				blackboard: defaultBB(),
				root: tCondition('always', () => true),
			});

			const ecs = createTestEcs();
			ecs.spawn({ ...createBehaviorTree(tree) });
			tick(ecs); // should not throw
		});

		test('returns Failure when check is false, causing selector fallback', () => {
			const tree = tDefine('test', {
				blackboard: defaultBB(),
				root: tSelector([
					tCondition('never', () => false),
					tAction('fallback', ({ blackboard: bb }) => {
						bb.counter++;
						return NodeStatus.Success;
					}),
				]),
			});

			const ecs = createTestEcs();
			const entity = ecs.spawn({ ...createBehaviorTree(tree) });
			tick(ecs);
			expect(getBB(ecs, entity.id).counter).toBe(1);
		});
	});

	// --- Sequence ---

	describe('sequence', () => {
		test('runs children in order until all succeed', () => {
			const tree = tDefine('test', {
				blackboard: defaultBB(),
				root: tSequence([
					tAction('a', ({ blackboard: bb }) => { bb.log.push('a'); return NodeStatus.Success; }),
					tAction('b', ({ blackboard: bb }) => { bb.log.push('b'); return NodeStatus.Success; }),
					tAction('c', ({ blackboard: bb }) => { bb.log.push('c'); return NodeStatus.Success; }),
				]),
			});

			const ecs = createTestEcs();
			const entity = ecs.spawn({ ...createBehaviorTree(tree) });
			tick(ecs);
			expect(getBB(ecs, entity.id).log).toEqual(['a', 'b', 'c']);
		});

		test('fails immediately on first child failure', () => {
			const tree = tDefine('test', {
				blackboard: defaultBB(),
				root: tSequence([
					tAction('a', ({ blackboard: bb }) => { bb.log.push('a'); return NodeStatus.Success; }),
					tAction('fail', ({ blackboard: bb }) => { bb.log.push('fail'); return NodeStatus.Failure; }),
					tAction('c', ({ blackboard: bb }) => { bb.log.push('c'); return NodeStatus.Success; }),
				]),
			});

			const ecs = createTestEcs();
			const entity = ecs.spawn({ ...createBehaviorTree(tree) });
			tick(ecs);
			expect(getBB(ecs, entity.id).log).toEqual(['a', 'fail']);
		});

		test('resumes from running child on next tick', () => {
			let callCount = 0;
			const tree = tDefine('test', {
				blackboard: defaultBB(),
				root: tSequence([
					tAction('a', ({ blackboard: bb }) => { bb.log.push('a'); return NodeStatus.Success; }),
					tAction('slow', ({ blackboard: bb }) => {
						callCount++;
						bb.log.push('slow');
						return callCount >= 2 ? NodeStatus.Success : NodeStatus.Running;
					}),
					tAction('c', ({ blackboard: bb }) => { bb.log.push('c'); return NodeStatus.Success; }),
				]),
			});

			const ecs = createTestEcs();
			const entity = ecs.spawn({ ...createBehaviorTree(tree) });

			tick(ecs); // a succeeds, slow returns Running
			expect(getBB(ecs, entity.id).log).toEqual(['a', 'slow']);

			getBB(ecs, entity.id).log = [];
			tick(ecs); // resumes at slow (skips a), slow succeeds, c runs
			expect(getBB(ecs, entity.id).log).toEqual(['slow', 'c']);
		});
	});

	// --- Selector ---

	describe('selector', () => {
		test('succeeds on first child success', () => {
			const tree = tDefine('test', {
				blackboard: defaultBB(),
				root: tSelector([
					tAction('fail', () => NodeStatus.Failure),
					tAction('win', ({ blackboard: bb }) => { bb.counter++; return NodeStatus.Success; }),
					tAction('never', ({ blackboard: bb }) => { bb.counter += 100; return NodeStatus.Success; }),
				]),
			});

			const ecs = createTestEcs();
			const entity = ecs.spawn({ ...createBehaviorTree(tree) });
			tick(ecs);
			expect(getBB(ecs, entity.id).counter).toBe(1);
		});

		test('always re-evaluates from child 0 (priority)', () => {
			let highPriorityActive = false;
			const tree = tDefine('test', {
				blackboard: defaultBB(),
				root: tSelector([
					tGuard(() => highPriorityActive,
						tAction('high', ({ blackboard: bb }) => { bb.log.push('high'); return NodeStatus.Success; }),
					),
					tAction('low', ({ blackboard: bb }) => { bb.log.push('low'); return NodeStatus.Running; }),
				]),
			});

			const ecs = createTestEcs();
			const entity = ecs.spawn({ ...createBehaviorTree(tree) });

			tick(ecs); // high priority fails guard, low runs
			expect(getBB(ecs, entity.id).log).toEqual(['low']);

			getBB(ecs, entity.id).log = [];
			highPriorityActive = true;
			tick(ecs); // selector re-evaluates from 0, high wins
			expect(getBB(ecs, entity.id).log).toEqual(['high']);
		});
	});

	// --- Priority preemption (selector + abort) ---

	describe('priority preemption', () => {
		test('higher priority branch preempts running lower priority action', () => {
			let threatNearby = false;
			const aborted: string[] = [];

			const tree = tDefine('test', {
				blackboard: defaultBB(),
				root: tSelector([
					tGuard(() => threatNearby,
						tAction('flee', ({ blackboard: bb }) => { bb.log.push('flee'); return NodeStatus.Running; }),
					),
					tAction('gather', ({ blackboard: bb }) => {
						bb.log.push('gather');
						return NodeStatus.Running;
					}, {
						onAbort: () => { aborted.push('gather'); },
					}),
				]),
			});

			const ecs = createTestEcs();
			const entity = ecs.spawn({ ...createBehaviorTree(tree) });

			tick(ecs); // gather runs
			expect(getBB(ecs, entity.id).log).toEqual(['gather']);

			getBB(ecs, entity.id).log = [];
			threatNearby = true;
			tick(ecs); // flee preempts gather
			expect(getBB(ecs, entity.id).log).toEqual(['flee']);
			expect(aborted).toEqual(['gather']);
		});

		test('publishes behaviorTreeAbort event on preemption', () => {
			let threatNearby = false;
			const events: BehaviorTreeAbortEvent[] = [];

			const tree = tDefine('test', {
				blackboard: defaultBB(),
				root: tSelector([
					tGuard(() => threatNearby,
						tAction('flee', () => NodeStatus.Running),
					),
					tAction('idle', () => NodeStatus.Running),
				]),
			});

			const ecs = createTestEcs();
			ecs.eventBus.subscribe('behaviorTreeAbort', (evt) => { events.push(evt); });
			ecs.spawn({ ...createBehaviorTree(tree) });

			tick(ecs); // idle runs
			expect(events).toHaveLength(0);

			threatNearby = true;
			tick(ecs); // flee preempts idle
			expect(events).toHaveLength(1);
			expect(events[0]!.nodeName).toBe('idle');
			expect(events[0]!.definitionId).toBe('test');
		});
	});

	// --- Guard ---

	describe('guard', () => {
		test('passes through when condition is true', () => {
			const tree = tDefine('test', {
				blackboard: defaultBB(),
				root: tGuard(
					() => true,
					tAction('inner', ({ blackboard: bb }) => { bb.counter++; return NodeStatus.Success; }),
				),
			});

			const ecs = createTestEcs();
			const entity = ecs.spawn({ ...createBehaviorTree(tree) });
			tick(ecs);
			expect(getBB(ecs, entity.id).counter).toBe(1);
		});

		test('returns Failure when condition is false', () => {
			const tree = tDefine('test', {
				blackboard: defaultBB(),
				root: tSelector([
					tGuard(() => false, tAction('blocked', () => NodeStatus.Success)),
					tAction('fallback', ({ blackboard: bb }) => { bb.counter++; return NodeStatus.Success; }),
				]),
			});

			const ecs = createTestEcs();
			const entity = ecs.spawn({ ...createBehaviorTree(tree) });
			tick(ecs);
			expect(getBB(ecs, entity.id).counter).toBe(1);
		});
	});

	// --- Inverter ---

	describe('inverter', () => {
		test('flips Success to Failure', () => {
			const tree = tDefine('test', {
				blackboard: defaultBB(),
				root: tSelector([
					tInverter(tAction('succeed', () => NodeStatus.Success)),
					tAction('fallback', ({ blackboard: bb }) => { bb.counter++; return NodeStatus.Success; }),
				]),
			});

			const ecs = createTestEcs();
			const entity = ecs.spawn({ ...createBehaviorTree(tree) });
			tick(ecs);
			expect(getBB(ecs, entity.id).counter).toBe(1);
		});

		test('flips Failure to Success', () => {
			const tree = tDefine('test', {
				blackboard: defaultBB(),
				root: tSequence([
					tInverter(tAction('fail', () => NodeStatus.Failure)),
					tAction('after', ({ blackboard: bb }) => { bb.counter++; return NodeStatus.Success; }),
				]),
			});

			const ecs = createTestEcs();
			const entity = ecs.spawn({ ...createBehaviorTree(tree) });
			tick(ecs);
			expect(getBB(ecs, entity.id).counter).toBe(1);
		});

		test('passes Running through unchanged', () => {
			const tree = tDefine('test', {
				blackboard: defaultBB(),
				root: tInverter(tAction('running', () => NodeStatus.Running)),
			});

			const ecs = createTestEcs();
			const entity = ecs.spawn({ ...createBehaviorTree(tree) });
			tick(ecs);
			expect(isBehaviorTreeRunning(ecs, entity.id)).toBe(true);
		});
	});

	// --- Repeat ---

	describe('repeat', () => {
		test('repeats child N times', () => {
			const tree = tDefine('test', {
				blackboard: defaultBB(),
				root: tRepeat(
					tAction('inc', ({ blackboard: bb }) => { bb.counter++; return NodeStatus.Success; }),
					3,
				),
			});

			const ecs = createTestEcs();
			const entity = ecs.spawn({ ...createBehaviorTree(tree) });

			// First tick: child succeeds → iteration 1, returns Running
			tick(ecs);
			expect(getBB(ecs, entity.id).counter).toBe(1);

			tick(ecs); // iteration 2
			expect(getBB(ecs, entity.id).counter).toBe(2);

			tick(ecs); // iteration 3 → repeat succeeds
			expect(getBB(ecs, entity.id).counter).toBe(3);
		});

		test('stops on child failure', () => {
			let shouldFail = false;
			const tree = tDefine('test', {
				blackboard: defaultBB(),
				root: tRepeat(
					tAction('maybe', ({ blackboard: bb }) => {
						bb.counter++;
						return shouldFail ? NodeStatus.Failure : NodeStatus.Success;
					}),
					5,
				),
			});

			const ecs = createTestEcs();
			const entity = ecs.spawn({ ...createBehaviorTree(tree) });

			tick(ecs); // iteration 1 succeeds
			shouldFail = true;
			tick(ecs); // iteration 2 fails → repeat fails
			expect(getBB(ecs, entity.id).counter).toBe(2);
		});
	});

	// --- Cooldown ---

	describe('cooldown', () => {
		test('prevents re-entry for duration after success', () => {
			const tree = tDefine('test', {
				blackboard: defaultBB(),
				root: tSelector([
					tCooldown(
						tAction('cd', ({ blackboard: bb }) => { bb.counter++; return NodeStatus.Success; }),
						1.0, // 1 second cooldown
					),
					tAction('fallback', ({ blackboard: bb }) => { bb.log.push('fallback'); return NodeStatus.Success; }),
				]),
			});

			const ecs = createTestEcs();
			const entity = ecs.spawn({ ...createBehaviorTree(tree) });
			const dt = 0.1;

			tick(ecs, dt); // cd fires, counter = 1
			expect(getBB(ecs, entity.id).counter).toBe(1);

			tick(ecs, dt); // on cooldown → Failure → fallback
			expect(getBB(ecs, entity.id).counter).toBe(1);
			expect(getBB(ecs, entity.id).log).toEqual(['fallback']);

			// Advance past cooldown
			for (let i = 0; i < 10; i++) tick(ecs, dt);

			getBB(ecs, entity.id).log = [];
			tick(ecs, dt); // cooldown expired → cd fires again
			expect(getBB(ecs, entity.id).counter).toBe(2);
		});
	});

	// --- Parallel ---

	describe('parallel', () => {
		test('succeeds when successThreshold is met', () => {
			const tree = tDefine('test', {
				blackboard: defaultBB(),
				root: tSequence([
					tParallel([
						tAction('a', () => NodeStatus.Success),
						tAction('b', () => NodeStatus.Failure),
						tAction('c', () => NodeStatus.Success),
					], { successThreshold: 2 }),
					tAction('after', ({ blackboard: bb }) => { bb.counter++; return NodeStatus.Success; }),
				]),
			});

			const ecs = createTestEcs();
			const entity = ecs.spawn({ ...createBehaviorTree(tree) });
			tick(ecs);
			expect(getBB(ecs, entity.id).counter).toBe(1);
		});

		test('fails when failureThreshold is met', () => {
			const tree = tDefine('test', {
				blackboard: defaultBB(),
				root: tSelector([
					tParallel([
						tAction('a', () => NodeStatus.Failure),
						tAction('b', () => NodeStatus.Failure),
						tAction('c', () => NodeStatus.Success),
					], { failureThreshold: 2 }),
					tAction('fallback', ({ blackboard: bb }) => { bb.counter++; return NodeStatus.Success; }),
				]),
			});

			const ecs = createTestEcs();
			const entity = ecs.spawn({ ...createBehaviorTree(tree) });
			tick(ecs);
			expect(getBB(ecs, entity.id).counter).toBe(1);
		});

		test('returns Running when thresholds not met and children still running', () => {
			const tree = tDefine('test', {
				blackboard: defaultBB(),
				root: tParallel([
					tAction('a', () => NodeStatus.Success),
					tAction('b', () => NodeStatus.Running),
				], { successThreshold: 2 }),
			});

			const ecs = createTestEcs();
			const entity = ecs.spawn({ ...createBehaviorTree(tree) });
			tick(ecs);
			expect(isBehaviorTreeRunning(ecs, entity.id)).toBe(true);
		});
	});

	// --- Blackboard ---

	describe('blackboard', () => {
		test('mutations persist across ticks', () => {
			const tree = tDefine('test', {
				blackboard: defaultBB(),
				root: tAction('inc', ({ blackboard: bb }) => {
					bb.counter++;
					return NodeStatus.Running;
				}),
			});

			const ecs = createTestEcs();
			const entity = ecs.spawn({ ...createBehaviorTree(tree) });

			tick(ecs);
			tick(ecs);
			tick(ecs);

			expect(getBB(ecs, entity.id).counter).toBe(3);
		});

		test('context provides correct blackboard reference', () => {
			const tree = tDefine('test', {
				blackboard: defaultBB(),
				root: tAction('check', ({ blackboard: bb }) => {
					bb.log.push('tick');
					return NodeStatus.Success;
				}),
			});

			const ecs = createTestEcs();
			const entity = ecs.spawn({ ...createBehaviorTree(tree, { counter: 42 }) });
			tick(ecs);
			expect(getBB(ecs, entity.id).counter).toBe(42);
			expect(getBB(ecs, entity.id).log).toEqual(['tick']);
		});
	});

	// --- Abort on divergence (post-tick) ---

	describe('abort on path divergence', () => {
		test('aborts running node when tree completes without visiting it', () => {
			let runForever = true;
			const aborted: string[] = [];

			const tree = tDefine('test', {
				blackboard: defaultBB(),
				root: tSelector([
					tGuard(() => !runForever,
						tAction('done', () => NodeStatus.Success),
					),
					tAction('loop', () => NodeStatus.Running, {
						onAbort: () => { aborted.push('loop'); },
					}),
				]),
			});

			const ecs = createTestEcs();
			ecs.spawn({ ...createBehaviorTree(tree) });

			tick(ecs); // loop runs
			expect(aborted).toHaveLength(0);

			runForever = false;
			tick(ecs); // done succeeds → tree completes → loop never visited → abort
			expect(aborted).toEqual(['loop']);
		});
	});

	// --- Dispose ---

	describe('dispose', () => {
		test('calls onAbort when entity with running tree is removed', () => {
			const aborted: string[] = [];
			const tree = tDefine('test', {
				blackboard: defaultBB(),
				root: tAction('forever', () => NodeStatus.Running, {
					onAbort: () => { aborted.push('forever'); },
				}),
			});

			const ecs = createTestEcs();
			const entity = ecs.spawn({ ...createBehaviorTree(tree) });

			tick(ecs); // start running
			expect(aborted).toHaveLength(0);

			ecs.removeEntity(entity.id);
			expect(aborted).toEqual(['forever']);
		});
	});

	// --- Utility functions ---

	describe('isBehaviorTreeRunning', () => {
		test('returns false for idle tree', () => {
			const tree = tDefine('test', {
				blackboard: defaultBB(),
				root: tAction('done', () => NodeStatus.Success),
			});

			const ecs = createTestEcs();
			const entity = ecs.spawn({ ...createBehaviorTree(tree) });
			tick(ecs);
			expect(isBehaviorTreeRunning(ecs, entity.id)).toBe(false);
		});

		test('returns true for running tree', () => {
			const tree = tDefine('test', {
				blackboard: defaultBB(),
				root: tAction('loop', () => NodeStatus.Running),
			});

			const ecs = createTestEcs();
			const entity = ecs.spawn({ ...createBehaviorTree(tree) });
			tick(ecs);
			expect(isBehaviorTreeRunning(ecs, entity.id)).toBe(true);
		});
	});

	describe('resetBehaviorTree', () => {
		test('aborts running node and clears state', () => {
			const aborted: string[] = [];
			const tree = tDefine('test', {
				blackboard: defaultBB(),
				root: tAction('loop', () => NodeStatus.Running, {
					onAbort: () => { aborted.push('loop'); },
				}),
			});

			const ecs = createTestEcs();
			const entity = ecs.spawn({ ...createBehaviorTree(tree) });

			tick(ecs);
			expect(isBehaviorTreeRunning(ecs, entity.id)).toBe(true);

			resetBehaviorTree(ecs, entity.id);
			expect(isBehaviorTreeRunning(ecs, entity.id)).toBe(false);
			expect(aborted).toEqual(['loop']);
		});

		test('applies blackboard overrides', () => {
			const tree = tDefine('test', {
				blackboard: defaultBB(),
				root: tAction('loop', () => NodeStatus.Running),
			});

			const ecs = createTestEcs();
			const entity = ecs.spawn({ ...createBehaviorTree(tree) });
			tick(ecs);

			resetBehaviorTree(ecs, entity.id, { counter: 99 });
			expect(getBB(ecs, entity.id).counter).toBe(99);
		});
	});

	// --- Typed helpers ---

	describe('createBehaviorTreeHelpers', () => {
		test('returns typed helper functions', () => {
			const ecs = createTestEcs();
			const helpers = ecs.getHelpers(createBehaviorTreeHelpers);
			expect(typeof helpers.defineBehaviorTree).toBe('function');
			expect(typeof helpers.action).toBe('function');
			expect(typeof helpers.condition).toBe('function');
			expect(typeof helpers.guard).toBe('function');
		});

		test('binds leaf callback ecs type to app world', () => {
			const ecs = ECSpresso.create()
				.withPlugin(createBehaviorTreePlugin())
				.withComponentTypes<{ enemy: { hp: number } }>()
				.withEventTypes<{ enemyChecked: { entityId: number } }>()
				.withResource('morale', { value: 3 })
				.build();
			const { defineBehaviorTree, action: boundAction } = ecs.getHelpers(createBehaviorTreeHelpers);

			const tree = defineBehaviorTree<TestBB>('typed-app-world', {
				blackboard: defaultBB(),
				root: boundAction<TestBB>('read app world', ({ ecs: world, entityId, blackboard: bb }) => {
					const enemy = world.getComponent(entityId, 'enemy');
					if (!enemy) throw new Error('expected enemy component');
					const morale = world.getResource('morale');
					world.eventBus.publish('enemyChecked', { entityId });
					bb.counter = enemy.hp + morale.value;
					// @ts-expect-error - bound helpers still reject components outside the app world
					world.getComponent(entityId, 'missing');
					return NodeStatus.Success;
				}),
			});

			const blackboardOnly = action<TestBB>('top-level helper', ({ ecs: world, entityId }) => {
				// @ts-expect-error - top-level helpers expose only the behavior-tree plugin world
				world.getComponent(entityId, 'enemy');
				return NodeStatus.Success;
			});
			expect(blackboardOnly.type).toBe('action');

			const entity = ecs.spawn({ ...createBehaviorTree(tree), enemy: { hp: 2 } });
			ecs.update(1 / 60);
			const bt = ecs.getComponent(entity.id, 'behaviorTree');
			if (!bt) throw new Error(`entity ${entity.id} has no behaviorTree`);
			expect((bt.blackboard as TestBB).counter).toBe(5);
		});
	});

	// --- Multiple entities ---

	describe('multiple entities', () => {
		test('each entity ticks independently', () => {
			const tree = tDefine('test', {
				blackboard: defaultBB(),
				root: tAction('inc', ({ blackboard: bb }) => {
					bb.counter++;
					return NodeStatus.Running;
				}),
			});

			const ecs = createTestEcs();
			const e1 = ecs.spawn({ ...createBehaviorTree(tree) });
			tick(ecs);
			const e2 = ecs.spawn({ ...createBehaviorTree(tree) });
			tick(ecs);
			tick(ecs);

			expect(getBB(ecs, e1.id).counter).toBe(3); // ticked 3 times
			expect(getBB(ecs, e2.id).counter).toBe(2); // ticked 2 times
		});
	});
});
