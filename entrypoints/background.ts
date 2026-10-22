import { getMealImages, cycleMealImage } from '@/utils/image-search';

interface QueueItem {
  cleanName: string;
  searchTiers: string[];
  forceRefresh: boolean;
  customQuery?: string;
  resolve: (data: any) => void;
  reject: (err: any) => void;
}

const searchQueue: QueueItem[] = [];
let isProcessingQueue = false;

async function processQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  while (searchQueue.length > 0) {
    const item = searchQueue.shift();
    if (!item) break;

    try {
      console.log('[Background] Searching for meal:', item.cleanName, item.searchTiers);
      const data = await getMealImages(
        item.cleanName,
        item.searchTiers,
        item.forceRefresh,
        item.customQuery
      );
      item.resolve(data);
    } catch (err: any) {
      console.error('[Background] Search error for:', item.cleanName, err);
      item.reject(err);
    }

    // Brief delay to be polite
    if (searchQueue.length > 0) {
      await new Promise((r) => setTimeout(r, 60));
    }
  }

  isProcessingQueue = false;
}

export default defineBackground(() => {
  console.log('Lunch Menu Preview background service worker active (v5).');

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'SEARCH_MEAL') {
      const cacheKey = 'meal_img_v6_' + message.cleanName.toLowerCase().replace(/\s+/g, '_');

      // Check cache first: if already cached and not forced, return immediately
      if (!message.forceRefresh && !message.customQuery) {
        chrome.storage.local.get(cacheKey).then((stored) => {
          if (
            stored &&
            stored[cacheKey] &&
            !stored[cacheKey].isFallback &&
            stored[cacheKey].images.length > 0
          ) {
            sendResponse({ success: true, data: stored[cacheKey] });
          } else {
            // Queue for search
            searchQueue.push({
              cleanName: message.cleanName,
              searchTiers: message.searchTiers || [],
              forceRefresh: message.forceRefresh,
              customQuery: message.customQuery,
              resolve: (data) => sendResponse({ success: true, data }),
              reject: (err) => sendResponse({ success: false, error: err.message }),
            });
            processQueue();
          }
        });
      } else {
        // Force refresh or custom query
        searchQueue.push({
          cleanName: message.cleanName,
          searchTiers: message.searchTiers || [],
          forceRefresh: message.forceRefresh,
          customQuery: message.customQuery,
          resolve: (data) => sendResponse({ success: true, data }),
          reject: (err) => sendResponse({ success: false, error: err.message }),
        });
        processQueue();
      }

      return true; // Keep message channel open for async response
    }

    if (message.type === 'CYCLE_MEAL_IMAGE') {
      cycleMealImage(message.cleanName)
        .then((data) => sendResponse({ success: true, data }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    }

    if (message.type === 'GET_CACHE_STATS') {
      chrome.storage.local.get(null).then((items) => {
        const mealKeys = Object.keys(items).filter((k) => k.startsWith('meal_img_v6_'));
        sendResponse({ count: mealKeys.length });
      });
      return true;
    }

    if (message.type === 'CLEAR_CACHE') {
      chrome.storage.local.get(null).then((items) => {
        const mealKeys = Object.keys(items).filter((k) => k.startsWith('meal_img_'));
        chrome.storage.local.remove(mealKeys).then(() => {
          sendResponse({ success: true, removedCount: mealKeys.length });
        });
      });
      return true;
    }
  });
});
