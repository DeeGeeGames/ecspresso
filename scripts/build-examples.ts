import { Glob } from 'bun';
import { join, dirname } from 'path';
import { mkdir, rm } from 'fs/promises';

const EXAMPLES_DIR = join(import.meta.dir, '..', 'examples');
const OUT_DIR = join(import.meta.dir, '..', 'docs', 'examples');

// Map of route name -> { htmlPath, entryDir }
// Derived from serve-examples.ts route structure
const examples = [
	{ route: 'movement', dir: 'movement', html: 'movement.html', entry: 'movement.ts' },
	{ route: 'player-input', dir: 'player-input', html: 'player-input.html', entry: 'player-input.ts' },
	{ route: 'events', dir: 'events', html: 'events.html', entry: 'events.ts' },
	{ route: 'plugins', dir: 'plugins', html: 'plugins.html', entry: 'plugins.ts' },
	{ route: 'space-invaders', dir: 'space-invaders', html: 'space-invaders.html', entry: 'index.ts' },
	{ route: 'turret-shooter', dir: 'turret-shooter', html: 'turret-shooter.html', entry: 'index.ts' },
	{ route: 'hierarchy', dir: 'hierarchy', html: 'hierarchy.html', entry: 'hierarchy.ts' },
	{ route: 'camera', dir: 'camera', html: 'camera.html', entry: 'camera.ts' },
	{ route: 'camera-zoom', dir: 'camera-zoom', html: 'camera-zoom.html', entry: 'camera-zoom.ts' },
	{ route: 'state-machine', dir: 'state-machine', html: 'state-machine.html', entry: 'state-machine.ts' },
	{ route: 'tweens', dir: 'tweens', html: 'tweens.html', entry: 'tweens.ts' },
	{ route: 'screens', dir: 'screens', html: 'screens.html', entry: 'screens.ts' },
	{ route: 'stress-test', dir: 'stress-test', html: 'stress-test.html', entry: 'stress-test.ts' },
	{ route: 'stress-test-3D', dir: 'stress-test-3D', html: 'stress-test-3D.html', entry: 'stress-test-3D.ts' },
	{ route: 'audio', dir: 'audio', html: 'audio.html', entry: 'audio.ts' },
	{ route: 'coroutines', dir: 'coroutines', html: 'coroutines.html', entry: 'coroutines.ts' },
	{ route: 'sprite-animation', dir: 'sprite-animation', html: 'sprite-animation.html', entry: 'sprite-animation.ts' },
	{ route: 'particles', dir: 'particles', html: 'particles.html', entry: 'particles.ts' },
	{ route: 'viewport-scaling', dir: 'viewport-scaling', html: 'viewport-scaling.html', entry: 'viewport-scaling.ts' },
	{ route: 'platformer', dir: 'platformer', html: 'platformer.html', entry: 'platformer.ts' },
	{ route: 'platformer3d', dir: 'platformer3d', html: 'platformer3d.html', entry: 'platformer3d.ts' },
	{ route: 'rts-movement', dir: 'rts-movement', html: 'rts-movement.html', entry: 'rts-movement.ts' },
	{ route: 'turret-defense', dir: 'turret-defense', html: 'turret-defense.html', entry: 'index.ts' },
	{ route: 'isometric', dir: 'isometric', html: 'isometric.html', entry: 'isometric.ts' },
	{ route: 'isometric-zoom', dir: 'isometric-zoom', html: 'isometric-zoom.html', entry: 'isometric-zoom.ts' },
	{ route: 'isometric-3d', dir: 'isometric-3d', html: 'isometric-3d.html', entry: 'isometric-3d.ts' },
	{ route: 'react-ui', dir: 'react-ui', html: 'react-ui.html', entry: 'index.tsx' },
	{ route: 'patrol-chase', dir: 'patrol-chase', html: 'patrol-chase.html', entry: 'patrol-chase.ts' },
	{ route: 'flocking', dir: 'flocking', html: 'flocking.html', entry: 'flocking.ts' },
	{ route: 'behavior-tree', dir: 'behavior-tree', html: 'behavior-tree.html', entry: 'behavior-tree.ts' },
	{ route: 'tilemap', dir: 'tilemap', html: 'tilemap.html', entry: 'tilemap.ts' },
	{ route: 'ui', dir: 'ui', html: 'ui.html', entry: 'ui.ts' },
	{ route: 'gamepad-tester', dir: 'gamepad-tester', html: 'gamepad-tester.html', entry: 'gamepad-tester.ts' },
] as const;

// Clean output
await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(OUT_DIR, { recursive: true });

// Copy shared styles
await Bun.write(
	join(OUT_DIR, 'styles.css'),
	Bun.file(join(EXAMPLES_DIR, 'styles.css')),
);

// Build each example
const results = await Promise.all(
	examples.map(async (example) => {
		const exampleSrcDir = join(EXAMPLES_DIR, example.dir);
		const exampleOutDir = join(OUT_DIR, example.route);
		await mkdir(exampleOutDir, { recursive: true });

		// Bundle TS entry point
		const entryPath = join(exampleSrcDir, example.entry);
		const bundleName = example.entry.replace(/\.tsx?$/, '.js');

		const result = await Bun.build({
			entrypoints: [entryPath],
			outdir: exampleOutDir,
			target: 'browser',
			sourcemap: 'none',
			minify: true,
			naming: bundleName,
		});

		if (!result.success) {
			console.error(`Failed to build ${example.route}:`);
			result.logs.forEach((log) => console.error(log));
			return { route: example.route, success: false, size: 0 };
		}

		// Read HTML source, rewrite .ts references to .js, and fix paths for flat file serving
		const htmlSrc = await Bun.file(join(exampleSrcDir, example.html)).text();
		const rewrittenHtml = htmlSrc
			// Rewrite script src from .ts/.tsx to .js
			.replace(
				/src="\.\/([^"]+)\.tsx?"/g,
				(_match, name) => `src="./${name}.js"`,
			)
			// Rewrite stylesheet href from ../styles.css to ../styles.css (same relative path works)
			.replace(
				'href="../styles.css"',
				'href="../styles.css"',
			)
			// Rewrite back link to point to examples index
			.replace(
				'href="/"',
				'href="../"',
			);

		await Bun.write(join(exampleOutDir, 'index.html'), rewrittenHtml);

		// Copy static assets (non-ts, non-html files) preserving directory structure
		const staticFiles = Array.from(
			new Glob('**/*.{wav,mp3,ogg,png,jpg,jpeg,webp,json,svg,txt}').scanSync(exampleSrcDir),
		);

		for (const file of staticFiles) {
			const destPath = join(exampleOutDir, file);
			await mkdir(dirname(destPath), { recursive: true });
			await Bun.write(destPath, Bun.file(join(exampleSrcDir, file)));
		}

		// Copy any prebuilt wasm-bindgen artifacts (bevy/pkg/*.{wasm,js})
		const pkgFiles = Array.from(
			new Glob('**/pkg/*.{wasm,js}').scanSync(exampleSrcDir),
		);
		for (const file of pkgFiles) {
			const destPath = join(exampleOutDir, file);
			await mkdir(dirname(destPath), { recursive: true });
			await Bun.write(destPath, Bun.file(join(exampleSrcDir, file)));
		}

		const totalSize = result.outputs.reduce((sum, o) => sum + o.size, 0);
		return { route: example.route, success: true, size: totalSize };
	}),
);

// Generate examples index page
const exampleLinks = examples
	.map((e) => `\t\t<li><a href="./${e.route}/">${e.route.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</a></li>`)
	.join('\n');

await Bun.write(
	join(OUT_DIR, 'index.html'),
	`<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>ECSpresso Examples</title>
	<link rel="stylesheet" href="./styles.css">
	<style>
		body {
			overflow: auto;
			background: #1e1e2e;
			color: #cdd6f4;
			font-family: 'Segoe UI', system-ui, sans-serif;
			padding: 40px;
		}
		h1 { color: #cba6f7; margin-bottom: 8px; }
		.subtitle { color: #6c7086; margin-bottom: 24px; }
		.subtitle a { color: #89b4fa; }
		ul { list-style: none; padding: 0; max-width: 600px; }
		li { margin: 0; }
		li a {
			display: block;
			padding: 12px 16px;
			color: #89b4fa;
			text-decoration: none;
			border-radius: 6px;
			transition: background 0.15s;
		}
		li a:hover { background: #313244; }
	</style>
</head>
<body>
	<h1>ECSpresso Examples</h1>
	<p class="subtitle">Interactive demos &mdash; <a href="../api/">API Documentation</a></p>
	<ul>
${exampleLinks}
	</ul>
</body>
</html>
`,
);

// Print summary
function formatSize(bytes: number): string {
	return bytes >= 1024 * 1024
		? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
		: bytes >= 1024
			? `${(bytes / 1024).toFixed(1)} KB`
			: `${bytes} B`;
}

const maxRoute = Math.max(...results.map((r) => r.route.length));
const succeeded = results.filter((r) => r.success);
const failed = results.filter((r) => !r.success);

console.log(`\nBuilt ${succeeded.length}/${results.length} examples → docs/examples/\n`);
succeeded.forEach((r) => {
	console.log(`  ${r.route.padEnd(maxRoute + 2)} ${formatSize(r.size).padStart(10)}`);
});

if (failed.length > 0) {
	console.error(`\nFailed (${failed.length}):`);
	failed.forEach((r) => console.error(`  ${r.route}`));
	process.exit(1);
}
