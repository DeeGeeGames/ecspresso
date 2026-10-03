import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// A separate Node consumer avoids this repository's source aliases. The plugin
// bundles must use the public root token factory rather than duplicate its state.
const consumerDirectory = mkdtempSync(join(tmpdir(), 'ecspresso-ordering-consumer-'));
const packageDirectory = resolve(import.meta.dir, '..');
const consumerFile = join(consumerDirectory, 'consumer.mjs');
const consumerSource = `
import assert from 'node:assert/strict';
import ECSpresso, { defineSystemRef } from 'ecspresso';
import { createTimerPlugin, createTimer, timerSystems } from 'ecspresso/plugins/scripting/timers';
import { createCoroutinePlugin, coroutineSystems } from 'ecspresso/plugins/scripting/coroutine';
import { createTransformPlugin, createTransform } from 'ecspresso/plugins/spatial/transform';
import { createCollisionPlugin, defineCollisionLayers, createCollisionLayer } from 'ecspresso/plugins/physics/collision';
import { createSpatialIndexPlugin, spatialIndexSystems } from 'ecspresso/plugins/spatial/spatial-index';
import { createDetectionPlugin, detectionSystems } from 'ecspresso/plugins/ai/detection';

const before = defineSystemRef('packaged.before');
const layers = defineCollisionLayers({ target: [] });
const world = ECSpresso.create()
	.withPlugin(createTimerPlugin({ after: [before], before: [coroutineSystems.update] }))
	.withPlugin(createCoroutinePlugin({ phase: 'preUpdate', after: [timerSystems.update] }))
	.withPlugin(createTransformPlugin())
	.withPlugin(createCollisionPlugin({ layers }))
	.withPlugin(createSpatialIndexPlugin({ phases: ['postUpdate'], ordering: { postUpdate: { before: [detectionSystems.scan] } } }))
	.withPlugin(createDetectionPlugin({ phase: 'postUpdate', after: [spatialIndexSystems.rebuild.postUpdate] }))
	.build();
const clock = world.spawn({ timers: { elapsed: createTimer(10) } });
const detector = world.spawn({ ...createTransform(0, 0), detector: { range: 50, layerFilter: ['target'], maxResults: 10 } });
const target = world.spawn({ ...createTransform(10, 0), aabbCollider: { width: 2, height: 2 }, ...createCollisionLayer('target', []) });
const observed = [];
world.addSystem('before').withRef(before).inPhase('preUpdate').setProcess(() => observed.push(clock.components.timers.elapsed.elapsed));
world.addSystem('consumer').after(coroutineSystems.update, detectionSystems.scan).inPhase('postUpdate').setPriority(100000)
	.setProcess(() => observed.push(clock.components.timers.elapsed.elapsed, world.getComponent(detector.id, 'detectedEntities')?.entities[0]?.entityId));
await world.initialize();
world.update(0.25);
assert.deepEqual(observed, [0, 0.25, target.id]);
assert.ok(Object.isFrozen(timerSystems));
assert.ok(Object.isFrozen(timerSystems.update));
await world.dispose();
console.log('Packaged ordering consumer passed: root and plugin tokens share identity, timer/coroutine order and same-frame detection work.');
`;

try {
	mkdirSync(join(consumerDirectory, 'node_modules'));
	symlinkSync(packageDirectory, join(consumerDirectory, 'node_modules', 'ecspresso'), 'dir');
	writeFileSync(consumerFile, consumerSource);
	const result = spawnSync('node', [consumerFile], { cwd: consumerDirectory, encoding: 'utf8' });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`Packaged ordering consumer failed:\n${result.stdout}${result.stderr}`);
	process.stdout.write(result.stdout);
} finally {
	rmSync(consumerDirectory, { recursive: true, force: true });
}
