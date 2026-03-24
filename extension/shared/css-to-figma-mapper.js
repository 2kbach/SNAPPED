/**
 * SNAPPED - CSS to Figma Property Mapper
 * Pure functions that convert CSS property values into Figma-compatible data structures.
 */

const SnappedMapper = (function() {
  'use strict';

  // ── Color Parsing ────────────────────────────────────────

  /**
   * Parse any CSS color string into { r, g, b, a } where r/g/b are 0-1 floats
   */
  function parseColor(cssColor) {
    if (!cssColor || cssColor === 'transparent' || cssColor === 'none') {
      return null;
    }

    // rgb(a) format
    const rgbaMatch = cssColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (rgbaMatch) {
      return {
        r: parseInt(rgbaMatch[1]) / 255,
        g: parseInt(rgbaMatch[2]) / 255,
        b: parseInt(rgbaMatch[3]) / 255,
        a: rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1
      };
    }

    // Hex format
    const hexMatch = cssColor.match(/^#([0-9a-f]{3,8})$/i);
    if (hexMatch) {
      let hex = hexMatch[1];
      if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
      if (hex.length === 4) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2]+hex[3]+hex[3];
      return {
        r: parseInt(hex.substring(0, 2), 16) / 255,
        g: parseInt(hex.substring(2, 4), 16) / 255,
        b: parseInt(hex.substring(4, 6), 16) / 255,
        a: hex.length === 8 ? parseInt(hex.substring(6, 8), 16) / 255 : 1
      };
    }

    // Named colors (common ones)
    const namedColors = {
      black: { r: 0, g: 0, b: 0, a: 1 },
      white: { r: 1, g: 1, b: 1, a: 1 },
      red: { r: 1, g: 0, b: 0, a: 1 },
      green: { r: 0, g: 128/255, b: 0, a: 1 },
      blue: { r: 0, g: 0, b: 1, a: 1 },
      gray: { r: 128/255, g: 128/255, b: 128/255, a: 1 },
      grey: { r: 128/255, g: 128/255, b: 128/255, a: 1 }
    };
    if (namedColors[cssColor.toLowerCase()]) {
      return namedColors[cssColor.toLowerCase()];
    }

    return null;
  }

  // ── Box Shadow Parsing ───────────────────────────────────

  /**
   * Parse CSS box-shadow into Figma effect objects
   * Returns array of { type, color, offset, radius, spread, visible }
   */
  function parseBoxShadow(cssShadow) {
    if (!cssShadow || cssShadow === 'none') return [];

    const effects = [];
    // Split multiple shadows (but not commas within rgba)
    const shadows = splitShadows(cssShadow);

    for (const shadow of shadows) {
      const isInset = shadow.includes('inset');
      const cleaned = shadow.replace('inset', '').trim();

      // Extract color - find rgb/rgba or hex or named color
      let colorStr = 'rgba(0, 0, 0, 1)';
      const rgbaMatch = cleaned.match(/rgba?\([^)]+\)/);
      const hexMatch = cleaned.match(/#[0-9a-f]{3,8}/i);
      if (rgbaMatch) colorStr = rgbaMatch[0];
      else if (hexMatch) colorStr = hexMatch[0];

      // Extract numeric values (offsets, blur, spread)
      const nums = cleaned.replace(/rgba?\([^)]+\)/, '').replace(/#[0-9a-f]{3,8}/i, '')
        .trim().split(/\s+/).map(parseFloat).filter(n => !isNaN(n));

      const offsetX = nums[0] || 0;
      const offsetY = nums[1] || 0;
      const blur = nums[2] || 0;
      const spread = nums[3] || 0;

      effects.push({
        type: isInset ? 'INNER_SHADOW' : 'DROP_SHADOW',
        color: parseColor(colorStr),
        offset: { x: offsetX, y: offsetY },
        radius: blur,
        spread: spread,
        visible: true
      });
    }

    return effects;
  }

  function splitShadows(shadowStr) {
    const result = [];
    let depth = 0;
    let current = '';
    for (let i = 0; i < shadowStr.length; i++) {
      const ch = shadowStr[i];
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim()) result.push(current.trim());
    return result;
  }

  // ── Border Parsing ───────────────────────────────────────

  function parseBorder(styles) {
    const strokes = [];
    const sides = ['Top', 'Right', 'Bottom', 'Left'];

    // Check if all sides are the same
    const widths = sides.map(s => parseFloat(styles[`border${s}Width`]) || 0);
    const colors = sides.map(s => parseColor(styles[`border${s}Color`]));
    const borderStyles = sides.map(s => styles[`border${s}Style`]);

    // Use the top border as representative if all are the same
    const allSame = widths.every(w => w === widths[0]) &&
                    borderStyles.every(s => s === borderStyles[0]);

    if (widths[0] > 0 && borderStyles[0] !== 'none' && colors[0]) {
      return {
        strokes: [{ type: 'SOLID', color: colors[0] }],
        strokeWeight: widths[0],
        strokeAlign: 'INSIDE',
        individualWidths: allSame ? null : {
          top: widths[0], right: widths[1], bottom: widths[2], left: widths[3]
        }
      };
    }

    return null;
  }

  // ── Border Radius Parsing ────────────────────────────────

  function parseBorderRadius(styles) {
    return {
      topLeft: parseFloat(styles.borderTopLeftRadius) || 0,
      topRight: parseFloat(styles.borderTopRightRadius) || 0,
      bottomRight: parseFloat(styles.borderBottomRightRadius) || 0,
      bottomLeft: parseFloat(styles.borderBottomLeftRadius) || 0
    };
  }

  // ── Font Weight to Style Name ────────────────────────────

  function fontWeightToStyle(weight, fontStyle) {
    const w = parseInt(weight) || 400;
    const isItalic = fontStyle === 'italic';

    const weightMap = {
      100: 'Thin',
      200: 'ExtraLight',
      300: 'Light',
      400: 'Regular',
      500: 'Medium',
      600: 'SemiBold',
      700: 'Bold',
      800: 'ExtraBold',
      900: 'Black'
    };

    const name = weightMap[w] || 'Regular';
    return isItalic ? `${name} Italic` : name;
  }

  // ── Font Family Parsing ──────────────────────────────────

  function parseFontFamily(cssFontFamily) {
    if (!cssFontFamily) return 'Inter';

    // Take the first font family, strip quotes
    const first = cssFontFamily.split(',')[0].trim().replace(/["']/g, '');

    // Map common system/generic fonts
    const systemFontMap = {
      '-apple-system': 'SF Pro Text',
      'BlinkMacSystemFont': 'SF Pro Text',
      'system-ui': 'SF Pro Text',
      'Segoe UI': 'Inter',
      'sans-serif': 'Inter',
      'serif': 'Georgia',
      'monospace': 'SF Mono',
      'Helvetica Neue': 'Helvetica Neue',
      'Helvetica': 'Helvetica',
      'Arial': 'Arial'
    };

    return systemFontMap[first] || first;
  }

  // ── Line Height Parsing ──────────────────────────────────

  function parseLineHeight(cssLineHeight, fontSize) {
    if (!cssLineHeight || cssLineHeight === 'normal') {
      return { value: 120, unit: 'PERCENT' };
    }

    const px = parseFloat(cssLineHeight);
    if (!isNaN(px) && cssLineHeight.includes('px')) {
      return { value: px, unit: 'PIXELS' };
    }

    // If it's a unitless number, it's a multiplier
    const multiplier = parseFloat(cssLineHeight);
    if (!isNaN(multiplier)) {
      return { value: multiplier * 100, unit: 'PERCENT' };
    }

    return { value: 120, unit: 'PERCENT' };
  }

  // ── Layout Mapping ───────────────────────────────────────

  function parseAutoLayout(styles) {
    if (styles.display !== 'flex' && styles.display !== 'inline-flex') {
      return null;
    }

    const layout = {
      layoutMode: styles.flexDirection === 'column' ? 'VERTICAL' : 'HORIZONTAL',
      paddingTop: parseFloat(styles.paddingTop) || 0,
      paddingRight: parseFloat(styles.paddingRight) || 0,
      paddingBottom: parseFloat(styles.paddingBottom) || 0,
      paddingLeft: parseFloat(styles.paddingLeft) || 0,
      itemSpacing: parseFloat(styles.gap) || 0,
      primaryAxisAlignItems: mapJustifyContent(styles.justifyContent),
      counterAxisAlignItems: mapAlignItems(styles.alignItems)
    };

    return layout;
  }

  function mapJustifyContent(val) {
    const map = {
      'flex-start': 'MIN',
      'start': 'MIN',
      'center': 'CENTER',
      'flex-end': 'MAX',
      'end': 'MAX',
      'space-between': 'SPACE_BETWEEN'
    };
    return map[val] || 'MIN';
  }

  function mapAlignItems(val) {
    const map = {
      'flex-start': 'MIN',
      'start': 'MIN',
      'center': 'CENTER',
      'flex-end': 'MAX',
      'end': 'MAX',
      'stretch': 'MIN' // Figma handles stretch differently
    };
    return map[val] || 'MIN';
  }

  // ── Gradient Parsing ─────────────────────────────────────

  function parseGradient(cssGradient) {
    if (!cssGradient || !cssGradient.includes('gradient')) return null;

    const linearMatch = cssGradient.match(/linear-gradient\(([^)]+)\)/);
    if (!linearMatch) return null;

    const parts = splitShadows(linearMatch[1]); // reuse comma splitter
    let angle = 180; // default top-to-bottom
    let colorStopStart = 0;

    // Check if first part is an angle
    const angleMatch = parts[0].match(/([\d.]+)deg/);
    if (angleMatch) {
      angle = parseFloat(angleMatch[1]);
      colorStopStart = 1;
    } else if (parts[0].startsWith('to ')) {
      const dirMap = {
        'to top': 0, 'to right': 90, 'to bottom': 180, 'to left': 270,
        'to top right': 45, 'to bottom right': 135, 'to bottom left': 225, 'to top left': 315
      };
      angle = dirMap[parts[0].trim()] || 180;
      colorStopStart = 1;
    }

    const stops = [];
    for (let i = colorStopStart; i < parts.length; i++) {
      const part = parts[i].trim();
      const colorMatch = part.match(/rgba?\([^)]+\)|#[0-9a-f]{3,8}/i);
      const posMatch = part.match(/([\d.]+)%/);

      if (colorMatch) {
        stops.push({
          color: parseColor(colorMatch[0]),
          position: posMatch ? parseFloat(posMatch[1]) / 100 : i / (parts.length - colorStopStart - 1) || 0
        });
      }
    }

    if (stops.length < 2) return null;

    // Convert angle to Figma gradient handle positions
    const radians = (angle - 90) * (Math.PI / 180);
    return {
      type: 'GRADIENT_LINEAR',
      gradientStops: stops,
      gradientHandlePositions: [
        { x: 0.5 - Math.cos(radians) * 0.5, y: 0.5 - Math.sin(radians) * 0.5 },
        { x: 0.5 + Math.cos(radians) * 0.5, y: 0.5 + Math.sin(radians) * 0.5 }
      ]
    };
  }

  // ── Public API ───────────────────────────────────────────

  return {
    parseColor,
    parseBoxShadow,
    parseBorder,
    parseBorderRadius,
    fontWeightToStyle,
    parseFontFamily,
    parseLineHeight,
    parseAutoLayout,
    parseGradient
  };
})();
