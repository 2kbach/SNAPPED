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

  function walkNode(element, rootOffset, depth) {
    if (depth > MAX_DEPTH) return null;
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;

    // Skip SNAPPED's own UI elements
    if (element.classList && (
      element.classList.contains('snapped-tooltip') ||
      element.classList.contains('snapped-status-bar')
    )) return null;

    const rect = element.getBoundingClientRect();
    const computed = window.getComputedStyle(element);

    // Skip invisible elements with no dimensions
    if (rect.width === 0 && rect.height === 0 && computed.overflow === 'hidden') {
      return null;
    }

    const node = {
      tag: element.tagName.toLowerCase(),
      bounds: {
        x: rect.left - rootOffset.x,
        y: rect.top - rootOffset.y,
        width: rect.width,
        height: rect.height
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
    const beforeStyles = extractPseudoElement(element, '::before', rootOffset, rect);
    const afterStyles = extractPseudoElement(element, '::after', rootOffset, rect);
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
          } else {
            // Create a synthetic text node
            node.children.push({
              tag: '#text',
              bounds: getTextBounds(child, rootOffset),
              computedStyles: extractStyles(computed),
              children: [],
              images: [],
              textContent: text,
              svgContent: null
            });
          }
        }
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const childNode = walkNode(child, rootOffset, depth + 1);
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

  function extractPseudoElement(element, pseudo, rootOffset, parentRect) {
    const computed = window.getComputedStyle(element, pseudo);
    const content = computed.content;

    // Skip if no content or content is "none" / ""
    if (!content || content === 'none' || content === '""' || content === "''") {
      return null;
    }

    // Clean content string (remove quotes)
    let textContent = content.replace(/^["']|["']$/g, '');
    if (textContent === '') textContent = null;

    return {
      tag: pseudo,
      bounds: {
        x: parentRect.left - rootOffset.x,
        y: parentRect.top - rootOffset.y,
        width: parseFloat(computed.width) || 0,
        height: parseFloat(computed.height) || 0
      },
      computedStyles: extractStyles(computed),
      children: [],
      images: [],
      textContent: textContent,
      svgContent: null
    };
  }

  function getTextBounds(textNode, rootOffset) {
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const rect = range.getBoundingClientRect();
    return {
      x: rect.left - rootOffset.x,
      y: rect.top - rootOffset.y,
      width: rect.width,
      height: rect.height
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

  return { extract, imageToBase64 };
})();
