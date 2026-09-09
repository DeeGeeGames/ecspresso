import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dir, '..');
const skillSourceDirectory = resolve(repositoryRoot, 'skills/ecspresso');
const skillMirrorDirectory = resolve(repositoryRoot, 'plugins/ecspresso/skills/ecspresso');

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readText(path: string): Promise<string> {
	return Bun.file(path).text();
}

async function readJsonObject(path: string): Promise<Record<string, unknown>> {
	const value: unknown = JSON.parse(await readText(path));
	if (!isRecord(value)) {
		throw new Error(`${path} must contain a JSON object`);
	}

	return value;
}

async function getMarkdownFiles(directory: string): Promise<ReadonlyArray<string>> {
	const entries = await readdir(directory, { withFileTypes: true });
	return entries
		.filter(entry => entry.isFile() && entry.name.endsWith('.md'))
		.map(entry => entry.name)
		.sort();
}

function getCapturedValues(pattern: RegExp, text: string): ReadonlyArray<string> {
	return Array.from(text.matchAll(pattern))
		.map(match => match[1])
		.filter((value): value is string => value !== undefined);
}

describe('distributed ECSpresso skill documentation', () => {
	test('catalogs exactly the plugin paths exported by the package', async () => {
		const manifest = await readJsonObject(resolve(repositoryRoot, 'package.json'));
		if (!isRecord(manifest['exports'])) {
			throw new Error('package.json must contain an exports object');
		}

		const catalog = await readText(resolve(skillSourceDirectory, 'plugins.md'));
		const documentedPaths = getCapturedValues(
			/^\|[^|\n]+\|\s*`(ecspresso\/plugins\/[^`]+)`\s*\|/gm,
			catalog,
		);
		const exportedPaths = Object.keys(manifest['exports'])
			.filter(path => path.startsWith('./plugins/'))
			.map(path => `ecspresso${path.slice(1)}`)
			.sort();

		expect([...new Set(documentedPaths)].sort()).toEqual(exportedPaths);
	});

	test('keeps root and marketplace Codex plugin manifests aligned', async () => {
		const rootManifest = await readJsonObject(resolve(repositoryRoot, '.codex-plugin/plugin.json'));
		const marketplaceManifest = await readJsonObject(
			resolve(repositoryRoot, 'plugins/ecspresso/.codex-plugin/plugin.json'),
		);

		expect(marketplaceManifest).toEqual(rootManifest);
	});

	test('keeps the source and distributable skill copies byte-aligned', async () => {
		const sourceFiles = await getMarkdownFiles(skillSourceDirectory);
		const mirrorFiles = await getMarkdownFiles(skillMirrorDirectory);
		expect(mirrorFiles).toEqual(sourceFiles);

		const mismatches = (await Promise.all(sourceFiles.map(async file => ({
			file,
			matches: await readText(resolve(skillSourceDirectory, file))
				=== await readText(resolve(skillMirrorDirectory, file)),
		}))))
			.filter(result => !result.matches)
			.map(result => result.file);

		expect(mismatches).toEqual([]);
	});

	test('ships every relative markdown reference linked by the skill', async () => {
		const skillFiles = await getMarkdownFiles(skillSourceDirectory);
		const missingReferences = (await Promise.all(skillFiles.map(async file => {
			const filePath = resolve(skillSourceDirectory, file);
			const references = getCapturedValues(/\]\(([^)#]+\.md)(?:#[^)]+)?\)/g, await readText(filePath));
			return references
				.map(reference => resolve(dirname(filePath), reference))
				.filter(reference => !existsSync(reference));
		}))).flat();

		expect(missingReferences).toEqual([]);
	});
});
