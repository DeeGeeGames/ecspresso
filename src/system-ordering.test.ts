import { describe, expect, test } from 'bun:test';
import ECSpresso, { defineSystemRef, definePlugin } from './index';

function createWorld() {
	return ECSpresso.create().withComponentTypes<{ value: number }>().build();
}

describe('explicit system ordering', () => {
	test('forward refs override priority; eligible systems retain priority and registration ties', () => {
		const world = createWorld();
		const producer = defineSystemRef('public.producer');
		const extra = defineSystemRef('extra');
		const order: string[] = [];
		world.addSystem('consumer').after(producer).after(extra).setPriority(100).setProcess(() => order.push('consumer'));
		world.addSystem('first-tie').setPriority(50).setProcess(() => order.push('first-tie'));
		world.addSystem('second-tie').setPriority(50).setProcess(() => order.push('second-tie'));
		world.addSystem('private-producer').withRef(producer).before(extra).setProcess(() => order.push('producer'));
		world.addSystem('extra').withRef(extra).setProcess(() => order.push('extra'));
		world.update(0);
		expect(order).toEqual(['first-tie', 'second-tie', 'producer', 'extra', 'consumer']);
	});

	test('references identify tokens, not names, and bind independently in worlds', () => {
		const ref = defineSystemRef('same-name');
		const other = defineSystemRef('same-name');
		expect(Object.isFrozen(ref)).toBe(true);
		const plugin = definePlugin('producer').install(world => world.addSystem('private').withRef(ref).setProcess(() => undefined));
		const worlds = [ECSpresso.create().withPlugin(plugin).build(), ECSpresso.create().withPlugin(plugin).build()];
		worlds.forEach(world => {
			world.addSystem('consumer').after(ref).setProcess(() => undefined);
			expect(() => world.update(0)).not.toThrow();
		});
		worlds[0]?.addSystem('wrong-token').after(other).setProcess(() => undefined);
		expect(() => worlds[0]?.update(0)).toThrow('unbound system "same-name"');
		expect(() => worlds[1]?.update(0)).not.toThrow();
	});

	test('rejects missing refs on every update; registering the producer repairs the graph', () => {
		const world = createWorld();
		const ref = defineSystemRef('missing');
		const order: string[] = [];
		world.addSystem('consumer').after(ref).setProcess(() => order.push('consumer'));
		expect(() => world.update(0)).toThrow('unbound system "missing"');
		expect(() => world.update(0)).toThrow('unbound system "missing"');
		expect(order).toEqual([]);
		world.addSystem('producer').withRef(ref).setProcess(() => order.push('producer'));
		world.update(0);
		expect(order).toEqual(['producer', 'consumer']);
	});

	test('rejects duplicate bindings, self dependencies and cycles', () => {
		const ref = defineSystemRef('producer');
		const duplicate = createWorld();
		duplicate.addSystem('first').withRef(ref);
		duplicate.addSystem('second').withRef(ref);
		expect(() => duplicate.update(0)).toThrow('bound to both "first" and "second"');
		expect(duplicate.removeSystem('second')).toBe(true);
		expect(() => duplicate.update(0)).not.toThrow();
		const self = createWorld();
		self.addSystem('self').withRef(ref).after(ref);
		expect(() => self.update(0)).toThrow('cannot depend on itself');
		const cycle = createWorld();
		const second = defineSystemRef('second');
		cycle.addSystem('first').withRef(ref).after(second);
		cycle.addSystem('second').withRef(second).after(ref);
		expect(() => cycle.update(0)).toThrow('ordering cycle in update: "first", "second"');
	});

	test('accepts compatible phases and rejects contradictions and invalid phase changes atomically', () => {
		const world = createWorld();
		const ref = defineSystemRef('producer');
		const order: string[] = [];
		world.addSystem('producer').withRef(ref).inPhase('preUpdate').setProcess(() => order.push('producer'));
		world.addSystem('consumer').after(ref).setProcess(() => order.push('consumer'));
		world.update(0);
		expect(() => world.updateSystemPhase('producer', 'render')).toThrow('contradicts fixed phase order');
		world.update(0);
		expect(order).toEqual(['producer', 'consumer', 'producer', 'consumer']);
		const wrong = createWorld();
		wrong.addSystem('producer').withRef(ref).inPhase('render');
		wrong.addSystem('consumer').after(ref).inPhase('preUpdate');
		expect(() => wrong.update(0)).toThrow('contradicts fixed phase order');
	});

	test('removal rejects referenced producers before detach; consumers can be removed first', () => {
		const world = createWorld();
		const ref = defineSystemRef('producer');
		const detached: string[] = [];
		world.addSystem('producer').withRef(ref).setOnDetach(() => { detached.push('producer'); });
		world.addSystem('consumer').after(ref);
		world.update(0);
		expect(() => world.removeSystem('producer')).toThrow('unbound system "producer"');
		expect(detached).toEqual([]);
		expect(() => world.update(0)).not.toThrow();
		expect(world.removeSystem('consumer')).toBe(true);
		expect(world.removeSystem('producer')).toBe(true);
		expect(detached).toEqual(['producer']);
	});

	test('pins schedule changes and additions to next update; removed fixed systems never run again', () => {
		const world = createWorld();
		const order: string[] = [];
		world.addSystem('change').inPhase('preUpdate').setProcess(({ ecs }) => {
			ecs.updateSystemPhase('move', 'preUpdate');
			ecs.updateSystemPriority('move', 100);
			ecs.removeSystem('fixed');
			ecs.addSystem('new').setProcess(() => order.push('new'));
			order.push('change');
		});
		world.addSystem('fixed').inPhase('fixedUpdate').setProcess(() => order.push('fixed'));
		world.addSystem('first').setProcess(() => order.push('first'));
		world.addSystem('move').setProcess(() => order.push('move'));
		world.update(2 / 60);
		expect(order).toEqual(['change', 'first', 'move']);
		world.removeSystem('change');
		world.update(0);
		expect(order).toEqual(['change', 'first', 'move', 'move', 'first', 'new']);
	});

	test('self removal during fixedUpdate skips all later fixed steps', () => {
		const world = createWorld();
		const steps: number[] = [];
		world.addSystem('once').inPhase('fixedUpdate').setProcess(({ ecs }) => {
			steps.push(1);
			ecs.removeSystem('once');
		});
		world.update(3 / 60);
		expect(steps).toEqual([1]);
	});

	test('self removal publishes completed process mutations without resurrecting the system', () => {
		const world = createWorld();
		const observed: number[] = [];
		world.addSystem('writer').setPriority(1)
			.addQuery('values', { with: ['value'], mutates: ['value'] })
			.setProcess(({ queries, ecs }) => {
				queries.values.forEach(entity => { entity.components.value += 1; });
				if (queries.values[0]?.components.value !== 2) return;
				ecs.removeSystem('writer');
			});
		world.addSystem('observer').addQuery('values', { with: ['value'], changed: ['value'] })
			.setProcess(({ queries }) => { observed.push(...queries.values.map(entity => entity.components.value)); });
		world.spawn({ value: 0 });
		world.update(0);
		world.update(0);
		world.update(0);
		expect(observed).toEqual([1, 2]);
	});

	test('self removal publishes completed entry callback mutations without processing', () => {
		const world = createWorld();
		const observed: number[] = [];
		world.spawn({ value: 0 });
		world.addSystem('observer').addQuery('values', { with: ['value'], changed: ['value'] })
			.setProcess(({ queries }) => { observed.push(...queries.values.map(entity => entity.components.value)); });
		world.update(0);
		world.addSystem('entry').setPriority(1).addQuery('values', { with: ['value'], mutates: ['value'] })
			.setOnEntityEnter('values', ({ entity, ecs }) => {
				entity.components.value += 1;
				ecs.removeSystem('entry');
			})
			.setProcess(() => { throw new Error('Removed system must not process.'); });
		world.update(0);
		world.update(0);
		expect(observed).toEqual([0, 1]);
	});

	test('detach hooks preserve phase changes, finalized additions and nested removals', async () => {
		const world = createWorld();
		const order: string[] = [];
		const detached: string[] = [];
		world.addSystem('move').setPriority(100).setProcess(() => order.push('move'));
		world.addSystem('pre').inPhase('preUpdate').setProcess(() => order.push('pre'));
		world.addSystem('nested').setProcess(() => order.push('nested')).setOnDetach(() => { detached.push('nested'); });
		world.addSystem('remove').setOnDetach(ecs => {
			ecs.updateSystemPhase('move', 'preUpdate');
			ecs.addSystem('added').inGroup('added').setProcess(() => order.push('added')).setOnDetach(() => { detached.push('added'); });
			expect(ecs.getSystemsInGroup('added')).toEqual(['added']);
			expect(ecs.removeSystem('nested')).toBe(true);
		});
		world.update(0);
		order.length = 0;
		expect(world.removeSystem('remove')).toBe(true);
		world.update(0);
		expect(order).toEqual(['move', 'pre', 'added']);
		await world.dispose();
		expect(detached).toEqual(['nested', 'added']);
	});

	test('rejects forged references at untyped builder boundaries', () => {
		const system = createWorld().addSystem('invalid');
		const forged: unknown = { name: 'forged' };
		expect(() => Reflect.apply(system.withRef, system, [forged])).toThrow('defineSystemRef');
		expect(() => Reflect.apply(system.after, system, [forged])).toThrow('defineSystemRef');
	});

	test('rejects invalid phases supplied by untyped callers instead of dropping systems', () => {
		const world = createWorld();
		const system = world.addSystem('typo').setProcess(() => undefined);
		Reflect.apply(system.inPhase, system, ['udpate']);
		expect(() => world.update(0)).toThrow('System "typo" has unsupported phase "udpate"');
		Reflect.apply(world.updateSystemPhase, world, ['typo', 'update']);
		expect(() => world.update(0)).not.toThrow();
		expect(() => Reflect.apply(world.updateSystemPhase, world, ['typo', 'broken'])).toThrow('unsupported phase "broken"');
		expect(() => world.update(0)).not.toThrow();
	});

	test('self removal in an entry callback skips later entry callbacks and processing', () => {
		const world = createWorld();
		const order: string[] = [];
		world.spawn({ value: 1 });
		world.spawn({ value: 2 });
		world.addSystem('entry').addQuery('values', { with: ['value'] })
			.setOnEntityEnter('values', ({ ecs }) => {
				order.push('enter');
				ecs.removeSystem('entry');
				order.push('callback-completed');
			})
			.setOnDetach(() => { order.push('detached'); })
			.setProcess(() => order.push('process'));
		world.addSystem('other').setProcess(() => order.push('other'));
		world.update(0);
		expect(order).toEqual(['enter', 'detached', 'callback-completed', 'other']);
	});

	test('caught invalid registration in an entry callback blocks the next callback and process', () => {
		const world = createWorld();
		const missing = defineSystemRef('missing');
		const order: string[] = [];
		world.spawn({ value: 1 });
		world.spawn({ value: 2 });
		world.addSystem('entry').addQuery('values', { with: ['value'] })
			.setOnEntityEnter('values', ({ ecs }) => {
				order.push('enter');
				ecs.addSystem('invalid').after(missing).inGroup('invalid');
				expect(() => ecs.getSystemsInGroup('invalid')).toThrow('unbound system "missing"');
			})
			.setProcess(() => order.push('process'));
		expect(() => world.update(0)).toThrow('unbound system "missing"');
		expect(order).toEqual(['enter']);
		expect(() => world.update(0)).toThrow('unbound system "missing"');
	});

	test('initialization validates forward references before running lifecycle callbacks', async () => {
		const world = createWorld();
		const missing = defineSystemRef('missing');
		const initialized: string[] = [];
		world.addSystem('consumer').after(missing).setOnInitialize(() => { initialized.push('consumer'); });
		await expect(world.initialize()).rejects.toThrow('unbound system "missing"');
		expect(initialized).toEqual([]);
		world.addSystem('producer').withRef(missing).setOnInitialize(() => { initialized.push('producer'); });
		await world.initialize();
		expect(initialized).toEqual(['consumer', 'producer']);
	});

	test('ordering does not flush structural commands, activate disabled systems or promise a fixed step', () => {
		const world = createWorld();
		const spawn = defineSystemRef('spawn');
		const fixed = defineSystemRef('fixed');
		const observed: number[] = [];
		world.addSystem('spawn').withRef(spawn).inGroup('paused').setProcess(({ ecs }) => { ecs.commands.spawn({ value: 1 }); });
		world.addSystem('fixed').withRef(fixed).inPhase('fixedUpdate').setProcess(() => observed.push(999));
		world.addSystem('consumer').after(spawn, fixed).setProcess(({ ecs }) => observed.push(ecs.getEntitiesWithQuery(['value']).length));
		world.disableSystemGroup('paused');
		world.update(0);
		world.enableSystemGroup('paused');
		world.update(0);
		expect(observed).toEqual([0, 0]);
		expect(world.getEntitiesWithQuery(['value'])).toHaveLength(1);
	});

	test('terminal disposal detaches even invalid schedules without initialization', async () => {
		const world = createWorld();
		const ref = defineSystemRef('missing');
		const detached: string[] = [];
		world.addSystem('invalid').after(ref).setOnDetach(() => { detached.push('invalid'); });
		expect(() => world.update(0)).toThrow('unbound');
		await world.dispose();
		expect(detached).toEqual(['invalid']);
	});
});
