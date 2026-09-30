import { expect, test } from 'bun:test';

test('disabling gameplay stops plugin steering and resuming restores it', async () => {
	Object.defineProperty(globalThis, 'document', {
		configurable: true,
		value: { body: {}, querySelector: () => null },
	});
	const { game } = await import('../types');
	try {
		const enemy = game.spawn({
			enemy: { type: 'fast', speed: 50, scoreValue: 10 },
			moveTarget: { x: 100, y: 0 },
			moveSpeed: 50,
			localTransform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
		});

		game.disableSystemGroup('gameplay');
		game.update(0.1);
		const pausedPosition = game.getComponent(enemy.id, 'localTransform');
		if (!pausedPosition) throw new Error('Expected enemy local transform');
		expect(pausedPosition.x).toBe(0);

		game.enableSystemGroup('gameplay');
		game.update(0.1);
		const resumedPosition = game.getComponent(enemy.id, 'localTransform');
		if (!resumedPosition) throw new Error('Expected enemy local transform');
		expect(resumedPosition.x).toBeGreaterThan(0);
	} finally {
		await game.dispose();
		Object.defineProperty(globalThis, 'document', { configurable: true, value: undefined });
	}
});
