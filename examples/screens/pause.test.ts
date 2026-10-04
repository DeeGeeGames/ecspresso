import { expect, test } from 'bun:test';
import ECSpresso from 'ecspresso';
import { createTimer, createTimerPlugin } from 'ecspresso/plugins/scripting/timers';

test('screen timer group preserves inactive slots and expiration across repeated overlays', async () => {
	const world = ECSpresso.create()
		.withPlugin(createTimerPlugin<'active' | 'inactive'>())
		.withScreens(screens => screens
			.add('playing', { initialState: () => ({}) })
			.add('paused', { initialState: () => ({}) })
			.add('gameOver', { initialState: () => ({}) }))
		.build();
	world.onScreenEnter('playing', () => world.enableSystemGroup('timers'));
	world.onScreenEnter('paused', () => world.disableSystemGroup('timers'));
	world.onScreenExit('playing', () => world.disableSystemGroup('timers'));
	world.onScreenResume('playing', () => world.enableSystemGroup('timers'));
	await world.initialize();
	await world.setScreen('playing', {});
	let completions = 0;
	const active = createTimer(1, { onComplete: () => { completions += 1; } });
	const inactive = createTimer(5);
	inactive.active = false;
	inactive.elapsed = 0.25;
	world.spawn({ timers: { active, inactive } });
	world.update(0.9);
	for (let cycle = 0; cycle < 3; cycle += 1) {
		await world.pushScreen('paused', {});
		world.update(10);
		expect(active.elapsed).toBe(0.9);
		expect(inactive).toMatchObject({ active: false, elapsed: 0.25 });
		expect(completions).toBe(0);
		await world.popScreen();
	}
	world.update(0.11);
	expect(completions).toBe(1);
	await world.pushScreen('paused', {});
	await world.popScreen();
	world.update(0.1);
	expect(completions).toBe(1);
	expect(active.active).toBe(false);
	await world.setScreen('gameOver', {});
	expect(world.isSystemGroupEnabled('timers')).toBe(false);
	await world.setScreen('playing', {});
	expect(world.isSystemGroupEnabled('timers')).toBe(true);
	await world.dispose();
});
