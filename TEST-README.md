# BAND APP TEST – testovací verze Kamarádek

**Není pro Laurinku ani její kamarádky.** Slouží jen k vyzkoušení Kamarádek před zapnutím ve skutečné BAND APP.

- Patří do **samostatného** repozitáře (doporučeno: ve vlastní bezplatné GitHub organizaci, viz SETUP-FIREBASE.md, část 0) a je napojená na **samostatný testovací projekt Firebase**.
- Obsahuje jen Kamarádky (bez hudební školy a studia). Nesahá na nahrávky (`bandapp-recordings`) ani na nastavení BAND APP. Používá vlastní klíče `bandapp-test-friends-…`, vlastní mezipaměť `band-app-test-…` a vlastní jméno aplikace Firebase.
- Nahoře je červený pruh **TEST**, aplikace se jmenuje **BAND APP TEST**, vyhledávače ji neindexují (`noindex`, `robots.txt`).
- `firebase-config.js` v tomto balíčku má `TEST_BUILD = true`. **Nikdy ho nenahrávej do repozitáře band-app** – veřejná BAND APP by Kamarádky s tímto souborem odmítla spustit.
- Postup testu: **REAL-FIREBASE-TEST.md**.
