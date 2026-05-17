import { join } from 'path';

const KEYWORDS = new Set([
	'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'of', 'in',
	'while', 'do', 'switch', 'case', 'break', 'continue', 'new', 'class', 'extends',
	'interface', 'type', 'enum', 'import', 'export', 'from', 'as', 'async', 'await',
	'true', 'false', 'null', 'undefined', 'this', 'typeof', 'instanceof',
]);

const BUILTIN_TYPES = new Set(['number', 'string', 'boolean', 'void', 'any', 'never', 'unknown', 'object']);

const rootDir = join(import.meta.dir, '..');
const docsDir = join(rootDir, 'docs');
const pkg = await Bun.file(join(rootDir, 'package.json')).json();
const version = `v${pkg.version}`;

const steps = await buildSteps();

await Bun.write(
	join(docsDir, 'index.html'),
	`<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>ECSpresso Documentation</title>
	<style>
		* { margin: 0; padding: 0; box-sizing: border-box; }
		body {
			background: #1e1e2e;
			color: #cdd6f4;
			font-family: 'Segoe UI', system-ui, sans-serif;
			min-height: 100vh;
			padding: 60px 20px;
		}
		.hero {
			text-align: center;
			margin-bottom: 48px;
		}
		h1 { font-size: 48px; color: #cba6f7; margin-bottom: 4px; }
		.pronunciation { color: #6c7086; font-style: italic; margin-bottom: 4px; font-size: 14px; }
		.version { color: #6c7086; font-size: 13px; margin-bottom: 8px; font-family: 'JetBrains Mono', 'Fira Code', monospace; }
		.tagline { color: #a6adc8; margin-bottom: 32px; font-size: 16px; }
		.links { display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; }
		.links a {
			display: block;
			padding: 20px 32px;
			background: #313244;
			border-radius: 12px;
			color: #89b4fa;
			text-decoration: none;
			font-size: 18px;
			font-weight: 500;
			transition: background 0.15s, transform 0.1s;
		}
		.links a:hover { background: #45475a; transform: translateY(-2px); }
		.links a span { display: block; font-size: 13px; color: #6c7086; margin-top: 4px; font-weight: 400; }
		.links a svg { vertical-align: middle; margin-right: 8px; }
		.quick-start {
			max-width: 720px;
			margin: 0 auto;
		}
		.quick-start h2 {
			font-size: 20px;
			color: #cba6f7;
			margin-bottom: 4px;
		}
		.quick-start .install {
			background: #181825;
			border-radius: 8px;
			padding: 12px 16px;
			margin-bottom: 20px;
			font-family: 'JetBrains Mono', 'Fira Code', monospace;
			font-size: 14px;
			color: #a6e3a1;
			overflow-x: auto;
		}
		.quick-start pre {
			background: #181825;
			border-radius: 8px;
			padding: 16px 20px;
			overflow-x: auto;
			font-size: 13px;
			line-height: 1.5;
			font-family: 'JetBrains Mono', 'Fira Code', monospace;
			color: #cdd6f4;
		}
		.quick-start code { font-family: inherit; }
		.kw { color: #cba6f7; }
		.st { color: #a6e3a1; }
		.cm { color: #6c7086; font-style: italic; }
		.nr { color: #fab387; }
		.tp { color: #f9e2af; }
		.step-label {
			display: inline-block;
			background: #45475a;
			color: #cba6f7;
			font-size: 11px;
			font-weight: 600;
			padding: 2px 8px;
			border-radius: 4px;
			margin-bottom: 8px;
		}
		.steps { margin-top: 24px; }
		.step { margin-bottom: 20px; }
	</style>
</head>
<body>
	<div class="hero">
		<h1>ECSpresso</h1>
		<p class="pronunciation">(pronounced "ex-presso")</p>
		<p class="version">${version}</p>
		<p class="tagline">A type-safe, modular ECS framework for TypeScript</p>
		<div class="links">
			<a href="./api/">API Reference<span>TypeDoc generated</span></a>
			<a href="./examples/">Examples<span>Interactive demos</span></a>
			<a href="./changelog/">What's New<span>${version} release notes</span></a>
			<a href="https://github.com/DeeGeeGames/ecspresso"><svg height="18" width="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>GitHub<span>Source on GitHub</span></a>
		</div>
	</div>

	<div class="quick-start">
		<h2>Quick Start</h2>
		<div class="install">npm install ecspresso</div>

		<div class="steps">
${steps}
		</div>
	</div>
</body>
</html>
`,
);

console.log('Built docs/index.html');

const apiIndexPath = join(docsDir, 'api', 'index.html');
const apiIndex = await Bun.file(apiIndexPath).text();
await Bun.write(
	apiIndexPath,
	apiIndex.replace(
		'<div class="tsd-page-title"><h1>ecspresso</h1></div>',
		`<div class="tsd-page-title"><h1>ecspresso <small style="font-size:0.5em;color:#888;font-weight:normal;">${version}</small></h1></div>`,
	),
);

console.log('Injected version into docs/api/index.html');

async function buildSteps(): Promise<string> {
	const md = await Bun.file(join(docsDir, 'getting-started.md')).text();
	const section = md.split(/^## Quick Start\s*$/m)[1]?.split(/^## /m)[0];
	if (!section) throw new Error('Quick Start section not found in getting-started.md');

	const code = section.match(/```typescript\s*\n([\s\S]*?)\n```/)?.[1];
	if (!code) throw new Error('No typescript fence in Quick Start section');

	const stepRegex = /^\/\/ (\d+[a-z]?)\. (.+)$/;
	const lines = code.split('\n');
	const chunks: Array<{ id: string; label: string; body: string[] }> = [];
	const preamble: string[] = [];

	for (const line of lines) {
		const match = line.match(stepRegex);
		if (match) {
			const id = match[1];
			const rest = match[2];
			if (!id || rest === undefined) throw new Error(`Malformed step header: ${line}`);
			const label = rest.split(/\. (?=[A-Z])/)[0]?.replace(/\.$/, '').trim() ?? rest;
			chunks.push({ id, label, body: [] });
			continue;
		}
		const current = chunks[chunks.length - 1];
		if (!current) {
			if (line.trim() !== '') preamble.push(line);
			continue;
		}
		current.body.push(line);
	}

	const stripped = chunks.map((chunk) => ({
		...chunk,
		body: trimBlankEdges(chunk.body).join('\n'),
	}));

	const preambleHtml = preamble.length > 0
		? `			<div class="step">
				<span class="step-label">0 &mdash; Import</span>
<pre><code>${highlight(preamble.join('\n'))}</code></pre>
			</div>\n`
		: '';

	const stepsHtml = stripped
		.map(
			(chunk) => `			<div class="step">
				<span class="step-label">${escapeHtml(chunk.id)} &mdash; ${escapeHtml(chunk.label)}</span>
<pre><code>${highlight(chunk.body)}</code></pre>
			</div>`,
		)
		.join('\n');

	return preambleHtml + stepsHtml;
}

function trimBlankEdges(lines: string[]): string[] {
	const start = lines.findIndex((l) => l.trim() !== '');
	if (start === -1) return [];
	const endOffset = [...lines].reverse().findIndex((l) => l.trim() !== '');
	return lines.slice(start, lines.length - endOffset);
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

function highlight(code: string): string {
	const tokens: Array<{ kind: string; text: string }> = [];
	const src = code;
	const len = src.length;
	const isIdStart = (c: string) => /[A-Za-z_$]/.test(c);
	const isIdCont = (c: string) => /[A-Za-z0-9_$]/.test(c);

	const pushRest = (start: number, end: number) => {
		if (end > start) tokens.push({ kind: 'txt', text: src.slice(start, end) });
	};

	const at = (k: number) => (k >= 0 && k < len ? src[k] ?? '' : '');

	const step = (i: number): number => {
		const c = at(i);

		if (c === '/' && at(i + 1) === '/') {
			const nl = src.indexOf('\n', i);
			const end = nl === -1 ? len : nl;
			tokens.push({ kind: 'cm', text: src.slice(i, end) });
			return end;
		}

		if (c === "'" || c === '"' || c === '`') {
			const quote = c;
			let j = i + 1;
			while (j < len && at(j) !== quote) {
				if (at(j) === '\\') j += 2;
				else j += 1;
			}
			j = Math.min(j + 1, len);
			tokens.push({ kind: 'st', text: src.slice(i, j) });
			return j;
		}

		if (/[0-9]/.test(c) && !isIdCont(at(i - 1) || ' ')) {
			let j = i + 1;
			while (j < len && /[0-9._]/.test(at(j))) j += 1;
			tokens.push({ kind: 'nr', text: src.slice(i, j) });
			return j;
		}

		if (c && isIdStart(c)) {
			let j = i + 1;
			while (j < len && isIdCont(at(j))) j += 1;
			const word = src.slice(i, j);
			if (KEYWORDS.has(word)) tokens.push({ kind: 'kw', text: word });
			else if (BUILTIN_TYPES.has(word)) tokens.push({ kind: 'tp', text: word });
			else if (/^[A-Z]/.test(word)) tokens.push({ kind: 'tp', text: word });
			else tokens.push({ kind: 'txt', text: word });
			return j;
		}

		pushRest(i, i + 1);
		return i + 1;
	};

	let i = 0;
	while (i < len) i = step(i);

	return tokens
		.map((t) =>
			t.kind === 'txt'
				? escapeHtml(t.text)
				: `<span class="${t.kind}">${escapeHtml(t.text)}</span>`,
		)
		.join('');
}
