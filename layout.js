'use strict';
// ניתוח מבנה המסך של הכספת הקודמת: כותרת שדה בכחול, ומתחתיה הערך בשחור.
const Layout = (() => {
  // מוצא שורות טקסט כחולות ושחורות לפי צבע הפיקסלים. מחזיר רשימה לפי סדר מלמעלה למטה
  function findRows(data, w, h) {
    const hist = new Array(256).fill(0);
    for (let i = 0; i < data.length; i += 16) hist[(data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8]++;
    const dark = hist.indexOf(Math.max(...hist)) < 100;
    const x0 = Math.round(w * .04), x1 = Math.round(w * .96);
    const rows = [];
    for (const color of ['blue', 'text']) {
      const isInk = i => {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const blue = b > 150 && b - r > 70;
        if (color === 'blue') return blue;
        return dark ? Math.min(r, g, b) > 170 : Math.max(r, g, b) < 110;
      };
      let open = null;
      const gapMax = Math.max(2, Math.round(w * .004));
      const close = () => {
        if (!open) return;
        const height = open.y1 - open.y0 + 1;
        if (height >= w * .012 && height <= w * .12) rows.push({ color, x: open.x0, y: open.y0, w: open.x1 - open.x0 + 1, h: height });
        open = null;
      };
      for (let y = 0; y < h; y++) {
        let n = 0, a = w, b = 0;
        for (let x = x0; x < x1; x++) if (isInk((y * w + x) * 4)) { n++; if (x < a) a = x; if (x > b) b = x; }
        if (n >= 2) {
          if (!open) open = { y0: y, y1: y, x0: a, x1: b };
          else { open.y1 = y; open.x0 = Math.min(open.x0, a); open.x1 = Math.max(open.x1, b); }
        } else if (open && y - open.y1 > gapMax) close();
      }
      close();
    }
    return rows.sort((a, b) => a.y - b.y);
  }

  // מזווג כותרות כחולות עם הערך שמתחתיהן. עוצר בתפריט הפעולות שבתחתית המסך
  const MENU = /siri|מועדפים|שיתוף|שיכפול|שכפול|לאשפה|ארכיון/i;
  function pairRows(rows) {
    const fields = []; let label = null, field = null, first = null;
    for (const r of rows) {
      if (r.color === 'blue') {
        if (MENU.test(r.text)) break;
        if (first === null) first = r.y;
        if (label && !field && r.y - label.bottom < label.h * 1.1) { label.rows.push(r); label.bottom = r.y + r.h; }
        else label = { rows: [r], bottom: r.y + r.h, h: r.h };
        field = null;
      } else if (label) {
        if (!field && r.y - label.bottom < label.h * 2) { field = { label: label.rows, value: r, bottom: r.y + r.h }; fields.push(field); }
      }
    }
    return { fields, firstY: first };
  }

  const EMAIL = /[^\s@:]+@[^\s@]+\.[A-Za-z]{2,}/;
  const IS_PW = /ס.?ס?מ[אה]|password|passcode|^pass|pwd|קוד/i;
  // "יוזר" נקרא לעתים "יוחר" או "יוור"
  const IS_USER = /יו[זחו]ר|משתמש|user|login|מייל|e-?mail/i;
  const IS_NAME = /שם|אתר|כתובת|site|url|name/i;
  // fields: [{label, value, crop}] -> רשומות [{site, user, pw, crop}]
  function buildRecords(title, fields) {
    const out = []; let pending = [];
    const join = (...parts) => [...new Set(parts.map(p => (p || '').trim()).filter(Boolean))].join(' – ');
    const standalone = f => {
      const m = f.label.match(EMAIL);
      out.push({ site: join(title, f.label.replace(EMAIL, '')), user: m ? m[0] : '', pw: f.value, crop: f.crop });
    };
    for (const f of fields) {
      if (IS_PW.test(f.label)) {
        let user = pending.filter(p => IS_USER.test(p.label)).pop();
        let name = pending.filter(p => p !== user && IS_NAME.test(p.label)).pop();
        let site = name ? name.value : '', userValue = user ? user.value : '';
        // בלי כותרת "יוזר": השדה שלפני הסיסמה הוא שם השירות, והערך שלו הוא שם המשתמש
        if (!user) {
          const prev = pending.filter(p => p !== name).pop();
          if (prev) { site = join(site, prev.label); userValue = prev.value; user = prev; }
        }
        pending.filter(p => p !== user && p !== name).forEach(standalone);
        out.push({ site: join(title, site), user: userValue, pw: f.value, crop: f.crop });
        pending = [];
      } else if (EMAIL.test(f.label)) {
        pending.forEach(standalone); pending = []; standalone(f);
      } else pending.push(f);
    }
    const user = pending.find(p => IS_USER.test(p.label));
    if (user) {
      const name = pending.find(p => p !== user && IS_NAME.test(p.label));
      out.push({ site: join(title, name && name.value), user: user.value, pw: '', crop: user.crop });
      pending.filter(p => p !== user && p !== name).forEach(standalone);
    } else pending.forEach(standalone);
    return out;
  }
  return { findRows, pairRows, buildRecords };
})();
if (typeof module !== 'undefined') module.exports = Layout;
