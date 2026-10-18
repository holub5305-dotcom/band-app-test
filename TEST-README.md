# BAND APP TEST – testovací verze Kamarádek (revize 1h)

**Není pro skutečné uživatelky.** Slouží jen k vyzkoušení Kamarádek před zapnutím ve skutečné BAND APP.

- Patří do **samostatného** repozitáře (doporučeno: ve vlastní bezplatné GitHub organizaci, viz SETUP-FIREBASE.md, část 0) a je napojená na **samostatný testovací projekt Firebase**.
- Obsahuje jen Kamarádky (bez hudební školy a studia). Nesahá na nahrávky (`bandapp-recordings`) ani na nastavení BAND APP. Používá vlastní klíče `bandapp-test-friends-…`, vlastní mezipaměť `band-app-test-…` (od 1g `band-app-test-2`) a vlastní jméno aplikace Firebase.
- Nahoře je červený pruh **TEST**, aplikace se jmenuje **BAND APP TEST**, vyhledávače ji neindexují (`noindex`, `robots.txt`).
- `firebase-config.js` v tomto balíčku je už vyplněný údaji testovacího projektu **band-app-test-9fc3e** (`FIREBASE_CONFIGURED = true`, `TEST_BUILD = true`, `RECOVERY_DOMAIN_VERIFIED = true` – od 1h, adresa obnovy ověřena skutečným testem 18. 10. 2026; App Check vypnutý). **Nikdy ho nenahrávej do repozitáře band-app** – veřejná BAND APP by Kamarádky s tímto souborem odmítla spustit.
- **Novinky 1h (jen v této testovací verzi):**
  - **Obnovovací kód zapnutý:** vytvoření kódu (ukáže se jen jednou, místo zaškrtávátka tlačítko **Zapsala jsem si ho**), **♻️ Mám obnovovací kód** na úvodní obrazovce, změna kódu jen se starým kódem (starý pak neplatí), odkaz **Kód nemám** s poctivým textem (bez kódu obnova nejde).
  - **🚪 Odhlásit z tohoto zařízení** (sdílené zařízení); bez kódu varuje, že by se účet ztratil.
  - Zařízení, které si pamatuje účet s kódem, po odhlášení (např. změna kódu jinde) **nikdy samo nezaloží nový účet** – ukáže „Tvůj kód byl změněn na jiném zařízení. Zadej nový kód.“ Nový účet jen tlačítkem s potvrzením.
  - Po obnově bez zálohy se vlastní skupiny dohledají dotazem na vlastní členství. **Před nahráním souborů publikuj nová `firestore.rules` a přidej index `members.uid` (Collection group)** – REAL-FIREBASE-TEST.md, 0.1c. Soubor `firestore.indexes.json` index popisuje (aplikace ho nepotřebuje).
  - Mezipaměť `band-app-test-3`.
- **Novinky 1g (jen v této testovací verzi):**
  - Pozvánka = jediná obrazovka: přezdívka + **Požádat o přijetí** + dva krátké řádky (soukromí; „Odesláním žádosti přijímáš pravidla skupiny. Soukromí a pravidla →“). Žádná zaškrtávátka, žádné tlačítko „Odmítnout“ (kdo nechce, stránku zavře – nic se neodešle).
  - Založení skupiny: jen přezdívka a název skupiny, žádný souhlas.
  - Nová stránka **`soukromi.html`**: Pravidla skupiny + informace o zpracování osobních údajů (funguje i offline). Kontakt: vholub.pro@seznam.cz. Identita provozovatele je zatím **zástupný text** – doplní se až po právním ověření.
  - Vlastní **`friends.js`** a **`firestore.rules`** (bez souhlasu). Veřejná BAND APP má svoje soubory beze změny. Pravidla z tohoto balíčku patří **jen** do testovacího projektu `band-app-test-9fc3e` a po nahrání je musíš v konzoli znovu **publikovat** (REAL-FIREBASE-TEST.md, 0.1b).
  - Schvalování zakladatelkou, odmítnutí/odebrání/blokování, 24h jednorázové pozvánky, obnovovací kód a předání vlastnictví zůstávají beze změny. Žádný rodičovský účet ani dohled.
- Po nahrání nové verze počkej asi 10 minut a stránku obnov se smazáním mezipaměti (Ctrl+Shift+R) – jinak může prohlížeč chvíli běžet se starým `friends.js` (viz REAL-FIREBASE-TEST.md, 0.1c).
- Postup testu: **REAL-FIREBASE-TEST.md**.
