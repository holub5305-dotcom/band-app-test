/* BAND APP TEST – Kamarádky, 1. etapa (revize 1g, JEN TESTOVACÍ VERZE): kontakty, soukromé pozvánky, textový chat
 * a vlastní účet Laurinky s obnovovacím kódem (bez e-mailu, bez cizích účtů, bez jakéhokoli dohledu).
 * 1g: tento soubor je SAMOSTATNÁ kopie jen pro band-app-test (veřejná BAND APP má svůj friends.js beze změny).
 * Zjednodušená pozvánka: přezdívka + „Požádat o přijetí“ + 2 krátké řádky (soukromí, pravidla → soukromi.html).
 * Žádná zaškrtávátka, žádný souhlas se neukládá (ani příznak přijetí pravidel), žádné tlačítko „Odmítnout“ u pozvánky.
 * Právní základ (jen test): plnění smlouvy = Pravidla skupiny (soukromi.html), viz PROPOSAL-v2.md.
 * Samostatný ES modul. Neovlivňuje ostatní části aplikace (app.js, studio.js, voice.js, lesson-em.js),
 * nepoužívá jejich klíče v localStorage ani databázi nahrávek (IndexedDB „bandapp-recordings“).
 * Firebase se načítá až při otevření Kamarádek z oficiálního CDN (gstatic), pevná verze.
 * Ochrana zpráv = bezpečnostní pravidla Firestore (proti jiným uživatelkám a cizím). Zprávy NEJSOU
 * koncově šifrované – vlastník/správce projektu Firebase a Google k nim mají technický přístup.
 * Testovací verze (stránka s <meta name="bandapp-friends-ns" content="test">) používá vlastní klíče
 * „bandapp-test-friends-“ a vlastní jméno aplikace Firebase, aby se nemíchala s veřejnou BAND APP. */
const FB_VERSION = '12.19.0';
const CDN = 'https://www.gstatic.com/firebasejs/' + FB_VERSION + '/';
const NS_META = typeof document !== 'undefined' && document.querySelector('meta[name="bandapp-friends-ns"]');
export const IS_TEST_BUILD = !!NS_META && NS_META.getAttribute('content') === 'test';
const LS = IS_TEST_BUILD ? 'bandapp-test-friends-' : 'bandapp-friends-';   // všechny klíče Kamarádek mají tuto předponu
const APP_NAME = IS_TEST_BUILD ? 'bandapp-test-friends' : 'bandapp-friends'; // jméno aplikace Firebase (oddělené přihlášení)
const DAY = 864e5, INVITE_MS = DAY, KEEP_MS = 30 * DAY, MAX_TEXT = 1000;
const CLOCK_MARGIN = 10 * 60e3;                      // rezerva na nepřesné hodiny v mobilu (pravidla: 30 dní podle času serveru)

const qs = new URLSearchParams(location.search);
export const isEmulator = qs.has('emulator') && ['localhost', '127.0.0.1'].includes(location.hostname);

/* ---------- malé pomocníky ---------- */
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
const lsGet = (k, d) => { try { const v = localStorage.getItem(LS + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch (e) { } };
const pad = n => String(n).padStart(2, '0');
const fmtTime = d => d ? d.getDate() + '. ' + (d.getMonth() + 1) + '. ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) : '…';
const cleanNick = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 24);
const err = (code, message) => Object.assign(new Error(message || code), { code });

export function randomToken() {                     // 128 bitů, base64url bez "=" → 22 znaků
  const b = new Uint8Array(16); crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export const validToken = t => /^[A-Za-z0-9_-]{22}$/.test(t || '');

/* ---------- místní data (v tomto zařízení) + záloha v cloudu (users/{uid}/private/state) ----------
 * Místní kopie zůstává vždy (funguje i offline). Každá změna se označí „dirty“ a odešle do zálohy,
 * kterou smí číst a zapisovat jen tentýž účet (pravidla). */
let pushTimer = null;
function changed() { lsSet('dirty', true); clearTimeout(pushTimer); pushTimer = setTimeout(() => { if (fbReady) pushState(fbReady).catch(() => { }); }, 600); }
export const local = {
  rooms: () => lsGet('rooms', []),
  saveRoom(r) { const all = local.rooms(), i = all.findIndex(x => x.id === r.id), old = all[i]; const nr = Object.assign({}, old || {}, r);
    if (old && JSON.stringify(old) === JSON.stringify(nr)) return; if (i >= 0) all[i] = nr; else all.push(nr); lsSet('rooms', all); changed(); },
  dropRoom(id) { lsSet('rooms', local.rooms().filter(x => x.id !== id)); changed(); },
  nick: () => lsGet('nick', ''), setNick: n => { if (n !== local.nick()) { lsSet('nick', n); changed(); } },
  favs: () => lsGet('favorites', []),
  isFav: (roomId, uid) => local.favs().includes(roomId + '/' + uid),
  toggleFav(roomId, uid) { const k = roomId + '/' + uid, f = local.favs(); lsSet('favorites', f.includes(k) ? f.filter(x => x !== k) : f.concat(k)); changed(); },
  blockedNames: () => lsGet('blocked-names', {}),
  setBlockedName(uid, nick) { const m = local.blockedNames(); if (nick == null) delete m[uid]; else m[uid] = nick; lsSet('blocked-names', m); changed(); }
};
// 1g: žádný souhlas se neukládá (ani v zařízení, ani v záloze). Starší záloha s polem „consent“ se při čtení jen ignoruje.
function localState() { return { rooms: local.rooms(), nick: local.nick(), favorites: local.favs(), blockedNames: local.blockedNames() }; }
function sanitize(s) {
  const rooms = (Array.isArray(s.rooms) ? s.rooms : []).filter(r => r && typeof r.id === 'string').slice(-50)
    .map(r => { const o = { id: r.id.slice(0, 64), name: String(r.name || '').slice(0, 40), role: String(r.role || 'member').slice(0, 12) }; if (r.from) o.from = String(r.from).slice(0, 24); return o; });
  const favorites = (Array.isArray(s.favorites) ? s.favorites : []).filter(x => typeof x === 'string').slice(-500);
  const bn = {}; Object.entries(s.blockedNames || {}).slice(-200).forEach(([k, v]) => { bn[k] = String(v).slice(0, 24); });
  return { rooms, nick: cleanNick(s.nick), favorites, blockedNames: bn };
}
function applyState(s) { const x = sanitize(s); lsSet('rooms', x.rooms); lsSet('nick', x.nick); lsSet('favorites', x.favorites); lsSet('blocked-names', x.blockedNames); }
function mergeState(a, b) {
  const rooms = b.rooms.slice(); a.rooms.forEach(r => { const i = rooms.findIndex(x => x.id === r.id); if (i >= 0) rooms[i] = Object.assign({}, rooms[i], r); else rooms.push(r); });
  return { rooms, nick: a.nick || b.nick, favorites: [...new Set([...b.favorites, ...a.favorites])], blockedNames: Object.assign({}, b.blockedNames, a.blockedNames) };
}
function backupLocal(reason) {
  const s = localState(); if (!s.rooms.length && !s.favorites.length && !s.nick) return;
  try { localStorage.setItem(LS + 'backup-' + Date.now(), JSON.stringify({ reason, uid: lsGet('state-uid', null), state: s })); } catch (e) { }
}
const stateRef = fb => fb.F.doc(fb.db, 'users', fb.uid, 'private', 'state');
async function pushState(fb) {
  const s = sanitize(localState());
  await fb.F.setDoc(stateRef(fb), Object.assign(s, { updatedAt: fb.F.serverTimestamp() }));
  lsSet('state-uid', fb.uid); lsSet('dirty', false);
}
/* Sladění místní kopie a zálohy po přihlášení:
 *  - stejný účet a neodeslané změny → odeslat; stejný účet bez změn → převzít zálohu (např. z jiného prohlížeče)
 *  - data z 1. etapy bez značky účtu → sloučit a odeslat (migrace z localStorage)
 *  - jiný účet (obnova) → místní kopii zazálohovat v zařízení a převzít zálohu účtu */
export async function syncState(fb) {
  let snap; try { snap = await fb.F.getDoc(stateRef(fb)); } catch (e) { return { ok: false, error: e }; }
  const owner = lsGet('state-uid', null), dirty = lsGet('dirty', false), loc = sanitize(localState());
  const empty = !loc.rooms.length && !loc.favorites.length && !loc.nick;
  try {
    if (snap.exists()) {
      const srv = sanitize(snap.data());
      if (owner === fb.uid) { if (dirty) await pushState(fb); else applyState(srv); }
      else if (owner == null && !empty) { applyState(mergeState(loc, srv)); await pushState(fb); }
      else { if (!empty) backupLocal('jiný účet'); applyState(srv); }
    } else if (owner && owner !== fb.uid) { backupLocal('jiný účet'); applyState({}); }
    else if (!empty) await pushState(fb);                  // migrace místních dat do zálohy
    lsSet('state-uid', fb.uid); if (snap.exists() && !(owner === fb.uid && dirty)) lsSet('dirty', false);
    return { ok: true };
  } catch (e) { return { ok: false, error: e }; }
}

/* ---------- konfigurace a připojení ---------- */
let cfgp = null, fbReady = null;
function loadConfig() { return cfgp || (cfgp = import('./firebase-config.js').catch(() => ({}))); }
const DEFAULT_RECOVERY_DOMAIN = 'obnova.band-app.invalid';   // vyhrazená doména .invalid (RFC 6761) – nikomu nepatří, e-mail tam nikdy nedojde
/* Pojistka proti záměně: testovací stránka smí běžet jen s testovacím firebase-config.js (TEST_BUILD = true)
 * a veřejná BAND APP jen s veřejným (TEST_BUILD = false/chybí). Jinak se Kamarádky nespustí. */
/* Druhá pojistka podle ID projektu Firebase: testovací stránka smí jen k testovacímu projektu (ID obsahuje
 * slovo „test“, např. band-app-test-9fc3e) a veřejná BAND APP testovací projekt odmítne, i kdyby někdo
 * přepsal TEST_BUILD. Projekt pro Laurinku proto NESMÍ mít v ID slovo „test“. Nevyplněné údaje (VLOZ_…) řeší isConfigured(). */
const TEST_PROJECT_IDS = ['band-app-test-9fc3e'];
const isTestProject = pid => TEST_PROJECT_IDS.includes(pid) || /(^|-)test(-|$)/i.test(pid);
export async function configMismatch() {
  const c = await loadConfig(); if ((c.TEST_BUILD === true) !== IS_TEST_BUILD) return true;
  const pid = String((c.firebaseConfig || {}).projectId || '');
  if (!pid || /VLOZ/.test(pid)) return false;
  return isTestProject(pid) !== IS_TEST_BUILD;
}
export async function isConfigured() {
  if (await configMismatch()) return false;
  if (isEmulator) return true;
  const c = await loadConfig(), f = c.firebaseConfig || {};
  return c.FIREBASE_CONFIGURED === true && !!f.apiKey && !!f.projectId && !/VLOZ/.test(f.apiKey + f.projectId + (f.appId || ''));
}
/* Pojistka: obnovovací kódy jsou zapnuté JEN když RECOVERY_DOMAIN_VERIFIED === true ve firebase-config.js
 * (nastaví se až po úspěšném testu ve skutečném Firebase podle REAL-FIREBASE-TEST.md). Do té doby aplikace
 * kód nevytvoří, neobnoví ani nezmění a nic takového neslibuje. Chat a pozvánky fungují dál (anonymní účet).
 * Jen v testovacím emulátoru (localhost + ?emulator=1) jde hodnotu přepsat parametrem ?rv=1 / ?rv=0. */
export async function recoveryVerified() {
  if (isEmulator && qs.has('rv')) return qs.get('rv') === '1';
  const c = await loadConfig();
  return c.RECOVERY_DOMAIN_VERIFIED === true;
}
async function requireVerified() { if (!(await recoveryVerified())) throw err('bandapp/recovery-unverified'); }
const EMU_CFG = { apiKey: 'demo-key', projectId: 'demo-bandapp', authDomain: 'demo-bandapp.firebaseapp.com', appId: '1:0:web:demo' };
let fbp = null;
export function connect() {
  if (fbp) return fbp;
  fbp = (async () => {
    const c = await loadConfig();
    const [A0, A, F] = await Promise.all([import(CDN + 'firebase-app.js'), import(CDN + 'firebase-auth.js'), import(CDN + 'firebase-firestore.js')]);
    const cfg = isEmulator ? EMU_CFG : c.firebaseConfig;
    const app = A0.getApps().find(a => a.name === APP_NAME) || A0.initializeApp(cfg, APP_NAME);
    const ac = c.APP_CHECK || {};
    if (!isEmulator && ac.siteKey) {                 // App Check musí být zapnutý dřív než Firestore
      const AC = await import(CDN + 'firebase-app-check.js');
      const provider = ac.provider === 'enterprise' ? new AC.ReCaptchaEnterpriseProvider(ac.siteKey) : new AC.ReCaptchaV3Provider(ac.siteKey);
      AC.initializeAppCheck(app, { provider, isTokenAutoRefreshEnabled: true });
    }
    const auth = A.getAuth(app), db = F.getFirestore(app);
    if (isEmulator) { A.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true }); F.connectFirestoreEmulator(db, '127.0.0.1', 8080); }
    await auth.authStateReady();
    if (!auth.currentUser) await A.signInAnonymously(auth);   // začíná se bez e-mailu a hesla (anonymní účet)
    const dom = String(c.RECOVERY_EMAIL_DOMAIN || DEFAULT_RECOVERY_DOMAIN).trim().toLowerCase();
    const fb = { app, auth, db, A, A0, F, cfg, recoveryDomain: /^[a-z0-9.-]+\.[a-z]{2,}$/.test(dom) ? dom : DEFAULT_RECOVERY_DOMAIN, get uid() { return auth.currentUser && auth.currentUser.uid; } };
    if (hasCode(auth.currentUser)) lsSet('recoverable-uid', auth.currentUser.uid);
    await syncState(fb);                                       // záloha kontaktů (nevadí, když selže – zkusí se příště)
    fbReady = fb;
    return fb;
  })();
  fbp.catch(() => { fbp = null; });
  return fbp;
}

/* ---------- účet: obnovovací kód ----------
 * Účet začíná jako anonymní (Firebase Anonymous). „Vytvořit obnovovací kód“ k němu připojí přihlášení
 * e-mailem a heslem (Firebase Email/Password) – ale bez skutečného e-mailu: adresa je vymyšlená
 * (náhodné ID účtu + vyhrazená doména .invalid, kam žádný e-mail nikdy nedojde) a heslo je náhodné
 * tajemství. Obojí je zakódované v obnovovacím kódu BAND-XXXX-…; uid účtu se nemění.
 * Kód se nikam neukládá (ani do Firestore, ani do localStorage) – ukáže se jen jednou. */
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';        // Crockford base32: bez I, L, O, U
const ID_LEN = 12, SECRET_LEN = 20;                     // 60 bitů ID + 100 bitů tajemství
function randB32(n) { const b = new Uint8Array(n); crypto.getRandomValues(b); return Array.from(b, x => B32[x & 31]).join(''); }   // 256/32 → bez zkreslení
export function formatCode(id, secret) { return 'BAND-' + (id + secret).match(/.{4}/g).join('-'); }
/* Tolerantní čtení: malá/velká písmena, mezery, pomlčky, tečky; O→0, I/L→1 (Crockford). */
export function parseCode(input) {
  let s = String(input || '').toUpperCase().replace(/[\s\-–—_.,:;]/g, '');
  if (s.length === ID_LEN + SECRET_LEN + 4 && s.startsWith('BAND')) s = s.slice(4);
  s = s.replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== ID_LEN + SECRET_LEN || ![...s].every(ch => B32.includes(ch))) return null;
  return { id: s.slice(0, ID_LEN), secret: s.slice(ID_LEN) };
}
const recoveryEmail = (fb, id) => id.toLowerCase() + '@' + fb.recoveryDomain;
const codeEmail = u => { const p = u && (u.providerData || []).find(x => x.providerId === 'password'); return p ? (p.email || (u.email || '')) : null; };
export const hasCode = u => codeEmail(u) != null;
export function accountInfo(fb) {
  const u = fb.auth.currentUser; if (!u) return { uid: null };
  const was = lsGet('recoverable-uid', null);
  return { uid: u.uid, hasCode: hasCode(u), signedOutFrom: was && was !== u.uid && !hasCode(u) ? was : null };
}
function markRecoverable(fb) { lsSet('recoverable-uid', fb.uid); }
/* Vytvoření prvního kódu: připojí k anonymnímu účtu přihlášení „ID@doména + tajemství“ (stejné uid). */
export async function createRecoveryCode() {
  await requireVerified();
  const fb = await connect(), { A } = fb, u = fb.auth.currentUser;
  if (hasCode(u)) throw err('bandapp/has-code');
  for (let i = 0; ; i++) {
    const id = randB32(ID_LEN), secret = randB32(SECRET_LEN);
    try {
      await A.linkWithCredential(u, A.EmailAuthProvider.credential(recoveryEmail(fb, id), secret));
    } catch (e) { if (i === 0 && e && e.code === 'auth/email-already-in-use') continue; throw e; }   // (prakticky nemožná) shoda ID
    markRecoverable(fb); pushState(fb).catch(() => { });
    return formatCode(id, secret);
  }
}
/* Nový kód: VŽDY jen se starým kódem. Starý kód se ověří u Firebase (reauthenticateWithCredential)
 * těsně před změnou (updatePassword). Bez starého kódu, se špatným kódem nebo s kódem jiného účtu se nic nezmění.
 * Jiná cesta ke změně kódu neexistuje (žádné „starý kód nemám“, žádné odpojení přihlášení).
 * Stejné ID, nové tajemství → starý kód přestane platit. */
export async function regenerateCode(oldCode) {
  await requireVerified();
  const old = oldCode && typeof oldCode === 'object' ? oldCode.oldCode : oldCode;
  if (old == null || !String(old).trim()) throw err('bandapp/old-code-required');
  const c = parseCode(old); if (!c) throw err('bandapp/bad-code');
  const fb = await connect(), { A } = fb, u = fb.auth.currentUser, email = codeEmail(u);
  if (email == null) throw err('bandapp/no-code');
  const id = email.split('@')[0].toUpperCase();
  if (c.id !== id) throw err('bandapp/not-this-account');
  const r = await A.reauthenticateWithCredential(u, A.EmailAuthProvider.credential(email, c.secret));
  if (!r || !r.user || r.user.uid !== u.uid || fb.auth.currentUser !== u) throw err('bandapp/not-this-account');
  const secret = randB32(SECRET_LEN);
  await A.updatePassword(u, secret);
  markRecoverable(fb);
  return formatCode(id, secret);
}
/* Obnova na jiném zařízení: přihlášení kódem → stejné uid → záloha (skupiny, hvězdičky, blokované) se stáhne.
 * Když se přihlášení nepovede (špatný kód), Firebase současné přihlášení v zařízení nezmění. */
export async function restoreAccount(input) {
  await requireVerified();
  const c = parseCode(input); if (!c) throw err('bandapp/bad-code');
  const fb = await connect(), email = recoveryEmail(fb, c.id);
  if (codeEmail(fb.auth.currentUser) === email) return { same: true, uid: fb.uid };
  await fb.A.signInWithEmailAndPassword(fb.auth, email, c.secret);
  markRecoverable(fb);
  const s = await syncState(fb);                    // jiný účet → místní data předchozího účtu se zazálohují v zařízení
  return { uid: fb.uid, synced: s.ok };
}
/* Má současný (jiný) účet v zařízení nějaká data? (varování před přepnutím) */
export function deviceHasData() { const s = localState(); return !!(s.rooms.length || s.favorites.length || Object.keys(s.blockedNames).length); }

/* ---------- operace s daty (pravidla ve firestore.rules je ověřují na serveru) ---------- */
export async function createRoom(name, nick) {
  const { db, F, uid } = await connect();
  const ref = F.doc(F.collection(db, 'rooms')), b = F.writeBatch(db);
  b.set(ref, { ownerUid: uid, name, createdAt: F.serverTimestamp(), blocked: [] });
  b.set(F.doc(db, 'rooms', ref.id, 'members', uid), { uid, nick, status: 'owner', joinedAt: F.serverTimestamp() });
  await b.commit();
  const r = { id: ref.id, name, role: 'owner' }; local.saveRoom(r); return r;
}
export function inviteLink(token) {
  const u = new URL('join.html', location.href); u.search = isEmulator ? '?emulator=1' : ''; u.hash = 't=' + token; return u.href;
}
export async function createInvite(roomId, fromNick) {
  const { db, F, uid } = await connect(), token = randomToken();
  const expires = Date.now() + INVITE_MS;
  await F.setDoc(F.doc(db, 'invites', token), { roomId, createdBy: uid, fromNick: cleanNick(fromNick) || 'Kamarádka', createdAt: F.serverTimestamp(), expiresAt: F.Timestamp.fromMillis(expires), used: false });
  return { token, link: inviteLink(token), expires };
}
export async function getInvite(token) {
  const { db, F } = await connect(); const s = await F.getDoc(F.doc(db, 'invites', token));
  return s.exists() ? s.data() : null;
}
/* Přijetí v transakci: Firestore zaručí, že při souběhu dvou osob uspěje jen jedna (druhá
 * transakce se zopakuje, uvidí used:true a skončí chybou „už použitá“). Je to JEDINÝ zápis do pozvánky,
 * který pozvaná osoba smí udělat (pravidla). Přijetím vzniká jen čekající členka – vstup schvaluje zakladatelka. */
export async function acceptInvite(token, roomId, nick) {
  const { db, F, uid } = await connect(), iref = F.doc(db, 'invites', token);
  await F.runTransaction(db, async tx => {
    const s = await tx.get(iref);
    if (!s.exists()) throw err('bandapp/invite-missing');
    const inv = s.data();
    if (inv.roomId !== roomId) throw err('bandapp/invite-room');
    if (inv.used) throw err('bandapp/invite-used');
    tx.set(F.doc(db, 'rooms', roomId, 'members', uid), { uid, nick, status: 'pending', joinedAt: F.serverTimestamp(), invite: token });
    tx.update(iref, { used: true, usedBy: uid, usedAt: F.serverTimestamp() });
  }).catch(async e => {
    // Souběh: když pozvánku mezitím použil někdo jiný, server zápis odmítne (permission-denied).
    // Zjistíme skutečný stav, aby se ukázala srozumitelná konečná zpráva.
    if (e && e.code === 'permission-denied') {
      const s = await F.runTransaction(db, tx => tx.get(iref)).catch(() => null);
      if (s && !s.exists()) throw err('bandapp/invite-missing');
      if (s && s.exists() && s.data().used && s.data().usedBy !== uid) throw err('bandapp/invite-used');
    }
    throw e;
  });
}
/* 1g: tlačítko „Odmítnout“ u pozvánky není. Odmítnutí se ani dřív nikam neposílalo – stačí stránku zavřít;
 * pozvánka sama vyprší po 24 hodinách (nebo ji zakladatelka zruší). Pravidla zápis „odmítnutí“ dál nedovolí. */
export async function revokeInvite(token) { const { db, F } = await connect(); await F.deleteDoc(F.doc(db, 'invites', token)); }
export async function watchInvites(roomId, cb, onErr) {
  const { db, F } = await connect();
  return F.onSnapshot(F.query(F.collection(db, 'invites'), F.where('roomId', '==', roomId), F.limit(50)),
    s => cb(s.docs.map(d => Object.assign({ token: d.id }, d.data()))), onErr);
}
export async function approveMember(roomId, uid) { const { db, F } = await connect(); await F.updateDoc(F.doc(db, 'rooms', roomId, 'members', uid), { status: 'approved', approvedAt: F.serverTimestamp() }); }
export async function removeMember(roomId, uid) { const { db, F } = await connect(); await F.deleteDoc(F.doc(db, 'rooms', roomId, 'members', uid)); }
export async function blockMember(roomId, uid, nick) {
  const { db, F } = await connect(), b = F.writeBatch(db);
  b.update(F.doc(db, 'rooms', roomId), { blocked: F.arrayUnion(uid) });
  b.delete(F.doc(db, 'rooms', roomId, 'members', uid));
  local.setBlockedName(uid, nick || '?');          // jméno uložit předem: seznam se překreslí hned po zápisu
  try { await b.commit(); } catch (e) { local.setBlockedName(uid, null); throw e; }
}
export async function unblock(roomId, uid) { const { db, F } = await connect(); await F.updateDoc(F.doc(db, 'rooms', roomId), { blocked: F.arrayRemove(uid) }); local.setBlockedName(uid, null); }
export async function leaveRoom(roomId) { const { db, F, uid } = await connect(); await F.deleteDoc(F.doc(db, 'rooms', roomId, 'members', uid)); local.dropRoom(roomId); }
/* Předání vlastnictví schválené člence (jen zakladatelka). Původní zakladatelka zůstane běžnou členkou. */
export async function transferOwnership(roomId, newUid) {
  const { db, F, uid } = await connect(), b = F.writeBatch(db);
  b.update(F.doc(db, 'rooms', roomId), { ownerUid: newUid });
  b.update(F.doc(db, 'rooms', roomId, 'members', newUid), { status: 'owner' });
  b.update(F.doc(db, 'rooms', roomId, 'members', uid), { status: 'approved' });
  await b.commit();
}
export async function sendMessage(roomId, nick, text) {
  const { db, F, uid } = await connect();
  await F.addDoc(F.collection(db, 'rooms', roomId, 'messages'), { uid, nick, text, createdAt: F.serverTimestamp() });
}
export async function watchMyMember(roomId, cb, onErr) {
  const { db, F, uid } = await connect();
  // Offline: prázdná odpověď z mezipaměti NEZNAMENÁ odebrání → cb(undefined) = „nevím, čekám na internet“.
  return F.onSnapshot(F.doc(db, 'rooms', roomId, 'members', uid), { includeMetadataChanges: true },
    s => cb(s.exists() ? s.data() : (s.metadata.fromCache ? undefined : null)), onErr);
}
export async function watchRoom(roomId, cb, onErr) { const { db, F } = await connect(); return F.onSnapshot(F.doc(db, 'rooms', roomId), s => cb(s.exists() ? s.data() : null), onErr); }
export async function watchMembers(roomId, cb, onErr) {
  const { db, F } = await connect();
  return F.onSnapshot(F.collection(db, 'rooms', roomId, 'members'), s => cb(s.docs.map(d => d.data())), onErr);
}
/* Jen posledních 30 dní: starší zprávy pravidla nikomu nevydají, i když ještě fyzicky existují.
 * Kdyby měl telefon hodiny o víc než 10 minut pozadu, server dotaz odmítne → zkusí se znovu s rezervou 2 dny. */
export async function watchMessages(roomId, cb, onErr) {
  const { db, F } = await connect();
  let unsub = null, stopped = false, margin = CLOCK_MARGIN;
  const start = () => {
    const q = F.query(F.collection(db, 'rooms', roomId, 'messages'), F.where('createdAt', '>', F.Timestamp.fromMillis(Date.now() - KEEP_MS + margin)), F.orderBy('createdAt', 'desc'), F.limit(150));
    unsub = F.onSnapshot(q, s => cb(s.docs.map(d => { const x = d.data({ serverTimestamps: 'estimate' }); return { id: d.id, uid: x.uid, nick: x.nick, text: x.text, at: x.createdAt ? x.createdAt.toDate() : null, pending: d.metadata.hasPendingWrites }; })
      .filter(m => !m.at || m.at.getTime() > Date.now() - KEEP_MS).reverse()),
      e => { if (!stopped && margin === CLOCK_MARGIN && e && String(e.code).includes('permission-denied')) { margin = 2 * DAY; start(); } else if (onErr) onErr(e); });
  };
  start();
  return () => { stopped = true; if (unsub) unsub(); };
}
function errText(e) {
  const c = (e && e.code) || '';
  if (c === 'bandapp/invite-used') return 'Tuto pozvánku mezitím použil někdo jiný. Každá pozvánka platí jen jednou – požádej o novou.';
  if (c === 'bandapp/invite-missing') return 'Pozvánka neexistuje – byla zrušena nebo vypršela.';
  if (c === 'bandapp/bad-code') return 'Kód má špatný tvar. Obnovovací kód začíná BAND- a má dalších 32 znaků (písmena a číslice). Zkontroluj, jestli jsi ho opsala celý.';
  if (c === 'bandapp/not-this-account') return 'Tento kód nepatří k tomuto účtu.';
  if (c === 'bandapp/old-code-required') return 'Nový kód jde vytvořit jen po zadání starého kódu.';
  if (c === 'bandapp/recovery-unverified') return 'Obnovovací kód se zatím připravuje (není ověřený), proto ho teď nejde vytvořit ani použít.';
  if (c === 'bandapp/has-code') return 'Účet už obnovovací kód má. Můžeš vytvořit nový.';
  if (c === 'bandapp/no-code') return 'Účet zatím nemá obnovovací kód.';
  if (c.startsWith('bandapp/')) return 'Něco se nepovedlo. Nic se nezměnilo, zkus to znovu.';
  if (c === 'auth/invalid-credential' || c === 'auth/wrong-password' || c === 'auth/user-not-found' || c === 'auth/invalid-login-credentials' || c === 'auth/user-mismatch')
    return 'Kód nesouhlasí. Zkontroluj ho (hlavně podobné znaky) a zkus to znovu. Pokud sis mezitím vytvořila nový kód, starý už neplatí.';
  if (c === 'auth/too-many-requests') return 'Příliš mnoho pokusů. Firebase obnovu na chvíli zablokoval – zkus to později.';
  if (c === 'auth/user-disabled') return 'Tento účet je zablokovaný.';
  if (c === 'auth/invalid-email') return 'Firebase odmítl adresu obnovovacího účtu. Viz návod SETUP-FIREBASE.md (RECOVERY_EMAIL_DOMAIN).';
  if (c === 'auth/email-already-in-use' || c === 'auth/credential-already-in-use') return 'Kód se nepodařilo vytvořit (shoda). Zkus to znovu.';
  if (c === 'auth/provider-already-linked') return 'Účet už obnovovací kód má.';
  if (c === 'auth/weak-password' || c === 'auth/password-does-not-meet-requirements') return 'Firebase má zapnutá zvláštní pravidla pro hesla. Viz návod SETUP-FIREBASE.md (Password policy nech vypnutou).';
  if (c === 'auth/unauthorized-domain') return 'Tato adresa není ve Firebase povolená (Authorized domains). Viz návod SETUP-FIREBASE.md.';
  if (c === 'auth/operation-not-allowed' || c === 'auth/admin-restricted-operation') return 'Ve Firebase není zapnuté přihlášení Email/Password (nebo Anonymous). Viz návod SETUP-FIREBASE.md.';
  if (c === 'auth/requires-recent-login') return 'Firebase chce čerstvé ověření. Zadej starý kód znovu.';
  if (c.includes('permission-denied')) return 'Nemáš k tomu oprávnění (možná pozvánka vypršela nebo tě zakladatelka skupiny odebrala).';
  if (c.includes('unavailable') || c.includes('network')) return 'Není připojení k internetu. Zkus to znovu.';
  if (c.includes('resource-exhausted') || c.includes('quota')) return 'Dnešní bezplatný limit je vyčerpaný. Zkus to zítra.';
  if (c.includes('failed-precondition') || c.includes('aborted')) return 'Pozvánku mezitím použil někdo jiný nebo se změnila. Zkus to znovu nebo požádej o novou.';
  return 'Něco se nepovedlo. Zkus to znovu.';
}
export { errText };

/* ---------- styl (černočervený, dotykové prvky min. 44 px) ---------- */
function injectStyle() {
  if (document.getElementById('fr-style')) return;
  document.head.append(h('style', { id: 'fr-style', text: `
.fr button{min-height:44px;min-width:44px}.fr input[type=text],.fr textarea{width:100%;padding:12px;background:#0a0a0a;color:#fff;border:1px solid #5c1219;border-radius:10px;font:inherit;min-height:44px}
.fr label.chk{display:flex;gap:10px;align-items:flex-start;padding:8px 0;min-height:44px;cursor:pointer}.fr label.chk input{width:24px;height:24px;flex:none;margin-top:2px}
.fr .row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:10px 0}.fr .note{color:#c0c0c8;font-size:14px;line-height:1.5}
.fr .box{background:#1d1d1f;border:1px solid #3a1a1e;border-radius:12px;padding:12px;margin:10px 0}.fr .err{background:#3a070c;border:1px solid #e0202f;border-radius:12px;padding:12px;color:#ffd6d9;margin:8px 0}
.fr .ok{color:#7fdc8f}.fr ul.fr-list{list-style:none;padding:0;margin:0;display:grid;gap:8px}.fr ul.fr-list li{background:#1d1d1f;border:1px solid #3a1a1e;border-radius:12px;padding:10px}
.fr .fname{font-weight:bold;word-break:break-word}.fr .fstat{font-size:13px;color:#e8c4c8}.fr .star{background:none;border:1px solid #5c1219;border-radius:10px;color:#777;font-size:22px;cursor:pointer}.fr .star.on{color:#ffcc33;border-color:#b3001b}
.fr .msgs{height:52vh;max-height:460px;overflow-y:auto;background:#0d0d0d;border:1px solid #3a1a1e;border-radius:12px;padding:10px;display:flex;flex-direction:column;gap:8px}
.fr .msg{max-width:82%;background:#232326;border:1px solid #3a1a1e;border-radius:14px;padding:8px 12px;align-self:flex-start;word-break:break-word;white-space:pre-wrap}.fr .msg.me{align-self:flex-end;background:#5a0a12;border-color:#b3001b}
.fr .msg .who{font-size:12px;color:#e8c4c8;margin-bottom:2px}.fr .msg .when{font-size:11px;color:#9a9aa2;margin-top:2px;text-align:right}.fr .link{width:100%;font-size:13px}
.fr button[disabled]{opacity:.5;cursor:not-allowed}.fr .code{font:bold 20px/1.5 ui-monospace,Consolas,monospace;letter-spacing:1px;word-break:break-all;background:#0a0a0a;border:1px dashed #e0202f;border-radius:10px;padding:10px;color:#fff;user-select:all}.fr details.box>summary{cursor:pointer;min-height:44px;display:flex;align-items:center;font-weight:bold}.fr .warnbox{background:#2a1a05;border:1px solid #b36b00;border-radius:12px;padding:10px;color:#ffe2b3;margin:8px 0}.fr .inv{font-size:14px}.fr .tabs{display:flex;gap:6px;flex-wrap:wrap}.fr .tabs button.on{background:#6b0d17}
` }));
}
const btn = (cls, text, onclick, extra) => h('button', Object.assign({ class: cls, type: 'button', onclick }, extra || {}), text);
/* 1g: místo dlouhého poučení 2 krátké řádky; úplné informace a Pravidla skupiny jsou v soukromi.html. */
const PRIVACY = 'Zprávy vidí jen schválené členky. Nejsou koncově šifrované: technicky k nim má přístup správce aplikace a Google.';
const PRIVACY_URL = 'soukromi.html';
const privacyLink = () => h('a', { href: PRIVACY_URL, class: 'fr-plink', 'data-act': 'privacy', style: 'color:#ffb3ba' }, 'Soukromí a pravidla →');
/* Dva krátké řádky pod formulářem. lead = věta o přijetí pravidel (pozvánka: „Odesláním žádosti…“, zakladatelka: „Založením skupiny…“). */
const privacyLines = lead => [h('p', { class: 'note', 'data-privacy': '1', text: PRIVACY }), h('p', { class: 'note', 'data-rules': '1' }, lead + ' ', privacyLink())];
export { PRIVACY, PRIVACY_URL };

/* ---------- chat (sdílí ho index.html i join.html) ---------- */
export function mountChat(el, roomId, getNick, meUid) {
  const list = h('div', { class: 'msgs', role: 'log', 'aria-live': 'polite', 'data-room': roomId });
  const ta = h('textarea', { rows: 2, maxlength: MAX_TEXT, placeholder: 'Napiš zprávu…', 'aria-label': 'Zpráva' });
  const count = h('span', { class: 'note', text: '0 / ' + MAX_TEXT });
  const err = h('div', { class: 'err', role: 'alert', hidden: true });
  const send = btn('primary', 'Odeslat ➤', null, { 'data-act': 'send' });
  ta.addEventListener('input', () => { count.textContent = ta.value.length + ' / ' + MAX_TEXT; });
  const doSend = async () => {
    const text = ta.value.trim(); if (!text) return;
    if (text.length > MAX_TEXT) { err.hidden = false; err.textContent = 'Zpráva může mít nejvýš ' + MAX_TEXT + ' znaků.'; return; }
    send.disabled = true; err.hidden = true;
    try { await sendMessage(roomId, getNick(), text); ta.value = ''; count.textContent = '0 / ' + MAX_TEXT; }
    catch (e) { err.hidden = false; err.textContent = 'Zpráva se neodeslala. ' + errText(e); }
    finally { send.disabled = false; ta.focus(); }
  };
  send.addEventListener('click', doSend);
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(pointer:fine)').matches) { e.preventDefault(); doSend(); } });
  el.replaceChildren(list, err, h('div', { class: 'row' }, ta), h('div', { class: 'row', style: 'justify-content:space-between' }, count, send),
    h('p', { class: 'note', text: 'Zprávy nejsou koncově šifrované. Starší než 30 dní se nezobrazují.' }));
  let unsub = null;
  watchMessages(roomId, msgs => {
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
    list.replaceChildren(...(msgs.length ? msgs.map(m => h('div', { class: 'msg' + (m.uid === meUid ? ' me' : ''), 'data-id': m.id },
      h('div', { class: 'who', text: m.uid === meUid ? 'Ty' : m.nick }), h('div', { class: 'mtext', text: m.text }), h('div', { class: 'when', text: m.pending ? 'odesílám…' : fmtTime(m.at) })))
      : [h('p', { class: 'note', text: 'Zatím tu nejsou žádné zprávy. Napiš první!' })]));
    if (atBottom || msgs.length < 15) list.scrollTop = list.scrollHeight;
  }, e => { err.hidden = false; err.textContent = 'Chat není dostupný. ' + errText(e); }).then(u => { unsub = u; }).catch(e => { err.hidden = false; err.textContent = errText(e); });
  return () => { if (unsub) unsub(); };
}

/* =====================================================================
   Můj účet: obnovovací kód (index.html)
   ===================================================================== */
const UNVERIFIED_TEXT = 'Obnova účtu kódem se teprve ověřuje a zatím není zapnutá. Do té doby platí: když smažeš data prohlížeče, odinstaluješ aplikaci nebo vyměníš telefon, přijdeš o tento účet, skupinu i kontakty a obnovit je nepůjde. Chat a pozvánky fungují normálně.';
const LIMIT_TEXT = 'Důležité: kód je jediný klíč k tvému účtu, aplikace žádný jiný způsob obnovy nemá. Když ztratíš kód a zároveň přijdeš o telefon nebo smažeš data prohlížeče, účet v aplikaci obnovit nepůjde. Pak založíš novou skupinu a kamarádky pozveš znovu.';
function downloadCode(code) {
  const text = 'BAND APP – obnovovací kód\r\n\r\n' + code + '\r\n\r\nVytvořen: ' + fmtTime(new Date()) + '\r\n\r\n'
    + 'Použití: BAND APP → Kamarádky → Můj účet → Obnovit účet → vlož tento kód.\r\n'
    + 'Nikomu ho neposílej. Kdo ho zná, dostane se do tvého účtu. Když vytvoříš nový kód, tento přestane platit.\r\n';
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = h('a', { href: url, download: 'band-app-obnovovaci-kod.txt', style: 'display:none' });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30e3);
}
function accountPanel(onRestored) {
  const body = h('div', { id: 'frAccountBody' }, h('p', { class: 'note', text: 'Načítám…' }));
  const box = h('details', { class: 'box', id: 'frAccount' }, h('summary', { text: '🔐 Můj účet a obnovovací kód' }), body);
  let loaded = false;
  // Kód se ukáže jen jednou; z obrazovky zmizí po „Hotovo“. Nikam se neukládá.
  const showCode = (code, isNew) => {
    const msg = h('p', { class: 'note', role: 'status' }), saved = h('input', { type: 'checkbox', id: 'frCodeSaved' });
    const done = btn('primary', 'Hotovo', () => { code = ''; render(); }, { id: 'frCodeDone', disabled: true });
    saved.addEventListener('change', () => { done.disabled = !saved.checked; });
    body.replaceChildren(
      h('div', { class: 'warnbox', 'data-state': 'show-code' },
        h('strong', { text: isNew ? '🔑 Tvůj NOVÝ obnovovací kód' : '🔑 Tvůj obnovovací kód' }),
        h('p', { class: 'code', id: 'frCodeValue', text: code }),
        h('p', { text: 'Ukáže se jen teď. Opiš si ho na papír nebo ho stáhni jako soubor a schovej. Nikomu ho neposílej – kdo ho zná, dostane se do tvého účtu.' + (isNew ? ' Starý kód už neplatí.' : '') })),
      h('div', { class: 'row' },
        btn('secondary', '📋 Kopírovat', async () => { try { await navigator.clipboard.writeText(code); msg.textContent = 'Zkopírováno. Ulož ho na bezpečné místo (ne do zprávy kamarádce).'; } catch (e) { msg.textContent = 'Kód opiš ručně.'; } }, { id: 'frCodeCopy' }),
        btn('secondary', '💾 Stáhnout jako soubor', () => { downloadCode(code); msg.textContent = 'Soubor band-app-obnovovaci-kod.txt je ve Stažených souborech.'; }, { id: 'frCodeDownload' })),
      msg, h('p', { class: 'note', text: LIMIT_TEXT }),
      h('label', { class: 'chk' }, saved, h('span', { text: 'Mám kód bezpečně uložený.' })), h('div', { class: 'row' }, done));
    box.open = true;
  };
  const render = async () => {
    let fb; try { fb = await connect(); } catch (e) { body.replaceChildren(h('div', { class: 'err', role: 'alert', text: 'Nepodařilo se připojit. ' + errText(e) })); loaded = false; return; }
    const info = accountInfo(fb), msg = h('div', { role: 'status', class: 'note', id: 'frAccountMsg' }), e2 = h('div', { class: 'err', role: 'alert', hidden: true });
    const showE = e => { e2.hidden = false; e2.textContent = errText(e); };
    if (!(await recoveryVerified())) {
      // Pojistka: dokud není ve skutečném Firebase ověřené, že obnova funguje, nic se neslibuje a nic nejde spustit.
      body.replaceChildren(h('div', { class: 'warnbox', 'data-state': 'unverified' },
        h('strong', { text: '🔐 Obnovovací kód: Připravuje se – zatím neověřeno' }),
        h('p', { text: UNVERIFIED_TEXT })),
        h('div', { class: 'row' }, btn('secondary', '🔑 Vytvořit obnovovací kód (připravuje se)', null, { id: 'frMakeCode', disabled: true }),
          btn('secondary', '♻️ Obnovit účet (připravuje se)', null, { id: 'frRestore', disabled: true })));
      return;
    }
    const rem = document.getElementById('frNoCode'); if (rem && info.hasCode) rem.hidden = true;
    const kids = [];
    if (info.signedOutFrom) kids.push(h('div', { class: 'warnbox', 'data-signedout': '1', text: '⚠️ Tento telefon už není přihlášený do tvého účtu s obnovovacím kódem (například protože sis na jiném telefonu vytvořila nový kód). Zadej svůj platný obnovovací kód níže v „Obnovit účet“.' }));
    if (info.hasCode) {
      // Nový kód VŽDY jen se starým kódem (ověří se u Firebase těsně před změnou). Žádná jiná cesta.
      const regen = h('div', { id: 'frRegen' });
      const askOld = () => {
        const old = h('input', { type: 'text', id: 'frOldCode', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'BAND-…', 'aria-label': 'Starý obnovovací kód' });
        const go = btn('primary', 'Ověřit starý kód a vytvořit nový', async () => {
          e2.hidden = true;
          if (!old.value.trim()) return showE({ code: 'bandapp/old-code-required' });
          if (!parseCode(old.value)) return showE({ code: 'bandapp/bad-code' });
          if (!confirm('Vytvořit nový obnovovací kód? Starý kód přestane platit.')) return;
          go.disabled = true;
          try { const c = await regenerateCode(old.value); old.value = ''; showCode(c, true); }
          catch (e) { go.disabled = false; showE(e); }
        }, { id: 'frOldCodeGo' });
        regen.replaceChildren(h('p', { class: 'note', text: 'Nový kód jde vytvořit jen se starým kódem. Zadej svůj současný obnovovací kód:' }), old,
          h('div', { class: 'row' }, go, btn('secondary', 'Zrušit', () => { regen.replaceChildren(); e2.hidden = true; }, { id: 'frOldCodeCancel' })));
        old.focus();
      };
      kids.push(h('p', { class: 'ok', 'data-state': 'has-code', text: '✅ Tvůj účet má obnovovací kód.' }),
        h('p', { class: 'note', text: 'Na novém telefonu (nebo po smazání dat) otevři Kamarádky → Můj účet → Obnovit účet a zadej kód. Vrátí se skupina, kamarádky, hvězdičky, blokované kontakty i historie zpráv (posledních 30 dní).' }),
        h('p', { class: 'note', text: 'Myslíš si, že kód někdo viděl? Vytvoř nový – k tomu potřebuješ starý kód. Starý kód tím přestane platit. Telefony, které už jsou do účtu přihlášené, se nemusí odhlásit hned.' }),
        h('div', { class: 'row' }, btn('secondary', '🔄 Vytvořit nový kód', askOld, { id: 'frNewCode' })), regen);
    } else {
      kids.push(h('div', { class: 'warnbox', 'data-state': 'no-code', text: '⚠️ Zatím nemáš obnovovací kód. Když se smažou data prohlížeče, aplikace se odinstaluje nebo vyměníš telefon, přijdeš o skupinu i kontakty.' }),
        h('p', { class: 'note', text: 'Obnovovací kód je tvůj soukromý klíč k účtu. Nepotřebuješ e-mail ani telefonní číslo. Bez kódu se do tvého účtu v aplikaci nikdo jiný nepřihlásí.' }),
        h('div', { class: 'row' }, btn('primary', '🔑 Vytvořit obnovovací kód', async ev => {
          const b = ev.currentTarget; b.disabled = true; e2.hidden = true;
          try { showCode(await createRecoveryCode(), false); } catch (e) { showE(e); b.disabled = false; }
        }, { id: 'frMakeCode' })));
    }
    const inp = h('input', { type: 'text', id: 'frRestoreCode', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'BAND-XXXX-XXXX-…', 'aria-label': 'Obnovovací kód' });
    kids.push(h('hr', { style: 'border-color:#3a1a1e' }),
      h('strong', { text: '♻️ Obnovit účet' }),
      h('p', { class: 'note', text: 'Nový telefon nebo smazaná data? Zadej svůj obnovovací kód. Velikost písmen, mezery ani pomlčky nevadí.' }), inp,
      h('div', { class: 'row' }, btn('secondary', '♻️ Obnovit účet', async ev => {
        const b = ev.currentTarget; e2.hidden = true;
        if (!parseCode(inp.value)) return showE({ code: 'bandapp/bad-code' });
        const cur = accountInfo(fb);
        if (deviceHasData() && !cur.hasCode) {
          if (!confirm('Pozor: na tomto zařízení je jiný účet Kamarádek, který NEMÁ obnovovací kód. Po přepnutí se k němu už nedostaneš (jeho skupiny a kontakty se tu ztratí). Opravdu přepnout na účet z kódu?')) return;
        } else if (deviceHasData()) {
          if (!confirm('Na tomto zařízení je přihlášený jiný účet. Přepnout na účet z kódu? (K současnému účtu se vrátíš jeho vlastním kódem.)')) return;
        }
        b.disabled = true;
        try {
          const r = await restoreAccount(inp.value); inp.value = '';
          if (!r.same && onRestored) return onRestored();
          await render(); const m = document.getElementById('frAccountMsg'); if (m) m.textContent = r.same ? 'Tento účet už je na tomto zařízení přihlášený.' : 'Účet je obnovený.';
        }
        catch (e) { showE(e); b.disabled = false; }
      }, { id: 'frRestore' })),
      h('p', { class: 'note', text: LIMIT_TEXT }), e2, msg);
    body.replaceChildren(...kids);
  };
  box.addEventListener('toggle', () => { if (box.open && !loaded) { loaded = true; render(); } });
  box.openNow = () => { box.open = true; if (!loaded) { loaded = true; render(); } box.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  return box;
}
/* Připomínka, dokud účet nemá obnovovací kód (jen když je už připojeno).
 * Dokud obnova není ověřená (RECOVERY_DOMAIN_VERIFIED), upozorní poctivě, že ztráta dat = ztráta účtu. */
/* Věta o obnově se ukáže jen když je obnova ověřená (jinak nic neslibujeme). */
function recoveryNote(text) {
  const p = h('p', { class: 'note', hidden: true, 'data-recovery-note': '1', text });
  recoveryVerified().then(v => { p.hidden = !v; });
  return p;
}
function codeReminder(panel) {
  const el = h('div', { class: 'warnbox', id: 'frNoCode', hidden: true });
  if (fbReady) {
    const i = accountInfo(fbReady);
    if (!i.hasCode) {
      el.hidden = false;
      el.append(h('span', { text: '⚠️ Bez obnovovacího kódu při výměně telefonu, odinstalování aplikace nebo smazání dat prohlížeče přijdeš o účet, skupinu i kontakty. ' }));
      recoveryVerified().then(v => {
        if (!v) { el.dataset.state = 'unverified'; el.firstChild.textContent = '⚠️ Obnovovací kód se zatím připravuje (neověřeno). Do té doby: když se smažou data prohlížeče, aplikace se odinstaluje nebo vyměníš telefon, přijdeš o účet, skupinu i kontakty – obnovit je zatím nepůjde.'; return; }
        if (i.signedOutFrom) el.firstChild.textContent = '⚠️ Tento telefon už není přihlášený do tvého účtu s kódem. Obnov ho svým kódem. ';
        el.append(btn('secondary', i.signedOutFrom ? '♻️ Obnovit účet' : '🔑 Vytvořit kód', () => panel.openNow(), { id: 'frNoCodeGo' }));
      });
    }
  }
  return el;
}

/* =====================================================================
   Sekce Kamarádky v index.html
   ===================================================================== */
const STATUS_TEXT = { owner: 'zakladatelka skupiny', approved: 'členka', pending: '⏳ čeká na schválení – zatím nevidí zprávy' };
async function initIndex(root) {
  injectStyle(); root.classList.add('fr');
  if (await configMismatch()) {
    root.replaceChildren(h('div', { class: 'err', role: 'alert', 'data-state': 'config-mismatch', text: IS_TEST_BUILD
      ? 'Tato TESTOVACÍ stránka má nahraný veřejný firebase-config.js (nebo údaje projektu, který není testovací). Kamarádky jsou vypnuté – nahraj testovací firebase-config.js (TEST_BUILD = true, testovací projekt).'
      : 'Do veřejné BAND APP byl nahraný testovací firebase-config.js (nebo údaje testovacího projektu Firebase). Kamarádky jsou vypnuté – nahraj veřejný firebase-config.js. Zbytek BAND APP funguje normálně.' }));
    return;
  }
  if (!(await isConfigured())) {
    root.replaceChildren(h('p', { class: 'muted', 'data-state': 'unconfigured', text: 'Kamarádky zatím nejsou nastavené.' }),
      h('p', { class: 'note', text: 'Soukromé pozvánky a chat se zapnou podle návodu SETUP-FIREBASE.md. Zbytek BAND APP funguje normálně.' }),
      btn('secondary', '📹 Videohovor (2. etapa)', null, { disabled: true }));
    return;
  }
  const S = { roomId: null, unsubs: [], chatOff: null, members: [], room: null, my: null, invites: [] };
  const stopAll = () => { S.unsubs.forEach(u => { try { u(); } catch (e) { } }); S.unsubs = []; if (S.chatOff) { S.chatOff(); S.chatOff = null; } };
  const showErr = (box, e) => { box.hidden = false; box.textContent = typeof e === 'string' ? e : errText(e); };

  function intro() {
    const b = btn('primary', '👯 Otevřít Kamarádky', async () => { b.disabled = true; await open(); b.disabled = false; });
    root.replaceChildren(h('p', { text: 'Soukromý chat s kamarádkami, které sama pozveš a schválíš.' }), b,
      h('p', { class: 'note' }, privacyLink()),
      h('div', { class: 'row' }, btn('secondary', '📹 Videohovor (2. etapa)', null, { disabled: true })), accountPanel(() => open()));
  }
  async function open() {
    stopAll();
    root.replaceChildren(h('p', { class: 'muted', text: 'Připojuji Kamarádky…' }));
    try { await connect(); } catch (e) {
      root.replaceChildren(h('div', { class: 'err', role: 'alert', text: 'Kamarádky se nepodařilo připojit. Potřebují internet. Ostatní části BAND APP fungují dál.' }), btn('secondary', '↻ Zkusit znovu', open));
      return;
    }
    const rooms = local.rooms();
    if (!rooms.length) return createForm();
    showRoom(rooms.some(r => r.id === S.roomId) ? S.roomId : rooms[rooms.length - 1].id);
  }
  function createForm(cancelable) {
    stopAll();
    const nick = h('input', { type: 'text', maxlength: 24, id: 'frNick', placeholder: 'Tvoje přezdívka', value: local.nick() });
    const name = h('input', { type: 'text', maxlength: 40, id: 'frRoomName', placeholder: 'Název skupiny, např. Moje kapela', value: 'Moje kapela' });
    const err = h('div', { class: 'err', role: 'alert', hidden: true });
    // 1g: žádné zaškrtávátko ani souhlas – jen přezdívka a název skupiny.
    const go = btn('primary', 'Založit soukromou skupinu', async () => {
      const n = cleanNick(nick.value), r = name.value.trim().slice(0, 40);
      if (!n || !r) return showErr(err, 'Vyplň přezdívku i název skupiny.');
      go.disabled = true;
      try { local.setNick(n); const room = await createRoom(r, n); showRoom(room.id); } catch (e) { showErr(err, e); go.disabled = false; }
    }, { id: 'frCreate' });
    const panel = accountPanel(() => open());
    root.replaceChildren(codeReminder(panel), h('h3', { text: 'Založ si soukromou skupinu' }),
      h('label', { for: 'frNick', text: 'Přezdívka (ne celé jméno)' }), nick, h('label', { for: 'frRoomName', text: 'Název skupiny' }), name, err, h('div', { class: 'row' }, go, cancelable && btn('secondary', 'Zpět', () => open())),
      ...privacyLines('Založením skupiny přijímáš pravidla skupiny.'),
      recoveryNote('Máš už účet z jiného telefonu a obnovovací kód? Otevři „Můj účet“ níže a obnov ho svým kódem.'), panel);
  }
  function showRoom(roomId) {
    stopAll(); S.roomId = roomId; S.members = []; S.room = null; S.my = null; S.membersOn = false; S.invites = []; S.invOn = false; S.invDetails = null;
    const info = local.rooms().find(r => r.id === roomId) || { id: roomId, name: 'Skupina', role: 'member' };
    const tabs = h('div', { class: 'tabs' }, ...local.rooms().map(r => btn('secondary' + (r.id === roomId ? ' on' : ''), r.name || 'Skupina', () => showRoom(r.id))),
      btn('secondary', '+ Nová skupina', () => createForm(true)));
    const title = h('h3', { id: 'frRoomTitle', text: info.name || 'Skupina' });
    const err = h('div', { class: 'err', role: 'alert', hidden: true });
    const inviteBox = h('div', { class: 'box', id: 'frInviteBox', hidden: true });
    const invList = h('div', { id: 'frInvites' });
    const quick = h('div', { class: 'row', id: 'frQuick' });
    const contacts = h('ul', { class: 'fr-list', id: 'frContacts' });
    const blockedBox = h('div', { id: 'frBlocked' });
    const chatWrap = h('div', { id: 'frChat', hidden: true });
    const statusP = h('p', { class: 'fstat', id: 'frMyStatus' });
    const panel = accountPanel(() => open());
    root.replaceChildren(codeReminder(panel), tabs, title, statusP, err, quick, inviteBox, invList, h('h4', { text: 'Moje kamarádky' }), contacts, blockedBox, chatWrap,
      h('p', { class: 'note', text: 'Kontakty, hvězdičky a blokované jsou uložené v tomto zařízení a navíc v záloze tvého účtu ve Firebase. V aplikaci ji může číst jen tvůj účet (koncově šifrovaná ale není).' }),
      recoveryNote('Na jiný telefon je přeneseš obnovovacím kódem (Můj účet → Obnovit účet).'),
      panel);
    const role = () => S.my && S.my.status;
    const isMgr = () => role() === 'owner';
    const canChat = () => ['owner', 'approved'].includes(role());

    const openChat = () => {
      if (!canChat()) return showErr(err, 'Chat se otevře, až tě zakladatelka skupiny schválí.');
      chatWrap.hidden = false; if (S.chatOff) S.chatOff();
      chatWrap.replaceChildren(h('h4', { text: '💬 Chat skupiny' }));
      const c = h('div'); chatWrap.append(c);
      connect().then(fb => { S.chatOff = mountChat(c, roomId, () => (S.my && S.my.nick) || local.nick(), fb.uid); });
      chatWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    const makeInvite = async (b) => {
      if (b) b.disabled = true; err.hidden = true;
      try {
        const inv = await createInvite(roomId, (S.my && S.my.nick) || local.nick());
        const link = h('input', { type: 'text', class: 'link', readonly: true, value: inv.link, id: 'frInviteLink', 'aria-label': 'Odkaz pozvánky', onfocus: e => e.target.select() });
        const msg = h('p', { class: 'note', role: 'status' });
        const copy = async () => { try { await navigator.clipboard.writeText(inv.link); msg.textContent = 'Odkaz je zkopírovaný. Vlož ho kamarádce do zprávy.'; } catch (e) { link.focus(); link.select(); msg.textContent = 'Odkaz označ a zkopíruj ručně.'; } };
        const share = async () => {
          if (navigator.share) { try { await navigator.share({ title: 'Pozvánka do BAND APP', text: 'Pozvánka do mé soukromé skupiny v BAND APP (platí 24 hodin):', url: inv.link }); msg.textContent = 'Pozvánka odeslána.'; return; } catch (e) { if (e && e.name === 'AbortError') return; } }
          copy();
        };
        inviteBox.hidden = false;
        inviteBox.replaceChildren(h('strong', { text: '✉️ Nová pozvánka' }),
          h('p', { class: 'note', text: 'Platí 24 hodin a jen jednou. Pošli ji jen kamarádce, kterou znáš.' }),
          link, h('div', { class: 'row' }, btn('primary', '📤 Sdílet', share), btn('secondary', '📋 Kopírovat', copy)), msg);
      } catch (e) { showErr(err, e); } finally { if (b) b.disabled = false; }
    };
    const renderQuick = () => {
      const r = role(), q = [];
      if (canChat()) q.push(btn('primary', '💬 Chat', openChat, { id: 'frOpenChat' }));
      if (isMgr()) q.push(btn('primary', '✉️ Pozvat kamarádku', e => makeInvite(e.currentTarget), { id: 'frInvite' }));
      q.push(btn('secondary', '📹 Videohovor (2. etapa)', null, { disabled: true }));
      if (r === 'approved' || r === 'pending') q.push(btn('secondary', 'Opustit skupinu', async () => { if (!confirm('Opravdu chceš opustit tuto skupinu?')) return; try { await leaveRoom(roomId); open(); } catch (e) { showErr(err, e); } }));
      quick.replaceChildren(...q);
    };
    /* Stav pozvánek pro zakladatelku: otevřená / použitá (kým a jestli čeká na schválení) / vypršela.
     * Odmítnutí se na server nezapisuje, takže se tu neukazuje – neodmítnutá pozvánka sama vyprší. */
    const invState = (i, now) => {
      if (i.used) {
        const m = S.members.find(x => x.uid === i.usedBy), bl = ((S.room && S.room.blocked) || []).includes(i.usedBy);
        if (m && m.status === 'pending') return { k: 'used-pending', t: 'použila ji „' + m.nick + '“ – čeká na tvoje schválení. Neznáš ji? Odmítni nebo zablokuj ji v seznamu níže a pošli novou pozvánku.' };
        if (m) return { k: 'used-member', t: 'použila ji „' + m.nick + '“ – ' + (m.status === 'owner' ? 'zakladatelka' : 'schválená členka') };
        if (bl) return { k: 'used-blocked', t: 'použila ji „' + (local.blockedNames()[i.usedBy] || 'neznámá') + '“ – zablokovaná' };
        return { k: 'used-gone', t: 'použitá – osoba už ve skupině není' };
      }
      const exp = Math.min(i.expiresAt ? i.expiresAt.toMillis() : 0, i.createdAt ? i.createdAt.toMillis() + INVITE_MS : Infinity);
      if (exp > now) return { k: 'open', t: 'otevřená – čeká na kamarádku (platí do ' + fmtTime(new Date(exp)) + ')' };
      return { k: 'expired', t: 'vypršela (nikdo ji nepoužil)' };
    };
    const renderInvites = () => {
      if (!isMgr()) { invList.replaceChildren(); return; }
      const now = Date.now();
      const list = S.invites.slice().sort((a, b) => ((b.createdAt && b.createdAt.toMillis()) || now) - ((a.createdAt && a.createdAt.toMillis()) || now)).slice(0, 8);
      if (!list.length) { invList.replaceChildren(); return; }
      if (!S.invDetails) { S.invSummary = h('summary'); S.invUl = h('ul', { class: 'fr-list' }); S.invDetails = h('details', { class: 'box' }, S.invSummary, S.invUl); }
      S.invSummary.textContent = '✉️ Moje pozvánky (' + list.length + ')';
      const del = async (i, q) => { if (!confirm(q)) return false; try { await revokeInvite(i.token); return true; } catch (e) { showErr(err, e); return false; } };
      S.invUl.replaceChildren(...list.map(i => { const st = invState(i, now); return h('li', { class: 'inv', 'data-token': i.token, 'data-inv': st.k },
          h('div', { text: fmtTime(i.createdAt ? i.createdAt.toDate() : new Date()) + ' – ' + st.t }),
          h('div', { class: 'row' },
            st.k === 'open' ? btn('secondary', 'Zrušit', () => del(i, 'Zrušit tuto pozvánku? Odkaz přestane fungovat.'), { 'data-act': 'revoke' }) : null,
            st.k === 'open' ? btn('secondary', 'Zrušit a vytvořit novou', async e => { const b = e.currentTarget; if (await del(i, 'Zrušit tuto pozvánku a vytvořit novou? Starý odkaz přestane fungovat.')) makeInvite(b); }, { 'data-act': 'reissue' }) : null,
            st.k !== 'open' ? btn('secondary', 'Smazat ze seznamu', () => del(i, 'Smazat tuto pozvánku ze seznamu? (Kamarádky ve skupině to neovlivní.)'), { 'data-act': 'delete' }) : null)); }));
      if (!invList.contains(S.invDetails)) invList.replaceChildren(S.invDetails);
    };

    const renderContacts = () => {
      const meUid = S.uid, mgr = isMgr();
      const others = S.members.filter(m => m.uid !== meUid);
      const rank = m => m.status === 'owner' ? 0 : m.status === 'pending' ? 2 : 1;
      others.sort((a, b) => (local.isFav(roomId, b.uid) - local.isFav(roomId, a.uid)) || (rank(a) - rank(b)) || a.nick.localeCompare(b.nick, 'cs'));
      if (!others.length) { contacts.replaceChildren(h('li', { class: 'note', text: mgr ? 'Zatím tu nikdo není. Klepni na „Pozvat kamarádku“.' : 'Zatím tu nikdo další není.' })); }
      else contacts.replaceChildren(...others.map(m => {
        const fav = local.isFav(roomId, m.uid), pending = m.status === 'pending';
        const star = btn('star' + (fav ? ' on' : ''), fav ? '★' : '☆', () => { local.toggleFav(roomId, m.uid); renderContacts(); }, { 'aria-label': fav ? 'Odebrat z oblíbených' : 'Označit jako oblíbenou', 'aria-pressed': String(fav) });
        const act = h('div', { class: 'row' });
        if (pending && mgr) act.append(btn('primary', '✔ Schválit', async () => { try { await approveMember(roomId, m.uid); } catch (e) { showErr(err, e); } }));
        if (['approved', 'owner'].includes(m.status) && canChat()) act.append(btn('secondary', '💬 Chat', openChat));
        act.append(btn('secondary', '📹 Videohovor (2. etapa)', null, { disabled: true }));
        if (mgr && ['pending', 'approved'].includes(m.status)) {
          act.append(btn('secondary', pending ? '✖ Odmítnout' : '➖ Odebrat', async () => { if (!confirm('Opravdu odebrat „' + m.nick + '“ ze skupiny?')) return; try { await removeMember(roomId, m.uid); } catch (e) { showErr(err, e); } }));
          act.append(btn('secondary', '⛔ Blokovat', async () => { if (!confirm('Zablokovat „' + m.nick + '“? Už se nebude moct vrátit ani s novou pozvánkou.')) return; try { await blockMember(roomId, m.uid, m.nick); } catch (e) { showErr(err, e); } }));
        }
        if (mgr && m.status === 'approved') act.append(btn('secondary', '👑 Předat vlastnictví', async () => {
          if (!confirm('Předat vlastnictví skupiny „' + m.nick + '“? Ty zůstaneš běžnou členkou a už nebudeš moct zvát, schvalovat ani blokovat.')) return;
          try { await transferOwnership(roomId, m.uid); } catch (e) { showErr(err, e); }
        }, { 'data-act': 'transfer' }));
        return h('li', { 'data-uid': m.uid, 'data-status': m.status }, h('div', { class: 'row', style: 'margin:0' }, star, h('div', { style: 'flex:1' }, h('div', { class: 'fname', text: m.nick }),
          h('div', { class: 'fstat', text: STATUS_TEXT[m.status] || m.status }))), act);
      }));
      const bl = (S.room && S.room.blocked) || [];
      if (mgr && bl.length) { const names = local.blockedNames(); blockedBox.replaceChildren(h('h4', { text: 'Zablokované' }), h('ul', { class: 'fr-list' }, ...bl.map(u => h('li', {}, h('span', { text: (names[u] || 'neznámá') + ' ' }), btn('secondary', 'Odblokovat', async () => { try { await unblock(roomId, u); } catch (e) { showErr(err, e); } }))))); }
      else blockedBox.replaceChildren();
    };

    connect().then(async fb => {
      S.uid = fb.uid;
      // Když server začne odmítat čtení (např. mě odebrali nebo předali vlastnictví), ověříme vlastní záznam přímo.
      const recheck = async e => {
        if (S.roomId !== roomId) return;
        if (!e || e.code !== 'permission-denied') return showErr(err, e);
        // Čtení přes transakci jde vždy přímo na server (nezávisle na živých odběrech, které už mohly být odmítnuté).
        try { const s = await fb.F.runTransaction(fb.db, tx => tx.get(fb.F.doc(fb.db, 'rooms', roomId, 'members', fb.uid))); if (!s.exists()) { stopAll(); return onMy(null); } onMy(s.data()); }
        catch (e2) { showErr(err, e); }
      };
      const onMy = my => {
        const prev = role(); S.my = my || null;
        if (my === undefined) { statusP.textContent = 'Jsi offline. Kamarádky se připojí, až bude internet. Ostatní části BAND APP fungují dál.'; return; }
        if (!my) { statusP.textContent = 'V této skupině už nejsi členkou.'; err.hidden = true; blockedBox.replaceChildren(); inviteBox.hidden = true; contacts.replaceChildren(); quick.replaceChildren(); invList.replaceChildren(); chatWrap.hidden = true; if (S.chatOff) { S.chatOff(); S.chatOff = null; } return; }
        if (info.role !== my.status) { info.role = my.status; local.saveRoom({ id: roomId, role: my.status }); }
        if (prev !== my.status) { renderQuick(); if (!canChat() && S.chatOff) { S.chatOff(); S.chatOff = null; chatWrap.hidden = true; } }
        if (my.status === 'pending') { statusP.textContent = '⏳ Čekáš na schválení zakladatelkou skupiny.'; return; }
        statusP.textContent = my.status === 'owner' ? 'Jsi zakladatelka této skupiny.' : 'Jsi členkou této skupiny.';
        if (!S.membersOn) {
          S.membersOn = true;
          watchMembers(roomId, ms => { S.members = ms; renderContacts(); renderInvites(); }, recheck).then(u => S.unsubs.push(u));
          watchRoom(roomId, r => { S.room = r; if (r && r.name && r.name !== info.name) { info.name = r.name; title.textContent = r.name; local.saveRoom({ id: roomId, name: r.name }); } renderContacts(); renderInvites(); }, recheck).then(u => S.unsubs.push(u));
        }
        if (isMgr() && !S.invOn) { S.invOn = true; watchInvites(roomId, l => { S.invites = l; renderInvites(); }, () => { }).then(u => S.unsubs.push(u)); }
        renderContacts(); renderInvites();
      };
      S.unsubs.push(await watchMyMember(roomId, onMy, recheck));
    }).catch(e => showErr(err, e));
  }

  if (local.rooms().length) open(); else intro();
}

/* =====================================================================
   join.html – pozvánka pro kamarádku bez instalace
   ===================================================================== */
async function initJoin(root) {
  injectStyle(); root.classList.add('fr');
  addEventListener('hashchange', () => { if (/(?:^|[#&])t=/.test(location.hash)) location.reload(); });   // další odkaz otevřený ve stejné kartě
  const say = (cls, text, state) => root.replaceChildren(h('div', { class: cls, role: 'status', 'data-state': state, text }));
  let token = '';
  const m = /(?:^|[#&])t=([^&]+)/.exec(location.hash);
  if (m) { token = decodeURIComponent(m[1]); try { sessionStorage.setItem(LS + 'join-token', token); } catch (e) { } history.replaceState(null, '', location.pathname + location.search); }
  else { try { token = sessionStorage.getItem(LS + 'join-token') || ''; } catch (e) { } }

  if (await configMismatch()) return say('err', 'Tato stránka a soubor firebase-config.js k sobě nepatří (testovací × veřejná verze). Pozvánky jsou vypnuté.', 'config-mismatch');
  if (!(await isConfigured())) return say('note', 'Kamarádky zatím nejsou nastavené.', 'unconfigured');
  const myRooms = local.rooms().filter(r => r.role !== 'owner');
  if (!token && myRooms.length) return roomView(myRooms[myRooms.length - 1]);
  const dropToken = () => { try { sessionStorage.removeItem(LS + 'join-token'); } catch (e) { } };
  if (!validToken(token)) { dropToken(); return say('err', 'Odkaz pozvánky je neplatný. Požádej kamarádku o nový.', 'invalid'); }

  say('note', 'Ověřuji pozvánku…', 'loading');
  let fb, inv;
  try { fb = await connect(); inv = await getInvite(token); }
  catch (e) { return root.replaceChildren(h('div', { class: 'err', role: 'alert', 'data-state': 'error', text: 'Pozvánku se nepodařilo ověřit. ' + errText(e) }), btn('secondary', '↻ Zkusit znovu', () => location.reload())); }
  if (!inv) { dropToken(); return say('err', 'Pozvánka neexistuje – byla zrušena nebo už vypršela.', 'missing'); }
  if (inv.used) {
    if (inv.usedBy === fb.uid) { const r = local.rooms().find(x => x.id === inv.roomId) || { id: inv.roomId, name: '', role: 'member', from: inv.fromNick }; local.saveRoom(r); return roomView(r); }
    dropToken(); return say('err', 'Tato pozvánka už byla použita. Každá pozvánka platí jen jednou.', 'used');
  }
  const exp = inv.expiresAt && inv.expiresAt.toMillis();
  if (!exp || exp <= Date.now()) { dropToken(); return say('err', 'Pozvánka vypršela. Požádej o novou.', 'expired'); }

  // 1g: jediná obrazovka – přezdívka + „Požádat o přijetí“. Žádné zaškrtávátko, nic dalšího se neukládá.
  const nick = h('input', { type: 'text', id: 'jNick', maxlength: 24, placeholder: 'Tvoje přezdívka', value: local.nick(), autocomplete: 'nickname' });
  const err = h('div', { class: 'err', role: 'alert', hidden: true });
  const accept = btn('primary', 'Požádat o přijetí', async () => {
    const n = cleanNick(nick.value);
    if (!n) { err.hidden = false; err.textContent = 'Napiš svou přezdívku.'; return; }
    accept.disabled = true; err.hidden = true;
    try {
      await acceptInvite(token, inv.roomId, n);
      local.setNick(n); const r = { id: inv.roomId, name: '', role: 'pending', from: inv.fromNick }; local.saveRoom(r);
      dropToken();
      roomView(r);
    } catch (e) {
      err.hidden = false; err.textContent = 'Žádost se nepodařilo odeslat. ' + errText(e);
      const final = ['bandapp/invite-used', 'bandapp/invite-missing'].includes(e && e.code);
      accept.disabled = final;
      if (final) dropToken();
    }
  }, { id: 'jAccept' });
  root.replaceChildren(
    h('h2', { id: 'jTitle', 'data-state': 'invite' }, '✉️ Pozvánka od „', h('span', { text: inv.fromNick || 'kamarádka' }), '“'),
    h('label', { for: 'jNick', text: 'Tvoje přezdívka (ne celé jméno)' }), nick,
    err, h('div', { class: 'row' }, accept),
    ...privacyLines('Odesláním žádosti přijímáš pravidla skupiny.'));

  function roomView(r) {
    root.replaceChildren(h('p', { class: 'note', text: 'Načítám…' }));
    let chatOff = null, roomName = '';
    connect().then(fb => watchMyMember(r.id, my => {
      if (my === undefined) { if (!chatOff) say('note', 'Jsi offline. Kamarádky se připojí, až bude internet.', 'offline'); return; }
      if (!my) { if (chatOff) { chatOff(); chatOff = null; } local.dropRoom(r.id); return say('err', 'V této skupině nejsi (nebo už nejsi) členkou.', 'removed'); }
      if (r.role !== my.status) { r.role = my.status; local.saveRoom({ id: r.id, role: my.status }); }
      if (my.status === 'pending') return root.replaceChildren(h('h2', { text: '⏳ Čekáš na schválení' }), h('p', { 'data-state': 'pending', text: 'Až tě ' + (r.from || 'zakladatelka skupiny') + ' schválí, otevře se tady chat. Stránku si ulož do záložek.' }));
      if (my.status === 'owner') {
        if (chatOff) { chatOff(); chatOff = null; }
        return root.replaceChildren(h('h2', { text: '👑 Jsi zakladatelka skupiny' }),
          h('p', { 'data-state': my.status, text: 'Správu skupiny najdeš v BAND APP v sekci Kamarádky.' }), h('a', { href: 'index.html' + location.search + '#friends', class: 'note', style: 'color:#ffb3ba', text: 'Otevřít BAND APP → Kamarádky' }));
      }
      if (chatOff) return;
      const chat = h('div'), title = h('h2', { id: 'jRoomTitle', text: '💬 ' + (r.name || 'Skupina') });
      root.replaceChildren(title, h('p', { class: 'note', 'data-state': 'approved', text: 'Jsi členkou jako „' + my.nick + '“. Stránku si ulož do záložek, ať se sem snadno vrátíš.' }), chat,
        h('div', { class: 'row' }, btn('secondary', '📹 Videohovor (2. etapa)', null, { disabled: true }),
          btn('secondary', 'Opustit skupinu', async () => { if (!confirm('Opravdu chceš opustit skupinu?')) return; try { await leaveRoom(r.id); } catch (e) { } })));
      chatOff = mountChat(chat, r.id, () => my.nick, fb.uid);
      fb.F.getDoc(fb.F.doc(fb.db, 'rooms', r.id)).then(s => { if (s.exists()) { roomName = s.data().name; title.textContent = '💬 ' + roomName; local.saveRoom({ id: r.id, name: roomName }); } }).catch(() => { });
    }, e => say('err', errText(e), 'error'))).catch(e => say('err', errText(e), 'error'));
  }
}

/* ---------- start ---------- */
function start() {
  const a = document.getElementById('friendsApp'), j = document.getElementById('joinApp');
  try { if (a) initIndex(a).catch(() => { a.textContent = 'Kamarádky se nepodařilo načíst.'; }); if (j) initJoin(j).catch(() => { j.textContent = 'Pozvánku se nepodařilo načíst.'; }); } catch (e) { }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
