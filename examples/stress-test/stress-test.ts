import { startECSpresso } from './ecspresso-version';
import { startPhaser } from './phaser-version';

type Engine = 'ecspresso' | 'phaser';

const toolbar = document.createElement('div');
toolbar.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:999999;display:flex;gap:6px;padding:6px;font:13px/1 monospace;background:rgba(20,20,30,0.85);border:1px solid #555;border-radius:6px';

const ecsBtn = document.createElement('button');
const phaserBtn = document.createElement('button');

const baseBtnStyle = 'padding:6px 14px;font:13px/1 monospace;border:1px solid #555;border-radius:4px;cursor:pointer';
ecsBtn.style.cssText = baseBtnStyle;
phaserBtn.style.cssText = baseBtnStyle;
ecsBtn.textContent = 'ECSpresso';
phaserBtn.textContent = 'Phaser';

toolbar.appendChild(ecsBtn);
toolbar.appendChild(phaserBtn);
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
	const started = engine === 'ecspresso' ? await startECSpresso(opts) : startPhaser(opts);
	if (gen !== generation) {
		started();
		return;
	}
	teardown = started;
}

ecsBtn.addEventListener('click', () => { switchTo('ecspresso'); });
phaserBtn.addEventListener('click', () => { switchTo('phaser'); });

await switchTo('ecspresso');
