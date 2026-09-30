import { resolve } from 'node:path';
import ts from 'typescript';
const root = resolve(import.meta.dir, '../..');
const dist = resolve(root, 'dist');
const virtualFile = resolve(import.meta.dir, 'editor-sample.ts');

const options: ts.CompilerOptions = {
	strict: true, noUncheckedIndexedAccess: true, noUnusedLocals: true, noUnusedParameters: true,
	noPropertyAccessFromIndexSignature: true, noFallthroughCasesInSwitch: true,
	skipLibCheck: false, noEmit: true, target: ts.ScriptTarget.ESNext,
	module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
	lib: ['lib.esnext.d.ts', 'lib.dom.d.ts'], types: [],
	paths: { ecspresso: [resolve(dist, 'index.d.ts')] },
};
export function compare(source: string, offsets: number[]) {
	const host: ts.LanguageServiceHost = {
		getCompilationSettings: () => options,
		getScriptFileNames: () => [virtualFile],
		getScriptVersion: () => '1',
		getScriptSnapshot: function (file) {
			const content = file === virtualFile ? source : ts.sys.readFile(file);
			return content === undefined ? undefined : ts.ScriptSnapshot.fromString(content);
		},
		getCurrentDirectory: () => root,
		getDefaultLibFileName: ts.getDefaultLibFilePath,
		fileExists: file => file === virtualFile || ts.sys.fileExists(file),
		readFile: file => file === virtualFile ? source : ts.sys.readFile(file),
		readDirectory: ts.sys.readDirectory,
	};
	const service = ts.createLanguageService(host);
	const program = service.getProgram();
	if (!program) throw new Error('Compiler program unavailable');
	const diagnostics = ts.getPreEmitDiagnostics(program).map(function (diagnostic) {
		return { file: diagnostic.file?.fileName === virtualFile ? 'sample' : diagnostic.file?.fileName, start: diagnostic.start, length: diagnostic.length, code: diagnostic.code, message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n') };
	});
	const probes = offsets.map(function (offset) {
		return {
			offset,
			completions: service.getCompletionsAtPosition(virtualFile, offset, {})?.entries.map(entry => entry.name) ?? [],
			hover: ts.displayPartsToString(service.getQuickInfoAtPosition(virtualFile, offset)?.displayParts),
		};
	});
	service.dispose();
	return { version: ts.version, diagnostics, probes };
}
