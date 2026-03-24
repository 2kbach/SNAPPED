/**
 * SNAPPED - Content Script
 * Handles element selection UI: hover highlight, click-to-select, multi-select.
 */

(function() {
  'use strict';

  // Prevent double-injection
  if (window.__snappedContentLoaded) return;
  window.__snappedContentLoaded = true;

  let isSelecting = false;
  let selectedElements = [];
  let hoveredElement = null;
  let tooltip = null;
  let statusBar = null;

  // ── Tooltip ──────────────────────────────────────────────

  function createTooltip() {
    tooltip = document.createElement('div');
    tooltip.className = 'snapped-tooltip';
    tooltip.style.display = 'none';
    document.body.appendChild(tooltip);
  }

  function updateTooltip(el, e) {
    if (!tooltip) return;
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : '';
    const classes = el.classList.length > 0
      ? '.' + Array.from(el.classList).filter(c => !c.startsWith('snapped-')).slice(0, 3).join('.')
      : '';
    const rect = el.getBoundingClientRect();
    const size = `${Math.round(rect.width)}x${Math.round(rect.height)}`;

    tooltip.textContent = `${tag}${id}${classes}  ${size}`;
    tooltip.style.display = 'block';

    // Position tooltip near cursor but keep it on screen
    let x = e.clientX + 12;
    let y = e.clientY + 12;
    const tooltipRect = tooltip.getBoundingClientRect();
    if (x + tooltipRect.width > window.innerWidth) x = e.clientX - tooltipRect.width - 8;
    if (y + tooltipRect.height > window.innerHeight) y = e.clientY - tooltipRect.height - 8;
    tooltip.style.left = x + 'px';
    tooltip.style.top = y + 'px';
  }

  function hideTooltip() {
    if (tooltip) tooltip.style.display = 'none';
  }

  // ── Status Bar ───────────────────────────────────────────

  function createStatusBar() {
    statusBar = document.createElement('div');
    statusBar.className = 'snapped-status-bar';
    updateStatusBar();
    document.body.appendChild(statusBar);
  }

  function updateStatusBar() {
    if (!statusBar) return;
    const count = selectedElements.length;
    statusBar.innerHTML = `
      <span class="snapped-label">SNAPPED</span>
      <span class="snapped-separator"></span>
      <span class="snapped-hint">Click to select</span>
      <kbd>⇧</kbd><span class="snapped-hint">multi</span>
      <kbd>⎋</kbd><span class="snapped-hint">cancel</span>
      <span class="snapped-count">${count}</span>
      ${count > 0 ? '<button id="snapped-done-btn">Done</button>' : ''}
    `;

    const doneBtn = statusBar.querySelector('#snapped-done-btn');
    if (doneBtn) {
      doneBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        finishSelection();
      });
    }
  }

  function removeStatusBar() {
    if (statusBar) { statusBar.remove(); statusBar = null; }
  }

  // ── Selection Logic ──────────────────────────────────────

  function isSnappedUI(el) {
    if (!el) return false;
    return el.closest('.snapped-tooltip, .snapped-status-bar') !== null;
  }

  function onMouseMove(e) {
    if (!isSelecting) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || isSnappedUI(el) || el === document.body || el === document.documentElement) {
      clearHover();
      return;
    }

    if (hoveredElement !== el) {
      clearHover();
      hoveredElement = el;
      if (!selectedElements.includes(el)) {
        el.classList.add('snapped-hover-outline');
      }
    }
    updateTooltip(el, e);
  }

  function clearHover() {
    if (hoveredElement) {
      hoveredElement.classList.remove('snapped-hover-outline');
      hoveredElement = null;
    }
    hideTooltip();
  }

  function onClick(e) {
    if (!isSelecting) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || isSnappedUI(el)) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    if (e.shiftKey) {
      // Toggle selection
      const idx = selectedElements.indexOf(el);
      if (idx >= 0) {
        selectedElements.splice(idx, 1);
        el.classList.remove('snapped-selected-outline');
      } else {
        selectedElements.push(el);
        el.classList.add('snapped-selected-outline');
        el.classList.remove('snapped-hover-outline');
      }
    } else {
      // Single select (clear previous)
      clearAllSelections();
      selectedElements = [el];
      el.classList.add('snapped-selected-outline');
      el.classList.remove('snapped-hover-outline');
    }

    updateStatusBar();
  }

  function onKeyDown(e) {
    if (!isSelecting) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelSelection();
    }
  }

  function clearAllSelections() {
    selectedElements.forEach(el => el.classList.remove('snapped-selected-outline'));
    selectedElements = [];
  }

  // ── Start / Stop Selection ───────────────────────────────

  function startSelection() {
    if (isSelecting) return;
    isSelecting = true;
    selectedElements = [];

    createTooltip();
    createStatusBar();

    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
  }

  function cancelSelection() {
    clearHover();
    clearAllSelections();
    cleanup();
    browser.runtime.sendMessage({ type: 'selectionCancelled' });
  }

  async function finishSelection() {
    if (selectedElements.length === 0) {
      cancelSelection();
      return;
    }

    // Detect browser zoom level
    const zoomFactor = SnappedExtractor.detectZoom();

    // Calculate a shared root offset from ALL selected elements
    const sourceUrl = window.location.href;
    let minX = Infinity, minY = Infinity;
    for (const el of selectedElements) {
      const rect = el.getBoundingClientRect();
      minX = Math.min(minX, rect.left / zoomFactor);
      minY = Math.min(minY, rect.top / zoomFactor);
    }
    const sharedOffset = { x: minX, y: minY };

    // Extract DOM data using the shared offset
    const extractions = selectedElements.map(el => {
      return SnappedExtractor.extractWithOffset(el, sourceUrl, sharedOffset, zoomFactor);
    });

    clearHover();
    clearAllSelections();
    cleanup();

    // Extract and download ALL fonts on the page
    const fonts = await SnappedExtractor.extractAllFonts();

    const payload = {
      sourceUrl: sourceUrl,
      pageTitle: document.title,
      elements: extractions,
      fonts: fonts,
      timestamp: new Date().toISOString()
    };

    // Auto-save JSON file via download link
    saveJsonFile(payload);

    // Send extracted data to background/popup
    browser.runtime.sendMessage({
      type: 'selectionComplete',
      data: payload
    });
  }

  function saveJsonFile(data) {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'snapped-latest.json';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  function cleanup() {
    isSelecting = false;
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
    if (tooltip) { tooltip.remove(); tooltip = null; }
    removeStatusBar();
  }

  // ── Message Handling ─────────────────────────────────────

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'startSelection') {
      startSelection();
      sendResponse({ ok: true });
    } else if (message.type === 'cancelSelection') {
      cancelSelection();
      sendResponse({ ok: true });
    }
  });
})();
