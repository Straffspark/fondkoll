const assert = require('node:assert');
const F = require('../core.js');

// Köpdagar
assert.equal(F.lastBuyDay('2026-11-15', 25), '2026-10-25');
assert.equal(F.lastBuyDay('2026-11-25', 25), '2026-11-25');
assert.equal(F.nextBuyDay('2026-11-15', 25), '2026-11-25');
assert.equal(F.nextBuyDay('2026-12-26', 25), '2027-01-25');
assert.equal(F.prevBuyDay('2027-01-25', 25), '2026-12-25');
assert.equal(F.daysBetween('2026-11-15', '2026-11-25'), 10);

const prices = { series: {
  r: { points: [['2026-11-25', 100], ['2026-12-23', 100.2], ['2027-01-25', 100.4]] },
  a: { points: [['2026-11-25', 200], ['2026-12-24', 180], ['2027-01-25', 220]] },
} };
const state = {
  settings: { monthlyAmount: 10000, buyDay: 25 },
  holdings: [
    { id: 'r', name: 'Räntefond', type: 'ranta', target: 90 },
    { id: 'a', name: 'Globalfond', type: 'aktiefond', target: 10 },
  ],
  purchases: [
    { id: 1, date: '2026-11-25', lines: [
      { hid: 'r', amount: 500000, price: 100, units: 5000 },
      { hid: 'a', amount: 50000, price: 200, units: 250 } ] },
    { id: 2, date: '2026-12-25', lines: [
      { hid: 'r', amount: 9000, price: 100.2, units: 9000 / 100.2 },
      { hid: 'a', amount: 1000, price: 180, units: 1000 / 180 } ] },
  ],
  manualPrices: {},
};

// Kurs: senaste kända, manuell vinner
assert.equal(F.priceOn(state, prices, 'a', '2026-12-25').price, 180);
assert.equal(F.priceOn(state, prices, 'a', '2026-11-24'), null);
const st2 = JSON.parse(JSON.stringify(state)); st2.manualPrices = { a: { '2026-12-25': 185 } };
assert.equal(F.priceOn(st2, prices, 'a', '2026-12-25').price, 185);
assert.equal(F.priceOn(st2, prices, 'a', '2026-12-25').source, 'manuell');

// Läge
const s = F.snapshot(state, prices, '2026-11-25');
assert.equal(s.total, 550000); assert.equal(s.invested, 550000);

// Period 25 nov – 25 dec: räntefond +0,2 %, aktiefond −10 %, köp 10 000
const rep = F.periodReport(state, prices, '2026-11-25', '2026-12-25');
assert.equal(Math.round(rep.total.v0), 550000);
assert.equal(Math.round(rep.total.buys), 10000);
assert.equal(Math.round(rep.byType.ranta.gain), 1000);
assert.equal(Math.round(rep.byType.aktiefond.gain), -5000);
assert.equal(Math.round(rep.total.gain), -4000);
assert.equal(Math.round(rep.total.v1), 556000);
assert.ok(Math.abs(rep.rows[1].priceChange + 0.10) < 1e-9);

// Första perioden (innan första köpet finns inget värde)
const rep0 = F.periodReport(state, prices, '2026-10-25', '2026-11-25');
assert.equal(rep0.total.v0, 0); assert.equal(rep0.total.buys, 550000); assert.equal(Math.round(rep0.total.gain), 0);

// Köpförslag summerar till beloppet och gynnar det underviktade
const sug = F.suggestBuy(state, prices, '2026-12-25', 10000);
assert.ok(Math.abs(sug.r + sug.a - 10000) < 1e-6);
assert.ok(sug.a > 1000);

// Perioder
const per = F.reportPeriods(state, '2027-01-10');
assert.deepEqual(per.map(p => p.end), ['2027-01-10', '2026-12-25', '2026-11-25']);
assert.equal(per[0].start, '2026-12-25'); assert.equal(per[0].full, false);

// Rekommendationer: inom målet → ok
const recs = F.recommendations(state, prices, rep, { fullPeriod: true });
assert.ok(recs.some(r => r.title === 'Fördelningen håller'));
// Kraftig snedfördelning → omviktning
const st3 = JSON.parse(JSON.stringify(state)); st3.holdings[0].target = 50; st3.holdings[1].target = 50;
const recs3 = F.recommendations(st3, prices, F.periodReport(st3, prices, '2026-11-25', '2026-12-25'), {});
const om = recs3.find(r => r.title === 'Vikta om mot målet');
assert.ok(om && /Månadsköpet räcker inte/.test(om.text));
// Inget köp i perioden
const rep2 = F.periodReport(state, prices, '2026-12-25', '2027-01-25');
assert.ok(F.recommendations(state, prices, rep2, {}).some(r => r.title === 'Inget köp registrerat'));
assert.ok(rep2.byType.aktiefond.pct > 0.2);

// Historik och analys
const h = F.history(state, prices, '2026-11-25', '2027-01-25');
assert.equal(h[0].value, 550000); assert.ok(h.length >= 4);
assert.ok(F.analysis(rep).length === 3);
assert.equal(F.fmtKr(1234567.4), '1 234 567 kr');
assert.equal(F.fmtPct(-0.0123, 2), '−1,23 %');

// Ingående innehav: värde 1000, anskaffning 600, kurs 200 → 5 andelar; utveckling räknas från importdagen
const so = { settings: { monthlyAmount: 0, buyDay: 25 }, holdings: [{ id: 'a', name: 'Globalfond', type: 'aktiefond', target: 100 }],
  purchases: [{ id: 'o', date: '2026-11-27', opening: true, lines: [{ hid: 'a', amount: 600, value: 1000, price: null, units: null }] }], manualPrices: {} };
let sn = F.snapshot(so, prices, '2026-12-25');
assert.equal(sn.total, 1000); assert.equal(sn.invested, 600);
assert.equal(F.resolveOpening(so, prices), 1);
assert.equal(so.purchases[0].lines[0].units, 5);
sn = F.snapshot(so, prices, '2026-12-25');
assert.equal(sn.total, 900); assert.equal(sn.invested, 600);
const ro = F.periodReport(so, prices, '2026-11-25', '2026-12-25');
assert.equal(ro.total.buys, 0); assert.equal(ro.total.open, 1000); assert.equal(Math.round(ro.total.gain), -100);
assert.ok(Math.abs(ro.total.pct + 0.10) < 1e-9);
assert.ok(/befintliga innehav/.test(F.analysis(ro)[0]));
assert.equal(F.TYPE_ORDER.length, 4);
console.log('Alla tester gick igenom');
