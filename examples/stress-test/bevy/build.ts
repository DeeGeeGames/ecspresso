import { $ } from 'bun';
import { join } from 'path';

const BEVY_DIR = import.meta.dir;
const TARGET_WASM = join(
	BEVY_DIR,
	'target',
	'wasm32-unknown-unknown',
	'release',
	'bevy_stress_test.wasm',
);
const PKG_DIR = join(BEVY_DIR, 'pkg');

await $`cargo build --target wasm32-unknown-unknown --release`.cwd(BEVY_DIR);
await $`wasm-bindgen --target web --out-dir ${PKG_DIR} --no-typescript ${TARGET_WASM}`;

const wasmFile = Bun.file(join(PKG_DIR, 'bevy_stress_test_bg.wasm'));
console.log(`bevy wasm: ${(wasmFile.size / 1024 / 1024).toFixed(1)} MB → ${PKG_DIR}`);
