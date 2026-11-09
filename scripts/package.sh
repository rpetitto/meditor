#!/usr/bin/env bash
# Zip the extension for "Load unpacked" sharing or Chrome Web Store upload.
#
# The default webhook URL is a secret, so it is not committed. If .webhook-url
# (gitignored) or $MEDITOR_WEBHOOK_URL is present, it is baked into the zip as
# the default; the source tree is never modified.
set -euo pipefail
cd "$(dirname "$0")/.."

version=$(python3 -c "import json;print(json.load(open('extension/manifest.json'))['version'])")
webhook="${MEDITOR_WEBHOOK_URL:-}"
if [[ -z "$webhook" && -f .webhook-url ]]; then webhook=$(tr -d '[:space:]' < .webhook-url); fi

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
cp -R extension/. "$stage/"

if [[ -n "$webhook" ]]; then
  python3 - "$stage/src/shared/settings.js" "$webhook" <<'PY'
import json, sys
from urllib.parse import urlparse
path, url = sys.argv[1], sys.argv[2]
if urlparse(url).scheme not in ("http", "https"):
    sys.exit(f"Not an http(s) URL: {url!r}")
src = open(path).read()
marker = "export const DEFAULT_WEBHOOK_URL = '';"
if src.count(marker) != 1:
    sys.exit("DEFAULT_WEBHOOK_URL marker not found in settings.js")
open(path, "w").write(src.replace(marker, f"export const DEFAULT_WEBHOOK_URL = {json.dumps(url)};"))
PY
  note="default webhook: $(python3 -c "from urllib.parse import urlparse;import sys;print(urlparse(sys.argv[1]).netloc)" "$webhook")"
else
  note="no default webhook (set it in Settings after installing)"
fi

mkdir -p dist
out="dist/meditor-extension-v${version}.zip"
rm -f "$out"
(cd "$stage" && zip -qr -X "$OLDPWD/$out" . -x '.*' -x '*/.*')
echo "$out ($(du -h "$out" | cut -f1)) — $note"
