import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';

const root = join(import.meta.dir, '..');
const docs = join(root, 'docs');
const pkg: unknown = await Bun.file(join(root, 'package.json')).json();
if (typeof pkg !== 'object' || pkg === null || !('version' in pkg) || typeof pkg.version !== 'string') throw new Error('Package version is missing.');
const template = await Bun.file(join(import.meta.dir, 'docs-showcase/index.html')).text();
const game = await Bun.file(join(import.meta.dir, 'docs-showcase/game.ts')).text();
const start = game.indexOf("world.addSystem('movement')");
const end = game.indexOf("\n\tworld.addSystem('collect-and-dodge')");
if (start < 0 || end < start) throw new Error('Movement system preview is missing.');
function escapeHtml(value: string) {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
await mkdir(join(docs, 'brand'), { recursive: true });
const marks = ['master-light-transparent', 'master-dark-transparent', 'icon-light-transparent', 'icon-dark-transparent', 'icon-light'];
await Promise.all(marks.map(mark => Bun.write(join(docs, 'brand', `ecspresso-${mark}.svg`), Bun.file(join(root, 'assets/brand', `ecspresso-${mark}.svg`)))));
await Bun.write(join(docs, 'index.html'), template.replaceAll('{{VERSION}}', escapeHtml(pkg.version)).replace('{{CODE}}', escapeHtml(game.slice(start, end).trim())));
console.log('Built branded documentation homepage');
