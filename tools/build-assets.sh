#!/usr/bin/env bash
# Regenerates the social preview image and app icons from tools/og.html and tools/icon.html.
# Needs: Google Chrome, Python 3 with Pillow, and the local server running (python3 -m http.server 5173).
set -euo pipefail
cd "$(dirname "$0")/.."
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
URL="${1:-http://localhost:5173}"
TMP="$(mktemp -d)"
shot() { # url width height out
  "$CHROME" --headless=new --disable-gpu-sandbox --use-angle=swiftshader --enable-unsafe-swiftshader \
    --hide-scrollbars --force-device-scale-factor=1 --window-size="$2,$3" \
    --virtual-time-budget=15000 --screenshot="$4" "$1" >/dev/null 2>&1
}
shot "$URL/tools/og.html" 1200 630 "$TMP/og.png"
shot "$URL/tools/icon.html" 512 512 "$TMP/icon.png"
python3 -I - "$TMP" <<'PY'
import sys
from PIL import Image
t = sys.argv[1]
Image.open(f"{t}/og.png").convert("RGB").save("assets/og.jpg", quality=86, optimize=True, progressive=True)
icon = Image.open(f"{t}/icon.png").convert("RGB")
for size, name in [(512, "icon-512.png"), (192, "icon-192.png"), (180, "apple-touch-icon.png"), (32, "favicon-32.png")]:
    icon.resize((size, size), Image.LANCZOS).save(f"assets/icons/{name}", optimize=True)
print("assets/og.jpg and assets/icons/ updated")
PY
rm -rf "$TMP"
