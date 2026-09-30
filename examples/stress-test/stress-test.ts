import { startECSpresso } from './ecspresso-version';
import { startPhaser } from './phaser-version';
import { startBevy } from './bevy-version';
import { createEngineSwitcher } from './engine-switcher';

type Engine = 'ecspresso' | 'phaser' | 'bevy';
const engines = ['ecspresso', 'phaser', 'bevy'] as const;
const labels = { ecspresso: 'ECSpresso', phaser: 'Phaser', bevy: 'Bevy' };
const starters = { ecspresso: startECSpresso, phaser: startPhaser, bevy: startBevy };
const state = { entityCount: 50 };

const toolbar = document.createElement('div');
toolbar.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:999999;display:flex;gap:6px;padding:6px;font:13px/1 monospace;background:rgba(20,20,30,0.85);border:1px solid #555;border-radius:6px';
const buttons = new Map(engines.map(function createButton(engine) {
	const button = document.createElement('button');
	button.textContent = labels[engine];
	button.style.cssText = 'padding:6px 14px;font:13px/1 monospace;border:1px solid #555;border-radius:4px;cursor:pointer';
	button.disabled = engine === 'bevy';
	button.addEventListener('click', () => {
		status.hidden = true;
		void switcher.switchTo(engine);
	});
	toolbar.appendChild(button);
	return [engine, button] as const;
}));
document.body.appendChild(toolbar);

const status = document.createElement('div');
status.setAttribute('role', 'status');
status.style.cssText = 'position:fixed;top:60px;left:50%;transform:translateX(-50%);z-index:999999;color:#fff;background:#2a2a3e;padding:6px;font:13px monospace';
status.hidden = true;
document.body.appendChild(status);

const switcher = createEngineSwitcher<Engine>({
	async start(engine) {
		return starters[engine]({
			initialCount: state.entityCount,
			onCountChange(count) { state.entityCount = count; },
		});
	},
	onActive(engine) {
		buttons.forEach((button, candidate) => {
			const active = candidate === engine;
			button.style.background = active ? '#0f0' : '#2a2a3e';
			button.style.color = active ? '#000' : '#fff';
			button.style.fontWeight = active ? 'bold' : 'normal';
			button.setAttribute('aria-pressed', String(active));
		});
	},
	onError(error) {
		status.textContent = `Unable to switch engine: ${error instanceof Error ? error.message : String(error)}`;
		status.hidden = false;
	},
});

await switcher.switchTo('ecspresso');

async function artifactExists(file: string): Promise<boolean> {
	const url = new URL(`./bevy/pkg/${file}`, document.baseURI);
	return fetch(url, { method: 'HEAD' }).then(response => response.ok).catch(() => false);
}
const bevyAvailable = (await Promise.all(['bevy_stress_test.js', 'bevy_stress_test_bg.wasm'].map(artifactExists))).every(Boolean);
const bevyButton = buttons.get('bevy');
if (!bevyButton) throw new Error('Bevy button is missing');
bevyButton.disabled = !bevyAvailable;
bevyButton.title = bevyAvailable ? '' : 'Bevy is not built. See examples/stress-test/README.md for setup.';
