// SNAPPED Figma Plugin — builds pixel-perfect UI from extracted DOM/CSS JSON

figma.showUI(__html__, { width: 360, height: 480 });

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'build') {
    try {
      await buildDesign(msg.data);
    } catch (e) {
      figma.ui.postMessage({ type: 'error', message: e.message || String(e) });
    }
  }
};

// ── Color Parsing ──────────────────────────────────────────

function parseColor(cssColor) {
  if (!cssColor || cssColor === 'transparent' || cssColor === 'none') return null;

  const rgbaMatch = cssColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (rgbaMatch) {
    return {
      r: parseInt(rgbaMatch[1]) / 255,
      g: parseInt(rgbaMatch[2]) / 255,
      b: parseInt(rgbaMatch[3]) / 255,
      a: rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1
    };
  }

  const hexMatch = cssColor.match(/^#([0-9a-f]{3,8})$/i);
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    return {
      r: parseInt(hex.substring(0, 2), 16) / 255,
      g: parseInt(hex.substring(2, 4), 16) / 255,
      b: parseInt(hex.substring(4, 6), 16) / 255,
      a: 1
    };
  }

  return null;
}

function isTransparent(color) {
  return !color || color.a === 0;
}

// ── Shadow Parsing ─────────────────────────────────────────

function parseBoxShadow(cssShadow) {
  if (!cssShadow || cssShadow === 'none') return [];

  const effects = [];
  const shadows = splitValues(cssShadow);

  for (const shadow of shadows) {
    const isInset = shadow.includes('inset');
    const cleaned = shadow.replace('inset', '').trim();

    let colorStr = 'rgba(0,0,0,1)';
    const rgbaMatch = cleaned.match(/rgba?\([^)]+\)/);
    const hexMatch = cleaned.match(/#[0-9a-f]{3,8}/i);
    if (rgbaMatch) colorStr = rgbaMatch[0];
    else if (hexMatch) colorStr = hexMatch[0];

    const nums = cleaned.replace(/rgba?\([^)]+\)/, '').replace(/#[0-9a-f]{3,8}/i, '')
      .trim().split(/\s+/).map(parseFloat).filter(n => !isNaN(n));

    const color = parseColor(colorStr);
    if (!color) continue;

    effects.push({
      type: isInset ? 'INNER_SHADOW' : 'DROP_SHADOW',
      color: { r: color.r, g: color.g, b: color.b, a: color.a },
      offset: { x: nums[0] || 0, y: nums[1] || 0 },
      radius: nums[2] || 0,
      spread: nums[3] || 0,
      visible: true
    });
  }

  return effects;
}

function splitValues(str) {
  const result = [];
  let depth = 0, current = '';
  for (const ch of str) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { result.push(current.trim()); current = ''; }
    else current += ch;
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

// ── Font Mapping ───────────────────────────────────────────

/**
 * Parse CSS font-family into a list of families to try, in order.
 * Returns array of family names — the original font first, then fallbacks.
 */
function parseFontFamilies(css) {
  if (!css) return ['Inter'];

  // Only map generic CSS keywords and system font aliases
  const genericMap = {
    '-apple-system': 'SF Pro Text',
    'BlinkMacSystemFont': 'SF Pro Text',
    'system-ui': 'SF Pro Text',
    'sans-serif': 'Inter',
    'serif': 'Georgia',
    'monospace': 'Roboto Mono'
  };

  // Parse all families from the CSS value
  const families = css.split(',').map(f => f.trim().replace(/["']/g, ''));

  // Build ordered candidate list: original names first, mapped generics, then Inter
  const candidates = [];
  for (const f of families) {
    const mapped = genericMap[f];
    if (mapped) {
      if (!candidates.includes(mapped)) candidates.push(mapped);
    } else if (f && !candidates.includes(f)) {
      candidates.push(f);
    }
  }

  // Always have Inter as ultimate fallback
  if (!candidates.includes('Inter')) candidates.push('Inter');

  return candidates;
}

function fontWeightToStyle(weight, italic) {
  const w = parseInt(weight) || 400;
  const names = {
    100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular',
    500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black'
  };
  const name = names[w] || 'Regular';
  return italic === 'italic' ? name + ' Italic' : name;
}

/**
 * Try to load the exact font. Tries each family from the CSS font-family list,
 * with multiple style name variations, before falling back to Inter.
 */
async function loadFont(families, style) {
  // If families is a string (legacy), convert to array
  if (typeof families === 'string') families = [families, 'Inter'];

  // Style variations to try for each family (fonts name styles inconsistently)
  const styleVariations = [
    style,
    'Regular',
    style.replace('SemiBold', 'Semibold'),
    style.replace('ExtraBold', 'Extrabold'),
    style.replace('ExtraLight', 'Extralight'),
    'Medium',
    'Book',
    'Roman'
  ];
  // Deduplicate
  const uniqueStyles = [...new Set(styleVariations)];

  for (const family of families) {
    for (const s of uniqueStyles) {
      try {
        const font = { family, style: s };
        await figma.loadFontAsync(font);
        return font;
      } catch (e) {
        // try next
      }
    }
  }

  // Ultimate fallback
  const fallback = { family: 'Inter', style: 'Regular' };
  await figma.loadFontAsync(fallback);
  return fallback;
}

// ── Main Build Function ────────────────────────────────────

async function buildDesign(data) {
  const { sourceUrl, pageTitle, elements } = data;

  // Create a top-level frame for the entire capture
  const rootFrame = figma.createFrame();
  rootFrame.name = `SNAPPED: ${pageTitle || sourceUrl}`;
  rootFrame.fills = [{ type: 'SOLID', color: { r: 0.07, g: 0.07, b: 0.11 } }];

  // Calculate total bounds across all elements
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const el of elements) {
    if (el.bounds.width === 0 && el.bounds.height === 0) continue;
    minX = Math.min(minX, el.bounds.x);
    minY = Math.min(minY, el.bounds.y);
    maxX = Math.max(maxX, el.bounds.x + el.bounds.width);
    maxY = Math.max(maxY, el.bounds.y + el.bounds.height);
  }

  const padding = 40;
  const totalW = (maxX - minX) + padding * 2;
  const totalH = (maxY - minY) + padding * 2 + 60; // extra for URL label
  rootFrame.resize(Math.max(totalW, 400), Math.max(totalH, 200));

  figma.ui.postMessage({ type: 'progress', message: 'Building nodes...' });

  let builtCount = 0;
  for (const el of elements) {
    if (el.bounds.width === 0 && el.bounds.height === 0) continue;
    const node = await buildNode(el, minX - padding, minY - padding);
    if (node) {
      rootFrame.appendChild(node);
      builtCount++;
    }
    figma.ui.postMessage({ type: 'progress', message: `Built ${builtCount} top-level element(s)...` });
  }

  // Add source URL label at the bottom
  const urlFont = await loadFont('Inter', 'Regular');
  const urlText = figma.createText();
  urlText.fontName = urlFont;
  urlText.characters = '🔗 ' + sourceUrl;
  urlText.fontSize = 12;
  urlText.fills = [{ type: 'SOLID', color: { r: 0.5, g: 0.5, b: 0.5 } }];
  urlText.x = padding;
  urlText.y = totalH - 50;
  rootFrame.appendChild(urlText);

  // Position on canvas and zoom to it
  rootFrame.x = Math.round(figma.viewport.center.x - totalW / 2);
  rootFrame.y = Math.round(figma.viewport.center.y - totalH / 2);
  figma.viewport.scrollAndZoomIntoView([rootFrame]);

  figma.ui.postMessage({
    type: 'done',
    count: builtCount,
    sourceUrl: sourceUrl
  });
}

// ── Recursive Node Builder ─────────────────────────────────

async function buildNode(node, offsetX, offsetY) {
  if (!node) return null;

  const s = node.computedStyles;
  const b = node.bounds;
  const w = Math.max(b.width, 1);
  const h = Math.max(b.height, 1);
  const x = b.x - offsetX;
  const y = b.y - offsetY;

  // Skip zero-size nodes
  if (b.width === 0 && b.height === 0) return null;

  // Handle SVG
  if (node.svgContent) {
    try {
      const svgNode = figma.createNodeFromSvg(node.svgContent);
      svgNode.x = x;
      svgNode.y = y;
      svgNode.resize(w, h);
      svgNode.name = node.tag;
      return svgNode;
    } catch (e) {
      // Fall through to rectangle
    }
  }

  // Handle <img> tags — render as rectangle with image fill
  if (node.tag === 'img' && node.images && node.images.length > 0) {
    const imgData = node.images[0];
    const imgSrc = imgData.src || imgData.url;
    if (imgSrc) {
      try {
        const imgNode = await buildImageNode(imgSrc, x, y, w, h, s);
        if (imgNode) return imgNode;
      } catch (e) {
        // Fall through to frame
      }
    }
  }

  // Determine if this is a text-only node
  const isTextNode = node.textContent && node.children.length === 0;

  if (isTextNode) {
    return await buildTextNode(node, x, y, w, h);
  }

  // Create a frame for container nodes
  const frame = figma.createFrame();
  frame.name = node.tag + (node.textContent ? ` "${node.textContent.substring(0, 20)}"` : '');
  frame.x = x;
  frame.y = y;
  frame.resize(w, h);

  // Apply styles
  applyFills(frame, s);
  applyBorder(frame, s);
  applyCornerRadius(frame, s);
  applyEffects(frame, s);
  applyOpacity(frame, s);
  frame.clipsContent = (s.overflow === 'hidden' || s.overflowX === 'hidden' || s.overflowY === 'hidden');

  // Do NOT use auto-layout — we have exact pixel positions from the browser.
  // Auto-layout fights with absolute positioning and causes stacking.

  // Handle background images on frames
  if (node.images && node.images.length > 0) {
    for (const img of node.images) {
      const imgSrc = img.src || img.url;
      if (imgSrc && img.type === 'background') {
        try {
          const image = await figma.createImageAsync(imgSrc);
          frame.fills = [...(frame.fills || []), {
            type: 'IMAGE',
            scaleMode: 'FILL',
            imageHash: image.hash
          }];
        } catch (e) {
          // Image fetch failed, skip
        }
      }
    }
  }

  // If frame has text content AND children, add text as first child
  if (node.textContent && node.children.length > 0) {
    const textChild = await buildTextNode(
      { computedStyles: s, textContent: node.textContent, bounds: { x: 0, y: 0, width: w, height: h } },
      0, 0, w, h
    );
    if (textChild) frame.appendChild(textChild);
  }

  // Build children — position relative to this frame's top-left
  for (const child of node.children) {
    if (!child) continue;
    if (child.bounds.width === 0 && child.bounds.height === 0) continue;

    // Pass parent's absolute position as offset so children are relative to parent
    const childNode = await buildNode(child, b.x, b.y);
    if (childNode) {
      frame.appendChild(childNode);
    }
  }

  return frame;
}

// ── Text Node Builder ──────────────────────────────────────

async function buildTextNode(node, x, y, w, h) {
  const s = node.computedStyles;
  const text = node.textContent;
  if (!text) return null;

  const families = parseFontFamilies(s.fontFamily);
  const style = fontWeightToStyle(s.fontWeight, s.fontStyle);
  const loadedFont = await loadFont(families, style);

  const textNode = figma.createText();
  textNode.fontName = loadedFont;
  textNode.characters = text;
  textNode.x = x;
  textNode.y = y;

  // Font size
  const fontSize = parseFloat(s.fontSize) || 14;
  textNode.fontSize = fontSize;

  // Text color
  const color = parseColor(s.color);
  if (color) {
    textNode.fills = [{ type: 'SOLID', color: { r: color.r, g: color.g, b: color.b } }];
    if (color.a < 1) textNode.opacity = color.a;
  }

  // Line height
  if (s.lineHeight && s.lineHeight !== 'normal') {
    const lh = parseFloat(s.lineHeight);
    if (!isNaN(lh)) {
      textNode.lineHeight = { value: lh, unit: 'PIXELS' };
    }
  }

  // Letter spacing
  if (s.letterSpacing && s.letterSpacing !== 'normal') {
    const ls = parseFloat(s.letterSpacing);
    if (!isNaN(ls)) {
      textNode.letterSpacing = { value: ls, unit: 'PIXELS' };
    }
  }

  // Text align
  const alignMap = { left: 'LEFT', center: 'CENTER', right: 'RIGHT', justify: 'JUSTIFIED', start: 'LEFT', end: 'RIGHT' };
  textNode.textAlignHorizontal = alignMap[s.textAlign] || 'LEFT';

  // Text decoration
  if (s.textDecoration) {
    if (s.textDecoration.includes('underline')) textNode.textDecoration = 'UNDERLINE';
    else if (s.textDecoration.includes('line-through')) textNode.textDecoration = 'STRIKETHROUGH';
  }

  // Text transform — apply to the actual string
  if (s.textTransform === 'uppercase') {
    textNode.characters = text.toUpperCase();
  } else if (s.textTransform === 'lowercase') {
    textNode.characters = text.toLowerCase();
  } else if (s.textTransform === 'capitalize') {
    textNode.characters = text.replace(/\b\w/g, c => c.toUpperCase());
  }

  // Resize to width constraint
  if (w > 0) {
    textNode.resize(w, Math.max(h, fontSize * 1.5));
    textNode.textAutoResize = 'HEIGHT';
  }

  textNode.name = 'text: "' + text.substring(0, 30) + '"';

  return textNode;
}

// ── Image Node Builder ─────────────────────────────────────

async function buildImageNode(src, x, y, w, h, s) {
  try {
    const image = await figma.createImageAsync(src);
    const rect = figma.createRectangle();
    rect.name = 'img';
    rect.x = x;
    rect.y = y;
    rect.resize(w, h);
    rect.fills = [{
      type: 'IMAGE',
      scaleMode: 'FILL',
      imageHash: image.hash
    }];

    // Apply corner radius (for rounded avatars)
    if (s) {
      const tl = parseFloat(s.borderTopLeftRadius) || 0;
      const tr = parseFloat(s.borderTopRightRadius) || 0;
      const br = parseFloat(s.borderBottomRightRadius) || 0;
      const bl = parseFloat(s.borderBottomLeftRadius) || 0;
      if (tl === tr && tr === br && br === bl) {
        rect.cornerRadius = tl;
      } else {
        rect.topLeftRadius = tl;
        rect.topRightRadius = tr;
        rect.bottomRightRadius = br;
        rect.bottomLeftRadius = bl;
      }
    }

    return rect;
  } catch (e) {
    // If image can't be fetched, create a placeholder
    const rect = figma.createRectangle();
    rect.name = 'img (failed to load)';
    rect.x = x;
    rect.y = y;
    rect.resize(w, h);
    rect.fills = [{ type: 'SOLID', color: { r: 0.85, g: 0.85, b: 0.85 } }];
    return rect;
  }
}

// ── Style Application ──────────────────────────────────────

function applyFills(node, s) {
  const fills = [];

  // Background gradient
  if (s.backgroundImage && s.backgroundImage.includes('gradient')) {
    const gradient = parseGradient(s.backgroundImage);
    if (gradient) fills.push(gradient);
  }

  // Background color
  const bgColor = parseColor(s.backgroundColor);
  if (bgColor && !isTransparent(bgColor)) {
    fills.push({
      type: 'SOLID',
      color: { r: bgColor.r, g: bgColor.g, b: bgColor.b },
      opacity: bgColor.a
    });
  }

  if (fills.length > 0) {
    node.fills = fills;
  } else {
    node.fills = [];
  }
}

function applyBorder(node, s) {
  const sides = ['Top', 'Right', 'Bottom', 'Left'];
  const widths = sides.map(side => parseFloat(s[`border${side}Width`]) || 0);
  const colors = sides.map(side => parseColor(s[`border${side}Color`]));
  const styles = sides.map(side => s[`border${side}Style`]);

  // Find the first side that has a visible border
  let strokeColor = null;
  let strokeWeight = 0;
  let hasIndividualBorders = false;

  for (let i = 0; i < 4; i++) {
    if (widths[i] > 0 && styles[i] !== 'none' && colors[i] && !isTransparent(colors[i])) {
      if (!strokeColor) {
        strokeColor = colors[i];
        strokeWeight = widths[i];
      }
      hasIndividualBorders = true;
    }
  }

  if (strokeColor) {
    node.strokes = [{
      type: 'SOLID',
      color: { r: strokeColor.r, g: strokeColor.g, b: strokeColor.b },
      opacity: strokeColor.a
    }];
    node.strokeAlign = 'INSIDE';

    // If borders differ per side, use individual stroke weights
    const allSame = widths.every(w => w === widths[0]);
    if (!allSame && 'strokeTopWeight' in node) {
      node.strokeTopWeight = widths[0];
      node.strokeRightWeight = widths[1];
      node.strokeBottomWeight = widths[2];
      node.strokeLeftWeight = widths[3];
    } else {
      node.strokeWeight = strokeWeight;
    }
  }
}

function applyCornerRadius(node, s) {
  const tl = parseFloat(s.borderTopLeftRadius) || 0;
  const tr = parseFloat(s.borderTopRightRadius) || 0;
  const br = parseFloat(s.borderBottomRightRadius) || 0;
  const bl = parseFloat(s.borderBottomLeftRadius) || 0;

  if (tl === tr && tr === br && br === bl) {
    node.cornerRadius = tl;
  } else {
    node.topLeftRadius = tl;
    node.topRightRadius = tr;
    node.bottomRightRadius = br;
    node.bottomLeftRadius = bl;
  }
}

function applyEffects(node, s) {
  const effects = parseBoxShadow(s.boxShadow);
  if (effects.length > 0) {
    node.effects = effects;
  }
}

function applyOpacity(node, s) {
  const opacity = parseFloat(s.opacity);
  if (!isNaN(opacity) && opacity < 1) {
    node.opacity = opacity;
  }
}

function applyAutoLayout(frame, s) {
  frame.layoutMode = s.flexDirection === 'column' ? 'VERTICAL' : 'HORIZONTAL';
  frame.primaryAxisSizingMode = 'FIXED';
  frame.counterAxisSizingMode = 'FIXED';

  frame.paddingTop = parseFloat(s.paddingTop) || 0;
  frame.paddingRight = parseFloat(s.paddingRight) || 0;
  frame.paddingBottom = parseFloat(s.paddingBottom) || 0;
  frame.paddingLeft = parseFloat(s.paddingLeft) || 0;

  const gap = parseFloat(s.gap);
  if (!isNaN(gap) && gap > 0) {
    frame.itemSpacing = gap;
  }

  // Primary axis alignment
  const justifyMap = {
    'flex-start': 'MIN', 'start': 'MIN', 'center': 'CENTER',
    'flex-end': 'MAX', 'end': 'MAX', 'space-between': 'SPACE_BETWEEN'
  };
  frame.primaryAxisAlignItems = justifyMap[s.justifyContent] || 'MIN';

  // Counter axis alignment
  const alignMap = {
    'flex-start': 'MIN', 'start': 'MIN', 'center': 'CENTER',
    'flex-end': 'MAX', 'end': 'MAX', 'stretch': 'MIN'
  };
  frame.counterAxisAlignItems = alignMap[s.alignItems] || 'MIN';
}

// ── Gradient Parsing ───────────────────────────────────────

function parseGradient(css) {
  const linearMatch = css.match(/linear-gradient\((.+)\)/);
  if (!linearMatch) return null;

  const parts = splitValues(linearMatch[1]);
  let angle = 180;
  let colorStart = 0;

  const angleMatch = parts[0].match(/([\d.]+)deg/);
  if (angleMatch) { angle = parseFloat(angleMatch[1]); colorStart = 1; }
  else if (parts[0].startsWith('to ')) {
    const dirMap = { 'to top': 0, 'to right': 90, 'to bottom': 180, 'to left': 270 };
    angle = dirMap[parts[0].trim()] || 180;
    colorStart = 1;
  }

  const stops = [];
  for (let i = colorStart; i < parts.length; i++) {
    const colorMatch = parts[i].match(/rgba?\([^)]+\)|#[0-9a-f]{3,8}/i);
    const posMatch = parts[i].match(/([\d.]+)%/);
    if (colorMatch) {
      const c = parseColor(colorMatch[0]);
      if (c) {
        stops.push({
          color: { r: c.r, g: c.g, b: c.b, a: c.a },
          position: posMatch ? parseFloat(posMatch[1]) / 100 : i / Math.max(parts.length - colorStart - 1, 1)
        });
      }
    }
  }

  if (stops.length < 2) return null;

  const rad = (angle - 90) * (Math.PI / 180);
  return {
    type: 'GRADIENT_LINEAR',
    gradientTransform: [
      [Math.cos(rad), Math.sin(rad), 0.5 - Math.cos(rad) * 0.5 - Math.sin(rad) * 0.5],
      [-Math.sin(rad), Math.cos(rad), 0.5 + Math.sin(rad) * 0.5 - Math.cos(rad) * 0.5]
    ],
    gradientStops: stops
  };
}
