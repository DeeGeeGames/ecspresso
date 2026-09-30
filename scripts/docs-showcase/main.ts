import { initializeTheme } from './theme';
import { createRunner, loadRuntime, fetchText, reportError, type GameState } from './runner';
import { button, element } from './protocol';

initializeTheme();
button('copy-install').addEventListener('click', function () {
	void navigator.clipboard.writeText('npm install ecspresso').then(function () {
		button('copy-install').textContent = 'Copied';
		setTimeout(() => { button('copy-install').textContent = 'Copy'; }, 1800);
	}).catch(() => { button('copy-install').textContent = 'Select command to copy'; });
});
const canvas = element('game-canvas');
if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Missing game canvas.');
const context = canvas.getContext('2d');
if (!context) throw new Error('Canvas is unavailable.');
const cup = new Image();
cup.src = new URL('../brand/ecspresso-icon-light-transparent.svg', import.meta.url).href;
const renderState: { latest?: GameState } = {};
function draw(snapshot: GameState) {
	renderState.latest = snapshot;
	const ctx = context;
	if (!ctx) return;
	ctx.fillStyle = '#fff6ea'; ctx.fillRect(0, 0, 640, 360);
	ctx.strokeStyle = '#ecdcc8'; ctx.lineWidth = 1;
	Array.from({ length: 16 }, (_, i) => i * 40).forEach(function (x) {
		Array.from({ length: 9 }, (_, i) => i * 40).forEach(function (y) {
			ctx.beginPath(); ctx.arc(x + 20, y + 20, 1, 0, Math.PI * 2); ctx.stroke();
		});
	});
	snapshot.coins.forEach(function (coin) {
		ctx.save(); ctx.translate(coin.x, coin.y); ctx.rotate(-0.45);
		ctx.fillStyle = '#9d683d'; ctx.beginPath(); ctx.ellipse(0, 0, 8, 11, 0, 0, Math.PI * 2); ctx.fill();
		ctx.strokeStyle = '#fff6ea'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -7); ctx.bezierCurveTo(-4, -1, 4, 1, 0, 7); ctx.stroke(); ctx.restore();
	});
	snapshot.hazards.forEach(function (hazard) {
		ctx.fillStyle = '#b85b3d'; ctx.beginPath(); ctx.arc(hazard.x, hazard.y, 12, 0, Math.PI * 2); ctx.fill();
		ctx.strokeStyle = '#f3dcc1'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(hazard.x, hazard.y, 5, 0, Math.PI * 2); ctx.stroke();
	});
	ctx.globalAlpha = snapshot.immunity > 0 ? 0.55 : 1;
	ctx.fillStyle = '#f3dcc1'; ctx.beginPath(); ctx.arc(snapshot.player.x, snapshot.player.y, 21, 0, Math.PI * 2); ctx.fill();
	if (cup.complete && cup.naturalWidth) ctx.drawImage(cup, snapshot.player.x - 20, snapshot.player.y - 20, 40, 40);
	ctx.globalAlpha = 1;
	element('score').textContent = `${snapshot.score} / 8`;
	element('lives').textContent = `${Math.max(0, Math.ceil(snapshot.health))} lives`;
	if (snapshot.phase === 'playing') return;
	ctx.fillStyle = '#fff6eae8'; ctx.fillRect(0, 0, 640, 360);
	ctx.fillStyle = '#3c2516'; ctx.textAlign = 'center'; ctx.font = '32px Georgia';
	ctx.fillText(snapshot.phase === 'won' ? 'A full cup. Well played.' : 'A little too hot.', 320, 168);
	ctx.font = '16px system-ui'; ctx.fillText('Press Play again for a fresh round.', 320, 202);
	element('game-status').textContent = snapshot.phase === 'won' ? 'All 8 beans collected. You win!' : 'Out of lives. Play again or adjust the code.';
}
const initial: GameState = {
	player: { x: 320, y: 180 }, coins: [{ x: 90, y: 70 }, { x: 210, y: 60 }, { x: 420, y: 65 }, { x: 550, y: 80 },
		{ x: 80, y: 285 }, { x: 220, y: 300 }, { x: 430, y: 290 }, { x: 555, y: 280 }],
	hazards: [{ x: 170, y: 175 }, { x: 470, y: 180 }, { x: 320, y: 85 }], health: 3, score: 0, phase: 'playing', immunity: 0,
};
draw(initial);
cup.addEventListener('load', () => draw(renderState.latest ?? initial));
window.addEventListener('showcase-theme', () => draw(renderState.latest ?? initial));
const runner = createRunner(draw);
const state: { assets?: Awaited<ReturnType<typeof loadRuntime>>; loading?: Promise<void>;
	editor?: { run(): Promise<void>; reset(): void; select(task: string): void }; selected: string; running: boolean } = {
	selected: 'movement', running: false,
};
async function assets() { state.assets ??= await loadRuntime(); return state.assets; }
async function play() {
	if (state.running) return;
	state.running = true;
	button('play-game').disabled = true;
	try {
		if (state.editor) { await state.editor.run(); return; }
		const [loaded, source] = await Promise.all([assets(), fetchText('./game.js')]);
		await runner.run(source, loaded.runtime, loaded.workerSource, loaded.sandbox);
	} catch (error) { reportError(error); }
	finally { state.running = false; button('play-game').disabled = false; }
}
button('play-game').addEventListener('click', function () { void play(); canvas.focus(); });
button('stop-game').addEventListener('click', () => { void runner.stop(); });
const keys = new Set<string>();
const directions: Record<string, readonly [number, number]> = {
	ArrowLeft: [-1, 0], a: [-1, 0], left: [-1, 0], ArrowRight: [1, 0], d: [1, 0], right: [1, 0],
	ArrowUp: [0, -1], w: [0, -1], up: [0, -1], ArrowDown: [0, 1], s: [0, 1], down: [0, 1],
};
function input() {
	const vector = Array.from(keys).reduce<readonly [number, number]>(function (sum, key) {
		const direction = directions[key];
		return direction ? [sum[0] + direction[0], sum[1] + direction[1]] : sum;
	}, [0, 0]);
	const length = Math.hypot(vector[0], vector[1]) || 1;
	runner.send({ kind: 'input', x: vector[0] / length, y: vector[1] / length });
}
function clearInput() { keys.clear(); input(); }
canvas.addEventListener('keydown', function (event) {
	if (!directions[event.key]) return;
	event.preventDefault(); keys.add(event.key); input();
});
canvas.addEventListener('keyup', function (event) {
	if (!directions[event.key]) return;
	event.preventDefault(); keys.delete(event.key); input();
});
canvas.addEventListener('blur', clearInput);
window.addEventListener('blur', clearInput);
document.addEventListener('visibilitychange', clearInput);
Array.from(document.querySelectorAll('button[data-direction]')).forEach(function (node) {
	if (!(node instanceof HTMLButtonElement)) return;
	const direction = node.dataset['direction'];
	if (!direction) return;
	node.addEventListener('pointerdown', function (event) {
		node.setPointerCapture(event.pointerId); keys.add(direction); input();
	});
	['pointerup', 'pointercancel', 'lostpointercapture'].forEach(name => node.addEventListener(name, function () { keys.delete(direction); input(); }));
	node.addEventListener('keydown', function (event) { if (event.key !== ' ' && event.key !== 'Enter') return; event.preventDefault(); keys.add(direction); input(); });
	node.addEventListener('keyup', clearInput);
	node.addEventListener('blur', clearInput);
});
async function loadEditor() {
	if (state.editor) return;
	if (state.loading) return state.loading;
	state.loading = (async function () {
		button('load-editor').disabled = true;
		button('load-editor').textContent = 'Loading TypeScript editor…';
		try {
			const [module, loaded] = await Promise.all([import('./editor'), assets()]);
			state.editor = await module.createEditor(runner, loaded);
			if (state.selected !== 'movement') state.editor.select(state.selected);
			element('editor-placeholder').hidden = true;
			element('editor-workspace').hidden = false;
			window.dispatchEvent(new Event('resize'));
		} catch (error) {
			reportError(error); button('load-editor').textContent = 'Retry loading editor'; button('load-editor').disabled = false;
			state.loading = undefined;
		}
	})();
	return state.loading;
}
button('load-editor').addEventListener('click', () => { void loadEditor(); });
void loadEditor();
Array.from(document.querySelectorAll('button[data-task]')).forEach(function (node) {
	if (!(node instanceof HTMLButtonElement)) return;
	node.addEventListener('click', function () {
		const task = node.dataset['task'];
		if (!task) return;
		state.selected = task;
		document.querySelectorAll('button[data-task]').forEach(button => button.setAttribute('aria-pressed', String(button === node)));
		state.editor?.select(task);
		const copy: Record<string, string> = {
			movement: 'Change speed: 160 to 240. Run, focus the game, and feel the difference. Explore suggestions inside the query and hover over position.',
			health: 'Health is optional in the movement query. Inspect its type, then add health to with to make it required. Use without to exclude it explicitly.',
			mutation: 'Position is writable; velocity has shallow readonly fields. Try velocity.x = 20, then add velocity to mutates to permit the write.',
		};
		element('task-description').textContent = copy[task] ?? '';
	});
});
// A small public inspection surface makes acceptance checks reproducible.
Object.assign(globalThis, { ecspressoShowcase: { runner, play, loadEditor, state, getGame: () => renderState.latest } });
