// Shared accounting rules. Skips are explicit records, never inferred after a new payment.
export function normalizeText(value) {
  return String(value ?? '').normalize('NFKC').replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/ك/g,'ک').replace(/[ىي]/g,'ی')
    .replace(/[\u200c\u200d\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,'').trim();
}
export const searchText = value => normalizeText(value).replace(/\s+/g,'').toLowerCase();
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function monthNumber(value) {
  const text = normalizeText(value);
  return /^\d{1,2}$/.test(text) && +text >= 1 && +text <= 12 ? +text : null;
}
export function parseMonthKey(value) {
  const match = normalizeText(value).match(/^(\d{4})[-/](\d{1,2})$/);
  if (!match || !monthNumber(match[2]) || +match[1] < 1900 || +match[1] > 2200) return null;
  const year = +match[1], month = +match[2];
  return { key: `${year}-${String(month).padStart(2,'0')}`, year, month };
}
export function monthEntries(map) {
  const result = new Map();
  const add = value => { const entry = parseMonthKey(value); if(entry) result.set(entry.key, entry); };
  if (Array.isArray(map)) map.forEach(value => add(value?.key ?? value));
  else if (map && typeof map === 'object') Object.entries(map).forEach(([key,value]) => {
    if (parseMonthKey(key)) { add(key); return; }
    const year = normalizeText(key);
    if (!/^\d{4}$/.test(year)) return;
    const months = Array.isArray(value) ? value : value && typeof value === 'object' ? Object.keys(value) : [value];
    months.forEach(month => { if (monthNumber(month)) add(`${year}-${monthNumber(month)}`); });
  });
  return [...result.values()].sort((a,b)=>a.key.localeCompare(b.key));
}
export function monthMap(entries) {
  const map = {};
  monthEntries(entries).forEach(({year,month}) => (map[year] ??= []).push(String(month)));
  return map;
}
const billingDateFormatter = new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Baghdad',year:'numeric',month:'2-digit',day:'2-digit'});
let dateSecond = null, dateValue = '';
export function baghdadDate(now = new Date()) {
  const second = Math.floor(now.getTime() / 1000);
  if (second === dateSecond) return dateValue;
  const parts = billingDateFormatter.formatToParts(now);
  const get = type => parts.find(p=>p.type===type).value;
  dateSecond = second;
  return dateValue = `${get('year')}-${get('month')}-${get('day')}`;
}
// Firestore snapshots replace these maps. Reuse derived dates until a map changes.
const monthStateCache = new WeakMap();
function monthState(house) {
  if (!house || typeof house !== 'object') return {skipped:[],paid:[],unpaid:[]};
  const previous = monthStateCache.get(house);
  if (previous && previous.paidSource === house.paidMonths && previous.unpaidSource === house.unpaidMonths && previous.skippedSource === house.skippedMonths) return previous;
  const skipped = monthEntries(house.skippedMonths);
  const excluded = new Set(skipped.map(e=>e.key));
  const paid = monthEntries(house.paidMonths).filter(e=>!excluded.has(e.key));
  paid.forEach(e=>excluded.add(e.key));
  const unpaid = monthEntries(house.unpaidMonths).filter(e=>!excluded.has(e.key));
  const result = {skipped,paid,unpaid,paidSource:house.paidMonths,unpaidSource:house.unpaidMonths,skippedSource:house.skippedMonths};
  monthStateCache.set(house,result);
  return result;
}
export function skippedEntries(house) { return monthState(house).skipped; }
export function paidEntries(house) { return monthState(house).paid; }
export function unpaidEntries(house) { return monthState(house).unpaid; }
export function dueEntries(house, now = new Date()) {
  const current = baghdadDate(now).slice(0,7), state = monthState(house);
  if (state.duePeriod !== current) {
    state.duePeriod = current;
    state.due = state.unpaid.filter(e=>e.key < current);
  }
  return state.due;
}
export function settledEntries(house, now = new Date()) {
  const current = baghdadDate(now).slice(0,7);
  return paidEntries(house).filter(e=>e.key < current);
}
export function paymentOptions(house, advanceYear = null, now = new Date()) {
  const current = baghdadDate(now).slice(0,7);
  const result = dueEntries(house,now).map(e=>({...e,advance:false}));
  const year = Number(advanceYear);
  if (!Number.isInteger(year) || year < Number(current.slice(0,4)) || year > 2200) return result;
  const excluded = new Set([...paidEntries(house),...skippedEntries(house)].map(e=>e.key));
  for (let month=1; month<=12; month++) {
    const entry = parseMonthKey(year+'-'+month);
    if (entry.key >= current && !excluded.has(entry.key)) result.push({...entry,advance:true});
  }
  return result.sort((a,b)=>a.key.localeCompare(b.key));
}
export function monthDataWarning(house) {
  const hasMissingDates = Number(house?.totalUnpaid) > 0 && !monthEntries(house?.unpaidMonths).length;
  const rawPaidCount = Object.values(house?.paidMonths || {}).reduce((sum,v)=>sum+(Array.isArray(v)?v.length:0),0);
  const duplicatePaid = rawPaidCount > monthEntries(house?.paidMonths).length;
  const paid = new Set(monthEntries(house?.paidMonths).map(e=>e.key));
  const overlap = monthEntries(house?.unpaidMonths).some(e=>paid.has(e.key));
  return Boolean(house?.billingReview || hasMissingDates || duplicatePaid || overlap);
}
export function parseIQD(value) {
  const text = normalizeText(value).replace(/٬/g,',');
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(text)) return null;
  const amount = Number(text.replace(/,/g,''));
  return Number.isSafeInteger(amount) && amount >= 0 && amount <= 1000000000 ? amount : null;
}
export function statusKind(value) {
  const text = searchText(value).replace(/ۆ/g,'و');
  if (/^(کر[ێی][چج]ی?|کر[چج]ی|کرچی|کرێنشین|renter|tenant)$/.test(text)) return 'renter';
  if (/^(مول+ک|ملک|مالک|خاوەن|خاوەنمولک|خاوەنخانوو|مومک|owner)$/.test(text)) return 'owner';
  return 'other';
}
export function compareComplexes(a,b) {
  return normalizeText(a).localeCompare(normalizeText(b),'en',{numeric:true,sensitivity:'base'});
}
function houseOrderKey(house) {
  // A1/B1 and 1A/1B sort together; the actual displayed identifier is never changed.
  return normalizeText(house.houseNum ?? house.houseNumber).toUpperCase().replace(/^([AB])(\d+)$/, '$2$1');
}
export function compareHouses(a,b) {
  const complexOrder = compareComplexes(a.complex ?? a.complexName ?? '',b.complex ?? b.complexName ?? '');
  if (complexOrder) return complexOrder;
  const left=houseOrderKey(a),right=houseOrderKey(b);
  if (!left || !right) return left ? -1 : right ? 1 : String(a.id??'').localeCompare(String(b.id??''));
  return left.localeCompare(right,'en',{numeric:true,sensitivity:'base'})
    || normalizeText(a.block).localeCompare(normalizeText(b.block),'en',{numeric:true}) || String(a.id??'').localeCompare(String(b.id??''));
}
export function planPayment(house, selectedKeys, now = new Date(), {allowAdvance = false} = {}) {
  const keys = [...new Set(selectedKeys)];
  const due = new Set(dueEntries(house,now).map(e=>e.key));
  const current = baghdadDate(now).slice(0,7);
  const excluded = new Set([...paidEntries(house),...skippedEntries(house)].map(e=>e.key));
  const eligible = key => due.has(key) || (allowAdvance && parseMonthKey(key)?.key === key && key >= current && !excluded.has(key));
  if (!keys.length || keys.length !== selectedKeys.length || keys.some(k=>!eligible(k))) throw new Error('مانگەکان گۆڕاون، دراون یان تێپەڕێنراون. داتاکان نوێ بکەرەوە.');
  const paid = [...paidEntries(house),...keys.map(parseMonthKey)];
  const unpaid = unpaidEntries(house).filter(e=>!keys.includes(e.key));
  return {paidMonths:monthMap(paid),unpaidMonths:monthMap(unpaid),totalPaid:paid.length,totalUnpaid:unpaid.length};
}

// Keep source contact columns separate. A general mobile is not assumed to be an owner's phone.
export function recordInfo(house = {}) {
  const source = house.raw && typeof house.raw === 'object' ? house.raw : house;
  const value = (...keys) => {
    for (const key of keys) {
      const raw = source[key];
      if (raw !== null && raw !== undefined && String(raw).trim()) return String(raw).trim();
    }
    return '';
  };
  const extra = [
    ['بلۆک',value('block','blockCode','blockName')],
    ['جۆری یەکە',value('homeType','unitType')],
    ['دەراب',value('darab','derab','darb','دەراب')],
    ['جۆری شوقە',value('apartmentType','qandilType','houseType')],
    ['ڕووبەر',value('apartmentMetre','qandilMetre','metre')],
    ['ژمارەی ڕیز',value('sourceSerial')],
    ['زانیاریی زیادە',value('sourceExtra','sourceColumn1','Column1')],
    ['تێبینی',Array.isArray(source.notes)?source.notes.join('؛ '):value('notes','note')]
  ].filter(([,text])=>text);
  return {
    residentName:value('residentName','tenantName','renterName','name','ناوی سیانی'),
    renterPhone:value('renterPhone','tenantPhone','كرێجى','کرێچی','کرێجی','كرجي','كرجى'),
    profession:value('profession','occupation','job','پیشە','پیشه'),
    ownerName:value('ownerName','landlordName','ناوی خاووەن خانوو','ناوی خاوەن خانوو'),
    ownerPhone:value('ownerPhone','landlordPhone','خاوەن مولک','خاوەن موڵک','خاون مولک','صاحب','صاحبی'),
    mobile:value('mobile','phone','مۆبایل','موبایل','موبيل'),
    nationality:value('nationality','nat','ethnicity','نەتەوە','نه ته وه'),
    extra:extra.map(([label,text])=>label+': '+text).join('\n')
  };
}
