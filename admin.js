import {initializeApp} from 'https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js';
import {getFirestore,collection,doc,onSnapshot,runTransaction,enableMultiTabIndexedDbPersistence} from 'https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js';
import {escapeHTML as esc,dueEntries,paidEntries,skippedEntries,planPayment,paymentOptions,recordInfo,compareHouses,searchText,statusKind,baghdadDate,monthDataWarning} from './business.js';
import {serviceFeeForHouse} from './service-fees.js';
import {createPaymentQueue} from './payment-queue.js';
const app=initializeApp({apiKey:'AIzaSyBe2dBVhBMFR7ZAR3Z26ZG0q8e2KQTHlII',authDomain:'nuenaran.firebaseapp.com',projectId:'nuenaran',appId:'1:271798697223:web:8dade3ac017ce1a9c399a2'});
const db=getFirestore(app), $=id=>document.getElementById(id);
const persistence=enableMultiTabIndexedDbPersistence(db).catch(()=>{});
const fmt=n=>Number(n).toLocaleString('en-US')+' IQD';
let houses=[],pending=[],selected=new Set(),activeId=null,unsubscribe=null,started=false,sort=1,saving=false,metadata={fromCache:true};
const label=h=>String(h.houseNum??h.houseNumber??'—')+(h.block?' · بلۆک '+h.block:'');
const resident=h=>h.residentName||h.tenantName||h.renterName||h.ownerName||h.name||'—';
function normalize(id,data){return {...data,id,houseNum:String(data.houseNum??data.houseNumber??''),complex:String(data.complex??''),payments:Array.isArray(data.payments)?data.payments:[]};}
function session(value){try{if(value===undefined)return sessionStorage.getItem('nuenaran-admin-session')==='1';if(value)sessionStorage.setItem('nuenaran-admin-session','1');else sessionStorage.removeItem('nuenaran-admin-session');}catch{}return false;}
let queueViewKey='';
const queue=createPaymentQueue(async request=>{
  if(!started)throw Object.assign(new Error('چوونەژوورەوە پێویستە.'),{code:'unavailable'});
  await runTransaction(db,async tx=>{
    const ref=doc(db,'houses',request.houseId),snapshot=await tx.get(ref);
    if(!snapshot.exists())throw Error('خانوو نەدۆزرایەوە.');
    const house=normalize(snapshot.id,snapshot.data());
    if(house.payments.some(p=>p.id===request.id))return; // Safe retry after an uncertain response.
    const fee=serviceFeeForHouse(house).amount;
    if(!fee||fee!==request.rate)throw Error('نرخ گۆڕاوە؛ پارەدانەکە بپشکنە.');
    const update=planPayment(house,request.months,new Date(),{allowAdvance:true});
    const receipt={id:request.id,type:'payment',monthsRecorded:request.months.length,months:request.months,amount:fee*request.months.length,note:'وەسل',recordedBy:'admin',createdAt:new Date().toISOString(),requestedAt:request.createdAt};
    tx.update(ref,{...update,payments:[...house.payments,receipt]});
  });
  $('paymentNotice').textContent='✓ پارەدان پەسەندکرا: '+request.houseLabel+' · '+request.months.join('، ');
},async rows=>{pending=rows;const key=JSON.stringify(rows);if(key!==queueViewKey){queueViewKey=key;renderQueue();render();if(activeId)renderPayment();}});
function renderQueue(){
  const root=$('paymentQueue');root.hidden=!pending.length;
  root.innerHTML=pending.map(item=>`<div class="rounded-lg border border-amber-200 bg-amber-50 p-3 mb-2"><strong>${esc(item.houseLabel)}</strong> · ${esc(item.months.join('، '))}<p>${item.state==='failed'?'پێویستی بە پشکنینە: '+esc(item.error):'چاوەڕێی پەسەندکردنی Firebase ـە؛ هێشتا پارەدان تۆمار نەکراوە.'}</p>${item.state==='failed'?`<button class="underline m-2" data-retry="${esc(item.id)}">هەوڵدانەوە</button><button class="underline m-2" data-cancel="${esc(item.id)}">لابردنی داواکاری</button>`:''}</div>`).join('');
  root.querySelectorAll('[data-retry]').forEach(b=>b.onclick=()=>queue.retry(b.dataset.retry));
  root.querySelectorAll('[data-cancel]').forEach(b=>b.onclick=()=>{if(confirm('داواکارییە شکست‌هاتووەکە لاببرێت؟'))queue.cancel(b.dataset.cancel);});
  connection();
}
function connection(){
  if(!started)return;
  $('connectionStatus').className='connection-status mx-auto m-3 p-3 rounded-lg text-sm '+(!navigator.onLine||pending.length?'bg-amber-50 text-amber-900':'bg-blue-50 text-blue-800');
  $('connectionStatus').textContent=!navigator.onLine?'ئۆفلاین — داتاکانی پاشەکەوتکراو':pending.length?`${pending.length} پارەدان چاوەڕێی سینککردنن / پشکنینن`:metadata.fromCache?'داتاکانی پاشەکەوتکراو — چاوەڕێی نوێکردنەوە':'ئۆنلاین — داتاکان نوێن';
}
function render(){
  if(!started)return;
  const q=searchText($('adminSearch').value),complex=$('adminComplexFilter').value,min=Number($('adminDebtFilter').value)||0;
  const list=houses.filter(h=>(!complex||h.complex===complex)&&dueEntries(h).length>=min&&(!q||[resident(h),h.houseNum,h.block,...Object.values(recordInfo(h))].some(v=>searchText(v).includes(q)))).sort((a,b)=>sort*compareHouses(a,b));
  $('adminResultCount').textContent=list.length;$('adminEmpty').classList.toggle('hidden',!!list.length);
  $('adminTableBody').innerHTML=list.map((h,i)=>{
    const rate=serviceFeeForHouse(h),due=dueEntries(h).length,busy=pending.some(p=>p.houseId===h.id);
    const kind=statusKind(h.occupancyType||h.status),info=recordInfo(h);
    return `<tr class="main-row"><td>${i+1}</td><td>${esc(h.complex)}</td><td dir="ltr">${esc(label(h))}</td><td>${esc(resident(h))}</td><td>${kind==='renter'?'کرێچی':kind==='owner'?'خاوەن مولک':'—'}</td><td class="contact-number" dir="ltr">${esc(info.mobile||'—')}</td><td class="contact-number" dir="ltr">${esc(info.renterPhone||'—')}</td><td>${esc(info.profession||'—')}</td><td>${esc(info.ownerName||'—')}</td><td class="contact-number" dir="ltr">${esc(info.ownerPhone||'—')}</td><td>${esc(info.nationality||'—')}</td><td class="record-extra">${esc(info.extra||'—')}</td><td>${rate.amount?fmt(rate.amount):esc(rate.rule)}</td><td><span class="text-green-700">${paidEntries(h).length} دراو</span> · <span class="text-red-700">${due} قەرز</span>${monthDataWarning(h)?'<div class="text-amber-800">بەروارەکان پێویستیان بە پشکنینە</div>':''}</td><td><button data-edit="${esc(h.id)}" class="rounded-lg bg-indigo-600 text-white p-2">گۆڕین</button> <button data-pay="${esc(h.id)}" class="rounded-lg bg-green-700 text-white p-2 disabled:opacity-50" ${busy?'disabled':''}>${busy?'چاوەڕێی سینککردن':'پارەدان / مانگەکان'}</button></td></tr>`;
  }).join('');
  $('adminTableBody').querySelectorAll('[data-pay]').forEach(b=>b.onclick=()=>window.openPaymentModal(b.dataset.pay));
  $('adminTableBody').querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>window.openHouseEditor(b.dataset.edit));
}
function houseEditorValue(id){ return ($(id)?.value || '').trim(); }
function fillHouseEditor(h){
  const info=h?recordInfo(h):{};
  $('houseEditComplex').value=h?.complex||$('adminComplexFilter')?.value||'';
  $('houseEditNumber').value=h?.houseNum||'';
  $('houseEditResident').value=info.residentName||resident(h||{}).replace(/^—$/,'');
  $('houseEditOwnerName').value=info.ownerName||'';
  const kind=statusKind(h?.occupancyType||h?.status); $('houseEditStatus').value=kind==='owner'?'خاوەن مولک':kind==='renter'?'کرێچی':'';
  $('houseEditProfession').value=info.profession||'';
  $('houseEditRenterPhone').value=info.renterPhone||'';
  $('houseEditOwnerPhone').value=info.ownerPhone||'';
  $('houseEditMobile').value=info.mobile||'';
  $('houseEditNationality').value=info.nationality||'';
  $('houseEditBlock').value=h?.block||'';
  $('houseEditMonthlyRent').value=h?.monthlyRent||'';
  $('houseEditExtra').value=h?.sourceExtra||h?.sourceColumn1||'';
}
window.openHouseEditor=id=>{
  const h=id?houses.find(x=>x.id===id):null;
  fillHouseEditor(h);
  const list=[...new Set(houses.map(x=>x.complex).filter(Boolean))].sort();
  const dl=$('houseComplexOptions'); if(dl) dl.innerHTML=list.map(c=>`<option value="${esc(c)}"></option>`).join('');
  $('houseEditorTitle').textContent=h?'✏️ گۆڕینی زانیاریی خانوو':'➕ زیادکردنی خانوو';
  $('houseEditorModal').classList.add('open'); setTimeout(()=>$('houseEditNumber').focus(),0);
};
window.closeHouseEditor=()=>{$('houseEditorModal')?.classList.remove('open');};
window.saveHouseProfile=async()=>{
  if(saving)return;
  const complex=houseEditorValue('houseEditComplex'),houseNum=houseEditorValue('houseEditNumber');
  if(!complex||!houseNum){alert('کۆمپلێکس و ژمارەی خانوو پڕ بکەرەوە.');return;}
  const residentName=houseEditorValue('houseEditResident'),extra=houseEditorValue('houseEditExtra'),fields={complex,houseNum,houseNumber:houseNum,residentName,tenantName:residentName,renterName:residentName,name:residentName,ownerName:houseEditorValue('houseEditOwnerName'),occupancyType:houseEditorValue('houseEditStatus'),status:houseEditorValue('houseEditStatus'),profession:houseEditorValue('houseEditProfession'),renterPhone:houseEditorValue('houseEditRenterPhone'),ownerPhone:houseEditorValue('houseEditOwnerPhone'),mobile:houseEditorValue('houseEditMobile'),phone:houseEditorValue('houseEditMobile'),nationality:houseEditorValue('houseEditNationality'),block:houseEditorValue('houseEditBlock'),sourceExtra:extra,sourceColumn1:extra,updatedAt:new Date().toISOString(),updatedBy:'admin',changeType:'house-profile-updated'};
  const rent=Number($('houseEditMonthlyRent')?.value); if(Number.isFinite(rent)&&rent>0)fields.monthlyRent=rent;
  const existing=houses.find(h=>String(h.complex)===complex&&String(h.houseNum)===houseNum);
  if(existing&&!confirm(`${complex} · ${houseNum}\nزانیاریی خانوو نوێ بکرێتەوە؟\nمێژووی پارەدان دەپارێزرێت.`))return;
  saving=true; const button=$('houseEditorSaveBtn'); if(button)button.disabled=true;
  try{
    await runTransaction(db,async tx=>{
      const ref=existing?doc(db,'houses',existing.id):doc(db,'houses',crypto.randomUUID());
      let previous={}; if(existing){const snap=await tx.get(ref);if(!snap.exists())throw Error('خانوو نەدۆزرایەوە.');previous=snap.data()||{};}
      const next=existing?{...previous,...fields}:{...fields,sourceSchema:'manual-v1',sourceSheet:'manual',sourceSerial:houseNum,paidMonths:{},unpaidMonths:{},skippedMonths:{},payments:[],totalPaid:0,totalUnpaid:0,createdAt:new Date().toISOString()};
      tx.set(ref,next);
    });
    window.closeHouseEditor(); $('paymentNotice').textContent=existing?'✓ زانیاریی خانوو نوێکرایەوە.':'✓ خانووی نوێ زیادکرا.';
  }catch(e){alert('پاشەکەوت نەکرا: '+e.message);}finally{saving=false;if(button)button.disabled=false;}
};
window.toggleAdminSortHouseNum=()=>{sort=-sort;render();};
window.openPaymentModal=id=>{
  const h=houses.find(h=>h.id===id);if(!h)return;
  $('paymentAdvance').checked=false;preparePaymentYear($('paymentYear'));
  activeId=id;selected=new Set(dueEntries(h).slice(0,1).map(e=>e.key));renderPayment();$('paymentModal').classList.add('open');
};
window.closePaymentModal=()=>{if(saving)return;activeId=null;selected.clear();$('paymentModal').classList.remove('open');};
// Display-only history; never changes payable months or payment totals.
function showPaymentHistory(element, house) {
  if (element._historyReady && element._historySource === house?.skippedMonths) return;
  element._historyReady = true; element._historySource = house?.skippedMonths;
  const entries = skippedEntries(house), ranges = [];
  for (const entry of entries) {
    const serial = entry.year * 12 + entry.month;
    const last = ranges[ranges.length - 1];
    if (last && serial === last.serial + 1) {
      last.end = entry.key; last.serial = serial;
    } else ranges.push({start: entry.key, end: entry.key, serial});
  }
  element.hidden = entries.length === 0;
  element.textContent = entries.length
    ? 'زانیاریی پێشوو — قەرز نییە\n' +
      entries.length + ' مانگی پێشوو تێپەڕێنراون؛ لە کۆی قەرز و وەسلدا ناژمێردرێن.\n' +
      ranges.map(range => range.start === range.end ? range.start : range.start + ' → ' + range.end).join('، ')
    : '';
}
// Keep month buttons mounted while selecting or entering cash (no grid rebuild).
function renderMonthPicker(root, entries, selected, attribute, onToggle) {
  const signature = entries.map(e=>e.key+(e.advance?'a':'d')).join('|');
  let view = root._monthView;
  if (!view || view.signature !== signature) {
    root.innerHTML = entries.map(e=>`<button type="button" ${attribute}="${e.key}" class="month-choice" aria-pressed="false"><span dir="ltr">${e.key}</span><span data-month-label>${e.advance?'پێشوەختە':'قەرز'}</span></button>`).join('') || '<p class="col-span-full">هیچ مانگێک نییە بۆ پارەدان.</p>';
    view = root._monthView = {signature, buttons:[...root.querySelectorAll('button')], entries:new Map(entries.map(e=>[e.key,e]))};
  }
  view.toggle = onToggle;
  if (!root._monthListener) {
    root.addEventListener('click', event=>{
      const button = event.target.closest('button');
      if (!button || !root.contains(button)) return;
      const key = button.getAttribute(attribute);
      if (root._monthView.entries.has(key)) root._monthView.toggle(key);
    });
    root._monthListener = true;
  }
  for (const button of view.buttons) {
    const key = button.getAttribute(attribute), entry = view.entries.get(key), chosen = selected.has(key);
    const state = chosen ? 'selected' : entry.advance ? 'advance' : 'debt';
    if (button.dataset.state === state) continue;
    button.dataset.state = state;
    button.setAttribute('aria-pressed', String(chosen));
    button.querySelector('[data-month-label]').textContent = chosen ? 'هەڵبژێردراوە ✓' : entry.advance ? 'پێشوەختە' : 'قەرز';
  }
}
function preparePaymentYear(select) {
  const year = Number(baghdadDate().slice(0,4));
  select.innerHTML = [year,year+1].map(y=>`<option value="${y}">${y}</option>`).join('');
  select.value = String(year);
}
window.refreshPaymentMonths=()=>renderPayment();
window.selectPaymentYear=()=>{
  const h=houses.find(h=>h.id===activeId);if(!h)return;
  const year=$('paymentYear').value;
  selected=new Set(paymentOptions(h,$('paymentAdvance').checked?year:null).filter(e=>String(e.year)===year).map(e=>e.key));
  renderPayment();
};
function renderPayment(){
  const h=houses.find(h=>h.id===activeId);if(!h){window.closePaymentModal();return;}
  showPaymentHistory($('paymentHistoryNote'),h);
  $('paymentYear').disabled=!$('paymentAdvance').checked;
  const due=paymentOptions(h,$('paymentAdvance').checked?$('paymentYear').value:null),allowed=new Set(due.map(e=>e.key));selected=new Set([...selected].filter(k=>allowed.has(k)));
  $('paymentHouseInfo').textContent=`${baghdadDate()} · ${h.complex} · ${label(h)} · ${resident(h)}`;
  renderMonthPicker($('paymentMonthOptions'),due,selected,'data-month',key=>{
    if(saving)return;
    if(selected.has(key))selected.delete(key);else selected.add(key);
    renderPayment();
  });
  const fee=serviceFeeForHouse(h),months=[...selected].sort();
  $('paymentMath').textContent=monthDataWarning(h)?'بەرواری قەرزەکان تەواو نییە؛ پێویستی بە پشکنینە.':fee.amount?`${months.length} مانگ · ${months.join('، ')} · ${fmt(fee.amount)} × ${months.length} = ${fmt(fee.amount*months.length)}`:fee.rule;
  $('paymentRecordBtn').disabled=saving||!months.length||!fee.amount||pending.some(p=>p.houseId===h.id);
}
window.recordPayment=async()=>{
  if(saving||!activeId)return;
  const h=houses.find(h=>h.id===activeId),months=[...selected].sort();
  if(!h||!months.length||!serviceFeeForHouse(h).amount)return;
  if(!confirm(`${label(h)} · ${resident(h)}\n${months.join('، ')}\n${fmt(serviceFeeForHouse(h).amount*months.length)}\nتۆمار بکرێت؟`))return;
  saving=true;renderPayment();
  try{
    await queue.enqueue({id:crypto.randomUUID(),houseId:h.id,houseLabel:h.complex+' · '+label(h),months,rate:serviceFeeForHouse(h).amount,createdAt:new Date().toISOString(),state:'pending'});
    saving=false;window.closePaymentModal();
  }catch(e){alert('پاشەکەوت نەکرا: '+e.message);}finally{saving=false;if(activeId)renderPayment();}
};
async function start(){
  if(started)return;started=true;$('loginScreen').classList.add('hidden');$('adminHeader').classList.remove('hidden');$('loadingBar').classList.remove('hidden');connection();
  await persistence;
  unsubscribe=onSnapshot(collection(db,'houses'),{includeMetadataChanges:true},snapshot=>{
    metadata=snapshot.metadata;houses=snapshot.docs.map(d=>normalize(d.id,d.data()));
    const filter=$('adminComplexFilter'),value=filter.value,complexes=[...new Set(houses.map(h=>h.complex))].filter(Boolean).sort();
    filter.innerHTML='<option value="">هەموو کۆمپلێکسەکان</option>';
    complexes.forEach(c=>filter.add(new Option(c,c)));filter.value=complexes.includes(value)?value:'';
    $('mainContent').classList.remove('hidden');$('loadingBar').classList.add('hidden');render();if(activeId)renderPayment();connection();void queue.flush();
  },error=>{
    houses=[];render();$('mainContent').classList.add('hidden');$('loadingBar').classList.remove('hidden');
    $('loadingBar').textContent='داتا بارنەکرا. دووبارە هەوڵ بدەرەوە.';
    const retry=document.createElement('button');retry.textContent='هەوڵدانەوە';retry.className='m-3 p-3 rounded bg-white';retry.onclick=()=>{unsubscribe?.();started=false;start();};$('loadingBar').append(retry);console.error(error.code);
  });
  try{pending=await queue.list();renderQueue();void queue.flush();}catch{$('connectionStatus').textContent='پاشەکەوتکردنی ئۆفلاین بەردەست نییە؛ پارەدان تۆمار مەکە.';}
}
window.checkAdminPass=()=>{if($('adminPassInput').value==='nuenaran.admin.2026'){session(true);$('adminPassInput').value='';start();}else $('adminLoginError').classList.remove('hidden');};
window.logoutAdmin=async()=>{
  if(saving)return;
  if(pending.length&&!confirm('پارەدانی چاوەڕوانکراو هەیە. بە دەرچوون سینککردن دەوەستێت. دڵنیایت؟'))return;
  started=false;unsubscribe?.();houses=[];selected.clear();session(false);location.reload();
};
$('adminPassInput').addEventListener('keydown',e=>{if(e.key==='Enter')window.checkAdminPass();});
['adminSearch','adminComplexFilter','adminDebtFilter'].forEach(id=>$(id).addEventListener('input',render));
document.addEventListener('keydown',e=>{if(e.key==='Escape')window.closePaymentModal();});
window.addEventListener('online',()=>{connection();if(started)void queue.flush();});window.addEventListener('offline',connection);
let lastDate='';setInterval(()=>{const date=baghdadDate();if(lastDate!==date){lastDate=date;$('adminDate').textContent=date;render();if(activeId)renderPayment();}if(started)void queue.flush();},30000);
$('adminDate').textContent=baghdadDate();if(session())void start();
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
