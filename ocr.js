'use strict';
// קריאת צילומי מסך (OCR) על המכשיר בלבד, והפיכתם לרשומות מוקלדות.
// התור נשמר מוצפן בתוך הכספת, ולכן אפשר לעצור ולהמשיך מאותה תמונה.

// ---- פענוח הטקסט שנקרא ----
const OCR_LABELS = [
  ['pw', 'password|passcode|pass|pwd|סיסמה|סיסמא|ססמה|ססמא'],
  ['user', 'user ?name|user ?id|user|login|account|e-?mail|שם ה?משתמש|משתמש|דוא["״\']?ל|אימייל|מייל'],
  ['site', 'web ?site|web ?page|site|url|address|title|name|אתר|כתובת|כותרת|שם']
];
function parseOcr(text) {
  const lines = String(text || '').split('\n').map(l => l.replace(/[‎‏‪-‮]/g, '').trim()).filter(Boolean);
  const out = { site: '', user: '', pw: '' };
  const labelOf = line => {
    // כותרות בעברית נקראות לעתים משובשות ("nv משתמש"): שורה קצרה שמכילה את המילה היא כותרת
    if (line.length <= 16 && !/[@.:：\d]/.test(line)) {
      if (/משתמש/.test(line)) return { key: 'user', value: '' };
      if (/ס.?סמ[הא]/.test(line)) return { key: 'pw', value: '' };
    }
    for (const [key, words] of OCR_LABELS) {
      const head = line.match(new RegExp('^(?:' + words + ')(?=\\s|[:：]|$)\\s*[:：]?\\s*(.*)$', 'i'));
      if (head) return { key, value: head[1].trim() };
      const tail = line.match(new RegExp('^(.*?)\\s*[:：]\\s*(?:' + words + ')$|^(.*?)\\s+(?:' + words + ')\\s*[:：]$', 'i'));
      if (tail) return { key, value: (tail[1] || tail[2] || '').trim() };
    }
    return null;
  };
  for (let i = 0; i < lines.length; i++) {
    const l = labelOf(lines[i]);
    if (!l || out[l.key]) continue;
    let v = l.value;
    if (!v && lines[i + 1] && !labelOf(lines[i + 1])) v = lines[i + 1];
    out[l.key] = v;
  }
  if (!out.user) { const m = lines.join(' ').match(/[^\s@:]+@[^\s@]+\.[A-Za-z]{2,}/); if (m) out.user = m[0]; }
  if (!out.site) {
    for (const l of lines) {
      if (l.includes('@')) continue;
      const m = l.match(/(?:https?:\/\/)?(?:[A-Za-z0-9-]+\.)+(?:com|net|org|co\.il|org\.il|gov\.il|ac\.il|il|io|co|info|biz)(?:\/\S*)?/i);
      if (m) { out.site = m[0]; break; }
    }
  }
  return { ...out, lines };
}
if (typeof module !== 'undefined') module.exports = { parseOcr };

if (typeof document !== 'undefined') (() => {
  // שני מנועים: עברית+אנגלית לכותרות, ואנגלית בלבד לשמות משתמש וסיסמאות (פחות בלבול)
  const workers = {};
  let current = null, curUrl = null, token = 0, lastField = null, records = [], idx = 0;

  function loadImage(blob) {
    const url = URL.createObjectURL(blob);
    return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; })
      .finally(() => URL.revokeObjectURL(url));
  }
  const toBlob = c => new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('prepare')), 'image/png'));
  // אפור, רקע לבן וכתב כהה (גם במסך כהה) עם חיזוק טקסט בהיר
  function clean(g, w, h) {
    const d = g.getImageData(0, 0, w, h), p = d.data, hist = new Array(256).fill(0);
    for (let i = 0; i < p.length; i += 4) { p[i] = (p[i] * 77 + p[i + 1] * 150 + p[i + 2] * 29) >> 8; hist[p[i]]++; }
    const bg = hist.indexOf(Math.max(...hist));
    for (let i = 0; i < p.length; i += 4) p[i] = p[i + 1] = p[i + 2] = 255 - Math.min(255, Math.abs(p[i] - bg) * 2);
    g.putImageData(d, 0, 0);
  }
  // חיתוך שורה אחת, בגודל שנקרא הכי טוב, עם שוליים לבנים
  function cut(im, r) {
    const m = Math.round(r.h * .25), sx = Math.max(0, r.x - m), sy = Math.max(0, r.y - m);
    const sw = Math.min(im.naturalWidth - sx, r.w + 2 * m), sh = Math.min(im.naturalHeight - sy, r.h + 2 * m);
    const sc = Math.min(2, 48 / r.h), dw = Math.max(1, Math.round(sw * sc)), dh = Math.max(1, Math.round(sh * sc)), pad = 24;
    const inner = document.createElement('canvas'); inner.width = dw; inner.height = dh;
    const ig = inner.getContext('2d'); ig.drawImage(im, sx, sy, sw, sh, 0, 0, dw, dh); clean(ig, dw, dh);
    const c = document.createElement('canvas'); c.width = dw + 2 * pad; c.height = dh + 2 * pad;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(inner, pad, pad);
    return c;
  }

  function getWorker(kind) {
    if (workers[kind]) return workers[kind];
    const p = (async () => {
      if (!window.Tesseract) await new Promise((res, rej) => {
        const s = document.createElement('script'); s.src = 'vendor/tesseract.min.js';
        s.onload = res; s.onerror = () => { s.remove(); rej(new Error('ספריית הקריאה לא נטענה')); };
        document.head.append(s);
      });
      const base = new URL('vendor/', location.href).href;
      return Tesseract.createWorker(kind === 'he' ? ['eng', 'heb'] : ['eng'], 1, {
        workerPath: base + 'worker.min.js', corePath: base.slice(0, -1), langPath: base.slice(0, -1),
        workerBlobURL: false, cacheMethod: 'none'
      });
    })();
    workers[kind] = p; p.catch(() => { delete workers[kind]; });
    return p;
  }
  function stopWorker() { for (const k of Object.keys(workers)) { const p = workers[k]; delete workers[k]; p.then(w => w.terminate()).catch(() => {}); } }
  const tidy = t => String(t || '').replace(/[‎‏‪-‮]/g, '').replace(/\s+/g, ' ').trim();
  async function read(kind, canvas, mode) {
    const w = await getWorker(kind);
    if (w.mode !== mode) { await w.setParameters({ tessedit_pageseg_mode: mode }); w.mode = mode; }
    const { data } = await w.recognize(await toBlob(canvas));
    return data.text;
  }

  // קורא תמונה: קודם לפי מבנה כותרת-כחולה/ערך-שחור, ואם אין כזה, קריאה כללית
  async function readImage(blob, alive, progress) {
    const im = await loadImage(blob);
    const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0);
    const rows = Layout.findRows(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
    const blue = rows.filter(r => r.color === 'blue');
    if (blue.length) {
      const lines = [];
      // כותרות קודם, כדי לזהות את תפריט הפעולות ולא לקרוא את מה שמתחתיו
      for (const r of blue) {
        if (!alive()) return null;
        r.text = tidy(await read('he', cut(im, r), '7'));
        if (/siri|מועדפים/i.test(r.text)) break;
      }
      for (const r of rows) if (r.text === undefined) r.text = '';
      const { fields, firstY } = Layout.pairRows(rows);
      if (fields.length) {
        // כותרת העמוד: השורה השחורה הגדולה ביותר מעל הכותרת הראשונה, מתחת לשורת השעון
        let title = '';
        const above = rows.filter(r => r.color === 'text' && r.y < firstY && r.y > c.height * .055).sort((a, b) => b.h - a.h).slice(0, 3);
        for (const r of above) {
          if (!alive()) return null;
          const t = tidy(await read('he', cut(im, r), '7')).replace(/עריכה|[<>‹›…|]|\.{2,}/g, '').trim();
          if (/[A-Za-zא-ת]{2}/.test(t)) { title = t; break; }
        }
        const list = [];
        for (const f of fields) {
          if (!alive()) return null;
          progress(list.length + 1, fields.length);
          const label = tidy(f.label.map(r => r.text).join(' '));
          // כתובת מייל בכותרת נקראת מדויק יותר במנוע האנגלי
          let fixed = label;
          if (label.includes('@')) for (const r of f.label) {
            const m = tidy(await read('en', cut(im, r), '7')).match(/[^\s@:]+@[^\s@]+\.[A-Za-z]{2,}/);
            if (m) fixed = fixed.replace(/[^\s@:]+@\S+/, m[0]);
          }
          const crop = cut(im, f.value);
          let value = tidy(await read('en', crop, '7'));
          const he = tidy(await read('he', crop, '7'));
          const letters = (he.match(/[א-ת]/g) || []).length;
          if (letters >= 2 && letters > he.replace(/\s/g, '').length / 2) value = he;
          list.push({ label: fixed, value, crop: crop.toDataURL('image/png') });
          lines.push(fixed, value);
        }
        return { records: Layout.buildRecords(title, list), lines: [title, ...lines].filter(Boolean) };
      }
    }
    const sc = Math.min(1, 830 / im.naturalWidth);
    const s = document.createElement('canvas'); s.width = Math.round(im.naturalWidth * sc); s.height = Math.round(im.naturalHeight * sc);
    const sg = s.getContext('2d'); sg.drawImage(im, 0, 0, s.width, s.height); clean(sg, s.width, s.height);
    const p = parseOcr(await read('he', s, '3'));
    return { records: [{ site: p.site, user: p.user, pw: p.pw }], lines: p.lines };
  }

  function clearFields() { ['o-site', 'o-user', 'o-pw'].forEach(i => $(i).value = ''); $('o-crop').hidden = true; $('o-crop').removeAttribute('src'); }
  function clearScreen() {
    token++; current = null; lastField = null; records = []; idx = 0;
    if (curUrl) URL.revokeObjectURL(curUrl); curUrl = null;
    $('o-img').removeAttribute('src'); clearFields();
    $('o-lines').textContent = ''; $('o-status').textContent = '';
  }
  // נקרא בנעילה: מוחק מהמסך ומהזיכרון כל מה שנקרא
  window.ocrReset = () => { clearScreen(); stopWorker(); releaseWake(); };
  let wake = null;
  function releaseWake() { if (wake) wake.release().catch(() => {}); wake = null; }

  function busy(on) { ['o-ok', 'o-more', 'o-skip'].forEach(i => $(i).disabled = on); }

  // ---- בחירת תמונות והכנסה לתור ----
  async function enqueue(files) {
    if (!dk) return toast('הכספת ננעלה בזמן הבחירה. פתח אותה ונסה שוב');
    const auto = await dialog('איך לקרוא את ' + files.length + ' התמונות? אוטומטי: הכול נשמר ומסומן 🤖 לאימות, והתיקיות נבחרות לבד.', { ok: 'אוטומטי', no: 'אחת אחת' });
    if (!dk) return;
    const folder = auto ? cur : await pickFolder('לאיזו תיקייה להכניס את ' + files.length + ' התמונות?', cur);
    if (folder === undefined || !dk) return;
    let added = 0;
    try {
      for (const f of files) {
        toast('מצפין תמונה ' + (added + 1) + ' מתוך ' + files.length + '...'); touch();
        const bytes = await shrink(f, 2600);
        if (!dk) return;
        const imgId = crypto.randomUUID();
        await kv.set('img:' + imgId, await VC.encBytes(dk, bytes));
        if (!dk) return;
        queue.push({ id: crypto.randomUUID(), imgId, folder, from: null });
        await saveItems(); added++;
      }
    } catch (e) { toast('הוספת תמונה נכשלה אחרי ' + added + ' תמונות'); }
    if (!added || !dk) return;
    if (auto) { queue.slice(-added).forEach(q => q.auto = true); await saveItems(); }
    next();
  }
  $('m-ocr').onclick = () => { picking = true; clearTimeout(idleT); $('o-file').click(); };
  $('o-file').onchange = e => { const files = [...e.target.files]; e.target.value = ''; if (files.length) enqueue(files); };
  $('m-resume').onclick = () => next();

  // תמונות שכבר שמורות בכספת
  $('v-ocrbtn').onclick = async () => {
    const it = viewing; if (!it) return;
    const folder = await pickFolder('לאיזו תיקייה להכניס את הרשומות?', it.folder);
    if (folder === undefined || !dk) return;
    for (const imgId of it.imgs || []) if (!queue.some(q => q.imgId === imgId)) queue.push({ id: crypto.randomUUID(), imgId, folder, from: it.id });
    await saveItems(); clearImgs(); viewing = null; next();
  };

  // כל התמונות ששמורות בתיקייה הנוכחית (כולל תתי-תיקיות), בקריאה אוטומטית
  window.ocrPhotos = () => {
    const ids = cur ? inside(cur) : null;
    return items.filter(i => i.kind === 'photo' && !i.noText && (!ids || ids.includes(i.folder)));
  };
  $('m-auto').onclick = async () => {
    const photos = ocrPhotos(), n = photos.reduce((s, p) => s + (p.imgs || []).length, 0);
    if (!n || !(await dialog('לקרוא אוטומטית ' + n + ' תמונות? כל מה שיזוהה יישמר ויסומן 🤖 לאימות. השאר את המסך פתוח.', { ok: 'התחלה' })) || !dk) return;
    for (const it of photos) for (const imgId of it.imgs || []) {
      const old = queue.find(q => q.imgId === imgId);
      if (old) old.auto = true;
      else queue.push({ id: crypto.randomUUID(), imgId, folder: it.folder, from: it.id, auto: true });
    }
    await saveItems(); next();
  };
  function folderId(name) {
    let f = folders.find(x => x.name === name && !x.parent) || folders.find(x => x.name === name);
    if (!f) { f = { id: crypto.randomUUID(), name, parent: null }; folders.push(f); }
    return f.id;
  }
  // שמירת כל הרשומות מתמונה אחת בבת אחת, כך שעצירה באמצע לא יוצרת כפילויות
  async function saveAuto(q, found) {
    const list = found.slice(q.done || 0).filter(r => r.pw || r.user);
    for (const r of list) {
      const site = (r.site || '').trim() || 'לא זוהה שם';
      items.push({ id: crypto.randomUUID(), site, user: r.user || '', pw: r.pw || '', folder: folderId(Layout.guessFolder(site)), imgs: [q.imgId], review: true });
    }
    if (list.length || q.saved) detach(q);
    else if (q.from) { const src = items.find(i => i.id === q.from); if (src) src.noText = true; }
    else { keepAsPhoto(q); items[items.length - 1].noText = true; }
    queue.shift(); await saveItems();
  }

  // ---- מסך אישור ----
  async function next() {
    clearScreen();
    if (!dk) return;
    if (!queue.length) {
      stopWorker(); releaseWake(); show('main'); renderList();
      const n = items.filter(i => i.review).length; if (n) toast(n + ' רשומות מחכות לאימות 🤖');
      return;
    }
    const q = queue[0], my = token, alive = () => my === token && !!dk;
    current = q; show('ocr'); window.scrollTo(0, 0); busy(true); touch();
    $('o-form').hidden = !!q.auto;
    if (q.auto && navigator.wakeLock) navigator.wakeLock.request('screen').then(l => wake = l).catch(() => {});
    $('o-count').textContent = 'נשארו ' + queue.length + ' תמונות';
    fillFolders($('o-folder'), q.folder);
    let blob;
    try {
      const rec = await kv.get('img:' + q.imgId);
      blob = new Blob([await VC.decBytes(dk, rec)], { type: 'image/jpeg' });
    } catch (_) {
      if (!alive()) return;
      queue.shift(); await saveItems(); toast('תמונה אחת לא נפתחה והוצאה מהתור'); return next();
    }
    if (!alive()) return;
    curUrl = URL.createObjectURL(blob); $('o-img').src = curUrl;
    $('o-status').textContent = 'קורא את התמונה...';
    // בזמן קריאה לא ננעלים מחוסר פעילות
    const keep = setInterval(() => { if (alive()) touch(); }, 10000);
    const limit = setTimeout(() => clearInterval(keep), 180000);
    try {
      const out = await readImage(blob, alive, (n, of) => { $('o-status').textContent = 'קורא שדה ' + n + ' מתוך ' + of + '...'; });
      if (!out || !alive()) return;
      if (q.auto) { await saveAuto(q, out.records); if (alive()) next(); return; }
      records = out.records.length ? out.records : [{ site: '', user: '', pw: '' }];
      showLines(out.lines);
      // אם נעצר באמצע תמונה, ממשיכים מהרשומה שאחרי האחרונה שטופלה
      idx = Math.min(q.done || 0, records.length - 1);
      showRecord();
    } catch (e) {
      if (!alive()) return;
      stopWorker(); records = [{ site: '', user: '', pw: '' }];
      // באוטומטי נעצרים על תמונה שנכשלה: אפשר לדלג עליה או לעצור
      q.auto = false; $('o-form').hidden = false;
      $('o-status').textContent = 'הקריאה נכשלה. אפשר להקליד ידנית או לשמור כתמונה.';
    } finally {
      clearInterval(keep); clearTimeout(limit);
      if (my === token) { busy(false); touch(); }
    }
  }
  function showRecord() {
    const r = records[idx];
    clearFields();
    $('o-site').value = r.site || ''; $('o-user').value = r.user || ''; $('o-pw').value = r.pw || '';
    if (r.crop) { $('o-crop').src = r.crop; $('o-crop').hidden = false; }
    $('o-count').textContent = 'נשארו ' + queue.length + ' תמונות' + (records.length > 1 ? ' · רשומה ' + (idx + 1) + ' מתוך ' + records.length + ' בתמונה הזאת' : '');
    $('o-status').textContent = /[0Oo1lI|]/.test(r.pw || '')
      ? 'בדוק היטב בסיסמה: אפס מול O, אחת מול l ו-I'
      : 'בדוק מול התמונה ותקן אם צריך';
  }
  // שורות שנקראו: לחיצה מכניסה את השורה לשדה שנבחר אחרון
  function showLines(lines) {
    const box = $('o-lines'); box.textContent = '';
    for (const l of lines) {
      const b = document.createElement('button'); b.textContent = l; b.dir = 'auto';
      b.onclick = () => {
        if (!lastField) return toast('לחץ קודם על השדה שרוצים למלא, ואז על השורה');
        lastField.value = l;
      };
      box.append(b);
    }
  }
  ['o-site', 'o-user', 'o-pw'].forEach(i => $(i).onfocus = () => lastField = $(i));

  // מוציא את התמונה מרשומת התמונות המקורית (התמונה עצמה עוברת לרשומות החדשות)
  function detach(q) {
    const src = q.from && items.find(i => i.id === q.from);
    if (!src || src.kind !== 'photo') return;
    src.imgs = (src.imgs || []).filter(x => x !== q.imgId);
    if (!src.imgs.length) items = items.filter(i => i !== src);
  }
  // מעבר לרשומה הבאה באותה תמונה, או סיום התמונה
  async function advance() {
    const q = current;
    q.done = idx + 1;
    if (q.done < records.length) {
      await saveItems();
      if (!dk) return;
      idx++; showRecord(); busy(false); touch(); window.scrollTo(0, 0); return;
    }
    if (q.saved) detach(q); else keepAsPhoto(q);
    queue.shift(); await saveItems(); next();
  }
  async function approve(more) {
    const q = current; if (!q || !dk) return;
    const site = $('o-site').value.trim(), user = $('o-user').value.trim(), pw = $('o-pw').value.trim();
    if (!site || !pw) return toast('חסר אתר או סיסמה');
    busy(true);
    const folder = $('o-folder').value || null;
    items.push({ id: crypto.randomUUID(), site, user, pw, folder, imgs: [q.imgId] });
    q.saved = true; q.folder = folder;
    if (more) {
      await saveItems(); if (!dk) return;
      clearFields(); busy(false); touch(); window.scrollTo(0, 0);
      return toast('נשמר. מלא את הרשומה הנוספת מאותה תמונה');
    }
    toast('נשמר'); await advance();
  }
  // תמונה מהגלריה שלא נשמרה ממנה שום רשומה נשמרת כרשומת תמונה; תמונה שכבר בכספת נשארת במקומה
  function keepAsPhoto(q) {
    if (q.from || q.saved) return;
    const name = (current === q && $('o-site').value.trim()) || 'תמונה לבדיקה ' + new Date().toLocaleDateString('he-IL');
    const folder = current === q ? ($('o-folder').value || null) : q.folder;
    items.push({ id: crypto.randomUUID(), site: name, user: '', pw: '', kind: 'photo', imgs: [q.imgId], folder });
  }
  $('o-ok').onclick = () => approve(false);
  $('o-more').onclick = () => approve(true);
  $('o-skip').onclick = async () => { if (!current || !dk) return; busy(true); await advance(); };
  $('o-stop').onclick = () => { clearScreen(); stopWorker(); releaseWake(); show('main'); renderList(); window.scrollTo(0, 0); };
  $('o-all').onclick = async () => {
    if (!(await dialog('לסיים בלי לקרוא את שאר התמונות? הן יישמרו כתמונות.')) || !dk) return;
    queue.forEach(q => { if (q.saved) detach(q); else keepAsPhoto(q); }); queue = []; await saveItems(); next();
  };
})();

