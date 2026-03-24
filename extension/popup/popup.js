/**
 * SNAPPED - Popup Script
 * Controls the extension popup UI and communicates with background/content scripts.
 */

(function() {
  'use strict';

  const stateIdle = document.getElementById('state-idle');
  const stateSelecting = document.getElementById('state-selecting');
  const stateReady = document.getElementById('state-ready');

  const btnStart = document.getElementById('btn-start');
  const btnCopy = document.getElementById('btn-copy');
  const btnReset = document.getElementById('btn-reset');
  const elementCount = document.getElementById('element-count');
  const sourceUrl = document.getElementById('source-url');
  const copySuccess = document.getElementById('copy-success');

  let currentData = null;

  function showState(state) {
    stateIdle.style.display = 'none';
    stateSelecting.style.display = 'none';
    stateReady.style.display = 'none';
    state.style.display = 'block';
  }

  // Check if we already have extracted data
  browser.runtime.sendMessage({ type: 'getExtractedData' }).then(response => {
    if (response && response.data) {
      currentData = response.data;
      showReadyState();
    }
  });

  // Start selection
  btnStart.addEventListener('click', () => {
    browser.runtime.sendMessage({ type: 'startSelection' });
    showState(stateSelecting);
    // Close popup so user can interact with the page
    setTimeout(() => window.close(), 300);
  });

  // Copy to clipboard
  btnCopy.addEventListener('click', async () => {
    if (!currentData) return;

    const json = JSON.stringify(currentData, null, 2);

    try {
      await navigator.clipboard.writeText(json);
      copySuccess.style.display = 'block';
      btnCopy.textContent = 'Copied!';
      setTimeout(() => {
        copySuccess.style.display = 'none';
        btnCopy.textContent = 'Copy to Clipboard';
      }, 2000);
    } catch (e) {
      // Fallback
      const textarea = document.createElement('textarea');
      textarea.value = json;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
      copySuccess.style.display = 'block';
      setTimeout(() => { copySuccess.style.display = 'none'; }, 2000);
    }
  });

  // Reset
  btnReset.addEventListener('click', () => {
    currentData = null;
    browser.runtime.sendMessage({ type: 'clearData' });
    showState(stateIdle);
  });

  // Listen for extraction results
  browser.runtime.onMessage.addListener((message) => {
    if (message.type === 'extractionReady') {
      currentData = message.data;
      showReadyState();
    } else if (message.type === 'selectionCancelled') {
      showState(stateIdle);
    }
  });

  function showReadyState() {
    showState(stateReady);
    const count = currentData.elements ? currentData.elements.length : 0;
    elementCount.textContent = `${count} element${count !== 1 ? 's' : ''} captured`;
    sourceUrl.textContent = currentData.sourceUrl || '';
  }
})();
