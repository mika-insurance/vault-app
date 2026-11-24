'use strict';
// הצפנה: מפתח נתונים אקראי (DK) מוצפן ב-AES-GCM. DK עטוף בסיסמה ראשית (PBKDF2) ואופציונלית ב-Face ID (WebAuthn PRF).
const VC = (() => {
  const enc = new TextEncoder(), dec = new TextDecoder();
  const ITER = 600000;
  const b64 = b => {
    // בחלקים: הפצת מערך גדול ל-fromCharCode קורסת בתמונות אמיתיות (מאות KB ומעלה)
    const u = new Uint8Array(b); let s = '';
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const rnd = n => crypto.getRandomValues(new Uint8Array(n));

  async function pwKey(pw, salt, iter) {
    const base = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function prfKey(secret) {
    const base = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode('vault-prf') },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function seal(key, bytes) {
    const iv = rnd(12);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
    return { iv: b64(iv), ct: b64(ct) };
  }
  async function open(key, o) {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(o.iv) }, key, unb64(o.ct)));
  }
  const dkImport = raw => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);

  // יצירת כספת חדשה. מחזיר {vault, dk}
  async function create(pw) {
    const salt = rnd(16), raw = rnd(32);
    const k = await pwKey(pw, salt, ITER);
    const wrapPw = await seal(k, raw);
    const dk = await dkImport(raw);
    const vault = { v: 1, salt: b64(salt), iter: ITER, wrapPw, data: await seal(dk, enc.encode('[]')) };
    return { vault, dk };
  }
  // פתיחה עם סיסמה. זורק שגיאה אם שגויה
  async function unlockPw(vault, pw) {
    const k = await pwKey(pw, unb64(vault.salt), vault.iter);
    const raw = await open(k, vault.wrapPw);
    return dkImport(raw);
  }
  async function unlockPrf(vault, secret) {
    const raw = await open(await prfKey(secret), vault.wrapPrf);
    return dkImport(raw);
  }
  // הוספת עטיפת Face ID: צריך את DK כמפתח גולמי, לכן פותחים שוב עם הסיסמה
  async function addPrf(vault, pw, secret) {
    const k = await pwKey(pw, unb64(vault.salt), vault.iter);
    const raw = await open(k, vault.wrapPw);
    vault.wrapPrf = await seal(await prfKey(secret), raw);
  }
  async function readItems(vault, dk) { return JSON.parse(dec.decode(await open(dk, vault.data))); }
  async function writeItems(vault, dk, items) { vault.data = await seal(dk, enc.encode(JSON.stringify(items))); }

  function gen(len = 20) {
    const set = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*-_=+?';
    const lim = 256 - (256 % set.length);
    let out = '';
    while (out.length < len) for (const b of rnd(len)) { if (b < lim && out.length < len) out += set[b % set.length]; }
    return out;
  }
  const encBytes = (key, bytes) => seal(key, bytes);
  const decBytes = (key, o) => open(key, o);
  return { create, unlockPw, unlockPrf, addPrf, readItems, writeItems, encBytes, decBytes, gen, b64, unb64, rnd };
})();
if (typeof module !== 'undefined') module.exports = VC;
