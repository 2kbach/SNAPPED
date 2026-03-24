/**
 * SNAPPED - DOM Extractor
 * Recursively extracts computed styles and DOM structure from selected elements.
 */

const SnappedExtractor = (function() {
  'use strict';

  // CSS properties we care about
  const STYLE_PROPERTIES = [
    'backgroundColor', 'backgroundImage', 'backgroundSize', 'backgroundPosition',
    'color', 'opacity',
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle',
    'lineHeight', 'letterSpacing', 'textAlign', 'textDecoration', 'textTransform',
    'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
    'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle',
    'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius',
    'boxShadow',
    'display', 'flexDirection', 'justifyContent', 'alignItems', 'flexWrap', 'gap',
    'position', 'top', 'left', 'right', 'bottom',
    'overflow', 'overflowX', 'overflowY',
    'zIndex', 'visibility',
    'boxSizing'
  ];

  // Max depth to prevent infinite recursion
  const MAX_DEPTH = 15;

  /**
   * Extract a DOM element and all its children into a serializable structure
   */
  function extract(element, sourceUrl) {
    const rootRect = element.getBoundingClientRect();
    const rootOffset = { x: rootRect.left, y: rootRect.top };
    return walkNode(element, rootOffset, 0);
  }

  /**
   * Extract using a shared offset (so multiple elements keep correct relative positions)
   */
  function extractWithOffset(element, sourceUrl, sharedOffset, zoomFactor) {
    return walkNode(element, sharedOffset, 0, zoomFactor || 1);
  }

  /**
   * Detect browser zoom level by comparing getBoundingClientRect to offsetWidth
   */
  function detectZoom() {
    const testEl = document.documentElement;
    const rect = testEl.getBoundingClientRect();
    const offsetW = testEl.offsetWidth;
    if (offsetW > 0 && rect.width > 0) {
      return rect.width / offsetW;
    }
    return 1;
  }

  function walkNode(element, rootOffset, depth, zoomFactor) {
    if (depth > MAX_DEPTH) return null;
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;

    // Skip SNAPPED's own UI elements
    if (element.classList && (
      element.classList.contains('snapped-tooltip') ||
      element.classList.contains('snapped-status-bar')
    )) return null;

    const rect = element.getBoundingClientRect();
    const computed = window.getComputedStyle(element);
    const z = zoomFactor || 1;

    // Skip invisible elements with no dimensions
    if (rect.width === 0 && rect.height === 0 && computed.overflow === 'hidden') {
      return null;
    }

    const node = {
      tag: element.tagName.toLowerCase(),
      bounds: {
        x: (rect.left / z) - rootOffset.x,
        y: (rect.top / z) - rootOffset.y,
        width: rect.width / z,
        height: rect.height / z
      },
      computedStyles: extractStyles(computed),
      children: [],
      images: [],
      textContent: null,
      svgContent: null
    };

    // Handle SVG elements
    if (element.tagName.toLowerCase() === 'svg') {
      node.svgContent = element.outerHTML;
      return node; // Don't recurse into SVG children
    }

    // Handle img elements
    if (element.tagName.toLowerCase() === 'img') {
      const src = element.src || element.currentSrc;
      if (src) {
        node.images.push({
          type: 'img',
          src: src,
          width: element.naturalWidth || rect.width,
          height: element.naturalHeight || rect.height
        });
      }
    }

    // Handle background images
    const bgImage = computed.backgroundImage;
    if (bgImage && bgImage !== 'none') {
      const urlMatch = bgImage.match(/url\(["']?(.*?)["']?\)/);
      if (urlMatch) {
        node.images.push({
          type: 'background',
          url: urlMatch[1],
          size: computed.backgroundSize,
          position: computed.backgroundPosition
        });
      }
    }

    // Handle pseudo-elements
    const beforeStyles = extractPseudoElement(element, '::before', rootOffset, rect, z);
    const afterStyles = extractPseudoElement(element, '::after', rootOffset, rect, z);
    if (beforeStyles) node.children.push(beforeStyles);

    // Extract child nodes
    const childNodes = element.childNodes;
    for (let i = 0; i < childNodes.length; i++) {
      const child = childNodes[i];

      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent.trim();
        if (text) {
          // If this is a direct text child within an element with other children,
          // wrap it as a text span node
          if (childNodes.length === 1 || (childNodes.length <= 3 && !hasElementChildren(element))) {
            node.textContent = text;
            // Capture precise text bounds (not element bounds) for accurate positioning
            node.textBounds = getTextBounds(child, rootOffset, z);
          } else {
            // Create a synthetic text node
            node.children.push({
              tag: '#text',
              bounds: getTextBounds(child, rootOffset, z),
              computedStyles: extractStyles(computed),
              children: [],
              images: [],
              textContent: text,
              svgContent: null
            });
          }
        }
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const childNode = walkNode(child, rootOffset, depth + 1, zoomFactor);
        if (childNode) {
          node.children.push(childNode);
        }
      }
    }

    if (afterStyles) node.children.push(afterStyles);

    return node;
  }

  function hasElementChildren(el) {
    for (let i = 0; i < el.childNodes.length; i++) {
      if (el.childNodes[i].nodeType === Node.ELEMENT_NODE) return true;
    }
    return false;
  }

  function extractStyles(computed) {
    const styles = {};
    for (const prop of STYLE_PROPERTIES) {
      styles[prop] = computed[prop];
    }
    return styles;
  }

  function extractPseudoElement(element, pseudo, rootOffset, parentRect, zoomFactor) {
    const computed = window.getComputedStyle(element, pseudo);
    const content = computed.content;
    const display = computed.display;

    // Skip if truly no pseudo-element (content must be set for it to render)
    if (!content || content === 'none') {
      return null;
    }

    // For empty content pseudo-elements (content: ""), check if they have
    // visible styles (background, border, dimensions) — these are decorative elements
    // like divider lines, overlays, etc.
    const isEmptyContent = content === '""' || content === "''";
    if (isEmptyContent && display === 'none') {
      return null;
    }
    if (isEmptyContent) {
      const bg = computed.backgroundColor;
      const bgImg = computed.backgroundImage;
      const w = parseFloat(computed.width) || 0;
      const h = parseFloat(computed.height) || 0;
      const hasBorder = parseFloat(computed.borderTopWidth) > 0 ||
                        parseFloat(computed.borderBottomWidth) > 0;
      const hasBackground = bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
      const hasBackgroundImage = bgImg && bgImg !== 'none';

      // Skip if the pseudo-element has no visible rendering
      if (!hasBackground && !hasBackgroundImage && !hasBorder && (w === 0 || h === 0)) {
        return null;
      }
    }

    // Clean content string (remove quotes)
    let textContent = isEmptyContent ? null : content.replace(/^["']|["']$/g, '');
    if (textContent === '') textContent = null;

    const z = zoomFactor || 1;
    return {
      tag: pseudo,
      bounds: {
        x: (parentRect.left / z) - rootOffset.x,
        y: (parentRect.top / z) - rootOffset.y,
        width: (parseFloat(computed.width) || 0) / z,
        height: (parseFloat(computed.height) || 0) / z
      },
      computedStyles: extractStyles(computed),
      children: [],
      images: [],
      textContent: textContent,
      svgContent: null
    };
  }

  function getTextBounds(textNode, rootOffset, z) {
    z = z || 1;
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const rect = range.getBoundingClientRect();
    return {
      x: (rect.left / z) - rootOffset.x,
      y: (rect.top / z) - rootOffset.y,
      width: rect.width / z,
      height: rect.height / z
    };
  }

  // Convert an image element's src to a base64 data URL (for cross-origin safety)
  function imageToBase64(imgElement) {
    return new Promise((resolve) => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = imgElement.naturalWidth || imgElement.width;
        canvas.height = imgElement.naturalHeight || imgElement.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(imgElement, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      } catch (e) {
        // CORS or other error, return original src
        resolve(imgElement.src);
      }
    });
  }

  /**
   * Extract @font-face declarations using multiple strategies:
   * 1. document.styleSheets API (fails on cross-origin)
   * 2. Fetch cross-origin stylesheet text and parse manually
   * 3. document.fonts API for loaded font metadata
   */
  async function extractFonts() {
    const fonts = [];
    const seen = new Set();

    // Strategy 1: Read same-origin stylesheets via CSSOM
    try {
      for (const sheet of document.styleSheets) {
        try {
          const rules = sheet.cssRules || sheet.rules;
          if (!rules) continue;
          for (const rule of rules) {
            if (rule instanceof CSSFontFaceRule || (rule.type === 5)) {
              const font = parseFontFaceRule(rule.cssText);
              if (font && !seen.has(font.key)) {
                seen.add(font.key);
                fonts.push(font);
              }
            }
          }
        } catch (e) {
          // Cross-origin — try Strategy 2
          if (sheet.href) {
            try {
              const resp = await fetch(sheet.href);
              const cssText = await resp.text();
              const parsed = parseFontFacesFromCSS(cssText, sheet.href);
              for (const font of parsed) {
                if (!seen.has(font.key)) {
                  seen.add(font.key);
                  fonts.push(font);
                }
              }
            } catch (e2) {
              // Fetch also failed, skip
            }
          }
        }
      }
    } catch (e) {}

    // Strategy 3: Check inline <style> tags
    const styleTags = document.querySelectorAll('style');
    for (const tag of styleTags) {
      const parsed = parseFontFacesFromCSS(tag.textContent, window.location.href);
      for (const font of parsed) {
        if (!seen.has(font.key)) {
          seen.add(font.key);
          fonts.push(font);
        }
      }
    }

    return fonts;
  }

  /**
   * Parse @font-face blocks from raw CSS text
   */
  function parseFontFacesFromCSS(cssText, baseUrl) {
    const fonts = [];
    const regex = /@font-face\s*\{([^}]+)\}/gi;
    let match;

    while ((match = regex.exec(cssText)) !== null) {
      const block = match[1];
      const font = parseFontFaceBlock(block, baseUrl);
      if (font) fonts.push(font);
    }

    return fonts;
  }

  function parseFontFaceBlock(block, baseUrl) {
    const familyMatch = block.match(/font-family\s*:\s*["']?([^"';]+)["']?/i);
    const weightMatch = block.match(/font-weight\s*:\s*(\d+|normal|bold)/i);
    const styleMatch = block.match(/font-style\s*:\s*(\w+)/i);

    // Try woff2 first, then woff, then any url
    let urlMatch = block.match(/url\(["']?([^"')]+\.woff2[^"')]*?)["']?\)/i);
    if (!urlMatch) urlMatch = block.match(/url\(["']?([^"')]+\.woff[^"')]*?)["']?\)/i);
    if (!urlMatch) urlMatch = block.match(/url\(["']?([^"')]+)["']?\)/i);

    if (!familyMatch || !urlMatch) return null;

    let url = urlMatch[1];
    // Resolve relative URLs
    if (url.startsWith('//')) url = 'https:' + url;
    else if (url.startsWith('/')) {
      const origin = new URL(baseUrl).origin;
      url = origin + url;
    } else if (!url.startsWith('http')) {
      const base = baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1);
      url = base + url;
    }

    const family = familyMatch[1].trim();
    const weight = weightMatch ? weightMatch[1] : '400';
    const style = styleMatch ? styleMatch[1] : 'normal';
    const format = url.includes('.woff2') ? 'woff2' : (url.includes('.woff') ? 'woff' : 'ttf');

    return {
      family, weight, style, url, format,
      key: `${family}-${weight}-${style}`
    };
  }

  function parseFontFaceRule(cssText) {
    return parseFontFaceBlock(cssText, window.location.href);
  }

  /**
   * Download a font file and return as base64 data URL
   */
  async function downloadFontAsBase64(url) {
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      const blob = await response.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      return null;
    }
  }

  /**
   * Extract fonts used by the selected elements and download them
   */
  async function extractUsedFonts(elements) {
    // Get all font families used in the selected elements
    const usedFamilies = new Set();
    function collectFonts(node) {
      if (!node || !node.computedStyles) return;
      const ff = node.computedStyles.fontFamily;
      if (ff) {
        ff.split(',').forEach(f => {
          const clean = f.trim().replace(/["']/g, '');
          if (clean) usedFamilies.add(clean);
        });
      }
      (node.children || []).forEach(collectFonts);
    }
    elements.forEach(collectFonts);

    // Get all available @font-face declarations
    const allFonts = await extractFonts();

    // Filter to only fonts used in the selection
    const usedFonts = allFonts.filter(f => usedFamilies.has(f.family));

    // Download each font as base64
    const fontsWithData = [];
    for (const font of usedFonts) {
      const dataUrl = await downloadFontAsBase64(font.url);
      if (dataUrl) {
        fontsWithData.push({
          family: font.family,
          weight: font.weight,
          style: font.style,
          format: font.format,
          dataUrl: dataUrl,
          originalUrl: font.url
        });
      }
    }

    return fontsWithData;
  }

  /**
   * Extract ALL fonts on the page (not just ones used in selection)
   */
  async function extractAllFonts() {
    const allFonts = await extractFonts();

    const fontsWithData = [];
    for (const font of allFonts) {
      const dataUrl = await downloadFontAsBase64(font.url);
      if (dataUrl) {
        fontsWithData.push({
          family: font.family,
          weight: font.weight,
          style: font.style,
          format: font.format,
          dataUrl: dataUrl,
          originalUrl: font.url
        });
      }
    }

    return fontsWithData;
  }

  return { extract, extractWithOffset, detectZoom, imageToBase64, extractUsedFonts, extractAllFonts };
})();
