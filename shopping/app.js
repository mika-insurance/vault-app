
const CATS=[
 ['ירקות ופירות','עגבני|מלפפ|בצל|תפוח|בננ|לימון|גזר|חסה|פלפל|תפוז|אבוקדו|שום|פטרוזיליה|תות|ענבים|בטטה|תפו"א|תפוחי אדמה|פירות|ירקות'],
 ['חלב וביצים','חלב|גבינ|יוגורט|ביצ|שמנת|חמאה|קוטג|לבן|מעדן'],
 ['לחם ומאפים','לחם|פיתה|חלה|חלות|לחמני|בורקס|עוג|בגט|טורטיה'],
 ['בשר ודגים','עוף|שניצל|בשר|דג|סלמון|טונה|נקניק|קבב|המבורגר|הודו'],
 ['מזווה','אורז|פסטה|שמן|קמח|סוכר|מלח|קפה|תה|שוקולד|חומוס|טחינה|קורנפלקס|דגנים|שימורים|רסק|עדשים|תבלין|ריבה|במבה|ביסלי|חטיף'],
 ['משקאות','מים|קולה|מיץ|בירה|יין|סודה|שתיה|שתייה'],
 ['ניקיון והיגיינה','נייר|סבון|שמפו|אקונומיקה|מרכך|אבקת|שקיות|מגבונים|משחת|טואלט|ספוג|חיתול'],
];
const OTHER='אחר';
const ORDER=[...CATS.map(c=>c[0]),OTHER];
const QUICK=['חלב','לחם','ביצים','עגבניות','מלפפונים','קפה','נייר טואלט','גבינה צהובה'];
const guess=n=>{for(const[c,k]of CATS)if(new RegExp(k).test(n))return c;return OTHER};
const $=id=>document.getElementById(id);
const esc=s=>s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let seq=0;const uid=()=>Date.now()*100+(seq++%100);

/* state: {lists:[{id,name,items:[]}], cur:index} */
let S=null,renaming=false;
const KEY='shop2';
try{S=JSON.parse(localStorage.getItem(KEY)||'null')}catch(e){}
function norm(s){
  s.lists.forEach(l=>{
    l.hist=l.hist||[];l.bought=l.bought||0;
    const d=l.items.filter(i=>i.done);
    if(d.length){l.items=l.items.filter(i=>!i.done);d.forEach(i=>{l.hist=l.hist.filter(x=>x.name!==i.name);l.hist.unshift({name:i.name,qty:i.qty,cat:i.cat,price:i.price||0});l.bought++})}
  });
}
if(S&&!(S.lists&&S.lists.length))S=null;
if(S)norm(S);
function mkDefault(){
  let old=[];try{old=JSON.parse(localStorage.getItem('shop')||'[]')||[]}catch(e){}
  S={cur:0,lists:[1,2,3].map(n=>({id:uid(),name:'רשימה '+n,items:[]}))};
  S.lists[0].items=old;
  norm(S);
}
const L=()=>S.lists[S.cur];
const save=()=>{persist();render()};

const ck='<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.2 3L13 4.5"/></svg>';
let editing=null;
const money=n=>'₪'+(Math.round(n*100)/100).toLocaleString('he-IL',{maximumFractionDigits:2});
function focusPrice(){
  const p=$('pe');if(!p)return;
  p.focus();p.select();
  p.onblur=()=>{
    if(editing==null)return;
    const it=L().items.find(i=>i.id===editing);editing=null;
    if(it)it.price=Math.max(0,parseFloat(p.value)||0);
    save();
  };
  p.onkeydown=e=>{if(e.key==='Enter')p.blur();if(e.key==='Escape'){editing=null;render()}};
}
function stash(it){
  const h=L().hist=(L().hist||[]).filter(x=>x.name!==it.name);
  h.unshift({name:it.name,qty:it.qty,cat:it.cat,price:it.price||0});
  h.length=Math.min(h.length,60);
}
/* top strip: removed and bought items first (struck through), then fixed suggestions */
function renderHist(){
  const el=$('chips');
  if(!S){el.innerHTML='';return}
  const h=L().hist||[],used=new Set([...h.map(x=>x.name),...L().items.map(x=>x.name)]);
  el.innerHTML=h.map((x,i)=>`<span class="chipw"><button class="chip h" type="button" data-h="${i}" data-a="b">${esc(x.name)}${x.qty>1?` ×${x.qty}`:''}</button><button class="cx" type="button" data-h="${i}" data-a="r" aria-label="הסר מההיסטוריה">×</button></span>`).join('')
    +QUICK.filter(q=>!used.has(q)).map(q=>`<button class="chip" type="button" data-s="${esc(q)}">+ ${esc(q)}</button>`).join('');
}
function render(){
  const ready=!!S;
  renderHist();
  $('f').hidden=$('chips').hidden=!ready;
  document.querySelectorAll('.foot').forEach(x=>{x.hidden=!ready});
  if(!ready){$('tabs').innerHTML='';$('count').textContent='';$('left').textContent='';$('list').innerHTML='';return}
  const items=L().items,left0=items.length,done=L().bought||0,total=left0+done;
  $('tabs').innerHTML=S.lists.map((l,i)=>{
    const on=i===S.cur,left=l.items.filter(x=>!x.done).length;
    if(on&&renaming)return`<span class="tab on"><input id="rn" value="${esc(l.name)}" maxlength="16" aria-label="שם הרשימה"></span>`;
    return`<button class="tab ${on?'on':''}" role="tab" aria-selected="${on}" data-i="${i}">${esc(l.name)}${left?`<b>${left}</b>`:''}</button>`}).join('')
    +(S.lists.length<8?'<button class="tab plus" id="addList" aria-label="רשימה חדשה">+</button>':'');
  if(renaming){const r=$('rn');r.focus();r.select();
    const fin=()=>{if(!renaming)return;renaming=false;const v=r.value.trim();if(v)L().name=v;save()};
    r.onblur=fin;r.onkeydown=e=>{if(e.key==='Enter')fin();if(e.key==='Escape'){renaming=false;render()}}}
  $('delList').hidden=S.lists.length<2;
  $('count').textContent=total?`${done} מתוך ${total} בעגלה`:'הרשימה ריקה';
  $('left').textContent=total&&done===total?'סיימת, אפשר לשלם':total?`נשארו ${total-done}`:'';
  $('fill').style.width=total?done/total*100+'%':'0';
  const priced=items.filter(i=>i.price>0),sum=priced.reduce((s,i)=>s+i.price*i.qty,0),noPrice=items.length-priced.length,tt=$('total');
  tt.hidden=!priced.length;
  tt.innerHTML=`<span>סה"כ משוער ${money(sum)}</span>${noPrice?`<small>ל-${noPrice} מוצרים אין מחיר</small>`:''}`;
  const m=$('list');
  if(!left0){m.innerHTML='<div class="empty">'+(total?'הכל בעגלה. אפשר להחזיר מוצרים מההיסטוריה.':'הוסיפו מוצר למעלה או בחרו אחד מההצעות.')+'</div>';return}
  m.innerHTML=ORDER.map(cat=>{
    const g=items.filter(i=>i.cat===cat).sort((a,b)=>a.done-b.done);
    if(!g.length)return'';
    return`<section><h2><span>${cat}</span><span>${g.filter(i=>!i.done).length}</span></h2><ul>${g.map(i=>`
      <li class="${i.done?'done':''}">
        <button class="chk" data-a="t" data-id="${i.id}" aria-label="סמן ${esc(i.name)}">${ck}</button>
        <button class="name" data-a="t" data-id="${i.id}">${esc(i.name)}</button>
        ${editing===i.id?`<input class="pin" id="pe" type="number" inputmode="decimal" step="0.01" min="0" value="${i.price||''}" placeholder="ליחידה" aria-label="מחיר ליחידה">`:`<button class="price ${i.price?'set':''}" data-a="$" data-id="${i.id}" aria-label="מחיר">${i.price?money(i.price*i.qty):'+ ₪'}</button>`}
        <div class="qty"><button data-a="m" data-id="${i.id}" aria-label="פחות">−</button><span>${i.qty}</span><button data-a="p" data-id="${i.id}" aria-label="יותר">+</button></div>
        <button class="del" data-a="d" data-id="${i.id}" aria-label="מחק">×</button>
      </li>`).join('')}</ul></section>`}).join('');
  focusPrice();
}
function add(name,qty=1,price=0){
  name=name.trim();if(!name)return;
  const items=L().items;if(!items.length)L().bought=0;const ex=items.find(i=>i.name===name&&!i.done);
  if(ex)ex.qty+=qty;else{const pr=price||((L().hist||[]).find(x=>x.name===name)||{}).price||0;items.push({id:uid(),name,qty,cat:guess(name),done:false,price:pr})}
  save();
}
const NUM={'אחד':1,'אחת':1,'שני':2,'שתי':2,'שניים':2,'שתיים':2,'שלוש':3,'שלושה':3,'ארבע':4,'ארבעה':4,'חמש':5,'חמישה':5,'שש':6,'שישה':6,'שבע':7,'שבעה':7,'שמונה':8,'תשע':9,'תשעה':9,'עשר':10,'עשרה':10};
function addMany(text){
  text.split(/[,\n.]|\s+ואז\s+|\s+ו(?=\S)/).map(s=>s.trim()).filter(Boolean).forEach(p=>{
    let q=1,n=p,m;
    if(m=p.match(/^(\d+)\s+(.+)$/)){q=+m[1];n=m[2]}
    else if(m=p.match(/^(\S+)\s+(.+)$/)){if(NUM[m[1]]){q=NUM[m[1]];n=m[2]}}
    add(n,q);
  });
}
$('f').onsubmit=e=>{e.preventDefault();addMany($('in').value);$('in').value='';$('in').focus()};
$('chips').onclick=e=>{
  const b=e.target.closest('[data-h],[data-s]');if(!b||!S)return;
  if(b.dataset.s){add(b.dataset.s);return}
  const h=L().hist||[],i=+b.dataset.h,x=h[i];if(!x)return;
  h.splice(i,1);
  if(b.dataset.a==='b')add(x.name,x.qty,x.price);else save();
};
$('list').onclick=e=>{
  const b=e.target.closest('[data-a]');if(!b)return;
  const it=L().items.find(i=>i.id==b.dataset.id);if(!it)return;
  const a=b.dataset.a;
  if(a==='t'){L().items=L().items.filter(i=>i!==it);stash(it);L().bought=(L().bought||0)+1}
  else if(a==='$'){editing=it.id;render();return}
  else if(a==='p')it.qty++;
  else if(a==='m')it.qty=Math.max(1,it.qty-1);
  else if(a==='d'){L().items=L().items.filter(i=>i!==it);stash(it)}
  save();
};
$('tabs').onclick=e=>{
  if(e.target.closest('#addList')){
    S.lists.push({id:uid(),name:'רשימה '+(S.lists.length+1),items:[]});S.cur=S.lists.length-1;renaming=false;save();return}
  const t=e.target.closest('.tab[data-i]');if(!t)return;
  const i=+t.dataset.i;
  if(i===S.cur){renaming=true;render()}else{S.cur=i;renaming=false;save()}
};
/* two-step buttons: no browser dialogs, so the first tap arms, the second confirms */
function twoStep(btn,label,action){
  btn.onclick=()=>{
    if(btn.classList.contains('armed')){clearTimeout(btn._t);btn.classList.remove('armed');btn.textContent=label;action();return}
    btn.classList.add('armed');btn.textContent='לחץ שוב לאישור';
    btn._t=setTimeout(()=>{btn.classList.remove('armed');btn.textContent=label},3000);
  };
}
twoStep($('resetList'),'אפס רשימה',()=>{L().items=[];L().bought=0;save()});
twoStep($('delList'),'מחק רשימה',()=>{S.lists.splice(S.cur,1);S.cur=Math.max(0,S.cur-1);save()});
$('clearDone').onclick=()=>{L().hist=[];save()};
$('rename').onclick=()=>{renaming=true;render()};

/* ---- saving: localStorage plus an IndexedDB copy, so a cleared one is restored from the other ---- */
const idb=()=>new Promise((res,rej)=>{const r=indexedDB.open('shopping',1);r.onupgradeneeded=()=>r.result.createObjectStore('kv');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
async function idbSet(v){try{const db=await idb();db.transaction('kv','readwrite').objectStore('kv').put(v,KEY)}catch(e){}}
async function idbGet(){try{const db=await idb();return await new Promise(res=>{const q=db.transaction('kv').objectStore('kv').get(KEY);q.onsuccess=()=>res(q.result);q.onerror=()=>res(null)})}catch(e){return null}}
function persist(){const j=JSON.stringify(S);try{localStorage.setItem(KEY,j)}catch(e){}idbSet(j)}
const note=t=>{const n=$('note');n.textContent=t;n.classList.add('ok');setTimeout(()=>{n.textContent=NOTE;n.classList.remove('ok')},3500)};
const NOTE=$('note').textContent;

/* ---- backup file ---- */
$('export').onclick=async()=>{
  if(!S)return;
  const blob=new Blob([JSON.stringify(S)],{type:'application/json'}),name='shopping-backup.json';
  try{const f=new File([blob],name,{type:'application/json'});
    if(navigator.canShare&&navigator.canShare({files:[f]})){await navigator.share({files:[f]});return}
  }catch(e){if(e&&e.name==='AbortError')return}
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();
};
$('import').onchange=async e=>{
  const f=e.target.files[0];if(!f)return;
  try{const n=JSON.parse(await f.text());if(!n.lists||!n.lists.length)throw 0;norm(n);n.cur=0;S=n;save();note('הרשימות שוחזרו מהגיבוי')}
  catch(x){note('הקובץ לא נראה כמו גיבוי של סל קניות')}
  e.target.value='';
};

/* ---- dictation where the browser offers it; on iPhone use the keyboard microphone ---- */
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
const inApp=navigator.standalone||matchMedia('(display-mode: standalone)').matches;
if(SR&&!(/iPhone|iPad|iPod/.test(navigator.userAgent)&&inApp)){
  const m=$('mic');m.hidden=false;let rec=null;
  m.onclick=()=>{
    if(rec){rec.stop();return}
    rec=new SR();rec.lang='he-IL';rec.interimResults=false;
    rec.onresult=ev=>{for(let i=ev.resultIndex;i<ev.results.length;i++)if(ev.results[i].isFinal)addMany(ev.results[i][0].transcript)};
    rec.onend=()=>{rec=null;m.classList.remove('on')};
    rec.onerror=()=>{};
    m.classList.add('on');
    try{rec.start()}catch(e){rec=null;m.classList.remove('on')}
  };
}

/* ---- start ---- */
(async()=>{
  if(!S){
    const j=await idbGet();
    try{const n=j?JSON.parse(j):null;if(n&&n.lists&&n.lists.length){norm(n);S=n}}catch(e){}
  }
  if(!S){mkDefault();persist()}
  render();
  try{navigator.storage&&navigator.storage.persist&&navigator.storage.persist()}catch(e){}
})();
render();
if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
