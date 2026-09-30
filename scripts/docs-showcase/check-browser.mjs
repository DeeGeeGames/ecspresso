import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { compare } from './compiler.ts';
import { typeCases, typeProbes } from './type-cases.ts';

const base = process.env['DOCS_URL'] ?? 'http://127.0.0.1:3220/ecspresso/';
const evidence = resolve('docs-showcase-evidence.local');
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env['DOCS_CHROME'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
const requests = [];
const results = [];
page.on('pageerror', error => errors.push(error.message));
page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
page.on('request', request => requests.push(request.url()));
async function check(name, action) {
	await action(); results.push({ name, result: 'pass' }); console.log(`PASS ${name}`);
}
async function running() {
	await page.waitForFunction(() => globalThis.ecspressoShowcase.runner.snapshot().phase === 'running' && globalThis.ecspressoShowcase.runner.snapshot().updates > 1);
}
async function restart() {
	await page.evaluate(() => ecspressoShowcase.play()); await running();
}
async function movement() {
	await page.locator('#game-canvas').focus();
	const before = await page.evaluate(() => ecspressoShowcase.getGame());
	await page.keyboard.down('ArrowRight'); await page.waitForTimeout(250); await page.keyboard.up('ArrowRight');
	const after = await page.evaluate(() => ecspressoShowcase.getGame());
	return (after.player.x - before.player.x) / (after.time - before.time);
}
try {
	const response = await page.goto(base);
	assert.equal(response?.status(), 200);
	assert.equal(await page.title(), 'ECSpresso — Strong types. Small ingredients.');
	await check('Homepage automatically loads an editable Monaco without taking focus', async () => {
		await page.waitForFunction(() => !!globalThis.ecspressoEditor && !document.querySelector('#editor-workspace').hidden);
		assert.equal(await page.evaluate(() => ecspressoEditor.editor.hasTextFocus()), false);
		assert.equal(await page.evaluate(() => scrollY), 0);
		assert.equal((await page.locator('#hero-heading').textContent()).replace(/\s+/g, ' ').trim(), 'Strong types. Small ingredients.');
		assert.equal(await page.locator('.hero-brand p').count(), 0);
		assert.ok(requests.some(url => /ts\.worker/.test(url)));
		const original = await page.evaluate(() => ecspressoEditor.model.getValue());
		await page.evaluate(() => { ecspressoEditor.editor.focus(); ecspressoEditor.editor.setPosition({ lineNumber: 1, column: 1 }); });
		await page.keyboard.type('// Editable on load\n');
		assert.ok(await page.evaluate(() => ecspressoEditor.model.getValue().startsWith('// Editable on load')));
		await page.evaluate(source => ecspressoEditor.model.setValue(source), original);
		await page.locator('#hero-heading').click();
		await page.evaluate(() => window.scrollTo(0, 0));
		await page.screenshot({ path: resolve(evidence, 'desktop-light.png'), fullPage: true });
	});
	await check('Desktop demo and main controls fit above the fold', async () => {
		const sizes = [{ width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }];
		for (const size of sizes) {
			await page.setViewportSize(size);
			await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
			assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
			for (const selector of ['#game-canvas', '#play-game', '#run-code']) {
				const bounds = await page.locator(selector).boundingBox();
				assert.ok(bounds, selector);
				assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= size.height, `${selector} below fold at ${size.width}×${size.height}`);
			}
			await page.screenshot({ path: resolve(evidence, `compact-${size.width}.png`) });
		}
		await page.setViewportSize({ width: 1440, height: 1000 });
	});
	await check('Twelve worker/compiler type-parity cases', async () => {
		const fixture = await Bun.file(new URL('./type-fixture.txt', import.meta.url)).text();
		const original = await page.evaluate(() => ecspressoEditor.model.getValue());
		const results = [];
		for (const variant of typeCases(fixture)) {
			const probes = typeProbes(variant.source);
			const compiler = compare(variant.source, probes.map(probe => probe.offset));
			const browserResult = await page.evaluate(async ({ source, probes }) => {
				const { model, worker } = ecspressoEditor;
				const previous = model.getVersionId();
				model.setValue(source);
				const file = model.uri.toString();
				const diagnostics = [...await worker.getSyntacticDiagnostics(file), ...await worker.getSemanticDiagnostics(file)];
				const options = await worker.getCompilerOptionsDiagnostics(file);
				const inspected = await Promise.all(probes.map(async probe => {
					const completion = await worker.getCompletionsAtPosition(file, probe.offset);
					const hover = await worker.getQuickInfoAtPosition(file, probe.offset);
					return { offset: probe.offset, completions: completion?.entries.map(entry => entry.name) ?? [], hover: hover?.displayParts?.map(part => part.text).join('') ?? '' };
				}));
				return { diagnostics, options, probes: inspected, updated: model.getVersionId() > previous };
			}, { source: variant.source, probes });
			function message(value) {
				return typeof value === 'string' ? value : [value.messageText, ...(value.next ?? []).map(message)].join('\n');
			}
			function diagnostics(entries, key) {
				return entries.map(entry => ({ code: entry.code, start: entry.start, length: entry.length, message: message(entry[key]) }))
					.sort((a, b) => a.start - b.start || a.code - b.code);
			}
			assert.deepEqual(browserResult.options, []);
			assert.equal(browserResult.updated, true);
			assert.deepEqual(diagnostics(browserResult.diagnostics, 'messageText'), diagnostics(compiler.diagnostics, 'message'), variant.name);
			browserResult.probes.forEach((probe, index) => {
				const expected = compiler.probes[index];
				assert.ok(expected);
				assert.deepEqual([...probe.completions].sort(), [...expected.completions].sort(), `${variant.name}/${probes[index].name} completions`);
				assert.equal(probe.hover, expected.hover, `${variant.name}/${probes[index].name} hover`);
			});
			results.push({ name: variant.name, compilerVersion: compiler.version, browser: browserResult, compiler });
		}
		await page.evaluate(source => ecspressoEditor.model.setValue(source), original);
		await writeFile(resolve(evidence, 'type-parity.json'), JSON.stringify(results, null, 2));
	});
	await check('Real game and keyboard movement', async () => {
		await page.getByRole('button', { name: /Play \/ restart/ }).click(); await running();
		assert.ok(Math.abs(await movement() - 160) < 25);
	});
	await check('Automatic editor, strict compilation, real component suggestions', async () => {
		await page.waitForFunction(() => !!globalThis.ecspressoEditor);
		const inspected = await page.evaluate(async () => {
			const { model, worker } = ecspressoEditor;
			const source = model.getValue();
			const completion = await worker.getCompletionsAtPosition(model.uri.toString(), source.indexOf("with: ['") + "with: ['".length);
			return { diagnostics: await worker.getSemanticDiagnostics(model.uri.toString()), completions: completion.entries.map(entry => entry.name) };
		});
		assert.equal(inspected.diagnostics.length, 0, JSON.stringify(inspected.diagnostics));
		['position', 'velocity', 'health'].forEach(name => assert.ok(inspected.completions.includes(name)));
		await page.getByRole('button', { name: 'Suggestions', exact: true }).click();
		await page.waitForSelector('.suggest-widget.visible');
		await page.screenshot({ path: resolve(evidence, 'autocomplete.png'), fullPage: true });
		await page.keyboard.press('Escape');
	});
	const source = await page.evaluate(() => ecspressoEditor.model.getValue());
	await check('Edit, compile, and run changes actual movement', async () => {
		await page.evaluate(source => ecspressoEditor.model.setValue(source.replace('speed: 160', 'speed: 240')), source);
		const runs = await page.evaluate(() => ecspressoShowcase.runner.snapshot().runs);
		await page.getByRole('button', { name: 'Run changes', exact: true }).click();
		await page.waitForFunction(previous => ecspressoShowcase.runner.snapshot().runs > previous, runs); await running();
		assert.ok(Math.abs(await movement() - 240) < 30);
	});
	await check('Compile errors preserve the last running game', async () => {
		const runs = await page.evaluate(() => ecspressoShowcase.runner.snapshot().runs);
		await page.evaluate(source => ecspressoEditor.model.setValue(source.replace('speed: 160', "speed: 'fast'")), source);
		await page.getByRole('button', { name: 'Run changes', exact: true }).click();
		await page.waitForFunction(() => document.querySelector('#editor-status').textContent.includes('Fix the errors'));
		assert.equal(await page.evaluate(() => ecspressoShowcase.runner.snapshot().runs), runs);
		assert.equal(await page.evaluate(() => ecspressoShowcase.runner.snapshot().phase), 'running');
		await page.screenshot({ path: resolve(evidence, 'compile-error.png'), fullPage: true });
	});
	await check('Readonly diagnostics and optional-component inference', async () => {
		await page.getByRole('button', { name: /Declare your writes/ }).click();
		const readonly = await page.evaluate(async () => {
			const { model, worker } = ecspressoEditor;
			model.setValue(model.getValue().replace('// entity.components.velocity.x = 20;', 'entity.components.velocity.x = 20;'));
			return worker.getSemanticDiagnostics(model.uri.toString());
		});
		assert.ok(readonly.some(problem => problem.code === 2540));
		await page.getByRole('button', { name: /Choose your components/ }).click();
		await page.getByRole('button', { name: 'Inspect type', exact: true }).click();
		await page.waitForFunction(() => document.querySelector('#type-explanation').textContent.includes('undefined'));
	});
	await check('Collection, win, and loss use real ECS state', async () => {
		const won = source.replace(/coins: \[[\s\S]*?\],\n\t\t\thazards/, `coins: [${Array.from({ length: 8 }, () => '{ x: 320, y: 180 }').join(', ')}],\n\t\t\thazards`);
		await page.evaluate(code => ecspressoEditor.model.setValue(code), won);
		await restart();
		await page.waitForFunction(() => ecspressoShowcase.getGame().phase === 'won');
		assert.equal(await page.evaluate(() => ecspressoShowcase.getGame().score), 8);
		await page.evaluate(code => ecspressoEditor.model.setValue(code.replace('health: { value: 3 }', 'health: { value: 0 }')), source);
		await restart();
		await page.waitForFunction(() => ecspressoShowcase.getGame().phase === 'lost');
		await page.evaluate(code => ecspressoEditor.model.setValue(code), source);
		await restart();
	});

	await check('Thrown runtime error and corrected-code recovery', async () => {
		await page.evaluate(source => ecspressoEditor.model.setValue(source.replace('if (resources.game.phase', "throw new Error('runtime-check');\n\t\t\tif (resources.game.phase")), source);
		await page.getByRole('button', { name: 'Run changes', exact: true }).click();
		await page.waitForFunction(() => document.querySelector('#game-status').textContent.includes('runtime-check'));
		await page.evaluate(source => ecspressoEditor.model.setValue(source), source);
		await restart();
	});
	await check('Infinite loop terminates while editor remains responsive', async () => {
		await page.evaluate(source => ecspressoEditor.model.setValue(source.replace('if (resources.game.phase', 'while (true) {}\n\t\t\tif (resources.game.phase')), source);
		await page.getByRole('button', { name: 'Run changes', exact: true }).click();
		await page.waitForFunction(() => document.querySelector('#game-status').textContent.includes('terminated'), { timeout: 12000 });
		await page.getByRole('button', { name: 'Dark mode', exact: true }).click();
		assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
		await page.evaluate(source => ecspressoEditor.model.setValue(source), source);
		await restart();
		await page.screenshot({ path: resolve(evidence, 'desktop-dark.png'), fullPage: true });
	});
	await check('Repeated restart disposes registered worlds', async () => {
		await restart(); await restart(); await restart();
		const snapshot = await page.evaluate(() => ecspressoShowcase.runner.snapshot());
		assert.ok(snapshot.audits.length >= 3);
		assert.ok(snapshot.audits.every(audit => audit.worlds === 1 && audit.errors.length === 0));
		assert.equal(await page.locator('#simulation-host iframe').count(), 1);
	});
	await check('Phone layout and pointer controls', async () => {
		await page.setViewportSize({ width: 390, height: 844 });
		assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
		await restart();
		const before = await page.evaluate(() => ecspressoShowcase.getGame().player.x);
		await page.getByRole('button', { name: 'Move right', exact: true }).dispatchEvent('pointerdown', { pointerId: 1 });
		await page.waitForTimeout(250);
		await page.getByRole('button', { name: 'Move right', exact: true }).dispatchEvent('pointerup', { pointerId: 1 });
		assert.ok(await page.evaluate(() => ecspressoShowcase.getGame().player.x) > before + 20);
		await page.screenshot({ path: resolve(evidence, 'phone-dark.png'), fullPage: true });
		await page.getByRole('button', { name: 'Light mode', exact: true }).click();
		await page.screenshot({ path: resolve(evidence, 'phone-light.png'), fullPage: true });
	});
	await check('Native Chrome touch input in a fresh phone context', async () => {
		const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
		phone.on('pageerror', error => errors.push(error.message));
		await phone.goto(base);
		await phone.getByRole('button', { name: /Play \/ restart/ }).click();
		await phone.waitForFunction(() => ecspressoShowcase.runner.snapshot().updates > 1);
		const control = await phone.getByRole('button', { name: 'Move right', exact: true }).boundingBox();
		assert.ok(control);
		const before = await phone.evaluate(() => ecspressoShowcase.getGame().player.x);
		const session = await phone.context().newCDPSession(phone);
		await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: control.x + control.width / 2, y: control.y + control.height / 2 }] });
		await phone.waitForTimeout(250);
		await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
		assert.ok(await phone.evaluate(() => ecspressoShowcase.getGame().player.x) > before + 20);
		assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
		await phone.waitForFunction(() => !!globalThis.ecspressoEditor);
		await phone.evaluate(() => { ecspressoEditor.editor.focus(); ecspressoEditor.editor.setPosition({ lineNumber: 1, column: 1 }); });
		await phone.keyboard.type('// Phone input check\n');
		assert.ok(await phone.evaluate(() => ecspressoEditor.model.getValue().startsWith('// Phone input check')));
		await phone.screenshot({ path: resolve(evidence, 'phone-touch-editor.png'), fullPage: true });
		await phone.close();
	});

	await check('HTTP outside localhost explains the HTTPS requirement', async () => {
		const context = await browser.newContext();
		await context.route('http://ecspresso.invalid/**', async route => {
			const target = new URL(route.request().url());
			const origin = new URL(base);
			target.protocol = origin.protocol;
			target.host = origin.host;
			await route.fulfill({ response: await route.fetch({ url: target.href }) });
		});
		const insecure = await context.newPage();
		const pageErrors = [];
		insecure.on('pageerror', error => pageErrors.push(error.message));
		const url = new URL(base);
		url.protocol = 'http:';
		url.host = 'ecspresso.invalid';
		url.port = '';
		await insecure.goto(url.href);
		assert.equal(await insecure.evaluate(() => isSecureContext), false);
		await insecure.getByText('HTTPS is required for the editor and game.', { exact: false }).waitFor();
		await insecure.getByRole('button', { name: 'Retry loading editor', exact: true }).waitFor();
		await insecure.getByRole('button', { name: /Play \/ restart/ }).click();
		assert.ok((await insecure.locator('#game-status').textContent()).includes('HTTPS is required'));
		await insecure.getByRole('button', { name: 'Dark mode', exact: true }).click();
		assert.equal(await insecure.evaluate(() => document.documentElement.dataset.theme), 'dark');
		assert.deepEqual(pageErrors, []);
		await insecure.screenshot({ path: resolve(evidence, 'https-required.png'), fullPage: true });
		await context.close();
	});
	await check('All local navigation targets exist', async () => {
		const links = await page.locator('a[href]').evaluateAll(anchors => anchors.map(a => a.href).filter(href => href.startsWith(location.origin) && !href.includes('#')));
		await Promise.all([...new Set(links)].map(async href => { const response = await page.request.get(href); assert.equal(response.status(), 200, href); }));
	});
	await check('Guide branding and return navigation', async () => {
		await page.goto(new URL('./api/documents/getting-started.html', base).href);
		assert.equal(await page.locator('.tsd-page-toolbar .title').getAttribute('href'), base);
		await page.screenshot({ path: resolve(evidence, 'guide.png'), fullPage: true });
	});
	assert.deepEqual(errors, []);
	console.log(`${results.length} Chrome/Chromium checks passed. Browser ${browser.version()}`);
} finally {
	await writeFile(resolve(evidence, 'results.json'), JSON.stringify({ base, browser: browser.version(), results, errors }, null, 2));
	await browser.close();
}
