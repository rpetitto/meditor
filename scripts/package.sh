#!/usr/bin/env bash
# Zip the extension for "Load unpacked" sharing or Chrome Web Store upload.
#
# The default webhook (normally your Meditor relay URL) is read from the gitignored
# .webhook-url file or $MEDITOR_WEBHOOK_URL and baked into the zip; the source tree
# is never modified. The Glide URL and bearer token belong in the relay, not here.
set -euo pipefail
cd "$(dirname "$0")/.."

version=$(python3 -c "import json;print(json.load(open('extension/manifest.json'))['version'])")
webhook="${MEDITOR_WEBHOOK_URL:-}"
if [[ -z "$webhook" && -f .webhook-url ]]; then webhook=$(tr -d '[:space:]' < .webhook-url); fi

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
cp -R extension/. "$stage/"

note=$(WEBHOOK="$webhook" python3 - "$stage/config.json" <<'PY'
import json, os, sys
from urllib.parse import urlparse
path, url = sys.argv[1], os.environ.get("WEBHOOK", "")
if not url:
    print("no default webhook (users will be asked for one in Settings)")
    sys.exit()
u = urlparse(url)
if u.scheme not in ("http", "https"):
    sys.exit("Not an http(s) URL in .webhook-url / MEDITOR_WEBHOOK_URL")
if u.netloc.endswith("glideapps.com") and os.environ.get("ALLOW_DIRECT_GLIDE") != "1":
    sys.exit("Refusing to bake the Glide webhook itself into the extension: point .webhook-url at your "
             "Meditor relay instead (see relay/README.md). Set ALLOW_DIRECT_GLIDE=1 only for a "
             "trigger that has no bearer token.")
config = json.load(open(path))
config["webhookUrl"] = url
with open(path, "w") as f:
    json.dump(config, f, indent=2)
    f.write("\n")
print(f"default webhook: {u.netloc}")
PY
)

mkdir -p dist
out="dist/meditor-extension-v${version}.zip"
rm -f "$out"
(cd "$stage" && zip -qr -X "$OLDPWD/$out" . -x '.*' -x '*/.*')
echo "$out ($(du -h "$out" | cut -f1)) — $note"
