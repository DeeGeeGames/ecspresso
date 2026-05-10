import { expect, describe, test } from 'bun:test';
import EntityManager from './entity-manager';
import ECSpresso from './ecspresso';

interface TestComponents {
	position: { x: number; y: number };
	velocity: { x: number; y: number };
	health: { value: number };
	dead: true;
	parentTag: true;
	other: { v: number };
}

describe('QueryCache', () => {
	test('with-component membership tracks add/remove', () => {
		const em = new EntityManager<TestComponents>();
		const a = em.createEntity();
		const b = em.createEntity();
		em.addComponent(a.id, 'position', { x: 0, y: 0 });

		// First call populates cache
		expect(em.getEntitiesWithQuery(['position']).map(e => e.id)).toEqual([a.id]);

		em.addComponent(b.id, 'position', { x: 1, y: 1 });
		expect(em.getEntitiesWithQuery(['position']).map(e => e.id).sort()).toEqual([a.id, b.id].sort());

		em.removeComponent(a.id, 'position');
		expect(em.getEntitiesWithQuery(['position']).map(e => e.id)).toEqual([b.id]);
	});

	test('without-component membership tracks add/remove', () => {
		const em = new EntityManager<TestComponents>();
		const alive = em.createEntity();
		const corpse = em.createEntity();
		em.addComponent(alive.id, 'position', { x: 0, y: 0 });
		em.addComponent(corpse.id, 'position', { x: 1, y: 1 });
		em.addComponent(corpse.id, 'dead', true);

		expect(em.getEntitiesWithQuery(['position'], ['dead']).map(e => e.id)).toEqual([alive.id]);

		em.addComponent(alive.id, 'dead', true);
		expect(em.getEntitiesWithQuery(['position'], ['dead']).map(e => e.id)).toEqual([]);

		em.removeComponent(corpse.id, 'dead');
		expect(em.getEntitiesWithQuery(['position'], ['dead']).map(e => e.id)).toEqual([corpse.id]);
	});

	test('removeEntity drops entity from cache', () => {
		const em = new EntityManager<TestComponents>();
		const a = em.createEntity();
		const b = em.createEntity();
		em.addComponent(a.id, 'position', { x: 0, y: 0 });
		em.addComponent(b.id, 'position', { x: 1, y: 1 });

		expect(em.getEntitiesWithQuery(['position']).length).toBe(2);

		em.removeEntity(a.id);
		expect(em.getEntitiesWithQuery(['position']).map(e => e.id)).toEqual([b.id]);
	});

	test('parentHas membership reacts to setParent / removeParent', () => {
		const em = new EntityManager<TestComponents>();
		const parent = em.createEntity();
		em.addComponent(parent.id, 'parentTag', true);

		const child = em.createEntity();
		em.addComponent(child.id, 'position', { x: 0, y: 0 });

		expect(em.getEntitiesWithQuery(['position'], [], undefined, undefined, ['parentTag']).map(e => e.id)).toEqual([]);

		em.setParent(child.id, parent.id);
		expect(em.getEntitiesWithQuery(['position'], [], undefined, undefined, ['parentTag']).map(e => e.id)).toEqual([child.id]);

		em.removeParent(child.id);
		expect(em.getEntitiesWithQuery(['position'], [], undefined, undefined, ['parentTag']).map(e => e.id)).toEqual([]);
	});

	test('parentHas reacts to component change on the parent', () => {
		const em = new EntityManager<TestComponents>();
		const parent = em.createEntity();
		const child = em.createEntity();
		em.addComponent(child.id, 'position', { x: 0, y: 0 });
		em.setParent(child.id, parent.id);

		expect(em.getEntitiesWithQuery(['position'], [], undefined, undefined, ['parentTag']).map(e => e.id)).toEqual([]);

		em.addComponent(parent.id, 'parentTag', true);
		expect(em.getEntitiesWithQuery(['position'], [], undefined, undefined, ['parentTag']).map(e => e.id)).toEqual([child.id]);

		em.removeComponent(parent.id, 'parentTag');
		expect(em.getEntitiesWithQuery(['position'], [], undefined, undefined, ['parentTag']).map(e => e.id)).toEqual([]);
	});

	test('parentHas evicts orphaned children when parent is removed (cascade=false)', () => {
		const em = new EntityManager<TestComponents>();
		const parent = em.createEntity();
		em.addComponent(parent.id, 'parentTag', true);
		const child = em.createEntity();
		em.addComponent(child.id, 'position', { x: 0, y: 0 });
		em.setParent(child.id, parent.id);

		expect(em.getEntitiesWithQuery(['position'], [], undefined, undefined, ['parentTag']).map(e => e.id)).toEqual([child.id]);

		em.removeEntity(parent.id, { cascade: false });
		expect(em.getEntitiesWithQuery(['position'], [], undefined, undefined, ['parentTag']).map(e => e.id)).toEqual([]);
	});

	test('two queries with identical shape share a single cache', () => {
		const em = new EntityManager<TestComponents>();
		em.addComponent(em.createEntity().id, 'position', { x: 0, y: 0 });

		em.getEntitiesWithQuery(['position'], ['dead']);
		em.getEntitiesWithQuery(['position'], ['dead']);
		em.getEntitiesWithQuery(['position'] as Array<'position'>, ['dead']);
		expect(em._queryCacheForTesting.cacheCount).toBe(1);

		em.getEntitiesWithQuery(['position']);
		expect(em._queryCacheForTesting.cacheCount).toBe(2);
	});

	test('changed filter still narrows over a cache hit', () => {
		const ecs = new ECSpresso<{ components: TestComponents; events: {}; resources: {}; assets: {}; screens: {} }>();
		const a = ecs.spawn({ position: { x: 0, y: 0 }, velocity: { x: 1, y: 1 } });
		const b = ecs.spawn({ position: { x: 0, y: 0 }, velocity: { x: 2, y: 2 } });

		let seen: number[] = [];
		ecs.addSystem('test')
			.runWhenEmpty()
			.addQuery('moving', { with: ['position', 'velocity'], changed: ['velocity'] })
			.setProcess(({ queries }) => {
				seen = queries.moving.map(e => e.id);
			});

		ecs.update(0.016);
		expect(seen.sort()).toEqual([a.id, b.id].sort());

		ecs.update(0.016);
		expect(seen).toEqual([]);

		ecs.markChanged(a.id, 'velocity');
		ecs.update(0.016);
		expect(seen).toEqual([a.id]);
	});

	test('cache survives command-buffer playback between phases', () => {
		const ecs = new ECSpresso<{ components: TestComponents; events: {}; resources: {}; assets: {}; screens: {} }>();
		ecs.spawn({ position: { x: 0, y: 0 } });
		ecs.spawn({ position: { x: 0, y: 0 } });

		const counts: number[] = [];
		ecs.addSystem('spawner')
			.inPhase('preUpdate')
			.addQuery('all', { with: ['position'] })
			.setProcess(({ queries, ecs }) => {
				counts.push(queries.all.length);
				if (counts.length === 1) {
					ecs.commands.spawn({ position: { x: 9, y: 9 } });
				}
			});

		ecs.addSystem('observer')
			.inPhase('update')
			.addQuery('all', { with: ['position'] })
			.setProcess(({ queries }) => {
				counts.push(queries.all.length);
			});

		ecs.update(0.016);
		expect(counts).toEqual([2, 3]);
	});

	test('reactive queries continue to work alongside the cache', () => {
		const ecs = new ECSpresso<{ components: TestComponents; events: {}; resources: {}; assets: {}; screens: {} }>();
		const enters: number[] = [];
		const exits: number[] = [];
		ecs.addReactiveQuery('alive', {
			with: ['position'],
			without: ['dead'],
			onEnter: (e) => enters.push(e.id),
			onExit: (id) => exits.push(id),
		});

		const a = ecs.spawn({ position: { x: 0, y: 0 } });
		expect(enters).toEqual([a.id]);

		ecs.entityManager.addComponent(a.id, 'dead', true);
		expect(exits).toEqual([a.id]);

		expect(ecs.entityManager.getEntitiesWithQuery(['position'], ['dead']).length).toBe(0);
	});
});
