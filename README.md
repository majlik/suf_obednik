# 🍲 SUF obedník (Chrome Extension)

Rozšírenie pre Google Chrome postavené na **TypeScript**, **React 19** a **Manifest V3 (WXT)**, ktoré na stránke školskej jedálne (`http://194.160.223.198/` - systém Apetit / phpBox) automaticky vyhľadá a zobrazí reálne fotografie jedál priamo v tabuľke obedov.

---

## ✨ Funkcie

- 🔍 **Inteligentné čistenie názvov**: Odstraňuje zátvorky s alergénmi (napr. `{alergény /1,3,7/}`) a vedľajšie prílohy pred vyhľadávaním.
- 🖼️ **Automatické online vyhľadávanie**: Integrované vyhľadávanie prispôsobené pre špecifické slovenské jedlá (DuckDuckGo Image Engine + fallback na Wikipédiu). Nevyžaduje žiadne platené API kľúče!
- ⚡ **Rýchla lokálna vyrovnávacia pamäť (`chrome.storage.local`)**: Každé jedlo sa vyhľadá len raz a uloží sa v prehliadači na 30 dní. Stránka sa načítava bleskovo.
- 🔍 **Interaktívny Lightbox / Modal**: Kliknutím na náhľad jedla sa otvorí detail s veľkou fotografiou a zoznamom alergénov v prehľadných farebných štítkoch.
- 🔄 **Možnosť prepnúť fotku ("Iná fotka")**: Ak náhodou fotka nesedí, rodič môže jedným kliknutím vybrať ďalší nájdený obrázok.
- ⚙️ **Popup menu**: Zobrazuje počet uložených fotiek a umožňuje vyčistiť vyrovnávaciu pamäť.

---

## 🚀 Ako vyskúšať rozšírenie ihneď v prehliadači Chrome

Rozšírenie je už zostavené v priečinku `.output/chrome-mv3`. Môžete si ho ihneď pridať do Chrome:

1. V prehliadači Google Chrome otvorte adresu: `chrome://extensions`
2. V pravom hornom rohu zapnite prepínač **Režim pre vývojárov** (Developer mode).
3. V ľavom hornom rohu kliknite na **Načítať rozbalené** (Load unpacked).
4. Vyberte priečinok:
   ```
   C:\Users\mmajl\lunch-menu-preview\.output\chrome-mv3
   ```
5. Otvorte stránku [http://194.160.223.198/](http://194.160.223.198/) – pri každom riadku obeda uvidíte náhľadové fotografie!

---

## 🛠️ Vývoj a príkazy

```bash
# Spustenie vývojového režimu s Hot-Reloadingom
npm run dev

# Zostavenie produkčnej verzie
npm run build

# Vytvorenie .ZIP balíčka pripraveného pre Chrome Web Store
npm run zip
```
Po spustení `npm run zip` nájdete pripravený archív v `.output/suf-obednik-1.0.0-chrome.zip`.
