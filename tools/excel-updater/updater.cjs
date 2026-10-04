#!/usr/bin/env node
/*
 * Nuenaran Excel updater
 *
 * This program is deliberately local.  It reads a workbook, compares it with
 * Firestore, prints a preview, writes a JSON backup, and only changes Firestore
 * after the operator types UPDATE.  The service-account key is never uploaded
 * to the public website.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const X = require('xlsx');

const PROJECT = 'nuenaran';
const COLLECTION = 'houses';
const MONTH_RE = /^(\d{4})-(\d{1,2})$/;
const SHEETS = {
  'تەلار ستی': { header: 1, firstData: 2 },
  'مارینا (١)': { header: 1, firstData: 2 },
  'مارینا (2)': { header: 1, firstData: 2 },
  'مارينا (3)': { header: 1, firstData: 2 },
  'مارينا (4)': { header: 1, firstData: 2 },
  'قنديل': { header: 1, firstData: 2 },
  'دوبەی ستی': { header: 1, firstData: 2 },
  'شوقەكان تەلار ستی': { header: 2, firstData: 3 },
  'دووكان': { header: 1, firstData: 2 },
  'پێشانگا': { header: 1, firstData: 2 },
};

function usage() {
  console.log('\nNuenaran Excel updater\n');
  console.log('Preview:  node updater.cjs --preview "new-file.xlsx" --key "serviceAccountKey.json"');
  console.log('Apply:    node updater.cjs --apply   "new-file.xlsx" --key "serviceAccountKey.json"');
  console.log('Optional: --as-of 2026-09-11   (use a fixed report date)');
  console.log('\nThe default is preview only. Apply requires typing UPDATE.\n');
}
function norm(v) {
  return String(v ?? '').normalize('NFKC').replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/ك/g, 'ک').replace(/[ىي]/g, 'ی')
    .replace(/[\u200c\u200d\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim();
}
function keyText(v) { return norm(v).replace(/\s+/g, '').toLowerCase(); }
function digits(v) { return norm(v).replace(/[^0-9A-Za-z]/g, ''); }
function safeId(v) { return norm(v).replace(/[^0-9A-Za-z\u0600-\u06ff_-]+/g, '_').slice(0, 100) || 'unknown'; }
function val(row, i) { return i == null ? '' : row[i] == null ? '' : String(row[i]).trim(); }
function isBlank(v) { return v == null || String(v).trim() === ''; }
function monthNum(v) { const n = Number(norm(v)); return Number.isInteger(n) && n >= 1 && n <= 12 ? n : null; }
function monthKey(y, m) { return `${y}-${String(m).padStart(2, '0')}`; }
function parseKey(v) { const m = norm(v).match(MONTH_RE); return m && +m[1] >= 1900 && +m[1] <= 2200 && monthNum(m[2]) ? monthKey(+m[1], +m[2]) : null; }
function mapEntries(map) {
  const out = new Set();
  if (Array.isArray(map)) for (const x of map) { const k = parseKey(x?.key ?? x); if (k) out.add(k); }
  else if (map && typeof map === 'object') for (const [y, xs] of Object.entries(map)) {
    if (/^\d{4}$/.test(norm(y))) for (const x of Array.isArray(xs) ? xs : Object.keys(xs || {})) { const m = monthNum(x); if (m) out.add(monthKey(+y, m)); }
    else { const k = parseKey(y); if (k) out.add(k); }
  }
  return out;
}
function mapMonths(set) {
  const out = {};
  for (const k of [...set].sort()) { const [y, m] = k.split('-'); (out[y] ||= []).push(String(+m)); }
  return out;
}
function status(v) {
  const t = keyText(v).replace(/ۆ/g, 'و');
  if (/^(کر[ێی][چج]ی?|کر[چج]ی|کرچی|کرێنشین|renter|tenant)$/.test(t)) return 'renter';
  if (/^(مول+ک|ملک|مالک|خاوەن|خاوەنمولک|خاوەنخانوو|مومک|owner)$/.test(t)) return 'owner';
  return 'other';
}
function parseArgs(argv) {
  const a = { mode: 'preview', asOf: new Date().toISOString().slice(0, 10) };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--apply') a.mode = 'apply';
    else if (argv[i] === '--preview') a.mode = 'preview';
    else if (argv[i] === '--key') a.key = argv[++i];
    else if (argv[i] === '--as-of') a.asOf = argv[++i];
    else if (!argv[i].startsWith('-') && !a.workbook) a.workbook = argv[i];
  }
  return a;
}
function findColumn(headers, names) {
  const wanted = names.map(keyText);
  for (let i = 0; i < headers.length; i++) if (wanted.includes(keyText(headers[i]))) return i;
  return null;
}
function sheetMonths(rows, yearRow, headerRow) {
  const result = []; let year = null;
  for (let c = 0; c < (rows[headerRow] || []).length; c++) {
    const yearCell = norm(rows[yearRow]?.[c]); const matchYear = yearCell.match(/(?:19|20)\d{2}/);
    const y = matchYear ? Number(matchYear[0]) : Number(yearCell); if (Number.isInteger(y) && y >= 1900 && y <= 2200) year = y;
    const m = monthNum(rows[headerRow]?.[c]); if (year && m) result.push({ col: c, key: monthKey(year, m) });
  }
  return result;
}
function sourceRows(workbook) {
  const records = [], warnings = [], excluded = [];
  for (const sheetName of workbook.SheetNames) {
    const schema = SHEETS[sheetName];
    if (!schema) { warnings.push(`${sheetName}: ignored (not a house sheet)`); continue; }
    const rows = X.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: null });
    const headers = rows[schema.header] || [], months = sheetMonths(rows, schema.header - 1, schema.header);
    if (!months.length) { warnings.push(`${sheetName}: no month columns found`); continue; }
    // The plain ژ column is often only a row serial. Prefer the explicit
    // house/shop identifier when both columns are present.
    const houseCol = findColumn(headers, ['ژ. خانوو', 'ژ. پێشانگا', 'خانوو', 'ژمارەی خانوو', 'ژماری خانوو'])
      ?? findColumn(headers, ['ژ']);
    const nameCol = findColumn(headers, ['ناوی سیانی', 'ناوی سێیانی']);
    const ownerCol = findColumn(headers, ['خاوەن', 'خاوون']);
    const nationalityCol = findColumn(headers, ['نەتەوە']);
    const professionCol = findColumn(headers, ['پیشە', 'پیشه']);
    const ownerNameCol = findColumn(headers, ['ناوی خاووەن خانوو', 'ناوی خاوەن خانوو']);
    const phoneCol = findColumn(headers, ['خاوەن مولک', 'خاوەن مولک ', 'مۆبایل', 'موبایل', 'ژمارەی تەلەفۆن']);
    const ownerPhoneCol = findColumn(headers, ['صاحب', 'خاوەن مولک', 'خاوەن مولک ']);
    const renterPhoneCol = findColumn(headers, ['كرێجى', 'کرێجى', 'کرێجی', 'كرجي', 'كرجى']);
    const blockCol = findColumn(headers, ['بلۆک', 'block']);
    if (houseCol == null || nameCol == null) { warnings.push(`${sheetName}: missing house/name columns`); continue; }
    for (let r = schema.firstData; r < rows.length; r++) {
      const row = rows[r] || [], houseNum = val(row, houseCol);
      if (!houseNum || !/\d/.test(norm(houseNum))) continue;
      if (sheetName === 'قنديل') {
        const address = X.utils.encode_cell({ r, c: houseCol });
        const color = workbook.Sheets[sheetName][address]?.s?.fgColor?.rgb?.toUpperCase();
        if (color === 'FFFF00' || color === '00FFFF00') {
          excluded.push({ sourceSheet: sheetName, sourceRow: r + 1, sourceSerial: houseNum });
          continue;
        }
      }
      const paid = new Set(), observed = new Set(), nonzero = [];
      for (const m of months) {
        const cell = row[m.col]; if (isBlank(cell)) continue;
        observed.add(m.key);
        if (Number(cell) === 0 || norm(cell) === '0') paid.add(m.key);
        else nonzero.push({ key: m.key, value: String(cell) });
      }
      const latestPaid = [...paid].sort().at(-1) || null, skipped = new Set();
      if (latestPaid) for (const m of months) if (m.key < latestPaid && isBlank(row[m.col])) skipped.add(m.key);
      const complex = sheetName;
      records.push({
        sourceSheet: sheetName, sourceRow: r + 1, sourceKey: `${sheetName}|${r + 1}`,
        sourceSerial: houseNum, houseNum, houseNumber: houseNum, complex,
        name: val(row, nameCol), residentName: val(row, nameCol), ownerName: val(row, ownerNameCol),
        status: val(row, ownerCol), normStatus: status(val(row, ownerCol)), nationality: val(row, nationalityCol), profession: val(row, professionCol),
        ownerPhone: val(row, ownerPhoneCol) || (sheetName === 'قنديل' ? '' : val(row, phoneCol)), mobile: val(row, phoneCol), phone: val(row, phoneCol), renterPhone: val(row, renterPhoneCol),
        block: val(row, blockCol), paid, skipped, nonzero, observed,
      });
    }
  }
  if (excluded.length) warnings.push(`قنديل: ${excluded.length} yellow rows excluded`);
  return { records, warnings, excluded };
}
function asFirestoreValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number' && Number.isFinite(v)) return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(asFirestoreValue) } };
  if (typeof v === 'object') { const fields = {}; for (const [k, x] of Object.entries(v)) fields[k] = asFirestoreValue(x); return { mapValue: { fields } }; }
  return { stringValue: String(v) };
}
function fromFirestoreValue(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue; if ('integerValue' in v) return Number(v.integerValue); if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue; if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromFirestoreValue);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, fromFirestoreValue(x)]));
  return v.timestampValue || '';
}
function encodeDoc(obj) { const fields = {}; for (const [k, v] of Object.entries(obj)) fields[k] = asFirestoreValue(v); return { fields }; }
function decodeDoc(doc) { return Object.fromEntries(Object.entries(doc.fields || {}).map(([k, v]) => [k, fromFirestoreValue(v)])); }
function b64(v) { return Buffer.from(v).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function requestJson(url, options = {}, body) {
  const payload = typeof body === 'string' ? body : (body ? JSON.stringify(body) : null);
  return new Promise((resolve, reject) => { const req = https.request(url, { ...options, headers: { ...(options.headers || {}), ...(payload && !options.headers?.['Content-Type'] ? { 'Content-Type': 'application/json' } : {}) } }, res => {
    let text = ''; res.setEncoding('utf8'); res.on('data', d => text += d); res.on('end', () => { let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; } if (res.statusCode >= 200 && res.statusCode < 300) resolve(data); else reject(new Error(`${res.statusCode}: ${data.error?.message || text.slice(0, 200)}`)); });
  }); req.on('error', reject); if (payload) req.write(payload); req.end(); });
}
async function accessToken(key) {
  const now = Math.floor(Date.now() / 1000), header = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' })), claim = b64(JSON.stringify({ iss: key.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: key.token_uri, iat: now, exp: now + 3600 }));
  const sign = crypto.createSign('RSA-SHA256'); sign.update(`${header}.${claim}`); const assertion = `${header}.${claim}.${b64(sign.sign(key.private_key))}`;
  const body = `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${assertion}`;
  const result = await requestJson(key.token_uri, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, body); return result.access_token;
}
async function readHouses(key, token) {
  const all = [], base = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(key.project_id)}/databases/(default)/documents/${COLLECTION}`; let pageToken = '';
  do { const url = `${base}?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`; const data = await requestJson(url, { headers: { Authorization: `Bearer ${token}` } }); for (const doc of data.documents || []) all.push({ id: doc.name.split('/').pop(), data: decodeDoc(doc), name: doc.name }); pageToken = data.nextPageToken || ''; } while (pageToken);
  return all;
}
function matchRecords(imported, current) {
  const bySource = new Map(), byHouse = new Map();
  for (const x of current) { if (x.data.sourceSheet && x.data.sourceSerial) bySource.set(`${keyText(x.data.sourceSheet)}|${keyText(x.data.sourceSerial)}`, x); byHouse.set(`${keyText(x.data.complex)}|${keyText(x.data.houseNum || x.data.houseNumber)}`, x); }
  return imported.map(x => ({ imported: x, current: bySource.get(`${keyText(x.sourceSheet)}|${keyText(x.sourceSerial)}`) || byHouse.get(`${keyText(x.complex)}|${keyText(x.houseNum)}`) || null }));
}
function mergedUpdate(i, c, asOf) {
  const old = c?.data || {}, paid = mapEntries(old.paidMonths), skipped = mapEntries(old.skippedMonths), unpaid = mapEntries(old.unpaidMonths);
  for (const k of i.paid) { skipped.delete(k); unpaid.delete(k); paid.add(k); }
  for (const k of i.skipped) { if (!paid.has(k)) { skipped.add(k); unpaid.delete(k); } }
  // Explicit admin corrections remain authoritative across later Excel imports.
  for (const [key, override] of Object.entries(old.accountingOverrides || {})) {
    const month = parseKey(key), state = override?.state;
    if (!month || !['paid', 'unpaid', 'skipped', 'none'].includes(state)) continue;
    paid.delete(month); skipped.delete(month); unpaid.delete(month);
    if (state === 'paid') paid.add(month);
    if (state === 'unpaid') unpaid.add(month);
    if (state === 'skipped') skipped.add(month);
  }
  const next = { ...old, ...Object.fromEntries(Object.entries(i).filter(([k]) => !['paid','skipped','nonzero','observed'].includes(k) && i[k] !== '')),
    ownerName: i.ownerName,
    paidMonths: mapMonths(paid), skippedMonths: mapMonths(skipped), unpaidMonths: mapMonths(unpaid), totalPaid: paid.size, totalUnpaid: unpaid.size,
    sourceSchema: old.sourceSchema || 'per-complex-v1', lastExcelImport: asOf };
  delete next.id; return next;
}
function changedFields(a, b) { const out = []; for (const k of ['name','houseNum','complex','ownerName','ownerPhone','renterPhone','profession','nationality','status','paidMonths','skippedMonths','unpaidMonths','totalPaid','totalUnpaid']) if (JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null)) out.push(k); return out; }
function summary(matches, asOf) {
  let added = 0, changed = 0, paid = 0, skipped = 0, conflicts = 0; const plans = [];
  for (const m of matches) { const next = mergedUpdate(m.imported, m.current, asOf), fields = changedFields(m.current?.data || {}, next); if (!m.current) added++; else if (fields.length) changed++; paid += m.imported.paid.size; skipped += m.imported.skipped.size; if (m.imported.nonzero.length) conflicts++; plans.push({ ...m, next, fields }); }
  return { added, changed, paid, skipped, conflicts, plans };
}
async function writeDoc(token, id, data, create) {
  const base = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${COLLECTION}`;
  const url = create ? `${base}?documentId=${encodeURIComponent(id)}` : `${base}/${encodeURIComponent(id)}`;
  return requestJson(url, { method: create ? 'POST' : 'PATCH', headers: { Authorization: `Bearer ${token}` } }, encodeDoc(data));
}
function ask(question) { return new Promise(resolve => { process.stdout.write(question); process.stdin.setEncoding('utf8'); process.stdin.once('data', d => resolve(d.trim())); }); }
async function main() {
  const a = parseArgs(process.argv.slice(2)); if (!a.workbook || !fs.existsSync(a.workbook)) { usage(); process.exitCode = 2; return; }
  if (!a.key) a.key = path.join(__dirname, 'serviceAccountKey.json'); if (!fs.existsSync(a.key)) throw new Error(`Key file not found: ${a.key}\nPut the private key beside this program or pass --key.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.asOf)) throw new Error('--as-of must be YYYY-MM-DD');
  const key = JSON.parse(fs.readFileSync(a.key, 'utf8')); if (!key.client_email || !key.private_key || !key.project_id) throw new Error('The key file is not a Google service-account key.');
  if (key.project_id !== PROJECT) throw new Error(`This updater is for Firebase project ${PROJECT}; key is for ${key.project_id}.`);
  const wb = X.readFile(a.workbook, { cellFormula: false, cellStyles: true }); const parsed = sourceRows(wb); if (!parsed.records.length) throw new Error('No house rows were found. Check that this is the company workbook.');
  console.log(`\nWorkbook: ${path.basename(a.workbook)}\nSheets: ${wb.SheetNames.length} | houses read: ${parsed.records.length}`); for (const w of parsed.warnings) console.log(`  Note: ${w}`);
  const token = await accessToken(key), current = await readHouses(key, token), result = summary(matchRecords(parsed.records, current), a.asOf);
  console.log(`\nPreview (${a.asOf})`); console.log(`  New houses: ${result.added}`); console.log(`  Existing houses with changes: ${result.changed}`); console.log(`  Paid months found: ${result.paid}`); console.log(`  Historical skipped months: ${result.skipped} (information only)`); console.log(`  Cells needing review: ${result.conflicts} (non-zero text values were not changed)`);
  const conflicts = result.plans.filter(x => x.imported.nonzero.length).slice(0, 12); if (conflicts.length) { console.log('\nReview these non-zero month cells:'); for (const x of conflicts) console.log(`  ${x.imported.complex} / ${x.imported.houseNum}: ${x.imported.nonzero.map(n => `${n.key}=${n.value}`).join(', ')}`); }
  if (a.mode !== 'apply') { console.log('\nPreview only. Nothing was changed.'); return; }
  const confirm = await ask('\nType UPDATE to back up and apply these changes: '); if (confirm !== 'UPDATE') { console.log('Cancelled. Nothing was changed.'); return; }
  const backupDir = path.join(__dirname, 'backups'); fs.mkdirSync(backupDir, { recursive: true }); const backupPath = path.join(backupDir, `before-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(backupPath, JSON.stringify({ createdAt: new Date().toISOString(), workbook: a.workbook, asOf: a.asOf, documents: result.plans.filter(x => x.current).map(x => ({ id: x.current.id, data: x.current.data })) }, null, 2));
  let done = 0; for (const p of result.plans) { const id = p.current?.id || `${safeId(p.imported.complex)}__${safeId(p.imported.houseNum)}`; await writeDoc(token, id, p.next, !p.current); done++; if (done % 25 === 0) process.stdout.write(`\rUpdated ${done}/${result.plans.length}`); }
  console.log(`\nUpdated ${done} houses. Backup: ${backupPath}`);
}
if (require.main === module) main().catch(err => { console.error(`\nERROR: ${err.message}`); process.exitCode = 1; });
module.exports = { sourceRows, mergedUpdate, accessToken, readHouses, writeDoc, requestJson, mapEntries, mapMonths, keyText, PROJECT, COLLECTION };
