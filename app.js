/* Fondkoll – gränssnitt. All persondata sparas bara i den här webbläsaren. */
(function () {
  'use strict';
  var F = window.Fondkoll;
  var KEY = 'fondkoll.v1';
  var MON = ['jan', 'feb', 'mars', 'april', 'maj', 'juni', 'juli', 'aug', 'sep', 'okt', 'nov', 'dec'];
  var view = document.getElementById('view');
  var prices = { updated: null, series: {} };
  var catalog = [];
  var tab = 'oversikt';
  var pd = null, pricesLoaded = false, manualOpen = false;
  var search = { term: '', rows: null, busy: false, err: '' }, msBusy = false, msTried = {};
  var draft = null, repIdx = 0, flash = null, openPrice = null, confirmDel = null;

  function blank() { return { settings: { monthlyAmount: 0, buyDay: 25 }, holdings: [], purchases: [], manualPrices: {}, plan: null, priceCache: {} }; }
  function normalise(s) {
    var b = blank();
    if (!s || typeof s !== 'object') return b;
    b.settings.monthlyAmount = +((s.settings || {}).monthlyAmount) || 0;
    b.settings.buyDay = Math.min(28, Math.max(1, Math.round(+((s.settings || {}).buyDay) || 25)));
    if (Array.isArray(s.holdings)) b.holdings = s.holdings.filter(function (h) { return h && h.id && h.name && F.TYPES[h.type]; });
    if (Array.isArray(s.purchases)) b.purchases = s.purchases.filter(function (p) { return p && p.date && Array.isArray(p.lines); });
    if (s.manualPrices && typeof s.manualPrices === 'object') b.manualPrices = s.manualPrices;
    if (s.priceCache && typeof s.priceCache === 'object') b.priceCache = s.priceCache;
    if (s.plan && typeof s.plan === 'object' && s.plan.alloc && typeof s.plan.alloc === 'object') {
      var al = {}; for (var k in s.plan.alloc) { var v = +s.plan.alloc[k]; if (v > 0) al[k] = v; }
      b.plan = { alloc: al, auto: s.plan.auto !== false, since: /^\d{4}-\d{2}-\d{2}$/.test(s.plan.since || '') ? s.plan.since : null, skipped: Array.isArray(s.plan.skipped) ? s.plan.skipped : [] };
    }
    return b;
  }
  /* Lagring: allt krypteras med AES-GCM. Nyckeln härleds ur lösenordet och finns bara i minnet. */
  var KEY2 = 'fondkoll.v2';
  var state = null, cryptoKey = null, salt = null, saveFailed = false, saveChain = Promise.resolve();
  var lockErr = '', wipeAsk = false, busy = false;
  function stored() { try { return JSON.parse(localStorage.getItem(KEY2)); } catch (e) { return null; } }
  function legacy() { try { var raw = localStorage.getItem(KEY); return raw ? normalise(JSON.parse(raw)) : null; } catch (e) { return null; } }
  function b64(buf) { var b = new Uint8Array(buf), t = ''; for (var i = 0; i < b.length; i++) t += String.fromCharCode(b[i]); return btoa(t); }
  function unb64(t) { var r = atob(t), b = new Uint8Array(r.length); for (var i = 0; i < r.length; i++) b[i] = r.charCodeAt(i); return b; }
  function deriveKey(pw, saltBytes) {
    return crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']).then(function (base) {
      return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: saltBytes, iterations: 250000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    });
  }
  function writeEncrypted() {
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, cryptoKey, new TextEncoder().encode(JSON.stringify(state))).then(function (ct) {
      localStorage.setItem(KEY2, JSON.stringify({ v: 2, salt: b64(salt), iv: b64(iv), data: b64(ct) }));
      saveFailed = false;
    });
  }
  function save() {
    if (!cryptoKey || !state) return;
    saveChain = saveChain.then(writeEncrypted).catch(function () { saveFailed = true; });
  }
  function setPassword(pw, data) {
    salt = crypto.getRandomValues(new Uint8Array(16));
    return deriveKey(pw, salt).then(function (k) {
      cryptoKey = k; state = data;
      return writeEncrypted().then(function () { try { localStorage.removeItem(KEY); } catch (e) {} });
    });
  }
  function unlock(pw) {
    var st = stored(), sb = unb64(st.salt);
    return deriveKey(pw, sb).then(function (k) {
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(st.iv) }, k, unb64(st.data)).then(function (pt) {
        state = normalise(JSON.parse(new TextDecoder().decode(pt))); cryptoKey = k; salt = sb;
      });
    });
  }
  /* Förberedda innehav som följer med appen, krypterade med en startkod. */
  function loadStart(code) {
    var norm = String(code).toUpperCase().replace(/[^A-Z0-9]/g, '');
    return fetch('data/start.json', { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('saknas'); return r.json(); }).then(function (st) {
      return deriveKey(norm, unb64(st.salt)).then(function (k) {
        return crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(st.iv) }, k, unb64(st.data));
      });
    }).then(function (pt) { return normalise(JSON.parse(new TextDecoder().decode(pt))); });
  }
  function lock() { state = null; cryptoKey = null; draft = null; tab = 'oversikt'; lockErr = ''; wipeAsk = false; render(); }

  function viewLock() {
    if (!(window.crypto && crypto.subtle)) return '<h2>Appen kan inte låsas upp här</h2><p>Krypteringen kräver en säker anslutning. Öppna appen via adressen som börjar med https.</p>';
    var err = '<p class="fel" role="alert">' + esc(lockErr) + '</p>';
    if (!stored()) {
      return '<h2>Välj ett lösenord</h2><p class="muted">Lösenordet krypterar dina belopp, köp och innehav i den här webbläsaren. Du anger det varje gång du öppnar appen.</p>' +
        '<form data-form="setup"><label for="pw1">Lösenord, minst 8 tecken</label><input id="pw1" type="password" autocomplete="new-password" minlength="8" required>' +
        '<label for="pw2">Upprepa lösenordet</label><input id="pw2" type="password" autocomplete="new-password" minlength="8" required>' +
        '<label for="kod">Startkod, om du har fått en</label><input id="kod" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX">' +
        '<p class="small muted">Med startkoden läggs dina förberedda innehav och belopp in direkt. Lämna tomt för att börja utan innehav.</p>' + err +
        '<button class="knapp" type="submit"' + (busy ? ' disabled' : '') + '>Spara lösenord</button></form>' +
        '<p class="notis">Lösenordet går inte att återställa. Glömmer du det kan uppgifterna inte läsas, så spara det i en lösenordshanterare.</p>';
    }
    return '<h2>Lås upp Fondkoll</h2><form data-form="unlock"><label for="pw">Lösenord</label><input id="pw" type="password" autocomplete="current-password" required>' + err +
      '<button class="knapp" type="submit"' + (busy ? ' disabled' : '') + '>Lås upp</button></form>' +
      '<h3>Glömt lösenordet?</h3><p class="muted">Det går inte att återställa. Har du en exporterad kopia kan du radera uppgifterna här, välja nytt lösenord och importera kopian.</p>' +
      '<button class="lank" data-act="radera">' + (wipeAsk ? 'Bekräfta: radera alla uppgifter i den här webbläsaren' : 'Radera uppgifterna och börja om') + '</button>';
  }
  function pwField(id) { var el = document.getElementById(id); return el ? el.value : ''; }
  function onSubmit(e) {
    var f = e.target.closest('form[data-form]'); if (!f) return;
    e.preventDefault(); if (busy) return;
    var kind = f.getAttribute('data-form');
    if (kind === 'setup' || kind === 'byt') {
      var p1 = pwField('pw1'), p2 = pwField('pw2');
      if (p1.length < 8) { lockErr = 'Lösenordet behöver vara minst 8 tecken.'; flashErr(kind); return; }
      if (p1 !== p2) { lockErr = 'Lösenorden är inte lika. Skriv dem igen.'; flashErr(kind); return; }
      busy = true; lockErr = '';
      var code = kind === 'setup' ? pwField('kod').trim() : '';
      var source = kind === 'byt' ? Promise.resolve(state) : code ? loadStart(code) : Promise.resolve(legacy() || blank());
      source.then(function (data) { return setPassword(p1, data); }, function () { throw 'kod'; }).then(function () {
        busy = false; flash = { ok: true, text: kind === 'byt' ? 'Lösenordet är bytt.' : code ? 'Lösenordet är sparat och dina innehav är inlagda.' : 'Lösenordet är sparat och dina uppgifter är krypterade.' }; render();
      }, function (why) {
        if (why === 'kod') { busy = false; lockErr = 'Startkoden stämmer inte. Kontrollera tecknen, eller lämna fältet tomt för att börja utan innehav.'; render(); return; } busy = false; lockErr = 'Det gick inte att spara. Kontrollera att webbläsaren tillåter lagring.'; if (kind === 'setup') { state = null; cryptoKey = null; } flashErr(kind); });
    } else if (kind === 'sok') {
      doSearch();
    } else if (kind === 'startkod') {
      var fel = document.getElementById('kod-fel'), c = pwField('kod2').trim();
      if (!c) { fel.textContent = 'Skriv in startkoden.'; return; }
      busy = true;
      loadStart(c).then(function (data) { busy = false; state = data; save(); flash = { ok: true, text: 'Dina innehav är inlagda.' }; render(); },
        function () { busy = false; fel.textContent = 'Startkoden stämmer inte. Kontrollera tecknen och försök igen.'; });
    } else if (kind === 'unlock') {
      busy = true; lockErr = '';
      unlock(pwField('pw')).then(function () { busy = false; render(); refreshMs(); }, function () { busy = false; lockErr = 'Fel lösenord. Försök igen.'; render(); var el = document.getElementById('pw'); if (el) el.focus(); });
    }
  }
  function flashErr(kind) {
    if (kind === 'byt') { var el = document.getElementById('byt-fel'); if (el) el.textContent = lockErr; lockErr = ''; } else render();
  }

  function today() {
    var m = /[?&]idag=(\d{4}-\d{2}-\d{2})/.exec(location.search);
    if (m) return m[1];
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fd(iso, noYear) { var p = iso.split('-'); return (+p[2]) + ' ' + MON[+p[1] - 1] + (noYear ? '' : ' ' + p[0]); }
  function kr(n) { return F.fmtKr(n); }
  function num(v) { var n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : 0; }
  function cls(n) { return n > 0.5 ? 'up' : n < -0.5 ? 'down' : ''; }
  function fmtPrice(p) { return p.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function buyDay() { return state.settings.buyDay || 25; }
  function hasLines(hid) { return state.purchases.some(function (p) { return p.lines.some(function (l) { return l.hid === hid; }); }); }

  /* ---------- Översikt ---------- */
  function viewOversikt() {
    var t = today(), day = buyDay();
    var last = F.lastBuyDay(t, day), next = F.nextBuyDay(t, day);
    var first = F.firstPurchaseDate(state);
    var boughtSinceLast = state.purchases.some(function (p) { return p.date >= last; });
    var h = '';
    var stampDate = next, waiting = false, title, text, actions = '';
    var autoOn = !!(state.plan && state.plan.auto && state.settings.monthlyAmount > 0), due = autoOn ? F.planDue(state, prices, t) : null;
    if (!state.holdings.length) {
      title = 'Välj dina fonder och aktier';
      text = 'Lägg in det du sparar i och en målfördelning. Sedan sköter appen uträkningarna inför varje köpdag.';
      actions = '<button class="knapp" data-go="innehav">Lägg till innehav</button>';
    } else if (autoOn && due.waiting) {
      waiting = true; stampDate = due.waiting; title = 'Månadens köp väntar på kurs';
      text = 'Sparandet den ' + fd(due.waiting) + ' på ' + kr(state.settings.monthlyAmount) + ' registreras automatiskt när dagens kurser har kommit in.';
      actions = '<button class="knapp tyst" data-go="rapport">Läs månadsrapporten</button>';
    } else if (!autoOn && t === next && !state.purchases.some(function (p) { return p.date >= t; })) {
      waiting = true; title = 'Köpdag i dag';
      text = state.settings.monthlyAmount ? 'Fördela månadens ' + kr(state.settings.monthlyAmount) + ' och läs rapporten för den gångna månaden.' : 'Lägg upp ditt månadssparande under Sparande, registrera köpet och läs rapporten för den gångna månaden.';
      actions = '<button class="knapp" data-go="kop">Registrera köp</button><button class="knapp tyst" data-go="rapport">Läs månadsrapporten</button>';
    } else if (!autoOn && first && first < last && !boughtSinceLast) {
      waiting = true; stampDate = last; title = 'Månadens köp saknas';
      text = 'Köpdagen var ' + fd(last) + '. Registrera köpet om det är gjort.';
      actions = '<button class="knapp" data-go="kop">Registrera köp</button><button class="knapp tyst" data-go="rapport">Läs månadsrapporten</button>';
    } else {
      var n = F.daysBetween(t, next);
      title = n === 0 ? 'Köpet är registrerat' : n === 1 ? 'En dag till spardagen' : n + ' dagar till spardagen';
      text = first ? (state.settings.monthlyAmount ? 'Nästa köp ' + fd(next) + ': ' + kr(state.settings.monthlyAmount) + (autoOn ? ', registreras automatiskt.' : ' enligt din fördelning.') : 'Nästa spardag ' + fd(next) + '. Lägg upp ditt månadssparande under Sparande.') : 'Registrera ditt första köp när du har handlat. Det behöver inte vara på köpdagen.';
      actions = (first ? '<button class="knapp tyst" data-go="rapport">Läs senaste rapporten</button>' : '') + (state.plan ? '' : '<button class="knapp" data-go="kop">Lägg upp månadssparande</button>');
    }
    var sp = stampDate.split('-');
    h += '<section class="kopdag"><div class="stampel' + (waiting ? ' vantar' : '') + '" aria-hidden="true"><b>' + (+sp[2]) + '</b><span>' + MON[+sp[1] - 1] + '</span></div>' +
      '<div><h2>' + esc(title) + '</h2><p class="muted">' + esc(text) + '</p></div></section><div>' + actions + '</div>';

    if (!first) return h;
    var snap = F.snapshot(state, prices, t);
    var gain = snap.total - snap.invested;
    h += '<dl class="nyckeltal"><div><dt>Värde i dag</dt><dd>' + kr(snap.total) + '</dd></div><div><dt>Insatt</dt><dd>' + kr(snap.invested) +
      '</dd></div><div><dt>Utveckling</dt><dd class="' + cls(gain) + '">' + F.fmtSignedKr(gain) + '</dd></div></dl>' +
      '<p class="small muted">' + F.fmtPct(snap.invested > 0 ? gain / snap.invested : null, 2) + ' på insatt belopp' + (state.purchases.some(function (x) { return x.opening; }) ? ', räknat från dina ursprungliga köp.' : ' sedan ' + fd(first) + '.') + '</p>';

    h += '<h3>Värde över tid</h3>' + chart(F.history(state, prices, first, t));
    h += '<h3>Fördelning mot målet</h3>' + allocation(snap);
    return h;
  }

  function chart(pts) {
    if (pts.length < 3) return '<p class="muted small">Diagrammet fylls på när det finns kurser för fler dagar.</p>';
    var W = 600, H = 210, L = 6, R = 6, T = 22, B = 24;
    var lo = Infinity, hi = -Infinity;
    pts.forEach(function (p) { lo = Math.min(lo, p.value, p.invested); hi = Math.max(hi, p.value, p.invested); });
    var span = (hi - lo) || 1; lo -= span * 0.08; hi += span * 0.08;
    var t0 = Date.parse(pts[0].date), t1 = Date.parse(pts[pts.length - 1].date) || t0 + 1;
    function x(d) { return L + (W - L - R) * ((Date.parse(d) - t0) / ((t1 - t0) || 1)); }
    function y(v) { return T + (H - T - B) * (1 - (v - lo) / (hi - lo)); }
    var val = '', inv = '';
    pts.forEach(function (p, i) {
      val += (i ? 'L' : 'M') + x(p.date).toFixed(1) + ' ' + y(p.value).toFixed(1);
      if (i) inv += 'L' + x(p.date).toFixed(1) + ' ' + y(pts[i - 1].invested).toFixed(1);
      inv += (i ? 'L' : 'M') + x(p.date).toFixed(1) + ' ' + y(p.invested).toFixed(1);
    });
    var lastP = pts[pts.length - 1];
    return '<svg class="graf" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Portföljens värde och insatt belopp över tid">' +
      '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + (H - B) + '" y2="' + (H - B) + '" stroke="#D3DDD8"/>' +
      '<path d="' + inv + '" fill="none" stroke="#586C66" stroke-width="1.5" stroke-dasharray="5 4"/>' +
      '<path d="' + val + '" fill="none" stroke="#1E5E4D" stroke-width="2.5" stroke-linejoin="round"/>' +
      '<circle cx="' + x(lastP.date).toFixed(1) + '" cy="' + y(lastP.value).toFixed(1) + '" r="4" fill="#1E5E4D"/>' +
      '<text x="' + (W - R) + '" y="14" text-anchor="end" font-size="14" fill="#14302A" font-weight="600">' + esc(kr(lastP.value)) + '</text>' +
      '<text x="' + L + '" y="' + (H - 6) + '" font-size="13" fill="#586C66">' + esc(fd(pts[0].date)) + '</text>' +
      '<text x="' + (W - R) + '" y="' + (H - 6) + '" text-anchor="end" font-size="13" fill="#586C66">' + esc(fd(lastP.date)) + '</text></svg>' +
      '<div class="forklaring"><span><i></i>Värde</span><span><i class="streck"></i>Insatt belopp</span></div>';
  }

  function allocation(snap) {
    var tg = F.targets(state), sh = F.typeShares(snap), h = '<div class="fordelning">';
    F.TYPE_ORDER.forEach(function (t) {
      if (!sh[t] && !tg.byType[t]) return;
      h += '<div class="rad"><div class="etikett"><span>' + F.TYPES[t] + '</span><span>' + Math.round(sh[t] * 100) + ' % <span class="muted">· mål ' + Math.round(tg.byType[t] * 100) + ' %</span></span></div>' +
        '<div class="stapel"><b style="width:' + (sh[t] * 100).toFixed(1) + '%"></b><i style="left:calc(' + (tg.byType[t] * 100).toFixed(1) + '% - 1px)"></i></div></div>';
    });
    return h + '</div><p class="small muted">Stapeln visar dagens andel, strecket visar målet.</p>';
  }

  /* ---------- Köp ---------- */
  function newDraft() {
    var t = today(), day = buyDay(), last = F.lastBuyDay(t, day), first = F.firstPurchaseDate(state);
    var missed = first && first < last && !state.purchases.some(function (p) { return p.date >= last; });
    var d = { date: missed ? last : t, amount: state.settings.monthlyAmount || 0, pct: {}, price: {} };
    if (state.plan) state.holdings.forEach(function (h) { d.pct[h.id] = +state.plan.alloc[h.id] || 0; }); else setPctFromTargets(d);
    prefillPrices(d);
    return d;
  }
  function setPctFromTargets(d) {
    var tg = F.targets(state).byHolding;
    state.holdings.forEach(function (h) { d.pct[h.id] = Math.round((tg[h.id] || 0) * 1000) / 10; });
  }
  function prefillPrices(d) {
    state.holdings.forEach(function (h) {
      var p = F.priceOn(state, prices, h.id, d.date);
      d.price[h.id] = p && F.daysBetween(p.date, d.date) <= 7 ? p.price : '';
      d['src_' + h.id] = p && F.daysBetween(p.date, d.date) <= 7 ? p : null;
    });
  }
  function pctSum() { var s = 0; state.holdings.forEach(function (h) { s += num(draft.pct[h.id]); }); return s; }

  /* ---------- Sök och kurser för valfria fonder och aktier ---------- */
  var MS = 'https://lt.morningstar.com/api/rest.svc/', MSTOK = '9vehuxllxs';
  function msType(row) {
    if (row.Universe !== 'FOSWE$$ALL') return 'aktie';
    var g = row.GlobalAssetClassId || '';
    return /FXINC|MMKT|CASH/.test(g) ? 'ranta' : /ALLOC/.test(g) ? 'blandfond' : 'aktiefond';
  }
  function msSearch(term) {
    var url = MS + MSTOK + '/security/screener?page=1&pageSize=12&sortOrder=LegalName%20asc&outputType=json&version=1&languageId=sv-SE&currencyId=SEK' +
      '&universeIds=' + encodeURIComponent('FOSWE$$ALL|E0EXG$XSTO') + '&securityDataPoints=' + encodeURIComponent('SecId|Name|ISIN|Ticker|ClosePrice|PriceCurrency|CategoryName|GlobalAssetClassId|Universe') +
      '&term=' + encodeURIComponent(term);
    return fetch(url).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (j) { return (j.rows || []).filter(function (x) { return x.SecId && x.Name; }); });
  }
  function msSeries(h) {
    var d = new Date(Date.now() - 730 * 86400000).toISOString().slice(0, 10);
    var id = h.ms.id + (h.ms.stock ? ']3]0]E0WWE$$ALL' : ']2]0]FOSWE$$ALL');
    return fetch(MS + 'timeseries_price/' + MSTOK + '?currencyId=SEK&idtype=Morningstar&frequency=daily&outputType=COMPACTJSON&startDate=' + d + '&id=' + encodeURIComponent(id))
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (a) {
        if (!Array.isArray(a) || !a.length) throw new Error('inga kurser');
        return a.filter(function (p) { return p && p[1] > 0; }).map(function (p) { return [new Date(p[0] + 43200000).toISOString().slice(0, 10), Math.round(p[1] * 10000) / 10000]; });
      });
  }
  function mergeCache() {
    if (!state) return;
    prices.series = prices.series || {};
    state.holdings.forEach(function (h) {
      var c = h.ms && state.priceCache[h.id];
      if (c && c.points && c.points.length) prices.series[h.id] = { source: 'morningstar', currency: 'SEK', points: c.points };
    });
  }
  /* Hämtar kurser för egna tillägg. Görs vid upplåsning och när det gått mer än sex timmar. */
  function refreshMs(force) {
    if (!state || msBusy) return Promise.resolve();
    var todo = state.holdings.filter(function (h) { var c = state.priceCache[h.id]; return h.ms && !(Date.now() - (msTried[h.id] || 0) < 600000) && (force || !c || !(Date.now() - c.fetched < 6 * 3600000)); });
    todo.forEach(function (h) { msTried[h.id] = Date.now(); });
    mergeCache();
    if (!todo.length) return Promise.resolve();
    msBusy = true;
    return Promise.all(todo.map(function (h) {
      return msSeries(h).then(function (pts) { if (state && holding(h.id)) state.priceCache[h.id] = { fetched: Date.now(), points: pts }; }, function () {});
    })).then(function () { msBusy = false; if (!state) return; mergeCache(); save(); if (!draft && !pd && !search.busy) render(); else autoBuy(); });
  }
  function searchResults() {
    if (search.busy) return '<p class="muted">Söker …</p>';
    if (search.err) return '<p class="fel" role="alert">' + esc(search.err) + '</p>';
    if (!search.rows) return '';
    if (!search.rows.length) return '<p class="muted">Inga träffar på ”' + esc(search.term) + '”. Prova en del av namnet eller ISIN-numret.</p>';
    var h = '';
    search.rows.forEach(function (r, i) {
      var ty = msType(r), held = state.holdings.some(function (x) { return x.id === 'ms-' + r.SecId || (r.ISIN && x.isin === r.ISIN); }) || catalog.some(function (c) { return r.ISIN && c.isin === r.ISIN && holding(c.id); });
      h += '<div class="innehav-rad"><div class="namn">' + esc(r.Name) + '</div><div class="rad2"><span>' + F.TYPES[ty].replace(/(er|r)$/, '') +
        (r.Ticker ? ' · ' + esc(r.Ticker) : r.CategoryName ? ' · ' + esc(r.CategoryName) : '') + '</span>' +
        (r.ClosePrice ? '<span>' + fmtPrice(+r.ClosePrice) + ' ' + esc(r.PriceCurrency || '') + '</span>' : '') +
        (held ? '<span>Finns redan bland dina innehav</span>' : '<button class="knapp liten" data-act="msadd" data-id="' + i + '">Lägg till</button>') + '</div></div>';
    });
    return h + '<p class="small muted">Visar högst tolv träffar. Skriv mer av namnet för att snäva in. Fonder med kurs i annan valuta räknas om till kronor.</p>';
  }
  function doSearch() {
    var term = (document.getElementById('q') || {}).value || '';
    term = term.trim();
    if (term.length < 2) { search = { term: term, rows: null, busy: false, err: 'Skriv minst två tecken.' }; render(); return; }
    search = { term: term, rows: null, busy: true, err: '' }; render();
    msSearch(term).then(function (rows) { search = { term: term, rows: rows, busy: false, err: '' }; render(); },
      function () { search = { term: term, rows: null, busy: false, err: 'Sökningen gick inte att nå just nu. Kontrollera uppkopplingen och försök igen.' }; render(); });
  }
  function addFromSearch(i) {
    var r = search.rows && search.rows[i]; if (!r) return;
    var c = r.ISIN ? catalog.filter(function (x) { return x.isin === r.ISIN; })[0] : null, h;
    if (c && !holding(c.id)) h = { id: c.id, name: c.name, type: c.type, target: 0 };
    else if (!holding('ms-' + r.SecId)) h = { id: 'ms-' + r.SecId, name: r.Name, type: msType(r), target: 0, isin: r.ISIN || null, ms: { id: r.SecId, stock: r.Universe !== 'FOSWE$$ALL' } };
    if (!h) return;
    state.holdings.push(h); save(); draft = null;
    flash = { ok: true, text: h.name + ' är tillagd. Kurserna hämtas automatiskt.' }; render();
    refreshMs();
  }

  /* ---------- Månadssparande ---------- */
  function newPlanDraft() {
    var al = {}; if (state.plan) for (var k in state.plan.alloc) if (holding(k)) al[k] = state.plan.alloc[k];
    return { amount: state.settings.monthlyAmount || '', day: buyDay(), auto: state.plan ? state.plan.auto : true, alloc: al };
  }
  function planSum() { var s = 0; for (var k in pd.alloc) s += num(pd.alloc[k]); return s; }
  function viewPlan() {
    if (!pd) pd = newPlanDraft();
    var t = today();
    var h = '<h2>Månadssparande</h2><p class="muted">Belopp, dag och fördelning gäller varje månad tills du ändrar dem.</p>';
    if (state.plan && state.settings.monthlyAmount > 0) {
      var due = F.planDue(state, prices, t);
      h += '<p class="klart">Du sparar ' + kr(state.settings.monthlyAmount) + ' den ' + buyDay() + ':e varje månad. ' +
        (state.plan.auto ? (due.waiting ? 'Köpet den ' + fd(due.waiting) + ' registreras när kurserna har kommit in.' : 'Nästa köp registreras automatiskt ' + fd(F.nextBuyDay(t, buyDay())) + '.') : 'Köpen registrerar du själv.') + '</p>';
    }
    h += '<div class="tva"><div><label for="s-belopp">Belopp per månad, kr</label><input id="s-belopp" type="number" inputmode="decimal" min="0" step="100" value="' + esc(pd.amount) + '"></div>' +
      '<div><label for="s-dag">Dag i månaden, 1–28</label><input id="s-dag" type="number" inputmode="numeric" min="1" max="28" step="1" value="' + esc(pd.day) + '"></div></div>';
    var rows = state.holdings.filter(function (ho) { return pd.alloc[ho.id] != null; });
    if (!rows.length) h += '<p class="muted" style="margin-top:14px">Välj nedan vilka fonder och aktier sparandet ska gå till.</p>';
    rows.forEach(function (ho) {
      h += '<div class="koprad"><div class="namn">' + esc(ho.name) + '</div><div class="falt">' +
        '<div><label for="sp-' + esc(ho.id) + '">Andel %</label><input id="sp-' + esc(ho.id) + '" type="number" inputmode="decimal" min="0" max="100" step="1" data-spct="' + esc(ho.id) + '" value="' + esc(pd.alloc[ho.id]) + '"></div>' +
        '<div><span class="etik">Belopp per månad</span><strong data-samt="' + esc(ho.id) + '" style="text-align:left"></strong></div>' +
        '<div style="text-align:right"><button class="lank" data-act="splanbort" data-id="' + esc(ho.id) + '">Ta bort</button></div></div></div>';
    });
    var have = {}; state.holdings.forEach(function (x) { have[x.id] = 1; });
    var mine = state.holdings.filter(function (ho) { return pd.alloc[ho.id] == null; });
    h += '<label for="s-add" style="margin-top:16px">Lägg till fond eller aktie i sparandet</label><select id="s-add"><option value="">Välj …</option>';
    if (mine.length) h += '<optgroup label="Dina innehav">' + mine.map(function (ho) { return '<option value="' + esc(ho.id) + '">' + esc(ho.name) + '</option>'; }).join('') + '</optgroup>';
    F.TYPE_ORDER.forEach(function (ty) {
      var items = catalog.filter(function (c) { return c.type === ty && !have[c.id]; });
      if (items.length) h += '<optgroup label="Fler ' + F.TYPES[ty].toLowerCase() + '">' + items.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>'; }).join('') + '</optgroup>';
    });
    h += '</select><button class="knapp tyst" data-act="splanadd">Lägg till</button><p class="small muted" style="margin-top:8px">Finns den inte här? <button class="lank" data-go="innehav">Sök bland alla fonder och aktier under Innehav</button></p>' +
      '<p id="s-summa" class="small" style="margin-top:14px"></p>' +
      '<label class="kryss" for="s-auto"><input id="s-auto" type="checkbox"' + (pd.auto ? ' checked' : '') + '> Registrera köpen automatiskt på spardagen, till dagens kurs</label>' +
      '<p id="s-fel" class="fel" role="alert"></p><button class="knapp" data-act="sparaplan">Spara månadssparande</button>';
    return h;
  }
  function refreshPlan() {
    if (tab !== 'kop' || !pd) return;
    var s = planSum(), n = Object.keys(pd.alloc).length;
    for (var k in pd.alloc) { var el = view.querySelector('[data-samt="' + k + '"]'); if (el) el.textContent = kr(num(pd.amount) * num(pd.alloc[k]) / 100); }
    var sm = document.getElementById('s-summa');
    if (sm) { var bad = n && Math.abs(s - 100) > 0.5; sm.textContent = n ? 'Andelarna summerar till ' + (Math.round(s * 10) / 10).toString().replace('.', ',') + ' %.' + (bad ? ' De behöver bli 100 %.' : '') : ''; sm.className = 'small ' + (bad ? 'fel' : 'muted'); }
  }
  function savePlan() {
    var err = document.getElementById('s-fel'), amount = num(pd.amount), day = Math.round(num(pd.day));
    if (!(amount > 0)) { err.textContent = 'Ange ett belopp per månad som är större än noll.'; return; }
    if (!(day >= 1 && day <= 28)) { err.textContent = 'Välj en dag mellan 1 och 28, så finns den i alla månader.'; return; }
    var al = {}, cnt = 0; for (var k in pd.alloc) { var v = num(pd.alloc[k]); if (v > 0) { al[k] = v; cnt++; } }
    if (!cnt) { err.textContent = 'Lägg till minst en fond eller aktie och ange dess andel.'; return; }
    if (Math.abs(planSum() - 100) > 0.5) { err.textContent = 'Andelarna behöver summera till 100 %.'; return; }
    var old = state.plan, fresh = !old || !old.since || (old.auto === false && pd.auto);
    state.settings.monthlyAmount = amount; state.settings.buyDay = day;
    state.plan = { alloc: al, auto: !!pd.auto, since: fresh ? today() : old.since, skipped: old && old.skipped ? old.skipped : [] };
    save(); pd = null;
    flash = { ok: true, text: 'Månadssparandet är sparat: ' + kr(amount) + ' den ' + day + ':e varje månad.' }; render();
  }
  function autoBuy() {
    if (!state || !pricesLoaded) return;
    var due = F.planDue(state, prices, today());
    if (!due.purchases.length) return;
    due.purchases.forEach(function (p) { state.purchases.push(p); });
    save();
    if (!flash) flash = { ok: true, text: due.purchases.length === 1 ? 'Månadssparandet den ' + fd(due.purchases[0].date) + ' är registrerat: ' + kr(state.settings.monthlyAmount) + '.' : due.purchases.length + ' månadsköp är registrerade enligt ditt månadssparande.' };
  }
  function viewKop() { return viewPlan() + (state.holdings.length ? viewManual() : ''); }

  function viewManual() {
    if (!draft) draft = newDraft();
    var h = '<details class="hand"' + (manualOpen ? ' open' : '') + '><summary>Registrera ett köp för hand</summary><p class="muted">För engångsköp, eller om du inte vill ha automatisk registrering. Kursen används för att räkna ut antal andelar.</p>';
    h += '<div class="tva"><div><label for="k-belopp">Belopp, kr</label><input id="k-belopp" type="number" inputmode="decimal" min="0" step="100" value="' + esc(draft.amount) + '"></div>' +
      '<div><label for="k-datum">Köpdatum</label><input id="k-datum" type="date" value="' + esc(draft.date) + '"></div></div>';
    state.holdings.forEach(function (ho) {
      var src = draft['src_' + ho.id];
      h += '<div class="koprad"><div class="namn">' + esc(ho.name) + '</div><div class="falt">' +
        '<div><label for="pc-' + esc(ho.id) + '">Andel %</label><input id="pc-' + esc(ho.id) + '" type="number" inputmode="decimal" min="0" max="100" step="0.1" data-pct="' + esc(ho.id) + '" value="' + esc(draft.pct[ho.id]) + '"></div>' +
        '<div><label for="pr-' + esc(ho.id) + '">Kurs, kr</label><input id="pr-' + esc(ho.id) + '" type="number" inputmode="decimal" min="0" step="0.01" data-price="' + esc(ho.id) + '" value="' + esc(draft.price[ho.id]) + '"></div>' +
        '<div><span class="etik">Belopp</span><strong data-amt="' + esc(ho.id) + '"></strong></div></div>' +
        '<p class="small muted">' + (src ? 'Kursen är från ' + fd(src.date, true) + ' (' + src.source + '). Ändra om du handlade till en annan kurs.' : 'Ingen kurs finns för dagen. Ange den kurs du handlade till.') + '</p></div>';
    });
    h += '<p id="k-summa" class="small"></p><p id="k-fel" class="fel" role="alert"></p>' +
      '<button class="knapp" data-act="registrera">Registrera köp</button>' +
      '<button class="knapp tyst" data-act="mal">Enligt målfördelning</button>' +
      '<button class="knapp tyst" data-act="styr">Styr mot målet</button>' +
      '<p class="small muted" style="margin-top:10px">”Styr mot målet” lägger mer på det som har halkat efter, så att portföljen närmar sig målfördelningen utan att du säljer något.</p>';

    h += '</details><h3>Tidigare köp</h3>';
    if (!state.purchases.length) h += '<p class="muted">Inga köp registrerade än. Din första insättning registreras på samma sätt som ett månadsköp.</p>';
    state.purchases.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).forEach(function (p) {
      var tot = p.lines.reduce(function (s, l) { return s + (p.opening && l.value != null ? l.value : l.amount); }, 0);
      h += '<div class="innehav-rad"><div class="namn">' + fd(p.date) + ' · ' + (p.opening ? 'Ingående innehav, värde ' : '') + kr(tot) + (p.auto ? ' <span class="small muted">månadssparande</span>' : '') + '</div><div class="small muted">' +
        p.lines.map(function (l) { var ho = holding(l.hid); return esc(ho ? ho.name : l.hid) + ' ' + kr(p.opening && l.value != null ? l.value : l.amount); }).join(', ') + '</div>' +
        '<div class="rad2"><button class="lank" data-act="tabortkop" data-id="' + esc(p.id) + '">' + (confirmDel === 'p' + p.id ? 'Bekräfta: ta bort köpet' : 'Ta bort') + '</button></div></div>';
    });
    return h;
  }
  function holding(id) { for (var i = 0; i < state.holdings.length; i++) if (state.holdings[i].id === id) return state.holdings[i]; return null; }
  function refreshBuy() {
    if (tab !== 'kop' || !draft) return;
    var s = pctSum();
    state.holdings.forEach(function (h) {
      var el = view.querySelector('[data-amt="' + h.id + '"]');
      if (el) el.textContent = kr(num(draft.amount) * num(draft.pct[h.id]) / 100);
    });
    var sm = document.getElementById('k-summa');
    if (sm) { sm.textContent = 'Andelarna summerar till ' + (Math.round(s * 10) / 10).toString().replace('.', ',') + ' %.' + (Math.abs(s - 100) > 0.5 ? ' De behöver bli 100 %.' : ''); sm.className = 'small ' + (Math.abs(s - 100) > 0.5 ? 'fel' : 'muted'); }
  }
  function register() {
    var err = document.getElementById('k-fel');
    var amount = num(draft.amount);
    if (!(amount > 0)) { err.textContent = 'Ange ett belopp större än noll.'; return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) { err.textContent = 'Välj ett köpdatum.'; return; }
    if (draft.date > today()) { err.textContent = 'Köpdatumet ligger i framtiden. Registrera köpet när det är gjort.'; return; }
    if (Math.abs(pctSum() - 100) > 0.5) { err.textContent = 'Andelarna behöver summera till 100 %.'; return; }
    var lines = [], missing = [];
    state.holdings.forEach(function (h) {
      var a = amount * num(draft.pct[h.id]) / 100;
      if (a < 0.005) return;
      var p = num(draft.price[h.id]);
      if (!(p > 0)) { missing.push(h.name); return; }
      lines.push({ hid: h.id, amount: Math.round(a * 100) / 100, price: p, units: a / p });
    });
    if (missing.length) { err.textContent = 'Ange kurs för ' + missing.join(', ') + '. Kursen står i bankens app eller på avräkningsnotan.'; return; }
    lines.forEach(function (l) {
      var auto = F.priceOn({ manualPrices: {} }, prices, l.hid, draft.date);
      if (!auto || auto.date !== draft.date || Math.abs(auto.price - l.price) > 1e-9) {
        state.manualPrices[l.hid] = state.manualPrices[l.hid] || {};
        state.manualPrices[l.hid][draft.date] = l.price;
      }
    });
    state.purchases.push({ id: Date.now().toString(36), date: draft.date, lines: lines });
    save();
    flash = { ok: true, text: 'Köpet på ' + kr(amount) + ' den ' + fd(draft.date) + ' är registrerat.' };
    draft = null; render();
  }

  /* ---------- Rapport ---------- */
  function currentReport() {
    var periods = F.reportPeriods(state, today());
    if (!periods.length) return null;
    if (repIdx >= periods.length) repIdx = 0;
    var p = periods[repIdx];
    var rep = F.periodReport(state, prices, p.start, p.end);
    return { periods: periods, p: p, rep: rep, analysis: F.analysis(rep), recs: F.recommendations(state, prices, rep, { fullPeriod: p.full }) };
  }
  function periodLabel(p) { return (p.full ? '' : 'Hittills: ') + fd(p.start, p.start.slice(0, 4) === p.end.slice(0, 4)) + ' – ' + fd(p.end); }

  function viewRapport() {
    var r = currentReport();
    if (!r) return state.purchases.length ? '<h2>Månadsrapport</h2><p>Dina innehav lades in i dag. Den första rapporten kommer i morgon och sedan varje köpdag, när det finns en utveckling att redovisa.</p>' : '<h2>Månadsrapport</h2><p>Rapporten bygger på dina köp. Registrera det första köpet så räknas utvecklingen fram varje köpdag.</p><button class="knapp" data-go="kop">Registrera köp</button>';
    var rep = r.rep, h = '<h2>Månadsrapport</h2>';
    h += '<label for="r-period" class="ejtryck">Period</label><select id="r-period" class="ejtryck">' + r.periods.map(function (p, i) {
      return '<option value="' + i + '"' + (i === repIdx ? ' selected' : '') + '>' + esc(periodLabel(p)) + '</option>'; }).join('') + '</select>';
    h += '<p class="muted small" style="margin-top:8px">' + esc(periodLabel(r.p)) + '</p>';
    h += '<dl class="nyckeltal"><div><dt>Värde vid slutet</dt><dd>' + kr(rep.total.v1) + '</dd></div><div><dt>Köp i perioden</dt><dd>' + kr(rep.total.buys) +
      '</dd></div><div><dt>Utveckling</dt><dd class="' + cls(rep.total.gain) + '">' + F.fmtSignedKr(rep.total.gain) + '</dd></div></dl>';

    if (rep.total.open) h += '<p class="small muted">Befintliga innehav värda ' + kr(rep.total.open) + ' lades in under perioden. De räknas inte som köp, och utvecklingen mäts från den dagen.</p>';
    h += '<h3>Redovisning per tillgångsslag</h3><div class="rulla"><table><thead><tr><th>Innehav</th><th>Köp</th><th>Värde</th><th>Utveckling</th></tr></thead><tbody>';
    F.TYPE_ORDER.forEach(function (t) {
      var b = rep.byType[t];
      if (!b.count) return;
      h += '<tr class="slag"><td>' + F.TYPES[t] + '</td><td>' + kr(b.buys) + '</td><td>' + kr(b.v1) + '</td><td class="' + cls(b.gain) + '">' + F.fmtSignedKr(b.gain) + '<br><span class="small">' + F.fmtPct(b.pct, 2) + '</span></td></tr>';
      rep.rows.forEach(function (row) {
        if (row.type !== t || row.empty) return;
        h += '<tr><td>' + esc(row.name) + '</td><td>' + kr(row.buys) + '</td><td>' + kr(row.v1) + '</td><td class="' + cls(row.gain) + '">' + F.fmtSignedKr(row.gain) +
          '<br><span class="small">' + F.fmtPct(row.priceChange != null ? row.priceChange : row.pct, 2) + '</span></td></tr>';
      });
    });
    h += '<tr class="summa"><td>Totalt</td><td>' + kr(rep.total.buys) + '</td><td>' + kr(rep.total.v1) + '</td><td class="' + cls(rep.total.gain) + '">' + F.fmtSignedKr(rep.total.gain) + '<br><span class="small">' + F.fmtPct(rep.total.pct, 2) + '</span></td></tr></tbody></table></div>' +
      '<p class="small muted">Procenten för ett innehav är kursförändringen under perioden. För tillgångsslag och totalt är den utvecklingen i förhållande till ingående värde plus köp.</p>';

    h += '<h3>Analys</h3>' + r.analysis.map(function (s) { return '<p>' + esc(s) + '</p>'; }).join('');
    h += '<h3>Fördelning efter perioden</h3>' + allocation(rep.snapEnd);
    h += '<h3>Rekommendation</h3><ul class="forslag">' + r.recs.map(function (x) { return '<li class="' + x.level + '"><strong>' + esc(x.title) + '</strong>' + esc(x.text) + '</li>'; }).join('') + '</ul>' +
      '<p class="small muted">Förslagen räknas fram med fasta regler utifrån dina egna mål och siffror. De är inte finansiell rådgivning.</p>' +
      '<button class="knapp tyst" data-act="kopiera">Kopiera rapporten</button><button class="knapp tyst" data-act="skrivut">Skriv ut</button>';
    return h;
  }
  function reportText() {
    var r = currentReport(); if (!r) return '';
    var out = ['Fondkoll – månadsrapport ' + periodLabel(r.p), ''];
    out.push('Värde: ' + kr(r.rep.total.v1) + ' | Köp: ' + kr(r.rep.total.buys) + ' | Utveckling: ' + F.fmtSignedKr(r.rep.total.gain) + ' (' + F.fmtPct(r.rep.total.pct, 2) + ')', '');
    F.TYPE_ORDER.forEach(function (t) {
      var b = r.rep.byType[t]; if (!b.count) return;
      out.push(F.TYPES[t] + ': värde ' + kr(b.v1) + ', utveckling ' + F.fmtSignedKr(b.gain) + ' (' + F.fmtPct(b.pct, 2) + ')');
      r.rep.rows.forEach(function (row) { if (row.type === t && !row.empty) out.push('  ' + row.name + ': ' + kr(row.v1) + ', ' + F.fmtSignedKr(row.gain) + ' (' + F.fmtPct(row.priceChange != null ? row.priceChange : row.pct, 2) + ')'); });
    });
    out.push('', 'Analys'); r.analysis.forEach(function (s) { out.push(s); });
    out.push('', 'Rekommendation'); r.recs.forEach(function (x) { out.push('- ' + x.title + ': ' + x.text); });
    return out.join('\n');
  }

  /* ---------- Innehav ---------- */
  function viewInnehav() {
    var t = today(), snap = F.snapshot(state, prices, t), tg = F.targets(state);
    var h = '<h2>Innehav</h2>';
    h += '<p class="muted">' + (state.plan && state.settings.monthlyAmount > 0 ? 'Månadssparande: ' + kr(state.settings.monthlyAmount) + ' den ' + buyDay() + ':e. ' : 'Inget månadssparande är upplagt. ') +
      '<button class="lank" data-go="kop">Ändra under Sparande</button></p>';

    h += '<h3>Dina innehav</h3>';
    if (!state.holdings.length) h += '<p class="muted">Listan är tom. Välj fonder och aktier nedan.</p>';
    snap.rows.forEach(function (r) {
      var used = hasLines(r.id);
      h += '<div class="innehav-rad"><div class="namn">' + esc(r.name) + ' <span class="small muted">' + F.TYPES[r.type].replace(/er$/, '') + '</span></div><div class="rad2">' +
        '<span><label style="display:inline;margin:0" for="m-' + esc(r.id) + '">Mål %</label> <input id="m-' + esc(r.id) + '" type="number" inputmode="decimal" min="0" max="100" step="1" data-target="' + esc(r.id) + '" value="' + esc(r.target) + '"></span>' +
        '<span>' + (r.price != null ? 'Kurs ' + fmtPrice(r.price) + ' (' + fd(r.priceDate, true) + ', ' + r.source + ')' : 'Ingen kurs än') + '</span>' +
        (r.units ? '<span>Värde ' + kr(r.value) + '</span>' : '') + '</div><div class="rad2">' +
        '<button class="lank" data-act="kurs" data-id="' + esc(r.id) + '">Ange kurs</button>' +
        (used ? '<span>Har köp. Sätt mål 0 % för att sluta köpa.</span>' : '<button class="lank" data-act="tabort" data-id="' + esc(r.id) + '">Ta bort</button>') + '</div>';
      if (openPrice === r.id) {
        h += '<div class="panel"><div class="tva"><div><label for="p-datum">Datum</label><input id="p-datum" type="date" value="' + t + '" max="' + t + '"></div>' +
          '<div><label for="p-kurs">Kurs, kr</label><input id="p-kurs" type="number" inputmode="decimal" min="0" step="0.01"></div></div>' +
          '<button class="knapp" data-act="sparakurs" data-id="' + esc(r.id) + '">Spara kurs</button><p id="p-fel" class="fel" role="alert"></p></div>';
      }
      h += '</div>';
    });
    if (state.holdings.length) {
      var bad = Math.abs(tg.sum - 100) > 0.5;
      h += '<p class="small ' + (bad ? 'fel' : 'muted') + '" id="i-summa">Målvikterna summerar till ' + (Math.round(tg.sum * 10) / 10).toString().replace('.', ',') + ' %.' + (bad ? ' Justera så att de blir 100 %.' : '') + '</p>';
    }

    var have = {}; state.holdings.forEach(function (x) { have[x.id] = 1; });
    h += '<h3>Lägg till fond eller aktie</h3><form data-form="sok"><label for="q">Sök på namn, kortnamn eller ISIN</label><input id="q" type="text" inputmode="search" autocomplete="off" spellcheck="false" value="' + esc(search.term) + '" placeholder="t.ex. Handelsbanken Global eller INVE B">' +
      '<button class="knapp" type="submit">Sök</button></form><p class="small muted">Söker bland fonder som säljs i Sverige och aktier på Stockholmsbörsen.</p><div id="sokres">' + searchResults() + '</div>';
    h += '<label for="a-kat" style="margin-top:22px">Eller välj ur den färdiga listan</label><select id="a-kat"><option value="">Välj …</option>';
    F.TYPE_ORDER.forEach(function (ty) {
      var items = catalog.filter(function (c) { return c.type === ty && !have[c.id]; });
      if (!items.length) return;
      h += '<optgroup label="' + F.TYPES[ty] + '">' + items.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>'; }).join('') + '</optgroup>';
    });
    h += '</select><button class="knapp tyst" data-act="laggtill">Lägg till</button>';
    if (!catalog.length) h += '<p class="small muted">Listan kunde inte läsas in just nu. Du kan lägga till egna innehav nedan.</p>';
    h += '<div class="panel" style="margin-top:18px"><p><strong>Hittar du det inte?</strong> Lägg in det själv, till exempel utländska aktier. Kursen anger du då för hand.</p>' +
      '<div class="tva"><div><label for="e-namn">Namn</label><input id="e-namn" type="text" maxlength="60"></div><div><label for="e-typ">Tillgångsslag</label><select id="e-typ">' +
      F.TYPE_ORDER.map(function (ty) { return '<option value="' + ty + '">' + F.TYPES[ty] + '</option>'; }).join('') + '</select></div></div>' +
      '<button class="knapp tyst" data-act="eget">Lägg till eget innehav</button><p id="e-fel" class="fel" role="alert"></p></div>';

    h += '<h3>Lösenord</h3><button class="knapp" data-act="las">Lås appen</button>' +
      '<form data-form="byt" class="panel" style="margin-top:14px"><p><strong>Byt lösenord</strong></p><div class="tva"><div><label for="pw1">Nytt lösenord</label><input id="pw1" type="password" autocomplete="new-password" minlength="8" required></div>' +
      '<div><label for="pw2">Upprepa</label><input id="pw2" type="password" autocomplete="new-password" minlength="8" required></div></div>' +
      '<button class="knapp tyst" type="submit">Byt lösenord</button><p id="byt-fel" class="fel" role="alert"></p></form>';
    h += '<h3>Hämta innehav med startkod</h3><form data-form="startkod"><label for="kod2">Startkod</label><input id="kod2" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX">' +
      '<p class="small muted">Lägger in dina förberedda innehav och belopp. Det som redan finns i appen ersätts.</p><button class="knapp tyst" type="submit">Hämta innehav</button><p id="kod-fel" class="fel" role="alert"></p></form>';
    h += '<h3>Dina uppgifter</h3><p class="muted">Belopp, köp och innehav sparas krypterade i den här webbläsaren och syns inte för någon annan. Exportera en kopia om du vill byta enhet eller ha en reserv. Kopian är inte krypterad, så förvara den säkert.</p>' +
      (saveFailed ? '<p class="fel">Webbläsaren tillåter inte att uppgifterna sparas. Exportera en kopia innan du stänger sidan.</p>' : '') +
      '<button class="knapp tyst" data-act="export">Exportera kopia</button><label class="knapp tyst" for="imp" style="color:var(--spruce)">Importera kopia</label><input id="imp" type="file" accept="application/json,.json" hidden>';
    if (prices.failed && prices.failed.length) h += '<p class="small muted" style="margin-top:14px">Senaste kurshämtningen misslyckades för: ' + esc(prices.failed.join(', ')) + '. Ange kurs för hand för dessa.</p>';
    return h;
  }

  /* ---------- Gemensamt ---------- */
  function render() {
    document.body.classList.toggle('last', !state);
    if (state && F.resolveOpening(state, prices)) save();
    autoBuy();
    if (!state) {
      view.innerHTML = viewLock();
      document.getElementById('kursinfo').textContent = '';
      var first = view.querySelector('input[type=password]'); if (first && !lockErr) first.focus();
      return;
    }
    var views = { oversikt: viewOversikt, kop: viewKop, rapport: viewRapport, innehav: viewInnehav };
    var msg = flash ? '<p class="' + (flash.ok ? 'klart' : 'notis') + '" role="status">' + esc(flash.text) + '</p>' : '';
    flash = null;
    view.innerHTML = msg + views[tab]();
    Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (b) {
      if (b.getAttribute('data-tab') === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    refreshBuy(); refreshPlan(); refreshMs();
    var info = document.getElementById('kursinfo');
    info.textContent = prices.updated ? 'Kurser hämtade ' + fd(prices.updated.slice(0, 10)) : 'Inga automatiska kurser än';
  }
  function go(t) { tab = t; search = { term: '', rows: null, busy: false, err: '' }; if (t !== 'kop') { draft = null; pd = null; } openPrice = null; confirmDel = null; render(); window.scrollTo(0, 0); }

  document.querySelector('.tabs').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-tab]'); if (b && state) go(b.getAttribute('data-tab'));
  });

  view.addEventListener('click', function (e) {
    var g = e.target.closest('[data-go]'); if (g) { go(g.getAttribute('data-go')); return; }
    var a = e.target.closest('[data-act]'); if (!a) return;
    var act = a.getAttribute('data-act'), id = a.getAttribute('data-id');
    if (act === 'radera') {
      if (!wipeAsk) { wipeAsk = true; render(); return; }
      try { localStorage.removeItem(KEY2); localStorage.removeItem(KEY); } catch (err) {}
      wipeAsk = false; lockErr = ''; render(); return;
    }
    if (act === 'las') { saveChain.then(lock); return; }
    if (!state) return;
    if (act === 'msadd') addFromSearch(+id);
    else if (act === 'sparaplan') savePlan();
    else if (act === 'splanbort') { delete pd.alloc[id]; render(); }
    else if (act === 'splanadd') {
      var sid = document.getElementById('s-add').value; if (!sid) return;
      if (!holding(sid)) { var ci = catalog.filter(function (x) { return x.id === sid; })[0]; if (!ci) return; state.holdings.push({ id: ci.id, name: ci.name, type: ci.type, target: 0 }); save(); draft = null; }
      pd.alloc[sid] = Object.keys(pd.alloc).length ? '' : 100; render();
    }
    else if (act === 'registrera') register();
    else if (act === 'mal') { setPctFromTargets(draft); render(); }
    else if (act === 'styr') {
      var amt = num(draft.amount), sug = F.suggestBuy(state, prices, draft.date, amt), acc = 0, lastId = null;
      state.holdings.forEach(function (h) { var p = amt > 0 ? Math.round(sug[h.id] / amt * 1000) / 10 : 0; draft.pct[h.id] = p; acc += p; if (p > 0) lastId = h.id; });
      if (lastId) draft.pct[lastId] = Math.round((draft.pct[lastId] + 100 - acc) * 10) / 10;
      render();
    }
    else if (act === 'tabortkop') {
      if (confirmDel !== 'p' + id) { confirmDel = 'p' + id; render(); return; }
      var gone = state.purchases.filter(function (p) { return p.id === id; })[0];
      if (gone && gone.planDate && state.plan) { state.plan.skipped = (state.plan.skipped || []).concat([gone.planDate]); }
      state.purchases = state.purchases.filter(function (p) { return p.id !== id; }); confirmDel = null; save();
      flash = { ok: true, text: 'Köpet är borttaget.' }; render();
    }
    else if (act === 'kopiera') {
      var txt = reportText();
      var done = function (ok) { flash = { ok: ok, text: ok ? 'Rapporten är kopierad.' : 'Det gick inte att kopiera. Använd Skriv ut i stället.' }; render(); };
      try { navigator.clipboard.writeText(txt).then(function () { done(true); }, function () { done(false); }); } catch (err) { done(false); }
    }
    else if (act === 'skrivut') window.print();
    else if (act === 'kurs') { openPrice = openPrice === id ? null : id; render(); }
    else if (act === 'sparakurs') {
      var d = document.getElementById('p-datum').value, p = num(document.getElementById('p-kurs').value);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !(p > 0)) { document.getElementById('p-fel').textContent = 'Ange datum och en kurs större än noll.'; return; }
      state.manualPrices[id] = state.manualPrices[id] || {}; state.manualPrices[id][d] = p; save();
      openPrice = null; flash = { ok: true, text: 'Kursen är sparad.' }; render();
    }
    else if (act === 'tabort') { state.holdings = state.holdings.filter(function (h) { return h.id !== id; }); delete state.manualPrices[id]; delete state.priceCache[id]; if (prices.series) delete prices.series[id]; save(); render(); }
    else if (act === 'laggtill') {
      var sel = document.getElementById('a-kat').value, c = catalog.filter(function (x) { return x.id === sel; })[0];
      if (!c) return;
      state.holdings.push({ id: c.id, name: c.name, type: c.type, target: 0 }); save();
      flash = { ok: true, text: c.name + ' är tillagd. Ange en målvikt.' }; render();
    }
    else if (act === 'eget') {
      var name = document.getElementById('e-namn').value.trim();
      if (!name) { document.getElementById('e-fel').textContent = 'Skriv ett namn på innehavet.'; return; }
      state.holdings.push({ id: 'eget-' + Date.now().toString(36), name: name, type: document.getElementById('e-typ').value, target: 0, custom: true }); save();
      flash = { ok: true, text: name + ' är tillagd. Ange en målvikt.' }; render();
    }
    else if (act === 'export') {
      var copy = JSON.parse(JSON.stringify(state)); copy.priceCache = {};
      var blob = new Blob([JSON.stringify(copy, null, 1)], { type: 'application/json' });
      var link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'fondkoll-' + today() + '.json';
      document.body.appendChild(link); link.click(); link.remove();
    }
  });

  view.addEventListener('submit', onSubmit);
  view.addEventListener('toggle', function (e) { if (e.target.classList && e.target.classList.contains('hand')) manualOpen = e.target.open; }, true);

  view.addEventListener('input', function (e) {
    var el = e.target;
    if (!state) return;
    if (el.id === 's-belopp' || el.id === 's-dag' || el.hasAttribute('data-spct')) { var sf = document.getElementById('s-fel'); if (sf) sf.textContent = ''; }
    if (el.id === 's-belopp') { pd.amount = el.value; refreshPlan(); }
    else if (el.id === 's-dag') { pd.day = el.value; }
    else if (el.hasAttribute('data-spct')) { pd.alloc[el.getAttribute('data-spct')] = el.value; refreshPlan(); }
    else if (el.id === 'k-belopp') { draft.amount = el.value; refreshBuy(); }
    else if (el.hasAttribute('data-pct')) { draft.pct[el.getAttribute('data-pct')] = el.value; refreshBuy(); }
    else if (el.hasAttribute('data-price')) { draft.price[el.getAttribute('data-price')] = el.value; }
    else if (el.hasAttribute('data-target')) {
      var h = holding(el.getAttribute('data-target')); if (h) { h.target = Math.max(0, num(el.value)); save(); }
      var s = document.getElementById('i-summa'), sum = F.targets(state).sum;
      if (s) { var bad = Math.abs(sum - 100) > 0.5; s.textContent = 'Målvikterna summerar till ' + (Math.round(sum * 10) / 10).toString().replace('.', ',') + ' %.' + (bad ? ' Justera så att de blir 100 %.' : ''); s.className = 'small ' + (bad ? 'fel' : 'muted'); }
    }
  });
  view.addEventListener('change', function (e) {
    var el = e.target;
    if (!state) return;
    if (el.id === 'k-datum') { draft.date = el.value; prefillPrices(draft); render(); }
    else if (el.id === 'r-period') { repIdx = +el.value; render(); }
    else if (el.id === 's-auto') { pd.auto = el.checked; }
    else if (el.id === 'imp' && el.files && el.files[0]) {
      var rd = new FileReader();
      rd.onload = function () {
        try { var data = JSON.parse(rd.result); if (!data || !Array.isArray(data.holdings)) throw new Error('fel format'); state = normalise(data); save(); flash = { ok: true, text: 'Kopian är inläst.' }; }
        catch (err) { flash = { ok: false, text: 'Filen kunde inte läsas. Välj en kopia som exporterats från Fondkoll.' }; }
        render();
      };
      rd.readAsText(el.files[0]);
    }
  });

  function getJson(url) { return fetch(url, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }
  render();
  Promise.all([
    getJson('data/prices.json').then(function (p) { if (p && p.series) { prices = p; mergeCache(); } }).catch(function () {}),
    getJson('data/catalog.json').then(function (c) { if (Array.isArray(c)) catalog = c; }).catch(function () {})
  ]).then(function () { pricesLoaded = true; if (state && !draft && !pd) render(); else if (state) { autoBuy(); } });
})();
