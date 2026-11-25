#!/usr/bin/env bash
# Regenerates the social preview image, app icons and the poster renders of each 3D view
# (shown while the 3D loads, in low-data mode, and as the before/after images).
# Needs: Google Chrome, Python 3 with Pillow, and the local server running (python3 -m http.server 5173).
set -euo pipefail
cd "$(dirname "$0")/.."
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
URL="${1:-http://localhost:5173}"
TMP="$(mktemp -d)"
shot() { # url width height out
  "$CHROME" --headless=new --disable-gpu-sandbox --use-angle=swiftshader --enable-unsafe-swiftshader \
    --hide-scrollbars --force-prefers-reduced-motion --force-device-scale-factor=1 --window-size="$2,$3" \
    --virtual-time-budget=15000 --screenshot="$4" "$1" >/dev/null 2>&1
}
shot "$URL/tools/og.html?quality=high" 1200 630 "$TMP/og.png"
shot "$URL/tools/icon.html" 512 512 "$TMP/icon.png"
shot "$URL/tools/render.html?view=hero&quality=high" 1600 900 "$TMP/hero.png"
shot "$URL/tools/render.html?view=aquifer&quality=high" 1000 825 "$TMP/aquifer.png"
shot "$URL/tools/render.html?view=eng&quality=high" 1000 825 "$TMP/eng.png"
shot "$URL/tools/render.html?view=sky&quality=high" 1000 1000 "$TMP/sky.png"
shot "$URL/tools/render.html?view=vigour&quality=high" 1000 1000 "$TMP/vigour.png"
for v in drone spray; do shot "$URL/tools/render.html?view=$v&quality=high" 1200 800 "$TMP/$v.png"; done
for n in 1 2 3 4; do shot "$URL/tools/render.html?view=story&step=$((n - 1))&quality=high" 1200 1000 "$TMP/story-$n.png"; done
shot "$URL/tools/render.html?view=before&quality=high" 1600 820 "$TMP/before.png"
shot "$URL/tools/render.html?view=after&quality=high" 1600 820 "$TMP/after.png"
python3 -I - "$TMP" <<'PY'
import sys
from PIL import Image
t = sys.argv[1]
Image.open(f"{t}/og.png").convert("RGB").save("assets/og.jpg", quality=86, optimize=True, progressive=True)
icon = Image.open(f"{t}/icon.png").convert("RGB")
for size, name in [(512, "icon-512.png"), (192, "icon-192.png"), (180, "apple-touch-icon.png"), (32, "favicon-32.png")]:
    icon.resize((size, size), Image.LANCZOS).save(f"assets/icons/{name}", optimize=True)
import os
os.makedirs("assets/renders", exist_ok=True)
for n in ["hero", "aquifer", "eng", "sky", "before", "after", "story-1", "story-2", "story-3", "story-4", "drone", "spray", "vigour"]:
    Image.open(f"{t}/{n}.png").convert("RGB").save(f"assets/renders/{n}.webp", quality=74, method=6)
print("assets/og.jpg, assets/icons/ and assets/renders/ updated")
PY
rm -rf "$TMP"
