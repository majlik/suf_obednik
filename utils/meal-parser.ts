import { parseAllergens } from './allergens';
import type { AllergenInfo } from './allergens';

export interface ParsedMeal {
  rawText: string;
  cleanName: string;
  searchTiers: string[];
  category: 'soup' | 'main';
  allergens: AllergenInfo[];
}

const CLUTTER_REGEX = /^(ovocie|šalát|uhorkov[ýy]\s+šalát|kysl[áa]\s+uhorka|čalamáda|kompót|chlieb|pečivo|tatarka|kysl[áa]\s+smotana)$/i;

export function parseMeal(rawText: string, category: 'soup' | 'main' = 'main'): ParsedMeal {
  // 1. Extract allergens
  const allergens = parseAllergens(rawText);

  // 2. Remove curly brackets with allergens and normalize whitespace
  let clean = rawText.replace(/\{[^}]*\}/g, '').trim().replace(/\s+/g, ' ');

  // 3. Split by comma and filter clutter
  const parts = clean.split(',').map((p) => p.trim()).filter(Boolean);
  const meaningful = parts.filter((p) => !CLUTTER_REGEX.test(p));

  const searchTiers: string[] = [];

  if (category === 'soup') {
    // For soup, ensure "polievka" is present if it's just a dish name (e.g. Kulajda, Čínska zeleninová)
    const baseFirst = parts[0] || clean;
    const hasSoupWord = /(polievka|polévka|vývar|kyselica|kapustnica|boršč|krém)/i.test(baseFirst);
    const soupName = hasSoupWord ? baseFirst : `${baseFirst} polievka`;

    searchTiers.push(soupName);
    if (!hasSoupWord) {
      searchTiers.push(baseFirst);
    }
  } else {
    // For main meal:
    // 1. Try first two parts if second part is a side dish (e.g. "Dusené kuracie stehná na údenej paprike kolienka")
    // 2. Then try just first part (e.g. "Dusené kuracie stehná na údenej paprike" or "Cuketovo - mrkvové placky")
    if (meaningful.length >= 2) {
      const twoParts = `${meaningful[0]} ${meaningful[1]}`;
      const onePart = meaningful[0];

      searchTiers.push(twoParts);
      searchTiers.push(onePart);
    } else if (meaningful.length === 1) {
      const onePart = meaningful[0];
      searchTiers.push(onePart);
    } else {
      searchTiers.push(clean);
    }

    // Simplified fallback without prefix verbs like "Dusené", "Pečené"
    const core = meaningful[0] || clean;
    const simplified = core.replace(/^(dusen[éée]|pečen[éée]|varen[éée]|vyprážan[éée]|zapekan[éée])\s+/i, '');
    if (simplified.length > 5 && simplified !== core) {
      searchTiers.push(simplified);
    }
  }

  return {
    rawText,
    cleanName: clean,
    searchTiers,
    category,
    allergens,
  };
}
