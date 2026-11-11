#!/bin/bash
# Copies TypeR's own panel build into SG Typer Studio, unchanged. Run it after
# `npm run build` in the TypeR repository:
#   scripts/sync-panel.sh ~/Desktop/TypeR
set -euo pipefail
SOURCE="${1:-$HOME/Desktop/TypeR}"
TARGET="$(cd "$(dirname "$0")/.." && pwd)/web/panel"
find "$TARGET" -mindepth 1 ! -name index.html -delete
mkdir -p "$TARGET/assets" "$TARGET/locale"
cp "$SOURCE"/app/modern.* "$TARGET/"
rm -f "$TARGET/modern.html"
# The Topcoat stylesheets: the two hashed files the panel's theme manager loads
find "$SOURCE/app" -maxdepth 1 -type f -name '*.css' ! -name 'modern.*' ! -name 'legacy.*' -exec cp {} "$TARGET/" \;
cp "$SOURCE"/app/assets/*.png "$TARGET/assets/"
cp "$SOURCE/locale/messages.properties" "$TARGET/locale/"
for dir in "$SOURCE"/locale/*/; do
  name="$(basename "$dir")"
  mkdir -p "$TARGET/locale/$name"
  cp "$dir/messages.properties" "$TARGET/locale/$name/"
done
# The local manifest of the panel files embedded in the Windows app.
(cd "$TARGET" && find . -type f ! -name index.html ! -name files.json ! -path './locale/*' ! -name '*.LICENSE.txt' | sed 's#^\./##' | sort | python3 -c 'import sys, json; print(json.dumps([line.strip() for line in sys.stdin]))') > "$TARGET/files.json"
echo "Panel copied from $SOURCE."
