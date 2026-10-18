/* BAND APP TEST – nastavení TESTOVACÍ verze Kamarádek (samostatný TESTOVACÍ projekt Firebase band-app-test-9fc3e).
 * ⚠️ Sem patří údaje TESTOVACÍHO projektu, NIKDY ne projektu, který bude používat Laurinka.
 * Tento soubor NIKDY nenahrávej do repozitáře band-app (veřejná BAND APP ho odmítne: TEST_BUILD = true).
 *
 *
 * Tyto údaje NEJSOU tajné: Firebase je navrhl tak, aby byly vidět ve webové stránce.
 * Data před jinými uživatelkami a cizími chrání bezpečnostní pravidla (firestore.rules) a App Check, ne tento soubor.
 * Zprávy nejsou koncově šifrované: vlastník/správce projektu Firebase a Google k nim mají technický přístup.
 * Obnovovací kódy Laurinky sem NEPATŘÍ – nikam se neukládají.
 * NIKDY sem nevkládej heslo, soukromý klíč ani "service account" JSON.
 *
 * ✅ VYPLNĚNO 18. 10. 2026: údaje webové aplikace „BAND APP TEST“ z testovacího projektu band-app-test-9fc3e
 *    (Firebase konzole → Nastavení projektu → Vaše aplikace). FIREBASE_CONFIGURED = true.
 *    Pojistka ve friends.js pustí testovací stránku jen k testovacímu projektu (ID obsahuje „test“)
 *    a veřejná BAND APP tento projekt odmítne.
 * Zbývá nastavení v konzoli Firebase a samotný test – viz REAL-FIREBASE-TEST.md.
 */
export const FIREBASE_CONFIGURED = true;

/* Testovací balíček = true. Neměň. (Veřejná BAND APP má false; aplikace odmítne běžet, když se soubory spletou.) */
export const TEST_BUILD = true;

export const firebaseConfig = {
  apiKey: "AIzaSyAyjDKn7Fn4v9pzw3hu5IVt8dXKpLy3jS0",
  authDomain: "band-app-test-9fc3e.firebaseapp.com",
  projectId: "band-app-test-9fc3e",
  storageBucket: "band-app-test-9fc3e.firebasestorage.app",
  messagingSenderId: "606696541917",
  appId: "1:606696541917:web:873c4b4b76002698ea9534"
};

/* App Check (ochrana proti zneužití cizími skripty). Volitelné, ale doporučené.
 * siteKey: veřejný klíč webu z reCAPTCHA (v3) nebo reCAPTCHA Enterprise. Prázdné = vypnuto.
 * provider: 'v3' nebo 'enterprise'.
 * Tajný klíč reCAPTCHA se vkládá jen do Firebase konzole, NIKDY sem.
 * Testovací verze: zatím VYPNUTO (siteKey prázdný) – App Check se testuje až samostatně (REAL-FIREBASE-TEST.md). */
export const APP_CHECK = {
  siteKey: "",
  provider: "v3"
};

/* Obnovovací kód Laurinky – technicky přihlášení Email/Password s vymyšlenou adresou účtu
 * (náhodné ID + doména níže). Na adresu se nikdy nic neposílá.
 *
 * ⚠️ NEOVĚŘENÉ technické řešení: zatím nevíme, jestli skutečný Firebase tuto adresu přijme.
 * Proto je pojistka RECOVERY_DOMAIN_VERIFIED = false. Dokud je false, aplikace obnovovací kód
 * NEVYTVOŘÍ, NEOBNOVÍ ani NEZMĚNÍ a ukazuje „Připravuje se – zatím neověřeno“.
 * Chat, pozvánky a kontakty fungují normálně (anonymní účet) – ale ztráta dat v telefonu
 * = ztráta účtu, skupiny a kontaktů.
 *
 * V TESTOVACÍ verzi ji přepneš na true podle REAL-FIREBASE-TEST.md, část A (až testovací projekt
 * Firebase vymyšlenou adresu přijme). Veřejná BAND APP má vlastní firebase-config.js a tam zůstává false,
 * dokud celý test neprojde.
 *
 * RECOVERY_EMAIL_DOMAIN:
 *  - výchozí "obnova.band-app.invalid" (.invalid je celosvětově vyhrazená, nikomu nepatří),
 *  - náhrada, když ji Firebase odmítne: "obnova.example.com" (vyhrazená pro příklady, spravuje IANA).
 * Doménu měň JEN PŘED vytvořením prvního skutečného kódu – po změně by dřív vytvořené kódy přestaly fungovat. */
export const RECOVERY_EMAIL_DOMAIN = "obnova.band-app.invalid";
export const RECOVERY_DOMAIN_VERIFIED = false;
