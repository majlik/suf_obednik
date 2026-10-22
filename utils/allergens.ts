export interface AllergenInfo {
  id: string;
  name: string;
  shortName: string;
}

export const ALLERGENS_MAP: Record<string, AllergenInfo> = {
  '1': { id: '1', name: 'Obilniny obsahujúce lepok', shortName: 'Lepok' },
  '2': { id: '2', name: 'Kôrovce a výrobky z nich', shortName: 'Kôrovce' },
  '3': { id: '3', name: 'Vajcia a výrobky z nich', shortName: 'Vajcia' },
  '4': { id: '4', name: 'Ryby a výrobky z nich', shortName: 'Ryby' },
  '5': { id: '5', name: 'Arašidy a výrobky z nich', shortName: 'Arašidy' },
  '6': { id: '6', name: 'Sójové zrná a výrobky z nich', shortName: 'Sója' },
  '7': { id: '7', name: 'Mlieko a mliečne výrobky', shortName: 'Mlieko' },
  '8': { id: '8', name: 'Orechy a výrobky z nich', shortName: 'Orechy' },
  '9': { id: '9', name: 'Zeler a výrobky z neho', shortName: 'Zeler' },
  '10': { id: '10', name: 'Horčica a výrobky z nej', shortName: 'Horčica' },
  '11': { id: '11', name: 'Sezamové semená a výrobky', shortName: 'Sezam' },
  '12': { id: '12', name: 'Oxid siričitý a siričitany', shortName: 'Siričitany' },
  '13': { id: '13', name: 'Vlčí bôb a výrobky z neho', shortName: 'Lupina' },
  '14': { id: '14', name: 'Mäkkýše a výrobky z nich', shortName: 'Mäkkýše' },
};

export function parseAllergens(text: string): AllergenInfo[] {
  // Matches patterns like {alergény /1,3,7/} or {alergény 1, 3, 7} or [1,3,7]
  const match = text.match(/\{[^}]*alerg[eé]ny?[^0-9]*([0-9,\s/]+)[^}]*\}/i);
  if (!match) return [];

  const rawNums = match[1].replace(/[\s/]/g, '').split(',');
  const result: AllergenInfo[] = [];

  for (const num of rawNums) {
    const cleanNum = num.trim();
    if (cleanNum && ALLERGENS_MAP[cleanNum]) {
      result.push(ALLERGENS_MAP[cleanNum]);
    }
  }

  return result;
}
