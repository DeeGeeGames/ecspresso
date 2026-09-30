# Engine benchmark

Run `bun run examples` and open `/stress-test/` to compare ECSpresso and Phaser.

The Bevy adapter loads locally generated WebAssembly files. Before selecting
Bevy, install Rust and the matching wasm-bindgen CLI, then build the adapter:

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.106 --locked
bun run examples:build:bevy
```

The Bevy button is disabled when its generated files are absent, leaving the
other engines usable. Reload the page after building Bevy.

The generated files live in `bevy/pkg/` and are ignored by Git. Rebuild them
after changing the Rust source. `bun scripts/build-examples.ts` copies these
files into the documentation output; build Bevy first when preparing docs
locally. The documentation deployment workflow already builds Bevy before
packaging the examples.

Engine transitions wait for teardown to complete. Failed starts restore the
previous engine and display the failure. Bevy runs in a separate iframe that is
removed on teardown, so its WebAssembly runtime and render loop cannot keep
running alongside another benchmark engine.
