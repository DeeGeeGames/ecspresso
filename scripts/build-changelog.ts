import { join } from 'path';
import { mkdir } from 'fs/promises';

const rootDir = join(import.meta.dir, '..');
const docsDir = join(rootDir, 'docs');
const outDir = join(docsDir, 'changelog');
const pkg = await Bun.file(join(rootDir, 'package.json')).json();
const version = `v${pkg.version}`;

const md = await Bun.file(join(rootDir, 'CHANGELOG.md')).text();
const body = renderMarkdown(md);

await mkdir(outDir, { recursive: true });
await Bun.write(
	join(outDir, 'index.html'),
	`<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>ECSpresso Changelog</title>
	<link rel="stylesheet" href="../showcase/site.css">
	<script type="module" src="../showcase/theme-page.js"></script>
	<style>
		* { margin: 0; padding: 0; box-sizing: border-box; }
		body {
			background: var(--bg);
			color: var(--ink);
			font-family: 'Segoe UI', system-ui, sans-serif;
			min-height: 100vh;
			padding: 60px 20px;
			line-height: 1.6;
		}
		.container { max-width: 760px; margin: 0 auto; }
		.back { color: var(--accent); text-decoration: none; font-size: 14px; }
		.back:hover { text-decoration: underline; }
		.version { color: var(--muted); font-size: 13px; font-family: 'JetBrains Mono', 'Fira Code', monospace; margin: 24px 0 8px; }
		h1 { font-size: 36px; color: var(--ink); margin-bottom: 32px; }
		h2 { font-size: 22px; color: var(--ink); margin: 40px 0 12px; border-bottom: 1px solid var(--line); padding-bottom: 6px; }
		h3 { font-size: 16px; color: var(--ink); margin: 20px 0 8px; }
		p { margin: 8px 0; color: var(--ink); }
		ul { margin: 8px 0 16px 24px; }
		li { margin: 6px 0; }
		a { color: var(--accent); text-decoration: none; }
		a:hover { text-decoration: underline; }
		code {
			background: var(--soft);
			color: var(--ink);
			padding: 2px 6px;
			border-radius: 4px;
			font-family: 'JetBrains Mono', 'Fira Code', monospace;
			font-size: 13px;
		}
		strong { color: var(--ink); }
	</style>
</head>
<body>
	<div class="container">
		<a class="back" href="../">&larr; Back to docs</a>
		<p class="version">${version}</p>
		${body}
	</div>
</body>
</html>
`,
);

console.log('Built docs/changelog/index.html');

function renderMarkdown(src: string): string {
	const headings = [
		['h1', /^# (.+)$/],
		['h2', /^## (.+)$/],
		['h3', /^### (.+)$/],
	] as const;
	const out: string[] = [];
	let inList = false;
	const closeList = () => {
		if (!inList) return;
		out.push('</ul>');
		inList = false;
	};

	for (const raw of src.split('\n')) {
		const line = raw.trimEnd();

		const heading = headings.find(([, re]) => re.test(line));
		if (heading) {
			const [tag, re] = heading;
			closeList();
			out.push(`<${tag}>${inline(line.match(re)?.[1] ?? '')}</${tag}>`);
			continue;
		}

		const li = line.match(/^- (.+)$/);
		if (li) {
			if (!inList) {
				out.push('<ul>');
				inList = true;
			}
			out.push(`<li>${inline(li[1] ?? '')}</li>`);
			continue;
		}

		if (line.trim() === '') {
			closeList();
			continue;
		}

		closeList();
		out.push(`<p>${inline(line)}</p>`);
	}
	closeList();
	return out.join('\n\t\t');
}

function inline(text: string): string {
	const escaped = text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
	return escaped
		.replace(/`([^`]+)`/g, '<code>$1</code>')
		.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
		.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}
