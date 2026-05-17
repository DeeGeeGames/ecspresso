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
	<style>
		* { margin: 0; padding: 0; box-sizing: border-box; }
		body {
			background: #1e1e2e;
			color: #cdd6f4;
			font-family: 'Segoe UI', system-ui, sans-serif;
			min-height: 100vh;
			padding: 60px 20px;
			line-height: 1.6;
		}
		.container { max-width: 760px; margin: 0 auto; }
		.back { color: #89b4fa; text-decoration: none; font-size: 14px; }
		.back:hover { text-decoration: underline; }
		.version { color: #6c7086; font-size: 13px; font-family: 'JetBrains Mono', 'Fira Code', monospace; margin: 24px 0 8px; }
		h1 { font-size: 36px; color: #cba6f7; margin-bottom: 32px; }
		h2 { font-size: 22px; color: #cba6f7; margin: 40px 0 12px; border-bottom: 1px solid #45475a; padding-bottom: 6px; }
		h3 { font-size: 16px; color: #f9e2af; margin: 20px 0 8px; }
		p { margin: 8px 0; color: #cdd6f4; }
		ul { margin: 8px 0 16px 24px; }
		li { margin: 6px 0; }
		a { color: #89b4fa; text-decoration: none; }
		a:hover { text-decoration: underline; }
		code {
			background: #181825;
			color: #a6e3a1;
			padding: 2px 6px;
			border-radius: 4px;
			font-family: 'JetBrains Mono', 'Fira Code', monospace;
			font-size: 13px;
		}
		strong { color: #f9e2af; }
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
