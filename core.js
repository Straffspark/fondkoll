/* Fondkoll – beräkningar. Körs både i webbläsaren och i Node (tester). */
(function (root) {
  'use strict';

  var TYPES = { ranta: 'Räntefonder', blandfond: 'Blandfonder', aktiefond: 'Aktiefonder', aktie: 'Aktier' };
  var TYPE_ORDER = ['ranta', 'blandfond', 'aktiefond', 'aktie'];

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }
  function parts(s) { var p = s.split('-'); return { y: +p[0], m: +p[1], d: +p[2] }; }
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function buyDateIn(y, m, day) { return iso(y, m, Math.min(day, daysInMonth(y, m))); }
  function shiftMonth(y, m, n) {
    var idx = y * 12 + (m - 1) + n;
    return { y: Math.floor(idx / 12), m: (idx % 12 + 12) % 12 + 1 };
  }
  /* Senaste köpdag som infallit till och med `today`. */
  function lastBuyDay(today, day) {
    var p = parts(today);
    var c = buyDateIn(p.y, p.m, day);
    if (c <= today) return c;
    var q = shiftMonth(p.y, p.m, -1);
    return buyDateIn(q.y, q.m, day);
  }
  /* Nästa köpdag från och med `today`. */
  function nextBuyDay(today, day) {
    var p = parts(today);
    var c = buyDateIn(p.y, p.m, day);
    if (c >= today) return c;
    var q = shiftMonth(p.y, p.m, 1);
    return buyDateIn(q.y, q.m, day);
  }
  function prevBuyDay(buyDate, day) {
    var p = parts(buyDate);
    var q = shiftMonth(p.y, p.m, -1);
    return buyDateIn(q.y, q.m, day);
  }
  function followingBuyDay(buyDate, day) {
    var p = parts(buyDate);
    var q = shiftMonth(p.y, p.m, 1);
    return buyDateIn(q.y, q.m, day);
  }
  function daysBetween(a, b) {
    var pa = parts(a), pb = parts(b);
    return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000);
  }

  /* Senaste kända kurs till och med `date`. Manuell kurs vinner samma dag. */
  function priceOn(state, prices, hid, date) {
    var best = null;
    var s = prices && prices.series && prices.series[hid];
    if (s && s.points && s.points.length) {
      var lo = 0, hi = s.points.length - 1, idx = -1;
      while (lo <= hi) {
        var mid = (lo + hi) >> 1;
        if (s.points[mid][0] <= date) { idx = mid; lo = mid + 1; } else { hi = mid - 1; }
      }
      if (idx >= 0) best = { price: s.points[idx][1], date: s.points[idx][0], source: 'auto' };
    }
    var man = state.manualPrices && state.manualPrices[hid];
    if (man) {
      for (var d in man) {
        if (d <= date && (!best || d >= best.date)) best = { price: man[d], date: d, source: 'manuell' };
      }
    }
    return best;
  }

  function linesFor(state, hid) {
    var out = [];
    (state.purchases || []).forEach(function (p) {
      p.lines.forEach(function (l) { if (l.hid === hid) out.push({ date: p.date, amount: l.amount, units: l.units, price: l.price, value: l.value, opening: !!p.opening }); });
    });
    return out;
  }

  /* Läget en viss dag: andelar, kurs, värde och insatt belopp per innehav. */
  function snapshot(state, prices, date) {
    var rows = [], total = 0, invested = 0;
    var byType = {};
    TYPE_ORDER.forEach(function (t) { byType[t] = { value: 0, invested: 0 }; });
    (state.holdings || []).forEach(function (h) {
      var units = 0, inv = 0, invResolved = 0, fixed = 0;
      linesFor(state, h.id).forEach(function (l) {
        if (l.date > date) return;
        inv += l.amount;
        if (l.units != null) { units += l.units; invResolved += (l.opening && l.value != null) ? l.value : l.amount; }
        else if (l.value != null) fixed += l.value; /* ingående innehav som ännu saknar kurs */
      });
      var pr = priceOn(state, prices, h.id, date);
      var value = (pr ? units * pr.price : invResolved) + fixed;
      rows.push({ id: h.id, name: h.name, type: h.type, target: +h.target || 0, units: units, price: pr ? pr.price : null,
        priceDate: pr ? pr.date : null, source: pr ? pr.source : null, value: value, invested: inv });
      total += value; invested += inv;
      if (byType[h.type]) { byType[h.type].value += value; byType[h.type].invested += inv; }
    });
    return { date: date, rows: rows, total: total, invested: invested, byType: byType };
  }

  /* Målvikter normaliserade till summa 1. */
  function targets(state) {
    var sum = 0, out = {}, byType = {};
    TYPE_ORDER.forEach(function (t) { byType[t] = 0; });
    (state.holdings || []).forEach(function (h) { sum += Math.max(0, +h.target || 0); });
    (state.holdings || []).forEach(function (h) {
      var w = sum > 0 ? Math.max(0, +h.target || 0) / sum : 0;
      out[h.id] = w;
      if (byType[h.type] != null) byType[h.type] += w;
    });
    return { byHolding: out, byType: byType, sum: sum };
  }

  /* Utveckling mellan två datum. Köp efter `start` till och med `end` räknas till perioden. */
  function periodReport(state, prices, start, end) {
    var s0 = snapshot(state, prices, start), s1 = snapshot(state, prices, end);
    var rows = [], byType = {};
    TYPE_ORDER.forEach(function (t) { byType[t] = { v0: 0, buys: 0, open: 0, v1: 0, gain: 0, count: 0 }; });
    var tot = { v0: 0, buys: 0, open: 0, v1: 0, gain: 0 };
    s1.rows.forEach(function (r1, i) {
      var r0 = s0.rows[i];
      var buys = 0, open = 0;
      linesFor(state, r1.id).forEach(function (l) {
        if (!(l.date > start && l.date <= end)) return;
        if (l.opening) open += (l.value != null ? l.value : l.amount); else buys += l.amount;
      });
      var gain = r1.value - r0.value - buys - open;
      var base = r0.value + buys + open;
      var p0 = priceOn(state, prices, r1.id, start);
      var priceChange = (p0 && r1.price != null && p0.price > 0) ? r1.price / p0.price - 1 : null;
      if (r1.value === 0 && buys === 0 && open === 0 && r0.value === 0) {
        rows.push({ id: r1.id, name: r1.name, type: r1.type, v0: 0, buys: 0, v1: 0, gain: 0, pct: null, priceChange: priceChange, empty: true, priceDate: r1.priceDate });
        return;
      }
      rows.push({ id: r1.id, name: r1.name, type: r1.type, v0: r0.value, buys: buys, open: open, v1: r1.value, gain: gain,
        pct: base > 0 ? gain / base : null, priceChange: priceChange, priceDate: r1.priceDate });
      var t = byType[r1.type];
      if (t) { t.v0 += r0.value; t.buys += buys; t.open += open; t.v1 += r1.value; t.gain += gain; t.count++; }
      tot.v0 += r0.value; tot.buys += buys; tot.open += open; tot.v1 += r1.value; tot.gain += gain;
    });
    TYPE_ORDER.forEach(function (t) { var b = byType[t]; b.pct = (b.v0 + b.buys + b.open) > 0 ? b.gain / (b.v0 + b.buys + b.open) : null; });
    tot.pct = (tot.v0 + tot.buys + tot.open) > 0 ? tot.gain / (tot.v0 + tot.buys + tot.open) : null;
    return { start: start, end: end, rows: rows, byType: byType, total: tot, snapEnd: s1 };
  }

  /* Fördela ett köp så att portföljen närmar sig målvikterna utan att sälja. */
  function suggestBuy(state, prices, date, amount) {
    var snap = snapshot(state, prices, date);
    var tg = targets(state).byHolding;
    var after = snap.total + amount;
    var needs = {}, sumNeeds = 0;
    snap.rows.forEach(function (r) {
      var n = Math.max(0, (tg[r.id] || 0) * after - r.value);
      needs[r.id] = n; sumNeeds += n;
    });
    var out = {};
    snap.rows.forEach(function (r) {
      out[r.id] = sumNeeds > 0 ? amount * needs[r.id] / sumNeeds : amount * (tg[r.id] || 0);
    });
    return out;
  }

  function typeShares(snap) {
    var out = {};
    TYPE_ORDER.forEach(function (t) { out[t] = snap.total > 0 ? snap.byType[t].value / snap.total : 0; });
    return out;
  }

  function fmtKr(n) { return Math.round(n).toLocaleString('sv-SE').replace(/ | /g, ' ') + ' kr'; }
  function fmtPct(x, dec) {
    if (x == null || !isFinite(x)) return '–';
    var v = (x * 100).toFixed(dec == null ? 1 : dec).replace('.', ',').replace('-', '−');
    return (x > 0 ? '+' : '') + v + ' %';
  }
  function fmtSignedKr(n) { n = Math.round(n) || 0; return (n > 0 ? '+' : n < 0 ? '−' : '') + fmtKr(Math.abs(n)); }

  /* Löpande text om periodens utveckling per tillgångsslag. */
  function analysis(report) {
    var out = [];
    var t = report.total;
    if (t.v1 === 0 && t.buys === 0 && !t.open) return ['Inga innehav under perioden.'];
    out.push('Portföljen gick från ' + fmtKr(t.v0) + ' till ' + fmtKr(t.v1) + '. Av förändringen är ' + fmtKr(t.buys) +
      ' nya köp och ' + fmtSignedKr(t.gain) + ' värdeutveckling (' + fmtPct(t.pct, 2) + ').' +
      (t.open ? ' Dessutom lades befintliga innehav värda ' + fmtKr(t.open) + ' in i appen under perioden; utvecklingen räknas från den dagen.' : ''));
    TYPE_ORDER.forEach(function (ty) {
      var b = report.byType[ty];
      if (!b.count) return;
      var rows = report.rows.filter(function (r) { return r.type === ty && !r.empty; });
      var s = TYPES[ty] + ': ' + fmtSignedKr(b.gain) + ' (' + fmtPct(b.pct, 2) + ').';
      var withPc = rows.filter(function (r) { return r.priceChange != null; });
      if (withPc.length > 1) {
        withPc.sort(function (a, c) { return c.priceChange - a.priceChange; });
        s += ' Bäst gick ' + withPc[0].name + ' (' + fmtPct(withPc[0].priceChange, 2) + '), sämst ' +
          withPc[withPc.length - 1].name + ' (' + fmtPct(withPc[withPc.length - 1].priceChange, 2) + ').';
      } else if (withPc.length === 1) {
        s += ' Kursen för ' + withPc[0].name + ' ändrades ' + fmtPct(withPc[0].priceChange, 2) + '.';
      }
      if (ty === 'ranta' && b.pct != null && b.pct < 0) s += ' Minus i en räntefond beror oftast på stigande räntor eller oro på kreditmarknaden.';
      out.push(s);
    });
    return out;
  }

  /* Regelbaserade förslag. level: 'gor' (åtgärd), 'overvag' (att fundera på), 'ok'. */
  function recommendations(state, prices, report, opts) {
    opts = opts || {};
    var monthly = +((state.settings || {}).monthlyAmount) || 0;
    var recs = [];
    var snap = report.snapEnd;
    if (!snap.total) return [{ level: 'gor', title: 'Registrera ditt första köp', text: 'När ett köp finns kan utveckling och fördelning följas upp.' }];

    if (opts.fullPeriod !== false && report.total.buys === 0) {
      recs.push({ level: 'gor', title: 'Inget köp registrerat', text: 'Perioden saknar månadsköp. Registrera köpet om det gjordes, annars tappar sparplanen en månad.' });
    } else if (opts.fullPeriod !== false && monthly > 0 && report.total.buys < monthly * 0.95) {
      recs.push({ level: 'overvag', title: 'Köpet var mindre än planerat', text: 'Du köpte för ' + fmtKr(report.total.buys) + ' mot planerade ' + fmtKr(monthly) + '. Justera sparbeloppet under Innehav om det nya beloppet ska gälla framåt.' });
    }

    var stale = snap.rows.filter(function (r) { return r.value > 0 && (r.priceDate == null || daysBetween(r.priceDate, report.end) > 7); });
    if (stale.length) {
      recs.push({ level: 'gor', title: 'Uppdatera kurser', text: 'Aktuell kurs saknas för ' + stale.map(function (r) { return r.name; }).join(', ') + '. Ange kurs under Innehav så blir rapporten rättvisande.' });
    }

    var tg = targets(state), shares = typeShares(snap);
    var worst = null;
    TYPE_ORDER.forEach(function (t) {
      var d = shares[t] - tg.byType[t];
      if (!worst || Math.abs(d) > Math.abs(worst.d)) worst = { t: t, d: d };
    });
    if (tg.sum > 0 && worst && Math.abs(worst.d) >= 0.05) {
      var txt = TYPES[worst.t] + ' utgör ' + fmtPct(shares[worst.t], 0).replace('+', '') + ' av portföljen mot målet ' +
        fmtPct(tg.byType[worst.t], 0).replace('+', '') + '.';
      if (monthly > 0) {
        var sug = suggestBuy(state, prices, report.end, monthly);
        var partsTxt = snap.rows.filter(function (r) { return sug[r.id] >= 1; }).map(function (r) { return r.name + ' ' + fmtKr(sug[r.id]); });
        txt += ' Styr nästa månadsköp mot det som är underviktat: ' + partsTxt.join(', ') + '.';
        var afterTotal = snap.total + monthly, still = 0;
        TYPE_ORDER.forEach(function (t) {
          var v = snap.byType[t].value;
          snap.rows.forEach(function (r) { if (r.type === t) v += sug[r.id] || 0; });
          still = Math.max(still, Math.abs(v / afterTotal - tg.byType[t]));
        });
        if (still >= 0.10) {
          var move = Math.abs(worst.d) * snap.total;
          txt += ' Månadsköpet räcker inte för att nå målet. En omviktning på cirka ' + fmtKr(move) + (worst.d > 0 ? ' från ' : ' till ') + TYPES[worst.t].toLowerCase() + ' skulle återställa fördelningen.';
        }
      } else {
        txt += ' En omviktning på cirka ' + fmtKr(Math.abs(worst.d) * snap.total) + (worst.d > 0 ? ' från ' : ' till ') + TYPES[worst.t].toLowerCase() + ' skulle återställa fördelningen.';
      }
      recs.push({ level: 'gor', title: 'Vikta om mot målet', text: txt });
    } else if (tg.sum > 0) {
      recs.push({ level: 'ok', title: 'Fördelningen håller', text: 'Alla tillgångsslag ligger inom fem procentenheter från målet. Ingen omviktning behövs, köp enligt målfördelningen.' });
    } else {
      recs.push({ level: 'gor', title: 'Sätt en målfördelning', text: 'Ange målvikt för varje innehav under Innehav. Då kan appen föreslå omviktning.' });
    }

    snap.rows.forEach(function (r) {
      if (r.type === 'aktie' && r.value / snap.total > 0.10) {
        recs.push({ level: 'overvag', title: 'Stor andel i en enskild aktie', text: r.name + ' utgör ' + fmtPct(r.value / snap.total, 0).replace('+', '') + ' av portföljen. Över tio procent i ett bolag gör utfallet beroende av just det bolaget.' });
      }
    });

    var p = report.total.pct;
    if (p != null && p <= -0.05) {
      recs.push({ level: 'overvag', title: 'Svag månad, behåll planen', text: 'Värdet föll ' + fmtPct(p, 1).replace('−', '') + '. Månadssparande köper fler andelar när kurserna är låga, så en enskild månad är inget skäl att pausa. Behöver du pengarna inom ett år bör aktieandelen ses över.' });
    } else if (p != null && p >= 0.05) {
      recs.push({ level: 'overvag', title: 'Stark månad, håll fördelningen', text: 'Värdet steg ' + fmtPct(p, 1) + '. Låt inte en bra månad höja risken; fortsätt köpa enligt målfördelningen.' });
    }
    var rb = report.byType.ranta;
    if (rb.count && rb.pct != null && rb.pct < -0.003) {
      recs.push({ level: 'overvag', title: 'Räntefonderna gav minus', text: 'Kontrollera att räntefonderna har kort räntebindning och god kreditkvalitet om pengarna ska användas snart.' });
    }

    var totals = (state.purchases || []).filter(function (pu) { return !pu.opening; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; })
      .map(function (pu) { return pu.lines.reduce(function (s, l) { return s + l.amount; }, 0); });
    if (totals.length >= 12) {
      var last12 = totals.slice(-12);
      if (last12.every(function (v) { return Math.abs(v - last12[0]) < 1; })) {
        recs.push({ level: 'overvag', title: 'Samma sparbelopp i ett år', text: 'Beloppet har varit ' + fmtKr(last12[0]) + ' i tolv köp. Räkna gärna upp det i takt med lön och inflation.' });
      }
    }
    return recs;
  }

  /* Värde och insatt belopp över tid, för diagrammet. */
  function history(state, prices, from, to) {
    var set = {};
    set[from] = 1; set[to] = 1;
    (state.purchases || []).forEach(function (p) { if (p.date >= from && p.date <= to) set[p.date] = 1; });
    (state.holdings || []).forEach(function (h) {
      var s = prices && prices.series && prices.series[h.id];
      if (s && s.points) s.points.forEach(function (pt) { if (pt[0] >= from && pt[0] <= to) set[pt[0]] = 1; });
      var man = state.manualPrices && state.manualPrices[h.id];
      if (man) for (var d in man) if (d >= from && d <= to) set[d] = 1;
    });
    var dates = Object.keys(set).sort();
    var step = Math.max(1, Math.ceil(dates.length / 160));
    var out = [];
    dates.forEach(function (d, i) {
      if (i % step && i !== dates.length - 1 && !(state.purchases || []).some(function (p) { return p.date === d; })) return;
      var s = snapshot(state, prices, d);
      out.push({ date: d, value: s.total, invested: s.invested });
    });
    return out;
  }

  /* Räknar om ingående innehav (värde i kronor) till andelar när en kurs finns. */
  function resolveOpening(state, prices) {
    var changed = 0;
    (state.purchases || []).forEach(function (p) {
      if (!p.opening) return;
      p.lines.forEach(function (l) {
        if (l.units != null || l.value == null) return;
        var pr = priceOn(state, prices, l.hid, p.date);
        if (pr && pr.price > 0 && daysBetween(pr.date, p.date) <= 10) { l.price = pr.price; l.units = l.value / pr.price; changed++; }
      });
    });
    return changed;
  }

  function firstPurchaseDate(state) {
    var f = null;
    (state.purchases || []).forEach(function (p) { if (!f || p.date < f) f = p.date; });
    return f;
  }

  /* Rapportperioder: en per köpdag sedan första köpet, nyast först. */
  function reportPeriods(state, today) {
    var day = +((state.settings || {}).buyDay) || 25;
    var f = firstPurchaseDate(state);
    if (!f) return [];
    var out = [];
    var end = nextBuyDay(f, day), last = lastBuyDay(today, day), guard = 0;
    while (end <= last && guard++ < 600) {
      out.push({ start: prevBuyDay(end, day), end: end, full: true });
      end = followingBuyDay(end, day);
    }
    if (today !== last && today > f) {
      var st = last < f ? prevBuyDay(nextBuyDay(f, day), day) : last;
      out.push({ start: st, end: today, full: false });
    }
    return out.reverse();
  }

  var api = { TYPES: TYPES, TYPE_ORDER: TYPE_ORDER, lastBuyDay: lastBuyDay, nextBuyDay: nextBuyDay, prevBuyDay: prevBuyDay,
    followingBuyDay: followingBuyDay, daysBetween: daysBetween, priceOn: priceOn, snapshot: snapshot, targets: targets,
    periodReport: periodReport, suggestBuy: suggestBuy, typeShares: typeShares, analysis: analysis,
    recommendations: recommendations, history: history, resolveOpening: resolveOpening, reportPeriods: reportPeriods, firstPurchaseDate: firstPurchaseDate,
    fmtKr: fmtKr, fmtPct: fmtPct, fmtSignedKr: fmtSignedKr };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Fondkoll = api;
})(typeof window !== 'undefined' ? window : globalThis);
