#!/usr/bin/env bash
# Zip the extension for "Load unpacked" sharing or Chrome Web Store upload.
#
# The webhook URL and its bearer token are secrets, so they are not committed.
# If .webhook-url / .webhook-token (gitignored) or $MEDITOR_WEBHOOK_URL /
# $MEDITOR_WEBHOOK_TOKEN are present, they are baked into the zip as defaults;
# the source tree is never modified.
set -euo pipefail
cd "$(dirname "$0")/.."

version=$(python3 -c "import json;print(json.load(open('extension/manifest.json'))['version'])")
webhook="${MEDITOR_WEBHOOK_URL:-}"
if [[ -z "$webhook" && -f .webhook-url ]]; then webhook=$(tr -d '[:space:]' < .webhook-url); fi
token="${MEDITOR_WEBHOOK_TOKEN:-}"
if [[ -z "$token" && -f .webhook-token ]]; then token=$(tr -d '[:space:]' < .webhook-token); fi

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
cp -R extension/. "$stage/"

# Bake secrets into the staged copy only. Values are passed via the environment,
# never on a command line.
note=$(WEBHOOK="$webhook" TOKEN="$token" python3 - "$stage/src/shared/settings.js" <<'PY'
import json, os, re, sys
from urllib.parse import urlparse
path = sys.argv[1]
url, token = os.environ.get("WEBHOOK", ""), os.environ.get("TOKEN", "")
token = re.sub(r"^(authorization\s*:\s*)?bearer\s+", "", token, flags=re.I).strip()
src = open(path).read()
def bake(src, name, value):
    marker = f"export const {name} = '';"
    if src.count(marker) != 1:
        sys.exit(f"{name} marker not found in settings.js")
    return src.replace(marker, f"export const {name} = {json.dumps(value)};")
notes = []
if url:
    if urlparse(url).scheme not in ("http", "https"):
        sys.exit(f"Not an http(s) URL in .webhook-url / MEDITOR_WEBHOOK_URL")
    src = bake(src, "DEFAULT_WEBHOOK_URL", url)
    notes.append(f"default webhook: {urlparse(url).netloc}")
else:
    notes.append("no default webhook (set it in Settings after installing)")
if token:
    src = bake(src, "DEFAULT_WEBHOOK_TOKEN", token)
    notes.append("bearer token: baked in")
open(path, "w").write(src)
print(", ".join(notes))
PY
)

mkdir -p dist
out="dist/meditor-extension-v${version}.zip"
rm -f "$out"
(cd "$stage" && zip -qr -X "$OLDPWD/$out" . -x '.*' -x '*/.*')
echo "$out ($(du -h "$out" | cut -f1)) — $note"
