import { startECSpresso } from '../examples/stress-test/ecspresso-version';
import { startPhaser } from '../examples/stress-test/phaser-version';
import { startBevy } from '../examples/stress-test/bevy-version';
import { createEngineSwitcher } from '../examples/stress-test/engine-switcher';

function assert(condition: boolean, message: string): void {
	if (!condition) throw new Error(message);
}

function wait(milliseconds: number): Promise<void> {
	return new Promise(resolve => window.setTimeout(resolve, milliseconds));
}

try {
	const starters = { ecspresso: startECSpresso, phaser: startPhaser, bevy: startBevy };
	const errors: unknown[] = [];
	const switcher = createEngineSwitcher<keyof typeof starters>({
		async start(engine) { return starters[engine]({ initialCount: 50, onCountChange() {} }); },
		onActive() {},
		onError(error) { errors.push(error); },
	});
	await switcher.switchTo('ecspresso');
	await Promise.all([switcher.switchTo('phaser'), switcher.switchTo('bevy')]);
	const frame = document.querySelector('iframe');
	if (!frame?.contentWindow) throw new Error('Bevy iframe is missing');
	const clock = { ticks: 0 };
	frame.contentWindow.setInterval(() => { clock.ticks++; }, 10);
	await wait(50);
	assert(clock.ticks > 0, 'Bevy iframe timer did not start');
	await Promise.all([switcher.switchTo('phaser'), switcher.switchTo('ecspresso')]);
	const stoppedAt = clock.ticks;
	await wait(50);
	assert(clock.ticks === stoppedAt, 'Inactive Bevy iframe retained timers');
	assert(!frame.isConnected && document.querySelector('iframe') === null, 'Inactive Bevy iframe survived');
	assert(document.querySelectorAll('canvas').length === 1, 'Engine switching retained duplicate canvases');
	assert(errors.length === 0, `Engine switching failed: ${errors.map(String).join(', ')}`);
	document.body.dataset['status'] = 'passed';
} catch (error) {
	document.body.dataset['status'] = 'failed';
	const result = document.createElement('pre');
	result.textContent = String(error);
	document.body.appendChild(result);
	throw error;
}
