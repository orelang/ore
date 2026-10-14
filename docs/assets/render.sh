#!/bin/sh
# Renders banner.html to banner.png with headless Chrome.
cd "$(dirname "$0")"
chrome=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
"$chrome" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
    --window-size=1280,520 --virtual-time-budget=5000 \
    --screenshot="$PWD/banner.png" "file://$PWD/banner.html" 2>/dev/null
