import ECSpresso from "ecspresso";
import { createInputPlugin } from "ecspresso/plugins/input/input";

const BUTTONS = [
	{ label: 'A',     color: '#4caf50' },
	{ label: 'B',     color: '#f44336' },
	{ label: 'X',     color: '#2196f3' },
	{ label: 'Y',     color: '#ff9800' },
	{ label: 'LB',    color: '#78909c' },
	{ label: 'RB',    color: '#78909c' },
	{ label: 'LT',    color: '#78909c' },
	{ label: 'RT',    color: '#78909c' },
	{ label: 'Sel',   color: '#78909c' },
	{ label: 'Start', color: '#78909c' },
	{ label: 'L3',    color: '#78909c' },
	{ label: 'R3',    color: '#78909c' },
	{ label: '↑',     color: '#78909c' },
	{ label: '↓',     color: '#78909c' },
	{ label: '←',     color: '#78909c' },
	{ label: '→',     color: '#78909c' },
	{ label: '⊙',    color: '#ff9800' },
] as const;

const LT_BUTTON = 6;
const RT_BUTTON = 7;
const STICK_ZONE_PX = 88;
const STICK_DOT_PX = 14;
const STICK_RANGE = (STICK_ZONE_PX - STICK_DOT_PX) / 2;

interface PadUI {
	statusDot: HTMLSpanElement;
	idText: HTMLSpanElement;
	buttons: HTMLDivElement[];
	ltFill: HTMLDivElement;
	rtFill: HTMLDivElement;
	leftDot: HTMLDivElement;
	rightDot: HTMLDivElement;
}

function makeEl<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
	const e = document.createElement(tag);
	if (className) e.className = className;
	return e;
}

function createStickViz(label: string): { root: HTMLDivElement; dot: HTMLDivElement } {
	const root = makeEl('div', 'stick-container');
	const lbl = makeEl('div', 'stick-label');
	lbl.textContent = label;

	const zone = makeEl('div', 'stick-zone');
	const crossH = makeEl('div', 'crosshair crosshair-h');
	const crossV = makeEl('div', 'crosshair crosshair-v');
	const dot = makeEl('div', 'stick-dot');

	zone.append(crossH, crossV, dot);
	root.append(lbl, zone);

	return { root, dot };
}

function createTriggerBar(label: string): { root: HTMLDivElement; fill: HTMLDivElement } {
	const root = makeEl('div', 'trigger-container');
	const lbl = makeEl('span', 'trigger-label');
	lbl.textContent = label;

	const track = makeEl('div', 'trigger-track');
	const fill = makeEl('div', 'trigger-fill');

	track.appendChild(fill);
	root.append(lbl, track);

	return { root, fill };
}

function createPadPanel(app: HTMLElement, index: number): PadUI {
	const panel = makeEl('div', 'pad-panel');

	const header = makeEl('div', 'pad-header');
	const statusDot = makeEl('span', 'status-dot');
	const idText = makeEl('span', 'pad-id');
	idText.textContent = `Gamepad ${index + 1} — Not connected`;
	header.append(statusDot, idText);

	const triggersRow = makeEl('div', 'triggers-row');
	const lt = createTriggerBar('LT');
	const rt = createTriggerBar('RT');
	triggersRow.append(lt.root, rt.root);

	const buttonsGrid = makeEl('div', 'buttons-grid');
	const buttons = BUTTONS.map(({ label }) => {
		const btn = makeEl('div', 'btn-indicator');
		btn.textContent = label;
		buttonsGrid.appendChild(btn);
		return btn;
	});

	const sticksRow = makeEl('div', 'sticks-row');
	const leftStick = createStickViz('Left Stick');
	const rightStick = createStickViz('Right Stick');
	sticksRow.append(leftStick.root, rightStick.root);

	panel.append(header, triggersRow, buttonsGrid, sticksRow);
	app.appendChild(panel);

	return {
		statusDot,
		idText,
		buttons,
		ltFill: lt.fill,
		rtFill: rt.fill,
		leftDot: leftStick.dot,
		rightDot: rightStick.dot,
	};
}

const app = document.getElementById('app');
if (!app) throw new Error('Missing #app element');

const padUIs = Array.from({ length: 4 }, (_, i) => createPadPanel(app, i));

const ecs = ECSpresso.create()
	.withPlugin(createInputPlugin())
	.build();

ecs.addSystem('gamepad-render')
	.inPhase('render')
	.withResources(['inputState'])
	.setProcess(({ resources: { inputState } }) => {
		inputState.gamepads.forEach((gp, i) => {
			const ui = padUIs[i];
			if (!ui) return;

			ui.statusDot.className = `status-dot${gp.connected ? ' connected' : ''}`;
			ui.idText.textContent = gp.connected
				? `Gamepad ${i + 1} — ${gp.id ?? 'Unknown'}`
				: `Gamepad ${i + 1} — Not connected`;

			ui.buttons.forEach((btn, b) => {
				const entry = BUTTONS[b];
				if (!entry) return;
				const pressed = gp.isDown(b);
				btn.style.background = pressed ? entry.color : '';
				btn.style.color = pressed ? '#fff' : '';
				btn.style.borderColor = pressed ? entry.color : '';
			});

			ui.ltFill.style.width = `${gp.buttonValue(LT_BUTTON) * 100}%`;
			ui.rtFill.style.width = `${gp.buttonValue(RT_BUTTON) * 100}%`;

			ui.leftDot.style.transform = `translate(${gp.axis(0) * STICK_RANGE}px, ${gp.axis(1) * STICK_RANGE}px)`;
			ui.rightDot.style.transform = `translate(${gp.axis(2) * STICK_RANGE}px, ${gp.axis(3) * STICK_RANGE}px)`;
		});
	});

await ecs.initialize();

let lastTime = performance.now();

function loop(now: number) {
	ecs.update((now - lastTime) / 1000);
	lastTime = now;
	requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
