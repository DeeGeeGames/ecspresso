import { expect, test } from 'bun:test';
import ECSpresso from '../../ecspresso';
import { createTransform, createTransformPlugin } from '../spatial/transform';
import { createSpatialIndexPlugin } from '../spatial/spatial-index';
import { createCollisionPlugin, createCollisionLayer, defineCollisionLayers } from '../physics/collision';
import { createDetectionPlugin, type DetectionGainedEvent, type DetectionLostEvent } from './detection';

test('reused detection plugin isolates event history for matching entity IDs', async () => {
	const plugin = createDetectionPlugin<'ai', 'target'>({ phase: 'postUpdate', priority: -100 });
	const layers = defineCollisionLayers({ target: [] });
	function buildWorld() {
		return ECSpresso.create()
			.withPlugin(createTransformPlugin())
			.withPlugin(createCollisionPlugin({ layers }))
			.withPlugin(createSpatialIndexPlugin({ phases: ['postUpdate'] }))
			.withPlugin(plugin)
			.build();
	}
	function populateWorld(world: ReturnType<typeof buildWorld>) {
		const detector = world.spawn({
			...createTransform(0, 0),
			detector: { range: 50, layerFilter: ['target'], maxResults: 10 },
		});
		const target = world.spawn({
			...createTransform(10, 0),
			aabbCollider: { width: 2, height: 2 },
			...createCollisionLayer('target', []),
		});
		return { detector, target };
	}
	const a = buildWorld();
	const b = buildWorld();
	const entitiesA = populateWorld(a);
	const entitiesB = populateWorld(b);
	expect(entitiesA.detector.id).toBe(entitiesB.detector.id);
	const gainedA: DetectionGainedEvent[] = [];
	const gainedB: DetectionGainedEvent[] = [];
	const lostB: DetectionLostEvent[] = [];
	a.eventBus.subscribe('detectionGained', (event) => gainedA.push(event));
	b.eventBus.subscribe('detectionGained', (event) => gainedB.push(event));
	b.eventBus.subscribe('detectionLost', (event) => lostB.push(event));
	a.update(0.016);
	b.update(0.016);
	expect(gainedA).toEqual([{ entityId: entitiesA.detector.id, detectedId: entitiesA.target.id }]);
	expect(gainedB).toEqual([{ entityId: entitiesB.detector.id, detectedId: entitiesB.target.id }]);
	await a.dispose();
	b.update(0.016);
	expect(gainedB).toHaveLength(1);
	b.removeEntity(entitiesB.target.id);
	b.update(0.016);
	expect(lostB).toEqual([{ entityId: entitiesB.detector.id, lostId: entitiesB.target.id }]);
	await b.dispose();
});
