/** A selector chooses between flee and patrol; a sequence gates fleeing. */
import ECSpresso from 'ecspresso';
import { createRenderer2DPlugin, createGraphicsComponents } from 'ecspresso/plugins/rendering/renderer2D';
import {
	createBehaviorTreePlugin, createBehaviorTreeHelpers, createBehaviorTree,
	selector, sequence, NodeStatus,
} from 'ecspresso/plugins/ai/behavior-tree';
import { createBeanGraphics } from '../brand';

const LEFT = 60;
const RIGHT = 580;
const ecs = ECSpresso.create()
	.withPlugin(createRenderer2DPlugin({ width: 640, height: 400, background: '#1a1a2e' }))
	.withPlugin(createBehaviorTreePlugin())
	.withResourceTypes<{ threat: boolean; activeBehavior: 'flee' | 'patrol' }>()
	.withResource('threat', false)
	.withResource('activeBehavior', 'patrol')
	.build();

const { defineBehaviorTree, condition, action } = ecs.getHelpers(createBehaviorTreeHelpers);
interface PatrolMemory { direction: number }

const tree = defineBehaviorTree<PatrolMemory>('flee-or-patrol', {
	blackboard: { direction: 1 },
	root: selector<PatrolMemory>([
		sequence<PatrolMemory>([
			condition<PatrolMemory>('threat nearby', ({ ecs: world }) => world.getResource('threat')),
			action<PatrolMemory>('flee right', ({ ecs: world, entityId, dt }) => {
				world.setResource('activeBehavior', 'flee');
				// Tree callbacks are outside an owning query: publish this write explicitly.
				world.mutateComponent(entityId, 'localTransform', function flee(transform) {
					transform.x = Math.min(RIGHT, transform.x + 150 * dt);
				});
				// Success resets the sequence so its condition is checked next tick.
				return NodeStatus.Success;
			}),
		]),
		action<PatrolMemory>('patrol', ({ ecs: world, entityId, blackboard, dt }) => {
			world.setResource('activeBehavior', 'patrol');
			world.mutateComponent(entityId, 'localTransform', function patrol(transform) {
				transform.x = Math.max(LEFT, Math.min(RIGHT, transform.x + blackboard.direction * 70 * dt));
				if (transform.x >= RIGHT) blackboard.direction = -1;
				if (transform.x <= LEFT) blackboard.direction = 1;
			});
			return NodeStatus.Success;
		}),
	]),
});

const behaviorLabel = document.getElementById('behavior');
ecs.addSystem('show-behavior')
	.inPhase('render')
	.withResources(['activeBehavior'])
	.setProcess(({ resources: { activeBehavior } }) => {
		if (behaviorLabel) behaviorLabel.textContent = activeBehavior;
	});

await ecs.initialize();
ecs.spawn({
	...createGraphicsComponents(createBeanGraphics(18, 0x4ecdc4), { x: 160, y: 300 }),
	...createBehaviorTree(tree),
});

const threatToggle = document.getElementById('threat');
if (!(threatToggle instanceof HTMLInputElement)) throw new Error('Missing threat toggle');
threatToggle.addEventListener('change', function toggleThreat() {
	ecs.setResource('threat', threatToggle.checked);
});
