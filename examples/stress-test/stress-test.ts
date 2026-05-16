import { startECSpresso } from './ecspresso-version';
import { startPhaser } from './phaser-version';
import { startBevy } from './bevy-version';

type Engine = 'ecspresso' | 'phaser' | 'bevy';

const toolbar = document.createElement('div');
toolbar.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:999999;display:flex;gap:6px;padding:6px;font:13px/1 monospace;background:rgba(20,20,30,0.85);border:1px solid #555;border-radius:6px';

const ecsBtn = document.createElement('button');
const phaserBtn = document.createElement('button');
const bevyBtn = document.createElement('button');

const baseBtnStyle = 'padding:6px 14px;font:13px/1 monospace;border:1px solid #555;border-radius:4px;cursor:pointer';
ecsBtn.style.cssText = baseBtnStyle;
phaserBtn.style.cssText = baseBtnStyle;
bevyBtn.style.cssText = baseBtnStyle;
ecsBtn.textContent = 'ECSpresso';
phaserBtn.textContent = 'Phaser';
bevyBtn.textContent = 'Bevy';

toolbar.appendChild(ecsBtn);
toolbar.appendChild(phaserBtn);
toolbar.appendChild(bevyBtn);
document.body.appendChild(toolbar);

let current: Engine | null = null;
let teardown: (() => void) | null = null;
let generation = 0;
let entityCount = 50;
const onCountChange = (n: number) => { entityCount = n; };

const paintButtons = () => {
	const setActive = (btn: HTMLButtonElement, active: boolean) => {
		btn.style.background = active ? '#0f0' : '#2a2a3e';
		btn.style.color = active ? '#000' : '#fff';
		btn.style.fontWeight = active ? 'bold' : 'normal';
	};
	setActive(ecsBtn, current === 'ecspresso');
	setActive(phaserBtn, current === 'phaser');
	setActive(bevyBtn, current === 'bevy');
};

const starters: Record<Engine, (opts: { initialCount: number; onCountChange: (n: number) => void }) => Promise<() => void> | (() => void)> = {
	ecspresso: startECSpresso,
	phaser: startPhaser,
	bevy: startBevy,
};

async function switchTo(engine: Engine) {
	if (current === engine) return;
	const gen = ++generation;
	if (teardown) {
		teardown();
		teardown = null;
	}
	current = engine;
	paintButtons();
	const opts = { initialCount: entityCount, onCountChange };
	const started = await starters[engine](opts);
	if (gen !== generation) {
		started();
		return;
	}
	teardown = started;
}

ecsBtn.addEventListener('click', () => { switchTo('ecspresso'); });
phaserBtn.addEventListener('click', () => { switchTo('phaser'); });
bevyBtn.addEventListener('click', () => { switchTo('bevy'); });

await switchTo('ecspresso');
