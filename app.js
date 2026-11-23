'use strict';
const $ = id => document.getElementById(id);
const views = ['setup', 'lock', 'main', 'edit', 'set'];
let vault = null, dk = null, items = [], editing = null, idleT = null, clipT = null;
const IDLE_MS = 60000, CLIP_MS = 30000, BACKUP_DAYS = 30;

// ---- אחסון (IndexedDB) ----
const db = new Promise((res, rej) => {
  const r = indexedDB.open('vault', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
const kv = {
  async get(k) { const d = await db; return new Promise((res, rej) => { const q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); },
  async set(k, v) { const d = await db; return new Promise((res, rej) => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
};

function show(v) { views.forEach(n => $('v-' + n).hidden = n !== v); }
function toast(t) { const e = $('toast'); e.textContent = t; e.hidden = false; setTimeout(() => e.hidden = true, 2500); }

// ---- נעילה ----
function lock() {
  dk = null; items = []; editing = null;
  $('m-q').value = ''; $('e-pw').value = ''; $('l-pw').value = '';
  $('m-list').textContent = '';
  show(vault ? 'lock' : 'setup');
}
function touch() { clearTimeout(idleT); if (dk) idleT = setTimeout(lock, IDLE_MS); }
['click', 'keydown', 'touchstart'].forEach(e => document.addEventListener(e, touch, { passive: true }));
document.addEventListener('visibilitychange', () => { if (document.hidden && dk) lock(); });
window.addEventListener('pagehide', () => { if (dk) lock(); });

async function persistVault() { await kv.set('vault', vault); }
async function saveItems() { await VC.writeItems(vault, dk, items); await persistVault(); }

// ---- הקמה ----
$('s-go').onclick = async () => {
  const a = $('s-pw1').value, b = $('s-pw2').value;
  if (a.length < 10) return $('s-err').textContent = 'הסיסמה קצרה מדי (לפחות 10 תווים)';
  if (a !== b) return $('s-err').textContent = 'הסיסמאות לא זהות';
  $('s-err').textContent = 'יוצר...';
  const r = await VC.create(a);
  vault = r.vault; dk = r.dk; items = [];
  await persistVault();
  $('s-pw1').value = $('s-pw2').value = ''; $('s-err').textContent = '';
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  enter();
};
$('s-file').onchange = e => importFile(e.target.files[0], true);

// ---- פתיחה ----
async function tryUnlockPw() {
  const pw = $('l-pw').value; if (!pw) return;
  $('l-err').textContent = 'פותח...';
  try {
    dk = await VC.unlockPw(vault, pw);
    items = await VC.readItems(vault, dk);
    $('l-pw').value = ''; $('l-err').textContent = '';
    enter();
  } catch (_) {
    dk = null; $('l-err').textContent = 'סיסמה שגויה';
  }
}
$('l-go').onclick = tryUnlockPw;
$('l-pw').onkeydown = e => { if (e.key === 'Enter') tryUnlockPw(); };

async function tryFace() {
  try {
    const credId = await kv.get('credId');
    const salt = await kv.get('prfSalt');
    const cred = await navigator.credentials.get({ publicKey: {
      challenge: VC.rnd(32), rpId: location.hostname, userVerification: 'required', timeout: 60000,
      allowCredentials: [{ type: 'public-key', id: credId }],
      extensions: { prf: { eval: { first: salt } } }
    } });
    const r = cred.getClientExtensionResults().prf;
    if (!r || !r.results || !r.results.first) throw new Error('no prf');
    dk = await VC.unlockPrf(vault, r.results.first);
    items = await VC.readItems(vault, dk);
    enter();
  } catch (_) { dk = null; $('l-err').textContent = 'Face ID לא הצליח. אפשר עם סיסמה.'; }
}
$('l-face').onclick = tryFace;

// ---- מסך ראשי ----
function enter() { show('main'); renderList(); backupWarn(); touch(); }
$('m-q').oninput = renderList;
function renderList() {
  const q = $('m-q').value.trim().toLowerCase();
  const ul = $('m-list'); ul.textContent = '';
  const shown = items.filter(i => !q || i.site.toLowerCase().includes(q) || i.user.toLowerCase().includes(q))
    .sort((a, b) => a.site.localeCompare(b.site));
  if (!shown.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = items.length ? 'לא נמצא' : 'עדיין אין סיסמאות. לחץ על ＋'; ul.append(li); return; }
  for (const it of shown) {
    const li = document.createElement('li');
    const info = document.createElement('div'); info.className = 'info';
    const s = document.createElement('b'); s.textContent = it.site;
    const u = document.createElement('span'); u.textContent = it.user;
    info.append(s, u); info.onclick = () => openEdit(it);
    const cp = document.createElement('button'); cp.textContent = 'העתק'; cp.onclick = () => copyPw(it);
    li.append(info, cp); ul.append(li);
  }
}
async function copyPw(it) {
  try {
    await navigator.clipboard.writeText(it.pw);
    toast('הועתק. יימחק בעוד 30 שניות');
    clearTimeout(clipT);
    clipT = setTimeout(() => { navigator.clipboard.writeText(' ').catch(() => {}); }, CLIP_MS);
  } catch (_) { toast('ההעתקה נחסמה'); }
}
$('m-lock').onclick = lock;
$('m-set').onclick = () => { $('t-msg').textContent = ''; show('set'); };
$('t-back').onclick = () => show('main');
async function backupWarn() {
  const last = await kv.get('lastBackup');
  const w = $('m-warn');
  if (!items.length) { w.hidden = true; return; }
  const days = last ? (Date.now() - last) / 864e5 : Infinity;
  w.hidden = days < BACKUP_DAYS;
  w.textContent = last ? `הגיבוי האחרון לפני ${Math.floor(days)} ימים. הגיע הזמן לייצא.` : 'עוד לא בוצע גיבוי. הגדרות ← ייצוא גיבוי.';
}

// ---- עריכה ----
function openEdit(it) {
  editing = it || null;
  $('e-title').textContent = it ? 'עריכה' : 'רשומה חדשה';
  $('e-site').value = it ? it.site : ''; $('e-user').value = it ? it.user : ''; $('e-pw').value = it ? it.pw : '';
  $('e-pw').type = 'password'; $('e-del').hidden = !it; show('edit');
}
$('m-add').onclick = () => openEdit(null);
$('e-show').onclick = () => { const p = $('e-pw'); p.type = p.type === 'password' ? 'text' : 'password'; };
$('e-gen').onclick = () => { $('e-pw').value = VC.gen(20); $('e-pw').type = 'text'; };
$('e-cancel').onclick = () => { $('e-pw').value = ''; show('main'); };
$('e-save').onclick = async () => {
  const site = $('e-site').value.trim(), user = $('e-user').value.trim(), pw = $('e-pw').value;
  if (!site || !pw) return toast('חסר אתר או סיסמה');
  if (editing) Object.assign(editing, { site, user, pw });
  else items.push({ id: crypto.randomUUID(), site, user, pw });
  await saveItems(); $('e-pw').value = ''; show('main'); renderList(); touch();
};
$('e-del').onclick = async () => {
  if (!editing || !confirm('למחוק את הרשומה?')) return;
  items = items.filter(i => i !== editing); await saveItems(); $('e-pw').value = ''; show('main'); renderList();
};

// ---- הגדרות: גיבוי ו-Face ID ----
$('t-exp').onclick = async () => {
  const blob = new Blob([JSON.stringify({ v: vault.v, salt: vault.salt, iter: vault.iter, wrapPw: vault.wrapPw, data: vault.data })], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'vault-backup-' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.append(a); a.click(); a.remove();
  await kv.set('lastBackup', Date.now()); $('t-msg').textContent = 'הגיבוי נוצר. שמור אותו בענן הפרטי שלך.';
};
$('t-imp').onchange = e => importFile(e.target.files[0], false);
async function importFile(file, fromSetup) {
  if (!file) return;
  try {
    const v = JSON.parse(await file.text());
    if (v.v !== 1 || !v.salt || !v.wrapPw || !v.data) throw new Error('bad');
    if (!fromSetup && !confirm('הייבוא יחליף את כל הכספת הקיימת. להמשיך?')) return;
    vault = { v: v.v, salt: v.salt, iter: v.iter, wrapPw: v.wrapPw, data: v.data };
    await persistVault();
    await kv.set('credId', null);
    toast('יובא. פתח עם הסיסמה הראשית'); lock(); initLock();
  } catch (_) { toast('הקובץ לא תקין'); }
}
$('t-face').onclick = async () => {
  const pw = $('t-pw').value;
  if (!pw) { $('t-msg').textContent = 'הקלד קודם את הסיסמה הראשית בשדה שמעל הכפתור.'; return; }
  let step = 'start';
  try {
    // קודם מבקשים Face ID (חייב להיות מיד אחרי הלחיצה), ורק אחר כך בודקים סיסמה
    const salt = VC.rnd(32);
    step = 'create';
    const cred = await navigator.credentials.create({ publicKey: {
      challenge: VC.rnd(32), rp: { name: 'כספת', id: location.hostname },
      user: { id: VC.rnd(16), name: 'vault', displayName: 'כספת' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      extensions: { prf: { eval: { first: salt } } }
    } });
    let res = cred.getClientExtensionResults().prf;
    let secret = res && res.results && res.results.first;
    if (!secret) {
      step = 'get';
      const a = await navigator.credentials.get({ publicKey: { challenge: VC.rnd(32), rpId: location.hostname, userVerification: 'required',
        allowCredentials: [{ type: 'public-key', id: cred.rawId }], extensions: { prf: { eval: { first: salt } } } } });
      res = a.getClientExtensionResults().prf; secret = res && res.results && res.results.first;
    }
    if (!secret) { $('t-msg').textContent = 'המכשיר לא תומך ב-Face ID לכספת. נשארים עם סיסמה.'; return; }
    step = 'wrap';
    await VC.addPrf(vault, pw, secret);
    await kv.set('credId', new Uint8Array(cred.rawId)); await kv.set('prfSalt', salt); await persistVault();
    $('t-pw').value = '';
    $('t-msg').textContent = 'Face ID הופעל.';
  } catch (e) {
    $('t-msg').textContent = step === 'wrap' ? 'הסיסמה הראשית שגויה.' : 'נכשל בשלב ' + step + ': ' + (e && e.name) + ' - ' + (e && e.message ? e.message.slice(0, 80) : '');
  }
};

// ---- הפעלה ----
async function initLock() {
  const hasFace = !!(vault && vault.wrapPrf && await kv.get('credId'));
  $('l-face').hidden = !hasFace;
  if (hasFace && !document.hidden) setTimeout(tryFace, 300);
}
(async () => {
  vault = (await kv.get('vault')) || null;
  show(vault ? 'lock' : 'setup');
  if (vault) initLock();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
