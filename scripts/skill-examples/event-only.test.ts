import { expect, test } from 'bun:test';
import ECSpresso from 'ecspresso';
import { createHealthPlugin } from 'ecspresso/plugins/combat/health';

test('damage and death are synchronous without a frame', async () => {
	const world = ECSpresso.create().withPlugin(createHealthPlugin()).build();
	const deaths: number[] = [];
	world.addSystem('death-response').setEventHandlers({
		entityDied({ data }) { deaths.push(data.entityId); },
	});
	try {
		await world.initialize();
		const target = world.spawn({ health: { current: 10, max: 10 } });
		world.eventBus.publish('damage', { entityId: target.id, amount: 3 });
		expect(target.components.health.current).toBe(7);
		expect(deaths).toEqual([]);
		world.eventBus.publish('damage', { entityId: target.id, amount: 7 });
		world.eventBus.publish('damage', { entityId: target.id, amount: 1 });
		expect(target.components.health.current).toBe(0);
		expect(deaths).toEqual([target.id]);
		expect(world.getEntity(target.id)).toBeDefined(); // Health does not remove it.
	} finally {
		await world.dispose();
	}
});
