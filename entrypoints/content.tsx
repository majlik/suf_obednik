import { createRoot } from 'react-dom/client';
import { MealBadge } from '@/components/MealBadge';
import { parseMeal } from '@/utils/meal-parser';

export default defineContentScript({
  matches: ['http://194.160.223.198/*', 'https://194.160.223.198/*'],
  runAt: 'document_idle',
  main() {
    console.log('[Lunch Menu Preview] Content script active.');

    function processMenuTables() {
      const rows = document.querySelectorAll('table.apeBROW tr');

      rows.forEach((row) => {
        // Skip already processed rows
        if (row.classList.contains('meal-preview-processed')) return;

        const tds = Array.from(row.querySelectorAll('td'));
        if (tds.length < 2) return;

        // ── KEY LOGIC ────────────────────────────────────────────────────────────
        // Both logged-in (4 cols) and logged-out (2 cols) menu rows always have
        // tds[0] = a meal-type code: 'p' (soup), '1', '2', '3' (main dishes).
        //
        // Other tables on the page (auction, "already ordered", header rows) use
        // different first-cell text ('klasik', 'Typ', date strings, etc.) so they
        // are naturally excluded.
        // ─────────────────────────────────────────────────────────────────────────
        const codeCell = tds[0].textContent?.trim() ?? '';
        const isMealCode = /^[p1-9]$/i.test(codeCell);
        if (!isMealCode) return;

        const isSoup = codeCell.toLowerCase() === 'p';

        // Meal name is always in tds[1] — true for both 2-col and 4-col layouts
        const mealCell = tds[1] as HTMLTableCellElement;
        if (!mealCell) return;

        const rawText = mealCell.textContent?.trim() ?? '';

        // Also detect soup from the dish name itself (e.g. "Polievka...", "Kulajda")
        const inferredSoup = isSoup ||
          /^(polievka|vývar|kyselica|kapustnica|kulajda|boršč)/i.test(rawText);

        const parsed = parseMeal(rawText, inferredSoup ? 'soup' : 'main');
        if (!parsed.cleanName || parsed.cleanName.length < 3) return;

        // Mark row as processed
        row.classList.add('meal-preview-processed');

        // Keep original cell HTML, wrap in flex so badge and text sit side-by-side
        const originalContent = mealCell.innerHTML;
        mealCell.innerHTML = '';

        const flexContainer = document.createElement('div');
        flexContainer.className = 'meal-preview-flex';
        flexContainer.style.cssText = 'display:flex;align-items:center;gap:10px;min-height:54px;padding:2px 0;';

        const badgeMount = document.createElement('div');
        badgeMount.className = 'meal-badge-mount';
        badgeMount.style.flexShrink = '0';

        const textContainer = document.createElement('div');
        textContainer.className = 'meal-text';
        textContainer.style.flex = '1';
        textContainer.innerHTML = originalContent;

        flexContainer.appendChild(badgeMount);
        flexContainer.appendChild(textContainer);
        mealCell.appendChild(flexContainer);

        const root = createRoot(badgeMount);
        root.render(<MealBadge meal={parsed} />);
      });
    }

    // Initial scan
    processMenuTables();

    // Re-scan on any DOM change (tab switches, AJAX order updates)
    const observer = new MutationObserver(() => {
      processMenuTables();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  },
});
