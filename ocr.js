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
  let worker = null, current = null, curUrl = null, token = 0, lastField = null;

  // הכנה לקריאה: אפור, רקע לבן וכתב כהה (גם במסך כהה), חיזוק כותרות בהירות והקטנה לרוחב שנקרא הכי טוב
  async function prepare(blob) {
    const url = URL.createObjectURL(blob);
    try {
      const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const sc = Math.min(1, 830 / im.naturalWidth);
      const c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * sc); c.height = Math.round(im.naturalHeight * sc);
      const g = c.getContext('2d'); g.drawImage(im, 0, 0, c.width, c.height);
      const d = g.getImageData(0, 0, c.width, c.height), p = d.data, hist = new Array(256).fill(0);
      for (let i = 0; i < p.length; i += 4) { p[i] = (p[i] * 77 + p[i + 1] * 150 + p[i + 2] * 29) >> 8; hist[p[i]]++; }
      const bg = hist.indexOf(Math.max(...hist));
      for (let i = 0; i < p.length; i += 4) p[i] = p[i + 1] = p[i + 2] = 255 - Math.min(255, Math.abs(p[i] - bg) * 2);
      g.putImageData(d, 0, 0);
      return await new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('prepare')), 'image/png'));
    } finally { URL.revokeObjectURL(url); }
  }

  async function getWorker() {
    if (worker) return worker;
    if (!window.Tesseract) await new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = 'vendor/tesseract.min.js';
      s.onload = res; s.onerror = () => { s.remove(); rej(new Error('ספריית הקריאה לא נטענה')); };
      document.head.append(s);
    });
    const base = new URL('vendor/', location.href).href;
    worker = Tesseract.createWorker(['eng', 'heb'], 1, {
      workerPath: base + 'worker.min.js', corePath: base.slice(0, -1), langPath: base.slice(0, -1),
      workerBlobURL: false, cacheMethod: 'none'
    }).catch(e => { worker = null; throw e; });
    return worker;
  }
  function stopWorker() { const w = worker; worker = null; if (w) Promise.resolve(w).then(x => x.terminate()).catch(() => {}); }

  function clearScreen() {
    token++; current = null; lastField = null;
    if (curUrl) URL.revokeObjectURL(curUrl); curUrl = null;
    $('o-img').removeAttribute('src');
    ['o-site', 'o-user', 'o-pw'].forEach(i => $(i).value = '');
    $('o-lines').textContent = ''; $('o-status').textContent = '';
  }
  // נקרא בנעילה: מוחק מהמסך ומהזיכרון כל מה שנקרא
  window.ocrReset = () => { clearScreen(); stopWorker(); };

  function busy(on) { ['o-ok', 'o-more', 'o-skip'].forEach(i => $(i).disabled = on); }

  // ---- בחירת תמונות והכנסה לתור ----
  async function enqueue(files) {
    if (!dk) return toast('הכספת ננעלה בזמן הבחירה. פתח אותה ונסה שוב');
    const folder = await pickFolder('לאיזו תיקייה להכניס את ' + files.length + ' התמונות?', cur);
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
    if (added && dk) next();
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

  // ---- מסך אישור ----
  async function next() {
    clearScreen();
    if (!dk) return;
    if (!queue.length) { stopWorker(); show('main'); renderList(); return; }
    const q = queue[0], my = token;
    current = q; show('ocr'); window.scrollTo(0, 0); busy(true); touch();
    $('o-count').textContent = 'נשארו ' + queue.length + ' תמונות';
    fillFolders($('o-folder'), q.folder);
    let blob;
    try {
      const rec = await kv.get('img:' + q.imgId);
      blob = new Blob([await VC.decBytes(dk, rec)], { type: 'image/jpeg' });
    } catch (_) {
      if (my !== token || !dk) return;
      queue.shift(); await saveItems(); toast('תמונה אחת לא נפתחה והוצאה מהתור'); return next();
    }
    if (my !== token) return;
    curUrl = URL.createObjectURL(blob); $('o-img').src = curUrl;
    $('o-status').textContent = 'קורא את התמונה...';
    // בזמן קריאה לא ננעלים מחוסר פעילות
    const keep = setInterval(() => { if (my === token) touch(); }, 10000);
    const limit = setTimeout(() => clearInterval(keep), 120000);
    try {
      const w = await getWorker();
      const { data } = await w.recognize(await prepare(blob));
      if (my !== token) return;
      const p = parseOcr(data.text);
      // לא דורסים מה שכבר הוקלד בזמן ההמתנה
      for (const [id, v] of [['o-site', p.site], ['o-user', p.user], ['o-pw', p.pw]]) if (!$(id).value) $(id).value = v;
      showLines(p.lines);
      $('o-status').textContent = /[0Oo1lI|]/.test($('o-pw').value)
        ? 'בדוק היטב בסיסמה: אפס מול O, אחת מול l ו-I'
        : 'בדוק מול התמונה ותקן אם צריך';
    } catch (e) {
      if (my !== token) return;
      stopWorker();
      $('o-status').textContent = 'הקריאה נכשלה. אפשר להקליד ידנית או לשמור כתמונה.';
    } finally {
      clearInterval(keep); clearTimeout(limit);
      if (my === token) { busy(false); touch(); }
    }
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

  // מוציא את התמונה מרשומת התמונות המקורית (התמונה עצמה עוברת לרשומה החדשה)
  function detach(q) {
    const src = q.from && items.find(i => i.id === q.from);
    if (!src || src.kind !== 'photo') return;
    src.imgs = (src.imgs || []).filter(x => x !== q.imgId);
    if (!src.imgs.length) items = items.filter(i => i !== src);
  }
  async function approve(more) {
    const q = current; if (!q || !dk) return;
    const site = $('o-site').value.trim(), user = $('o-user').value.trim(), pw = $('o-pw').value.trim();
    if (!site || !pw) return toast('חסר אתר או סיסמה');
    busy(true);
    const folder = $('o-folder').value || null;
    items.push({ id: crypto.randomUUID(), site, user, pw, folder, imgs: [q.imgId] });
    detach(q);
    q.saved = true; q.folder = folder;
    if (!more) queue.shift();
    await saveItems();
    if (!dk) return;
    if (more) {
      ['o-site', 'o-user', 'o-pw'].forEach(i => $(i).value = ''); busy(false); touch(); window.scrollTo(0, 0);
      return toast('נשמר. מלא את הרשומה הבאה מאותה תמונה');
    }
    toast('נשמר'); next();
  }
  // דילוג: תמונה מהגלריה נשמרת כרשומת תמונה; תמונה שכבר בכספת נשארת במקומה
  function keepAsPhoto(q) {
    if (q.from || q.saved) return;
    const name = (current === q && $('o-site').value.trim()) || 'תמונה לבדיקה ' + new Date().toLocaleDateString('he-IL');
    const folder = current === q ? ($('o-folder').value || null) : q.folder;
    items.push({ id: crypto.randomUUID(), site: name, user: '', pw: '', kind: 'photo', imgs: [q.imgId], folder });
  }
  $('o-ok').onclick = () => approve(false);
  $('o-more').onclick = () => approve(true);
  $('o-skip').onclick = async () => {
    const q = current; if (!q || !dk) return;
    busy(true); keepAsPhoto(q); queue.shift(); await saveItems(); next();
  };
  $('o-stop').onclick = () => { clearScreen(); stopWorker(); show('main'); renderList(); window.scrollTo(0, 0); };
  $('o-all').onclick = async () => {
    if (!(await dialog('לסיים בלי לקרוא את שאר התמונות? הן יישמרו כתמונות.')) || !dk) return;
    queue.forEach(keepAsPhoto); queue = []; await saveItems(); next();
  };
})();
