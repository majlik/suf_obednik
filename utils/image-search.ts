export interface ImageResult {
  url: string;        // data:image/jpeg;base64,... (pre-fetched in background, no CORS issues)
  title: string;
  thumbnail: string;  // same data URL (already small from Dobruchut CDN)
  source: 'dobruchut' | 'wikipedia' | 'custom' | 'fallback';
}

export interface CachedMealData {
  cleanName: string;
  images: ImageResult[];
  selectedIndex: number;
  timestamp: number;
  isFallback?: boolean;
}

const CACHE_PREFIX = 'meal_img_v6_'; // v6: images stored as data URLs
const CACHE_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function getCacheKey(name: string): string {
  return CACHE_PREFIX + name.toLowerCase().replace(/\s+/g, '_');
}

/**
 * Fetches a remote image and converts it to a base64 data URL.
 * Runs in the background service worker which has no CORS restrictions.
 * Returns null if the fetch fails or the response is not an image.
 */
async function fetchImageAsDataUrl(remoteUrl: string): Promise<string | null> {
  try {
    const res = await fetch(remoteUrl);
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image/')) return null;

    const buffer = await res.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // Convert to base64 using chunked approach (avoids call-stack overflow for large images)
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
    }
    return `data:${contentType};base64,${btoa(binary)}`;
  } catch (e) {
    console.warn('[image-search] Failed to fetch image as data URL:', remoteUrl, e);
    return null;
  }
}

/**
 * Searches Dobruchut.sk directly for authentic Slovak recipe photos.
 * Returns image URLs from the CDN (not yet converted to data URLs).
 */
async function searchDobruchut(term: string): Promise<{ title: string; url: string }[]> {
  try {
    const cleanTerm = term
      .replace(/[,\-–]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const url = `https://dobruchut.aktuality.sk/vyhladavanie/?q=${encodeURIComponent(cleanTerm)}`;
    const res = await fetch(url);
    if (!res.ok) return [];

    const html = await res.text();

    // Match recipe cards anchors that point to /recept/... containing an img with srcset from img.aktuality.sk
    const regex = /<a[^>]+href=["']https:\/\/dobruchut\.aktuality\.sk\/recept\/(\d+)\/([^/]+)\/["'][^>]*class=["']image-wrapper["'][\s\S]*?<img[^>]+(?:src|srcset)=["'](https:\/\/img\.aktuality\.sk\/foto\/[^"'\s,]+)/gi;
    const matches = [...html.matchAll(regex)];
    if (matches.length === 0) return [];

    return matches.slice(0, 5).map((m) => {
      const slug = m[2].replace(/-/g, ' ');
      return {
        title: slug.charAt(0).toUpperCase() + slug.slice(1),
        url: m[3],
      };
    });
  } catch (err) {
    console.warn(`[image-search] Dobruchut error for "${term}":`, err);
    return [];
  }
}

/**
 * Searches Czech/Slovak Wikipedia for a dish.
 * Returns image URLs from Wikimedia CDN.
 */
async function searchWikipedia(term: string): Promise<{ title: string; url: string }[]> {
  const cleanTerm = term.replace(/\s*(polievka|recept|jedlo|obed)\b/gi, '').trim();
  const wikis = ['cs', 'sk'];

  for (const lang of wikis) {
    try {
      const apiUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(cleanTerm)}&gsrlimit=2&prop=pageimages&pithumbsize=600&format=json&origin=*`;
      const res = await fetch(apiUrl);
      const data = await res.json();
      const pages = data.query?.pages;
      if (!pages) continue;

      const results: { title: string; url: string }[] = [];
      for (const page of Object.values(pages) as any[]) {
        if (page.thumbnail?.source) {
          results.push({ title: page.title, url: page.thumbnail.source });
        }
      }
      if (results.length > 0) return results;
    } catch (err) {
      console.warn(`[image-search] Wikipedia (${lang}) error:`, err);
    }
  }

  return [];
}

/**
 * Main search function.
 * Searches Dobruchut -> Wikipedia, then converts each found image to a data URL in the background.
 */
export async function getMealImages(
  cleanName: string,
  searchTiers: string[],
  forceRefresh = false,
  customQuery?: string
): Promise<CachedMealData> {
  const cacheKey = getCacheKey(cleanName);

  // 1. Serve from cache if available
  if (!forceRefresh && !customQuery) {
    try {
      const stored = await chrome.storage.local.get(cacheKey);
      if (stored && stored[cacheKey]) {
        const cached = stored[cacheKey] as CachedMealData;
        if (
          !cached.isFallback &&
          Date.now() - cached.timestamp < CACHE_DURATION_MS &&
          cached.images.length > 0
        ) {
          return cached;
        }
      }
    } catch (e) {
      console.warn('[image-search] Cache read error:', e);
    }
  }

  // 2. Find raw image URLs
  let rawImages: { title: string; url: string }[] = [];

  const tiersToSearch = customQuery && customQuery.trim().length > 1
    ? [customQuery.trim()]
    : searchTiers;

  for (const query of tiersToSearch) {
    rawImages = await searchDobruchut(query);
    if (rawImages.length > 0) break;
  }

  // Fallback to Wikipedia
  if (rawImages.length === 0) {
    const baseName = tiersToSearch[tiersToSearch.length - 1] || cleanName;
    rawImages = await searchWikipedia(baseName);
  }

  if (rawImages.length === 0) {
    return {
      cleanName,
      images: [],
      selectedIndex: 0,
      timestamp: Date.now(),
      isFallback: true,
    };
  }

  // 3. Convert raw URLs to data URLs in the background service worker
  //    This completely bypasses CORS and signed-token expiry issues.
  const images: ImageResult[] = [];
  for (const raw of rawImages) {
    const dataUrl = await fetchImageAsDataUrl(raw.url);
    if (dataUrl) {
      images.push({
        url: dataUrl,
        thumbnail: dataUrl,
        title: raw.title,
        source: raw.url.includes('aktuality.sk') ? 'dobruchut' : 'wikipedia',
      });
    }
  }

  if (images.length === 0) {
    // All fetches failed for some reason — don't cache
    return {
      cleanName,
      images: [],
      selectedIndex: 0,
      timestamp: Date.now(),
      isFallback: true,
    };
  }

  const resultData: CachedMealData = {
    cleanName,
    images,
    selectedIndex: 0,
    timestamp: Date.now(),
    isFallback: false,
  };

  try {
    await chrome.storage.local.set({ [cacheKey]: resultData });
  } catch (e) {
    console.warn('[image-search] Cache save error:', e);
  }

  return resultData;
}

/**
 * Cycle to the next image for a meal.
 */
export async function cycleMealImage(cleanName: string): Promise<CachedMealData | null> {
  const cacheKey = getCacheKey(cleanName);
  try {
    const stored = await chrome.storage.local.get(cacheKey);
    if (!stored || !stored[cacheKey]) return null;

    const data = stored[cacheKey] as CachedMealData;
    if (data.images.length <= 1) return data;

    data.selectedIndex = (data.selectedIndex + 1) % data.images.length;
    await chrome.storage.local.set({ [cacheKey]: data });
    return data;
  } catch (e) {
    console.error('[image-search] Cycle error:', e);
    return null;
  }
}
