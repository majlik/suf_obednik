(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Allergen map (EU 14 major allergens)
  // ---------------------------------------------------------------------------
  const ALLERGENS_MAP = {
    '1':  { id: '1',  name: 'Obilniny obsahujúce lepok',       shortName: 'Lepok'      },
    '2':  { id: '2',  name: 'Kôrovce a výrobky z nich',        shortName: 'Kôrovce'    },
    '3':  { id: '3',  name: 'Vajcia a výrobky z nich',         shortName: 'Vajcia'     },
    '4':  { id: '4',  name: 'Ryby a výrobky z nich',           shortName: 'Ryby'       },
    '5':  { id: '5',  name: 'Arašidy a výrobky z nich',        shortName: 'Arašidy'    },
    '6':  { id: '6',  name: 'Sójové zrná a výrobky z nich',    shortName: 'Sója'       },
    '7':  { id: '7',  name: 'Mlieko a mliečne výrobky',        shortName: 'Mlieko'     },
    '8':  { id: '8',  name: 'Orechy a výrobky z nich',         shortName: 'Orechy'     },
    '9':  { id: '9',  name: 'Zeler a výrobky z neho',          shortName: 'Zeler'      },
    '10': { id: '10', name: 'Horčica a výrobky z nej',         shortName: 'Horčica'    },
    '11': { id: '11', name: 'Sezamové semená a výrobky',       shortName: 'Sezam'      },
    '12': { id: '12', name: 'Oxid siričitý a siričitany',      shortName: 'Siričitany' },
    '13': { id: '13', name: 'Vlčí bôb a výrobky z neho',      shortName: 'Lupina'     },
    '14': { id: '14', name: 'Mäkkýše a výrobky z nich',        shortName: 'Mäkkýše'   },
  };

  /**
   * Parse allergen numbers from raw meal text.
   * Allergens appear as {1,3,7} or (1,3,7) in the text.
   */
  function parseAllergens(text) {
    const allergens = [];
    // Matches: {alergény /1,3,7/} or {alergény 1, 3, 7} etc.
    const match = text.match(/\{[^}]*alerg[eé]ny?[^0-9]*([0-9,\s/]+)[^}]*\}/is);
    if (match) {
      match[1].replace(/[\s/]/g, '').split(',').forEach(id => {
        const trimmed = id.trim();
        if (trimmed && ALLERGENS_MAP[trimmed]) allergens.push(ALLERGENS_MAP[trimmed]);
      });
    }
    return allergens;
  }

  // ---------------------------------------------------------------------------
  // Meal parser (ported from utils/meal-parser.ts)
  // ---------------------------------------------------------------------------
  const CLUTTER_WORDS = /^(alebo|alebo:|príloha:|príloha|obed:|a|so|na|s|v|zo|ku|k)$/i;

  function parseMeal(rawText, category) {
    // Extract allergens before stripping
    const allergens = parseAllergens(rawText);

    // Strip allergen blocks {…} and (…)
    let clean = rawText.replace(/[{(][0-9,s]+[})]/g, '').trim();

    // Split by comma to get individual parts
    const parts = clean.split(',').map(p => p.trim()).filter(p => p.length > 1 && !CLUTTER_WORDS.test(p));

    // Build search tiers: longest first (most specific), then progressively shorter
    const searchTiers = [];
    if (parts.length > 0) {
      // Tier 1: full clean name (first significant part up to ~4 words)
      const primary = parts[0].split(/\s+/).slice(0, 5).join(' ');
      searchTiers.push(primary);
      // Tier 2: first 3 words of primary
      const shorter = parts[0].split(/\s+/).slice(0, 3).join(' ');
      if (shorter !== primary && shorter.length > 3) searchTiers.push(shorter);
      // Tier 3: first 2 words
      const shortest = parts[0].split(/\s+/).slice(0, 2).join(' ');
      if (shortest !== shorter && shortest.length > 3) searchTiers.push(shortest);
    }

    return {
      rawText,
      cleanName: parts[0] || clean,
      searchTiers: searchTiers.length ? searchTiers : [clean],
      category,
      allergens,
    };
  }

  // Route external image URLs through our proxy to avoid CSP/CORS issues
  function proxyImg(url) {
    if (!url || url.startsWith('data:')) return url;
    return '/api/img-proxy?url=' + encodeURIComponent(url);
  }

  // ---------------------------------------------------------------------------
  // Client-side image cache
  // ---------------------------------------------------------------------------
  const imgCache = new Map(); // key: name → { images, isFallback }

  function cacheKey(name) { return name.toLowerCase().trim(); }

  function getCached(name) {
    const k = cacheKey(name);
    if (imgCache.has(k)) return imgCache.get(k);
    try {
      const stored = localStorage.getItem('suf_img_' + k);
      if (stored) {
        const parsed = JSON.parse(stored);
        imgCache.set(k, parsed);
        return parsed;
      }
    } catch (_) {}
    return null;
  }

  function setCached(name, data) {
    const k = cacheKey(name);
    imgCache.set(k, data);
    try { localStorage.setItem('suf_img_' + k, JSON.stringify(data)); } catch (_) {}
  }

  // ---------------------------------------------------------------------------
  // Fetch images from our proxy API
  // ---------------------------------------------------------------------------
  async function fetchImages(cleanName, tiers, force, customQuery) {
    if (!force && !customQuery) {
      const cached = getCached(cleanName);
      if (cached) return cached;
    }
    let url = '/api/image-search?name=' + encodeURIComponent(cleanName)
            + '&tiers=' + encodeURIComponent(tiers.join(','));
    if (force) url += '&force=1';
    if (customQuery) url += '&customQuery=' + encodeURIComponent(customQuery);
    try {
      const res = await fetch(url);
      if (!res.ok) return { images: [], isFallback: true };
      const data = await res.json();
      if (!force && !customQuery) setCached(cleanName, data);
      return data;
    } catch (_) {
      return { images: [], isFallback: true };
    }
  }

  // ---------------------------------------------------------------------------
  // Modal
  // ---------------------------------------------------------------------------
  let modalEl = null;

  function closeModal() {
    if (modalEl) { modalEl.remove(); modalEl = null; }
  }

  function openModal(meal, initialData, badgeEl) {
    closeModal();
    const { cleanName, category, allergens, searchTiers } = meal;

    let images = initialData ? initialData.images : [];
    let isFallback = initialData ? initialData.isFallback : false;
    let imgIdx = initialData ? (initialData.selectedIndex || 0) : 0;

    function closeSave() {
      // Persist current state and update the badge thumbnail.
      console.log('[SUF] closeSave: imgIdx=', imgIdx, 'images.length=', images.length);
      const dataToSave = { cleanName, images, isFallback, selectedIndex: imgIdx };
      setCached(cleanName, dataToSave);
      if (badgeEl) {
        console.log('[SUF] calling updateBadge with selectedIndex=', imgIdx);
        updateBadge(badgeEl, dataToSave);
      } else {
        console.warn('[SUF] no badgeEl — thumbnail will not update');
      }
      closeModal();
    }

    const overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:999999',
      'background:rgba(0,0,0,0.75)', 'display:flex',
      'align-items:center', 'justify-content:center', 'padding:16px',
    ].join(';');
    overlay.addEventListener('click', e => { if (e.target === overlay) closeSave(); });

    const card = document.createElement('div');
    card.style.cssText = [
      'background:#fff', 'border-radius:16px', 'max-width:420px', 'width:100%',
      'max-height:90vh', 'overflow-y:auto', 'padding:20px',
      'box-shadow:0 8px 32px rgba(0,0,0,0.3)', 'display:flex',
      'flex-direction:column', 'gap:12px',
    ].join(';');

    // Image area
    const imgBox = document.createElement('div');
    imgBox.style.cssText = 'width:100%;aspect-ratio:16/9;border-radius:10px;overflow:hidden;background:#f0f0f0;display:flex;align-items:center;justify-content:center;font-size:48px;position:relative;';

    const imgEl = document.createElement('img');
    imgEl.style.cssText = 'width:100%;height:100%;object-fit:cover;display:none;';
    imgBox.appendChild(imgEl);

    const placeholderEl = document.createElement('span');
    placeholderEl.textContent = '🍽️';
    imgBox.appendChild(placeholderEl);

    const counterBadge = document.createElement('span');
    counterBadge.style.cssText = 'position:absolute;bottom:6px;right:8px;background:rgba(0,0,0,0.55);color:#fff;font-size:12px;padding:2px 7px;border-radius:12px;display:none;';
    imgBox.appendChild(counterBadge);

    function renderImage() {
      if (images.length > 0) {
        imgEl.src = proxyImg(images[imgIdx].url);
        imgEl.style.display = 'block';
        placeholderEl.style.display = 'none';
        if (images.length > 1) {
          counterBadge.textContent = `${imgIdx + 1}/${images.length}`;
          counterBadge.style.display = '';
        } else {
          counterBadge.style.display = 'none';
        }
      } else {
        imgEl.style.display = 'none';
        placeholderEl.style.display = '';
        counterBadge.style.display = 'none';
      }
    }
    renderImage();

    // Title
    const title = document.createElement('div');
    title.style.cssText = 'font-size:17px;font-weight:600;color:#1a1a1a;';
    title.textContent = cleanName;

    // Category badge
    const catBadge = document.createElement('div');
    catBadge.style.cssText = 'display:inline-block;padding:3px 10px;border-radius:12px;font-size:13px;font-weight:500;background:#e8f4fd;color:#1565c0;width:fit-content;';
    catBadge.textContent = category === 'soup' ? '🥣 Polievka' : '🍽️ Hlavné jedlo';

    // Allergen badges
    const allergenRow = document.createElement('div');
    allergenRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;';
    allergens.forEach(a => {
      const pill = document.createElement('span');
      pill.style.cssText = 'background:#fff9c4;color:#795548;font-size:12px;padding:2px 8px;border-radius:10px;border:1px solid #f9a825;';
      pill.title = a.name;
      pill.textContent = a.shortName;
      allergenRow.appendChild(pill);
    });

    // Custom query area
    const customArea = document.createElement('div');
    customArea.style.display = 'none';
    const customInput = document.createElement('input');
    customInput.type = 'text';
    customInput.placeholder = 'Vlastný výraz na hľadanie...';
    customInput.style.cssText = 'width:100%;box-sizing:border-box;padding:8px 10px;font-size:14px;border:1px solid #ccc;border-radius:8px;margin-bottom:6px;';
    const customBtn = document.createElement('button');
    customBtn.textContent = 'Hľadať';
    customBtn.style.cssText = 'padding:7px 16px;font-size:14px;border:none;border-radius:8px;background:#1565c0;color:#fff;cursor:pointer;';
    customArea.appendChild(customInput);
    customArea.appendChild(customBtn);

    // Buttons
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;';

    function makeBtn(label, bg, fg, onClick) {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = `flex:1;min-width:100px;padding:10px 14px;font-size:14px;border:none;border-radius:8px;background:${bg};color:${fg};cursor:pointer;font-weight:500;`;
      b.addEventListener('click', onClick);
      return b;
    }

    const nextBtn = makeBtn('Iná fotka ▶', '#f5f5f5', '#333', () => {
      if (images.length > 1) { imgIdx = (imgIdx + 1) % images.length; renderImage(); }
    });

    const refreshBtn = makeBtn('🔄 Hľadať znova', '#e8f5e9', '#2e7d32', async () => {
      refreshBtn.textContent = '⏳ Hľadám...';
      refreshBtn.disabled = true;
      const data = await fetchImages(cleanName, searchTiers, true, '');
      images = data.images; isFallback = data.isFallback; imgIdx = 0;
      setCached(cleanName, data);
      renderImage();
      refreshBtn.textContent = '🔄 Hľadať znova';
      refreshBtn.disabled = false;
    });

    const doneBtn = makeBtn('Hotovo ✓', '#1565c0', '#fff', closeSave);

    const editLink = document.createElement('a');
    editLink.href = '#';
    editLink.textContent = '✏️ Upraviť hľadanie';
    editLink.style.cssText = 'font-size:12px;color:#888;width:100%;text-align:center;';
    editLink.addEventListener('click', e => {
      e.preventDefault();
      customArea.style.display = customArea.style.display === 'none' ? '' : 'none';
    });

    customBtn.addEventListener('click', async () => {
      const q = customInput.value.trim();
      if (!q) return;
      customBtn.textContent = '⏳';
      customBtn.disabled = true;
      const data = await fetchImages(cleanName, searchTiers, true, q);
      images = data.images; isFallback = data.isFallback; imgIdx = 0;
      renderImage();
      customBtn.textContent = 'Hľadať';
      customBtn.disabled = false;
    });

    btnRow.append(nextBtn, refreshBtn, doneBtn);

    card.append(imgBox, title, catBadge, allergenRow.children.length ? allergenRow : document.createTextNode(''), btnRow, editLink, customArea);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    modalEl = overlay;
  }

  // ---------------------------------------------------------------------------
  // Badge element for a single meal row
  // ---------------------------------------------------------------------------
  function createBadge(meal) {
    const badge = document.createElement('div');
    badge.className = 'suf-badge-mount';
    badge.style.cssText = 'width:74px;height:54px;border-radius:8px;overflow:hidden;background:#f5f5f5;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;font-size:22px;position:relative;border:1px solid #e0e0e0;';
    badge.title = meal.cleanName;

    const spinner = document.createElement('span');
    spinner.textContent = '🍲';
    spinner.style.opacity = '0.5';
    badge.appendChild(spinner);

    badge.addEventListener('click', () => {
      const cached = getCached(meal.cleanName);
      openModal(meal, cached || { images: [], isFallback: true }, badge);
    });

    return badge;
  }

  function updateBadge(badge, data) {
    badge.innerHTML = '';
    const idx = data.selectedIndex || 0;
    if (data.images.length > 0) {
      const img = document.createElement('img');
      img.src = proxyImg(data.images[idx].url);
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
      img.onerror = () => { badge.textContent = '🍽️'; };
      badge.appendChild(img);
      if (data.images.length > 1) {
        const c = document.createElement('span');
        c.style.cssText = 'position:absolute;bottom:2px;right:3px;background:rgba(0,0,0,0.5);color:#fff;font-size:10px;padding:1px 4px;border-radius:8px;';
        c.textContent = `${idx + 1}/${data.images.length}`;
        badge.appendChild(c);
      }
    } else {
      badge.textContent = '🍽️';
    }
  }

  // ---------------------------------------------------------------------------
  // Process menu tables
  // ---------------------------------------------------------------------------
  function processMenuTables() {
    const rows = document.querySelectorAll('table.apeBROW tr');
    rows.forEach(row => {
      if (row.classList.contains('suf-processed')) return;
      const tds = row.querySelectorAll('td');
      if (tds.length < 2) return;

      const firstCell = tds[0].textContent.trim();
      if (!/^[p1-9]$/i.test(firstCell)) return;

      row.classList.add('suf-processed');

      const isSoup = firstCell.toLowerCase() === 'p';
      const category = isSoup ? 'soup' : 'main';
      const rawText = tds[1].textContent.trim();
      if (!rawText || rawText.length < 3) return;

      const meal = parseMeal(rawText, category);
      if (!meal.cleanName || meal.cleanName.length < 3) return;

      // Wrap cell content in flex
      const originalHtml = tds[1].innerHTML;
      const wrapper = document.createElement('div');
      wrapper.className = 'suf-meal-flex';

      const badge = createBadge(meal);
      wrapper.appendChild(badge);

      const textDiv = document.createElement('div');
      textDiv.innerHTML = originalHtml;
      wrapper.appendChild(textDiv);

      tds[1].innerHTML = '';
      tds[1].appendChild(wrapper);

      // Load image async
      const cached = getCached(meal.cleanName);
      if (cached) {
        updateBadge(badge, cached);
      } else {
        fetchImages(meal.cleanName, meal.searchTiers, false, '').then(data => {
          updateBadge(badge, data);
        });
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Run on load + observe DOM changes
  // ---------------------------------------------------------------------------
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', processMenuTables);
  } else {
    processMenuTables();
  }

  const observer = new MutationObserver(() => processMenuTables());
  observer.observe(document.body, { childList: true, subtree: true });

})();
