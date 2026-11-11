#!/bin/sh
# Builds web/vendor/indd.wasm: indd-utils (MIT or Apache-2.0), the .indd reader, for the
# browser. The commit it builds is pinned in scripts/indd-wasm/Cargo.toml.
# Needs Rust with the wasm32-unknown-unknown target:
#   rustup target add wasm32-unknown-unknown
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root/scripts/indd-wasm"
cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/indd_wasm.wasm "$root/web/vendor/indd.wasm"
ls -l "$root/web/vendor/indd.wasm"
