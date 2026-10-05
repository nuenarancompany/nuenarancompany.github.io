import {initializeApp} from 'https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js';
import {getFirestore,collection,onSnapshot,enableMultiTabIndexedDbPersistence} from 'https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js';
import {searchText,escapeHTML,compareHouses,dueEntries,paidEntries,monthDataWarning} from './business.js';
import {serviceFeeForHouse} from './service-fees.js';
const db=getFirestore(initializeApp({apiKey:'AIzaSyBe2dBVhBMFR7ZAR3Z26ZG0q8e2KQTHlII',authDomain:'nuenaran.firebaseapp.com',projectId:'nuenaran',appId:'1:271798697223:web:8dade3ac017ce1a9c399a2'}));
const $=id=>document.getElementById(id),esc=escapeHTML,size=20;
let houses=[],page=0,stop=null;
const ready=enableMultiTabIndexedDbPersistence(db).catch(()=>{});
function render(){
 const q=searchText($('search').value),complex=$('complex').value;
 const matches=houses.filter(h=>(!complex||h.complex===complex)&&(!q||[h.houseNum,h.residentName,h.ownerName].some(v=>searchText(v).includes(q))));
 page=Math.min(page,Math.max(0,Math.ceil(matches.length/size)-1));
 $('results').innerHTML=matches.slice(page*size,(page+1)*size).map(h=>{
  const due=dueEntries(h),paid=paidEntries(h),fee=serviceFeeForHouse(h),review=monthDataWarning(h);
  const value=v=>esc(v||'—');
  const debt=review?'پێویستی بە پشکنینە':fee.amount?`${(due.length*fee.amount).toLocaleString('en-US')} IQD`:'نرخ دیاری نەکراوە';
  return `<article><h2>${value(h.complex)} — ${value(h.houseNum)}</h2><dl><dt>ناوی دانیشتوو</dt><dd>${value(h.residentName)}</dd><dt>ناوی خاوەن خانوو</dt><dd>${value(h.ownerName)}</dd><dt>مۆبایل</dt><dd dir="ltr">${value(h.mobile)}</dd><dt>تەلەفۆنی کرێچی</dt><dd dir="ltr">${value(h.renterPhone)}</dd><dt>تەلەفۆنی خاوەن موڵک</dt><dd dir="ltr">${value(h.ownerPhone)}</dd></dl><footer>کۆی قەرزی پێشوو: <b dir="ltr">${esc(debt)}</b><br>مانگی نەدراو: ${due.length} · مانگی دراو: ${paid.length}<small>قەرزی مانگەکانی پێش مانگی ئێستا؛ مانگە تێپەڕدراوەکان حساب ناکرێن.</small></footer></article>`;
 }).join('')||'<p>هیچ خانوویەک نەدۆزرایەوە.</p>';
 $('count').textContent=`${matches.length} خانوو · ${page+1} / ${Math.max(1,Math.ceil(matches.length/size))}`;
 $('prev').disabled=page===0;$('next').disabled=(page+1)*size>=matches.length;
}
async function start(){
 $('login').hidden=true;$('app').hidden=false;await ready;
 stop=onSnapshot(collection(db,'houses'),{includeMetadataChanges:true},snap=>{
 houses=snap.docs.map(doc=>{const d=doc.data();return {...d,id:doc.id,complex:d.complex??d.complexName??'',houseNum:d.houseNum??d.houseNumber??'',residentName:d.residentName??d.name??'',ownerName:d.ownerName??d.landlordName??'',mobile:d.mobile??d.phone??'',renterPhone:d.renterPhone??d.tenantPhone??'',ownerPhone:d.ownerPhone??d.landlordPhone??''};}).sort(compareHouses);
 const selected=$('complex').value;
 $('complex').innerHTML='<option value="">هەموو کۆمپڵێکسەکان</option>'+[...new Set(houses.map(h=>h.complex))].sort().map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
 $('complex').value=selected;
 $('status').textContent=snap.metadata.fromCache?'داتای هەڵگیراو — نوێبوونەوەی ئۆنلاین پشتڕاست نەکراوەتەوە':'ئۆنلاین — داتا نوێیە';$('status').className='';render();
 },()=>{$('status').textContent='داتا نەگەیشت؛ ئینتەرنێت یان دەستپێگەیشتن بپشکنە.';$('status').className='error';});
}
// Same convenience gate as the existing index. This is not server-side authorization.
$('login').onsubmit=e=>{e.preventDefault();if($('password').value.trim()==='nuenaran.497'){sessionStorage.setItem('nuenaran-security','1');start();}else $('error').textContent='وشەی نهێنی هەڵەیە';};
$('logout').onclick=()=>{stop?.();houses=[];$('results').textContent='';sessionStorage.removeItem('nuenaran-security');$('app').hidden=true;$('login').hidden=false;$('password').value='';};
for(const id of ['complex','search'])$(id).addEventListener(id==='search'?'input':'change',()=>{page=0;render();});
$('prev').onclick=()=>{page--;render();};$('next').onclick=()=>{page++;render();};
if(sessionStorage.getItem('nuenaran-security')==='1')start();
