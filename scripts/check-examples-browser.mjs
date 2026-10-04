import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const base = process.env.EXAMPLE_BASE_URL ?? 'http://localhost:3000';
const output = process.env.EXAMPLE_EVIDENCE_DIR ?? '/tmp/ecspresso-example-evidence';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXAMPLE_BROWSER_PATH, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.addInitScript(() => {
	document.addEventListener('DOMContentLoaded', () => {
		const style = document.createElement('style');
		style.id = 'example-host-style-sentinel';
		style.textContent = ':root { --example-host-style-sentinel: preserved; }';
		document.head.prepend(style);
	}, { once: true });
	const pending = new Set();
	const requestFrame = window.requestAnimationFrame.bind(window);
	const cancelFrame = window.cancelAnimationFrame.bind(window);
	window.requestAnimationFrame = callback => {
		const id = requestFrame(time => { pending.delete(id); callback(time); });
		pending.add(id);
		return id;
	};
	window.cancelAnimationFrame = id => { pending.delete(id); cancelFrame(id); };
	window.examplePendingFrames = pending;
});
const errors = [];
const observations = [];
page.on('pageerror', error => errors.push({ url: page.url(), message: error.message }));

async function visit(route, canvas = true) {
	await page.goto(`${base}${route ? `/${route}/` : '/'}`);
	if (canvas) await page.locator('canvas').waitFor();
	await page.waitForTimeout(500);
}
async function capture(name) {
	await page.screenshot({ path: join(output, `${name}.png`) });
}
async function canvasClick(x, y, width = 800, height = 600) {
	const box = await page.locator('canvas').boundingBox();
	assert.ok(box);
	await page.mouse.click(box.x + x * box.width / width, box.y + y * box.height / height);
}

try {
	const probeBuild = await Bun.build({ entrypoints: [join(import.meta.dirname, '../browser-tests/example-coordinate-probe.ts')], target: 'browser' });
	assert.ok(probeBuild.success, 'Coordinate probe must bundle');
	const probeBundle = probeBuild.outputs[0];
	assert.ok(probeBundle);
	const probeCode = await probeBundle.text();
	await page.route('**/example-coordinate-probe.js', route => route.fulfill({ body: probeCode, contentType: 'text/javascript' }));
	await visit('', false);
	assert.deepEqual(await page.locator('h2').allTextContents(), ['Introduction', 'Focused features', 'Complete games', 'Diagnostics']);
	assert.equal(await page.locator('section a').count(), 35);
	await capture('gallery');
	observations.push('Gallery contains all 33 existing routes and both new lessons in four groups.');

	await page.getByRole('link', { name: /Mutation and Change Tracking/ }).click();
	await page.getByRole('button', { name: 'Write component', exact: true }).click();
	await page.getByRole('button', { name: 'Process without writing', exact: true }).click();
	assert.equal(await page.locator('#value').textContent(), '1');
	assert.equal(await page.locator('#updates').textContent(), '1');
	await capture('change-tracking');
	observations.push('Write followed by no-op retains value=1 and consumer updates=1.');

	await visit('behavior-tree-basics');
	assert.equal(await page.locator('#behavior').textContent(), 'patrol');
	await page.getByRole('checkbox', { name: 'Threat nearby' }).check();
	await page.waitForFunction(() => document.querySelector('#behavior')?.textContent === 'flee');
	await capture('behavior-tree-basics');
	await page.getByRole('checkbox', { name: 'Threat nearby' }).uncheck();
	await page.waitForFunction(() => document.querySelector('#behavior')?.textContent === 'patrol');
	await page.getByRole('link', { name: /Advanced villager/ }).click();
	await page.locator('canvas').waitFor();
	await page.waitForTimeout(1800);
	await capture('behavior-tree-advanced');
	observations.push('Basics switches patrol → flee → patrol and navigates to the advanced simulation.');

	await visit('screens');
	await capture('screens-menu');
	await page.keyboard.press('Space');
	await page.waitForTimeout(700);
	await page.keyboard.press('p');
	await page.waitForTimeout(250);
	const paused = await page.locator('canvas').screenshot();
	await page.waitForTimeout(1200);
	assert.ok(paused.equals(await page.locator('canvas').screenshot()), 'Paused scene must remain unchanged');
	await capture('screens-paused');
	await page.keyboard.press('p');
	await page.waitForTimeout(700);
	assert.ok(!paused.equals(await page.locator('canvas').screenshot()), 'Resume must change the scene');
	await page.keyboard.press('p');
	await page.waitForTimeout(150);
	await page.keyboard.press('p');
	await page.waitForTimeout(21000);
	await capture('screens-game-over');
	await page.keyboard.press('Space');
	await page.waitForTimeout(500);
	await capture('screens-restart');
	observations.push('Screens menu/start, stable paused canvas, resume, repeated overlay, game-over and restart journey exercised.');

	await visit('sprite-animation');
	for (let cycle = 0; cycle < 5; cycle += 1) {
		await canvasClick(140, 225, 900, 600);
		await canvasClick(620, 410, 900, 600);
	}
	await capture('sprite-animation');
	observations.push('Sprite named-animation and pause areas clicked five times each without page errors.');

	await visit('tilemap');
	const before = await page.locator('#coords').textContent();
	await page.keyboard.down('ArrowRight');
	await page.waitForTimeout(700);
	await page.keyboard.up('ArrowRight');
	const after = await page.locator('#coords').textContent();
	assert.notEqual(after, before, 'Tilemap player coordinates must change');
	await page.keyboard.down('ArrowUp');
	await page.waitForTimeout(2200);
	await page.keyboard.up('ArrowUp');
	await capture('tilemap');
	observations.push({ tilemapMovement: { before, after }, note: 'Movement and sustained motion against map geometry exercised.' });

	await visit('isometric');
	await canvasClick(400, 300);
	await page.waitForTimeout(600);
	await capture('isometric');
	const coordinateProbe = await page.evaluate(async () => {
		const probe = await import('/example-coordinate-probe.js');
		return probe.runCoordinateProbe();
	});
	assert.deepEqual(coordinateProbe, { center: { x: 5, y: 5 }, zoomed: { x: 6, y: 5 }, resizedCenter: { x: 5, y: 5 } });
	observations.push({ isometricCoordinateProbe: coordinateProbe, note: 'Real initialized renderer/camera helper tested at canvas offset, half-size CSS scale, zoom=2 and resized CSS dimensions.' });

	await visit('turret-shooter');
	await page.waitForTimeout(2800);
	assert.ok(await page.locator('#radar-overlay').isVisible());
	assert.equal(await page.locator('#example-host-style-sentinel').count(), 1, 'Turret startup must preserve the existing host style');
	assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--example-host-style-sentinel').trim()), 'preserved');
	assert.equal(await page.locator('#radar-sweep').evaluate(element => getComputedStyle(element).animationPlayState), 'running');
	const stylesBefore = await page.locator('style').count();
	await page.keyboard.press('p');
	assert.equal(await page.locator('#radar-sweep').evaluate(element => getComputedStyle(element).animationPlayState), 'paused');
	await capture('turret-paused');
	await page.keyboard.press('p');
	await page.waitForTimeout(250);
	assert.equal(await page.locator('#radar-sweep').evaluate(element => getComputedStyle(element).animationPlayState), 'running');
	assert.equal(await page.locator('style').count(), stylesBefore);
	await page.keyboard.press('Space');
	await page.waitForTimeout(300);
	await capture('turret-playing');
	observations.push('Turret radar starts, pauses and resumes; a pre-startup host stylesheet sentinel survives startup and stylesheet count is preserved through pause/resume; keyboard firing exercised. Pointer-lock request is headless evidence only.');

	await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
	await page.waitForFunction(() => !document.querySelector('canvas'));
	await page.waitForTimeout(200);
	assert.equal(await page.evaluate(() => window.examplePendingFrames.size), 0);
	assert.ok(!await page.locator('#radar-overlay').isVisible());
	assert.equal(await page.locator('#radar-sweep').evaluate(element => getComputedStyle(element).animationPlayState), 'paused');
	await page.evaluate(() => {
		document.dispatchEvent(new Event('pointerlockchange'));
		window.dispatchEvent(new MouseEvent('mousemove'));
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p' }));
	});
	await visit('turret-shooter');
	await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
	await page.waitForFunction(() => !document.querySelector('canvas'));
	await page.waitForTimeout(3000);
	assert.equal(await page.evaluate(() => window.examplePendingFrames.size), 0);
	assert.ok(!await page.locator('#radar-overlay').isVisible());
	observations.push('Disposal during playing and startup removes canvas, leaves zero pending animation frames, hides/pauses radar, and tolerates later synthetic input events without uncaught page errors.');

	assert.deepEqual(errors, [], 'Examples must load and run without uncaught page errors');
	console.log(JSON.stringify({ base, output, observations, errors }, null, 2));
} finally {
	await writeFile(join(output, 'observations.json'), JSON.stringify({ base, observations, errors }, null, 2));
	await browser.close();
}
