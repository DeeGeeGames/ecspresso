import * as monaco from 'monaco-editor';
import { button, element, record, errorText } from './protocol';
import { fetchText, sha256, type Runner, type loadRuntime } from './runner';

function diagnosticText(value: unknown): string {
	if (typeof value === 'string') return value;
	if (!record(value)) return String(value);
	return [String(value['messageText']), ...(Array.isArray(value['next']) ? value['next'].map(diagnosticText) : [])].join('\n');
}
function displayParts(value: unknown): string {
	if (!record(value) || !Array.isArray(value['displayParts'])) return 'Place the cursor on a component or resource to inspect its type.';
	return value['displayParts'].map(function (part: unknown) {
		return record(part) && typeof part['text'] === 'string' ? part['text'] : '';
	}).join('');
}
export async function createEditor(runner: Runner, assets: Awaited<ReturnType<typeof loadRuntime>>) {
	Object.assign(globalThis, { MonacoEnvironment: {
		getWorker(_moduleId: string, label: string) {
			return new Worker(new URL(label === 'typescript' || label === 'javascript' ? './ts.worker.js' : './editor.worker.js', import.meta.url), { type: 'module' });
		},
	} });
	const stylesheet = document.createElement('link');
	stylesheet.rel = 'stylesheet';
	stylesheet.href = new URL('./main.css', import.meta.url).href;
	document.head.append(stylesheet);
	const [source, declarationsText] = await Promise.all([fetchText('./game.ts'), fetchText('./declarations.json')]);
	const declarations: unknown = JSON.parse(declarationsText);
	if (!record(declarations) || !Array.isArray(declarations['libs']) || declarations['buildId'] !== assets.manifest['buildId']) throw new Error('Editor and game build mismatch. Reload the page.');
	const libs = await Promise.all(declarations['libs'].map(async function (lib: unknown) {
		if (!record(lib) || typeof lib['path'] !== 'string' || typeof lib['content'] !== 'string' || typeof lib['sha256'] !== 'string') throw new Error('Invalid declaration.');
		if (await sha256(lib['content']) !== lib['sha256']) throw new Error('Declaration checksum mismatch. Reload the page.');
		monaco.typescript.typescriptDefaults.addExtraLib(lib['content'], lib['path']);
		return lib['path'];
	}));
	const resolutionKey: string = 'moduleResolution';
	monaco.typescript.typescriptDefaults.setCompilerOptions({
		strict: true, noUncheckedIndexedAccess: true, noUnusedLocals: true, noUnusedParameters: true,
		noPropertyAccessFromIndexSignature: true, noFallthroughCasesInSwitch: true, skipLibCheck: false,
		noEmit: false, target: monaco.typescript.ScriptTarget.ESNext, module: monaco.typescript.ModuleKind.ESNext,
		[resolutionKey]: 100, lib: ['lib.esnext.d.ts', 'lib.dom.d.ts'], types: [],
		paths: { ecspresso: ['file:///node_modules/ecspresso/index.d.ts'] },
	});
	monaco.typescript.typescriptDefaults.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false });
	monaco.typescript.typescriptDefaults.setEagerModelSync(true);
	monaco.editor.defineTheme('coffee-light', { base: 'vs', inherit: true, rules: [], colors: {
		'editor.background': '#FFFAF3', 'editor.foreground': '#3C2516', 'editorLineNumber.foreground': '#947E68',
		'editor.lineHighlightBackground': '#F3DCC140', 'editor.selectionBackground': '#E4C9A7',
	} });
	monaco.editor.defineTheme('coffee-dark', { base: 'vs-dark', inherit: true, rules: [], colors: {
		'editor.background': '#211812', 'editor.foreground': '#F5E6D3', 'editorLineNumber.foreground': '#AD937D',
		'editor.lineHighlightBackground': '#6B4A3330', 'editor.selectionBackground': '#6B4A33',
	} });
	const model = monaco.editor.createModel(source, 'typescript', monaco.Uri.parse('file:///game.ts'));
	const editor = monaco.editor.create(element('editor'), {
		model, theme: document.documentElement.dataset['theme'] === 'dark' ? 'coffee-dark' : 'coffee-light',
		automaticLayout: true, minimap: { enabled: false }, fontSize: 13, lineHeight: 22, padding: { top: 16, bottom: 16 },
		fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', scrollBeyondLastLine: false,
		wordWrap: 'on', quickSuggestions: { strings: true, other: true, comments: false }, tabSize: 4,
		ariaLabel: 'Editable ECSpresso game TypeScript. Press Control Enter to run.',
	});
	window.addEventListener('showcase-theme', function (event) {
		if (!(event instanceof CustomEvent)) return;
		monaco.editor.setTheme(event.detail === 'dark' ? 'coffee-dark' : 'coffee-light');
	});
	async function languageWorker(attempt = 0): ReturnType<typeof monaco.typescript.getTypeScriptWorker> {
		try { return await monaco.typescript.getTypeScriptWorker(); }
		catch (error) {
			if (errorText(error) !== 'TypeScript not registered!' || attempt >= 20) throw error;
			await new Promise<void>(resolve => setTimeout(resolve, 100));
			return languageWorker(attempt + 1);
		}
	}
	async function checkedWorker() {
		try {
			const factory = await languageWorker();
			const worker = await factory(model.uri);
			const errors = (await Promise.all(libs.map(async function (path) {
				return [...await worker.getSyntacticDiagnostics(path), ...await worker.getSemanticDiagnostics(path)];
			}))).flat();
			if (errors.length) throw new Error('Library declarations could not be checked.');
			return worker;
		} catch (error) { editor.dispose(); model.dispose(); throw error; }
	}
	const worker = await checkedWorker();
	element('editor-version').textContent = `TypeScript ${monaco.typescript.typescriptVersion} · strict checking`;
	const state = { task: 'movement', busy: false };
	const edits = new Map<string, string>();
	function diagnostics() {
		const markers = monaco.editor.getModelMarkers({ resource: model.uri });
		element('diagnostics').textContent = markers.length ? markers.map(marker => `Line ${marker.startLineNumber} · ${marker.message}`).join('\n\n') : 'No TypeScript errors.';
		element('diagnostic-count').textContent = markers.length ? `${markers.length} issue${markers.length === 1 ? '' : 's'}` : 'Types check out';
	}
	monaco.editor.onDidChangeMarkers(diagnostics);
	async function run() {
		if (state.busy) return;
		state.busy = true; button('run-code').disabled = true;
		try {
			const version = model.getVersionId();
			element('editor-status').textContent = 'Checking TypeScript…';
			const problems = (await Promise.all([worker.getSyntacticDiagnostics(model.uri.toString()), worker.getSemanticDiagnostics(model.uri.toString()), worker.getCompilerOptionsDiagnostics(model.uri.toString())])).flat();
			if (version !== model.getVersionId()) { element('editor-status').textContent = 'Code changed. Press Run again.'; return; }
			if (problems.length) {
				element('editor-status').textContent = 'Fix the errors to run. Your previous game keeps playing.';
				element('diagnostics').textContent = problems.map(problem => diagnosticText(problem.messageText)).join('\n\n');
				const details = element('diagnostic-details');
				if (details instanceof HTMLDetailsElement) details.open = true;
				return;
			}
			const emitted = await worker.getEmitOutput(model.uri.toString());
			const javascript = emitted.outputFiles.find(file => file.name.endsWith('.js'))?.text;
			if (version !== model.getVersionId()) { element('editor-status').textContent = 'Code changed. Press Run again.'; return; }
			if (emitted.emitSkipped || !javascript) throw new Error('No JavaScript was emitted.');
			await runner.run(javascript, assets.runtime, assets.workerSource, assets.sandbox);
			element('editor-status').textContent = 'Changes applied. Focus the game to play.';
		} catch (error) { element('editor-status').textContent = errorText(error); }
		finally { state.busy = false; button('run-code').disabled = false; }
	}
	function focus(needle: string) {
		const index = model.getValue().indexOf(needle);
		if (index < 0) { editor.focus(); return; }
		const position = model.getPositionAt(index + needle.length);
		editor.setPosition(position); editor.revealPositionInCenter(position); editor.focus();
	}
	function select(task: string) {
		edits.set(state.task, model.getValue()); state.task = task;
		const presets: Record<string, string> = {
			movement: source,
			health: source.replace('const { position } = entity.components;', '// Health is optional here. Add health to with to require it.\n\t\t\t\tif (entity.components.health) {\n\t\t\t\t\tentity.components.health.value += 0;\n\t\t\t\t}\n\t\t\t\tconst { position } = entity.components;'),
			mutation: source.replace('const { position } = entity.components;', '// Try uncommenting this write, then add velocity to mutates:\n\t\t\t\t// entity.components.velocity.x = 20;\n\t\t\t\tconst { position } = entity.components;'),
		};
		model.setValue(edits.get(task) ?? presets[task] ?? source);
		focus(task === 'health' ? 'entity.components.health' : task === 'mutation' ? 'entity.components.velocity' : 'speed: ');
	}
	function reset() { const task = state.task; edits.delete(task); state.task = ''; select(task); element('editor-status').textContent = 'Original activity code restored. Press Run to apply.'; }
	button('run-code').addEventListener('click', () => { void run(); });
	button('reset-code').addEventListener('click', reset);
	button('show-suggestions').addEventListener('click', function () {
		focus("with: ['"); editor.trigger('showcase', 'editor.action.triggerSuggest', {});
	});
	button('show-types').addEventListener('click', function () {
		const needle = state.task === 'health' ? 'entity.components.health' : state.task === 'mutation' ? 'entity.components.velocity' : 'const { position';
		focus(needle); editor.trigger('showcase', 'editor.action.showHover', {});
		const cursor = editor.getPosition();
		if (!cursor) return;
		void worker.getQuickInfoAtPosition(model.uri.toString(), model.getOffsetAt(cursor) - 1).then(info => { element('type-explanation').textContent = displayParts(info); });
	});
	editor.addAction({ id: 'run-game', label: 'Run game', keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter], run: () => { void run(); } });
	Object.assign(globalThis, { ecspressoEditor: { model, editor, worker, run, select } });
	return { run, reset, select };
}
