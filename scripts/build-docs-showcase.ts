import { resolve, dirname, relative } from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import ts from 'typescript';

const root = resolve(import.meta.dir, '..');
const source = resolve(import.meta.dir, 'docs-showcase');
const output = resolve(root, 'docs/showcase');
const dist = resolve(root, 'dist');
const declarations = new Map<string, string>();
function hash(content: string) { return new Bun.CryptoHasher('sha256').update(content).digest('hex'); }
async function collect(file: string): Promise<void> {
	if (declarations.has(file)) return;
	const content = await Bun.file(file).text();
	declarations.set(file, content);
	await Promise.all(ts.preProcessFile(content).importedFiles.map(function (entry) {
		if (!entry.fileName.startsWith('.')) throw new Error(`Unexpected declaration dependency: ${entry.fileName}`);
		return collect(resolve(dirname(file), `${entry.fileName}.d.ts`));
	}));
}
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await collect(resolve(dist, 'index.d.ts'));
const libs = Array.from(declarations, function ([file, content]) {
	return { path: `file:///node_modules/ecspresso/${relative(dist, file)}`, content, sha256: hash(content) };
}).sort((a, b) => a.path.localeCompare(b.path));
const runtime = await Bun.file(resolve(dist, 'index.js')).text();
const runtimeHash = hash(runtime);
const buildId = hash(JSON.stringify({ runtimeHash, declarations: libs.map(lib => lib.sha256) }));
const bundles = await Promise.all([
	Bun.build({ entrypoints: [resolve(source, 'main.ts'), resolve(source, 'editor.ts')],
		outdir: output, target: 'browser', splitting: true, naming: '[name].[ext]', minify: true }),
	...['simulation.ts', 'sandbox.ts', 'typedoc.ts', 'theme-page.ts'].map(entry => Bun.build({ entrypoints: [resolve(source, entry)], outdir: output, target: 'browser', naming: '[name].[ext]', minify: true })),
	...['typescript/ts.worker.js', '../editor/editor.worker.js'].map(entry => Bun.build({
		entrypoints: [resolve(root, 'node_modules/monaco-editor/esm/vs/language', entry)],
		outdir: output, target: 'browser', naming: '[name].[ext]', minify: true,
	})),
	Bun.build({ entrypoints: [resolve(source, 'game.ts')], outdir: output, target: 'browser', naming: '[name].[ext]', external: ['ecspresso'] }),
]);
bundles.forEach(function (build) {
	if (!build.success) throw new AggregateError(build.logs, 'Documentation showcase build failed');
});
const bootstrap = (await Bun.file(resolve(output, 'sandbox.js')).text()).replace(/<\/script/gi, '<\\/script');
const sandbox = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; worker-src blob:; connect-src 'none'"></head><body><script>${bootstrap}</script></body></html>`;
await Promise.all([
	Bun.write(resolve(output, 'sandbox.html'), sandbox),
	Bun.write(resolve(output, 'runtime.js'), runtime),
	Bun.write(resolve(output, 'runtime.js.map'), Bun.file(resolve(dist, 'index.js.map'))),
	Bun.write(resolve(output, 'game.ts'), Bun.file(resolve(source, 'game.ts'))),
	Bun.write(resolve(output, 'site.css'), Bun.file(resolve(source, 'site.css'))),
	Bun.write(resolve(output, 'declarations.json'), JSON.stringify({ libs, buildId })),
	Bun.write(resolve(output, 'manifest.json'), JSON.stringify({ runtimeHash, buildId, compilerVersion: ts.version })),
]);
console.log(`Built documentation showcase: ${libs.length} declarations, build ${buildId.slice(0, 12)}`);
