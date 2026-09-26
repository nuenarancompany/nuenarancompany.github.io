const serviceDigitMap = { '٠':'0', '١':'1', '٢':'2', '٣':'3', '٤':'4', '٥':'5', '٦':'6', '٧':'7', '٨':'8', '٩':'9', '۰':'0', '۱':'1', '۲':'2', '۳':'3', '۴':'4', '۵':'5', '۶':'6', '۷':'7', '۸':'8', '۹':'9' };
export function normalizeServiceText(value){
  return String(value ?? '')
    .replace(/[٠-٩۰-۹]/g, digit => serviceDigitMap[digit] || digit)
    .replace(/[أإآ]/g, 'ا')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[ةۀ]/g, 'ە')
    .replace(/ۆ/g, 'و')
    .replace(/[\u200c\u200f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
export function compactServiceText(value){
  return normalizeServiceText(value).replace(/[()[\]{}]/g, '').replace(/[\s._\-–—]/g, '');
}
export function isShopComplex(value){
  return /دو+کان/.test(compactServiceText(value));
}
const qandilApartmentRates = {
  A: { amount: 30000, metre: '125m²' },
  B: { amount: 37000, metre: '150m²' },
  D1: { amount: 20000, metre: '80m²' },
  D2: { amount: 20000, metre: '80m²' },
  C: { amount: 45000, metre: '200m²' },
  CDP: { amount: 35000, metre: '100 Dublex' }
};
export function qandilApartmentInfo(house = {}){
  const candidates = [
    house.qandilType, house.apartmentType, house.houseType, house.unitType,
    house.houseNum, house.houseNumber, house.houseNumStr, house['house num']
  ];
  for (const candidate of candidates) {
    const value = normalizeServiceText(candidate).toUpperCase().replace(/[\s()\-–—]/g, '');
    const type = value.startsWith('CDP') ? 'CDP'
      : value.startsWith('D1') ? 'D1'
      : value.startsWith('D2') ? 'D2'
      : value.startsWith('A') ? 'A'
      : value.startsWith('B') ? 'B'
      : value.startsWith('C') ? 'C'
      : '';
    if (type && qandilApartmentRates[type]) return { type, ...qandilApartmentRates[type] };
  }
  return null;
}
export function missingServiceFeeLabel(fee){
  if (fee.needsDarab) return 'دەراب پێویستە';
  if (fee.needsApartmentType) return 'جۆری شوقە پێویستە بۆ قندیل';
  return 'نرخ دیاری نەکراوە';
}
export function serviceFeeForHouse(house = {}){
  const complex = compactServiceText(house.complex ?? house.complexName);
  const houseNumber = normalizeServiceText(house.houseNum ?? house.houseNumber ?? house.houseNumStr ?? house['house num']);
  const darabValue = house.darab ?? house.derab ?? house.darb ?? house['دەراب'] ?? '';
  const darab = Number(normalizeServiceText(darabValue));
  const manualNumber = Number(house.monthlyRent ?? house.rentPerMonth);
  const manualAmount = Number.isSafeInteger(manualNumber) && manualNumber > 0 && manualNumber <= 1000000000 ? manualNumber : 0;

  if (['تەلارسیتی', 'تەلارستی'].includes(complex)) return { amount: 40000, automatic: true, rule: 'تەلار سیتی — 40,000 IQD' };
  if (complex === 'مارینا1') return { amount: 55000, automatic: true, rule: 'مارینا (١) — 55,000 IQD' };
  if (complex === 'مارینا2') return { amount: 53000, automatic: true, rule: 'مارینا (٢) — 53,000 IQD' };
  if (complex === 'مارینا3') return { amount: 55000, automatic: true, rule: 'مارینا (٣) — 55,000 IQD' };
  if (complex === 'مارینا4') {
    const hasAB = /^(?:\d+\s*[ab]|[ab]\s*\d+)$/i.test(houseNumber);
    return {
      amount: hasAB ? 40000 : 55000,
      automatic: true,
      rule: hasAB ? 'مارینا (٤) — A/B: 40,000 IQD' : 'مارینا (٤) — بێ A/B: 55,000 IQD'
    };
  }
  if (['شوقەکانتەلارسیتی', 'شوقەکانتەلارستی', 'شوقەکانیتەلارسیتی'].includes(complex)) return { amount: 25000, automatic: true, rule: 'شوقەکان تەلار سیتی — 25,000 IQD' };
  if (complex === 'قندیل') {
    const qandil = qandilApartmentInfo(house);
    if (qandil) return {
      amount: qandil.amount,
      automatic: true,
      qandil,
      rule: `قندیل — ${qandil.type} · ${qandil.metre}: ${qandil.amount.toLocaleString('en-US')} IQD`
    };
    return {
      amount: manualAmount,
      automatic: false,
      needsApartmentType: !manualAmount,
      rule: manualAmount ? 'قندیل — نرخی تۆمارکراو' : 'قندیل — جۆری شوقە پێویستە بۆ قندیل'
    };
  }
  if (isShopComplex(complex)) {
    const shopRates = { 1: 15000, 2: 20000, 3: 25000, 4: 30000 };
    if (shopRates[darab]) return { amount: shopRates[darab], automatic: true, rule: `دووكان — دەراب ${darab}: ${shopRates[darab].toLocaleString('en-US')} IQD` };
    return { amount: 0, automatic: false, needsDarab: true, rule: 'دووكان — دەراب پێویستە' };
  }
  if (['دوبایسیتی', 'دوبەیستی', 'دوبەیسیتی'].includes(complex)) return { amount: 150000, automatic: true, rule: 'دوبەی ستی — 150,000 IQD' };
  if (complex === 'پێشانگا') return { amount: 100000, automatic: true, rule: 'پێشانگا — 100,000 IQD' };
  return { amount: manualAmount, automatic: false, rule: manualAmount ? 'نرخی دەستی (دەستکاریکراو) / تۆمارکراو' : 'نرخ دیاری نەکراوە' };
}
