#!/bin/bash
# SNAPPED Font Installer — converts woff2 fonts from captured JSON to TTF and installs them
# Usage: ./install-fonts.sh [path-to-json]
#   If no path given, uses the latest snapped-latest*.json in ~/Downloads

JSON_FILE="$1"

if [ -z "$JSON_FILE" ]; then
  JSON_FILE=$(ls -t ~/Downloads/snapped-latest*.json 2>/dev/null | head -1)
fi

if [ -z "$JSON_FILE" ] || [ ! -f "$JSON_FILE" ]; then
  echo "No SNAPPED JSON file found."
  exit 1
fi

echo "Reading fonts from: $JSON_FILE"

python3 -c "
import json, base64, os, sys

with open('$JSON_FILE') as f:
    data = json.load(f)

fonts = data.get('fonts', [])
if not fonts:
    print('No fonts found in JSON.')
    sys.exit(0)

try:
    from fontTools.ttLib import TTFont
except ImportError:
    print('Installing fonttools...')
    os.system('pip3 install fonttools brotli -q')
    from fontTools.ttLib import TTFont

font_dir = os.path.expanduser('~/Library/Fonts')
installed = 0

for font in fonts:
    family = font['family'].replace(' ', '_')
    weight = font['weight']
    style = font['style']
    fmt = font.get('format', 'woff2')

    # Decode base64
    b64 = font['dataUrl'].split(',', 1)[1]
    raw = base64.b64decode(b64)

    # Save temp woff2
    tmp = f'/tmp/{family}_{weight}_{style}.{fmt}'
    with open(tmp, 'wb') as out:
        out.write(raw)

    # Convert to ttf
    ttf_name = f'{family}-{weight}-{style}.ttf'
    ttf_path = os.path.join(font_dir, ttf_name)

    try:
        tt = TTFont(tmp)
        tt.flavor = None
        tt.save(ttf_path)
        print(f'  Installed: {ttf_name}')
        installed += 1
    except Exception as e:
        print(f'  Failed: {ttf_name} ({e})')

    os.remove(tmp)

print(f'\nDone! Installed {installed} font(s) to ~/Library/Fonts/')
print('Restart Figma to use the new fonts.')
"
