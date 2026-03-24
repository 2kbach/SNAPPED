#!/bin/bash
# SNAPPED Font Installer — converts woff2 fonts to TTF, patches names, and installs
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

weight_names = {
    '100': 'Thin', '200': 'ExtraLight', '300': 'Light', '400': 'Regular',
    '500': 'Medium', '600': 'SemiBold', '700': 'Bold', '800': 'ExtraBold', '900': 'Black',
    'normal': 'Regular', 'bold': 'Bold'
}

font_dir = os.path.expanduser('~/Library/Fonts')
installed = 0

for font in fonts:
    family = font['family']
    weight = str(font['weight'])
    style = font['style']
    fmt = font.get('format', 'woff2')

    # Decode base64
    b64 = font['dataUrl'].split(',', 1)[1]
    raw = base64.b64decode(b64)

    # Save temp file
    safe_family = family.replace(' ', '_')
    tmp = f'/tmp/{safe_family}_{weight}_{style}.{fmt}'
    with open(tmp, 'wb') as out:
        out.write(raw)

    # Convert to ttf
    ttf_name = f'{safe_family}-{weight}-{style}.ttf'
    ttf_path = os.path.join(font_dir, ttf_name)

    try:
        tt = TTFont(tmp)
        tt.flavor = None  # Remove woff2 compression

        # Patch font name table (many sites strip names to prevent unauthorized use)
        name_table = tt['name']
        current_name = name_table.getDebugName(4) or name_table.getDebugName(1) or ''

        # If name is missing/obfuscated (single char or empty), patch it
        if len(current_name.strip()) <= 1:
            style_name = weight_names.get(weight, 'Regular')
            full_name = f'{family} {style_name}'
            ps_name = f'{family.replace(\" \", \"\")}-{style_name}'

            for plat_id in [1, 3]:
                enc_id = 0 if plat_id == 1 else 1
                lang_id = 0 if plat_id == 1 else 0x409
                name_table.setName(family, 1, plat_id, enc_id, lang_id)
                name_table.setName(style_name, 2, plat_id, enc_id, lang_id)
                name_table.setName(full_name + ';1.0', 3, plat_id, enc_id, lang_id)
                name_table.setName(full_name, 4, plat_id, enc_id, lang_id)
                name_table.setName('Version 1.0', 5, plat_id, enc_id, lang_id)
                name_table.setName(ps_name, 6, plat_id, enc_id, lang_id)
            print(f'  Installed: {ttf_name} (name patched -> {full_name})')
        else:
            print(f'  Installed: {ttf_name} ({current_name})')

        tt.save(ttf_path)
        installed += 1
    except Exception as e:
        print(f'  Failed: {ttf_name} ({e})')

    os.remove(tmp)

print(f'\nDone! Installed {installed} font(s) to ~/Library/Fonts/')
print('Restart Figma to use the new fonts.')
"
