/**
 * SNAPPED - Background Service Worker
 * Relays messages between popup and content scripts.
 * Stores extracted data temporarily.
 */

let extractedData = null;

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'startSelection':
      // Forward to the active tab's content script
      browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
        if (tabs[0]) {
          browser.tabs.sendMessage(tabs[0].id, { type: 'startSelection' });
        }
      });
      break;

    case 'selectionComplete':
      // Store the extracted data
      extractedData = message.data;
      // Notify popup if it's open
      browser.runtime.sendMessage({
        type: 'extractionReady',
        data: extractedData
      }).catch(() => {
        // Popup might not be open, that's fine
      });
      break;

    case 'selectionCancelled':
      extractedData = null;
      browser.runtime.sendMessage({ type: 'selectionCancelled' }).catch(() => {});
      break;

    case 'getExtractedData':
      sendResponse({ data: extractedData });
      return true; // async response

    case 'clearData':
      extractedData = null;
      break;
  }
});
