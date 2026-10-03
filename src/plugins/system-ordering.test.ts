import { expect, test } from 'bun:test';
import ECSpresso, { defineSystemRef } from '../index';
import { createTimer, createTimerPlugin, timerSystems } from './scripting/timers';
import { createCoroutinePlugin, coroutineSystems } from './scripting/coroutine';
import { createTweenPlugin, tweenSystems } from './scripting/tween';
import { createTransform, createTransformPlugin } from './spatial/transform';
import { createCollisionPlugin, createCollisionLayer, defineCollisionLayers } from './physics/collision';
import { createSpatialIndexPlugin, spatialIndexSystems } from './spatial/spatial-index';
import { createDetectionPlugin, detectionSystems } from './ai/detection';
import { createSpatialIndex3DPlugin } from './spatial/spatial-index3D';
import { createPhysics2DPlugin, createRigidBody, physics2DSystems } from './physics/physics2D';

test('built-in primary options form timer/coroutine/tween ordering without priorities', () => {
	const before = defineSystemRef('before');
	const after = defineSystemRef('after');
	const world = ECSpresso.create()
		.withPlugin(createTweenPlugin({ phase: 'preUpdate', after: [coroutineSystems.update], before: [after] }))
		.withPlugin(createCoroutinePlugin({ phase: 'preUpdate', after: [timerSystems.update] }))
		.withPlugin(createTimerPlugin({ after: [before] }))
		.build();
	const elapsed: number[] = [];
	world.spawn({ timers: { clock: createTimer(10) } });
	world.addSystem('before').withRef(before).before(timerSystems.update).setProcess(({ ecs }) => {
		elapsed.push(ecs.getEntitiesWithQuery(['timers'])[0]?.components.timers?.['clock']?.elapsed ?? -1);
	}).inPhase('preUpdate');
	world.addSystem('after').withRef(after).after(tweenSystems.update).inPhase('preUpdate').setProcess(({ ecs }) => {
		elapsed.push(ecs.getEntitiesWithQuery(['timers'])[0]?.components.timers?.['clock']?.elapsed ?? -1);
	});
	world.update(0.25);
	expect(elapsed).toEqual([0, 0.25]);
});

test('consumer sees detection from the same update without knowing plugin priorities', () => {
	const layers = defineCollisionLayers({ target: [] });
	const world = ECSpresso.create()
		.withPlugin(createTransformPlugin())
		.withPlugin(createCollisionPlugin({ layers }))
		.withPlugin(createSpatialIndexPlugin({ phases: ['postUpdate'], ordering: { postUpdate: { before: [detectionSystems.scan] } } }))
		.withPlugin(createDetectionPlugin<'ai', 'target'>({ phase: 'postUpdate', after: [spatialIndexSystems.rebuild.postUpdate] }))
		.build();
	const detector = world.spawn({ ...createTransform(0, 0), detector: { range: 50, layerFilter: ['target'], maxResults: 10 } });
	const target = world.spawn({ ...createTransform(10, 0), aabbCollider: { width: 2, height: 2 }, ...createCollisionLayer('target', []) });
	const observed: number[] = [];
	world.addSystem('high-priority-consumer').after(detectionSystems.scan).inPhase('postUpdate').setPriority(100_000).setProcess(({ ecs }) => {
		observed.push(ecs.getComponent(detector.id, 'detectedEntities')?.entities[0]?.entityId ?? -1);
	});
	world.update(0);
	expect(observed).toEqual([target.id]);
});

test('spatial ordering rejects options for phases that are not registered', () => {
	expect(() => createSpatialIndexPlugin({ phases: ['fixedUpdate'], ordering: { postUpdate: { after: [timerSystems.update] } } })).toThrow('unregistered phase "postUpdate"');
	expect(() => createSpatialIndex3DPlugin({ phases: ['postUpdate'], ordering: { fixedUpdate: { after: [timerSystems.update] } } })).toThrow('unregistered phase "fixedUpdate"');
});

test('existing inverted physics priorities remain configurable without implicit plugin edges', () => {
	const world = ECSpresso.create()
		.withPlugin(createTransformPlugin())
		.withPlugin(createPhysics2DPlugin({ integrationPriority: -100, collisionPriority: 100 }))
		.withFixedTimestep(1)
		.build();
	const body = world.spawn({ ...createTransform(0, 0), ...createRigidBody('dynamic'), velocity: { x: 10, y: 0 } });
	const observed: number[] = [];
	world.addSystem('between-passes').inPhase('fixedUpdate')
		.after(physics2DSystems.collide).before(physics2DSystems.integrate)
		.setProcess(({ ecs }) => observed.push(ecs.getComponent(body.id, 'localTransform')?.x ?? -1));
	world.update(1);
	expect(observed).toEqual([0]);
	expect(body.components.localTransform.x).toBe(10);
});
