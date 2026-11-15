// Hämtar dagskurser för allt i data/catalog.json och sparar dem i data/prices.json.
// Körs av GitHub Actions (.github/workflows/kurser.yml). Kräver Node 20+.
// Källor i tur och ordning: Yahoo Finance, Morningstar (fonder), Avanza.
import fs from 'node:fs/promises';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HEAD = { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', 'Accept-Language': 'sv-SE,sv;q=0.9,en;q=0.8' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const r4 = (x) => Math.round(x * 10000) / 10000;

async function getJson(url, opt = {}) {
  let lastErr;
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetch(url, { ...opt, headers: { ...HEAD, ...(opt.headers || {}) } });
      if (res.ok) return await res.json();
      lastErr = new Error('HTTP ' + res.status);
      if (res.status !== 429 && res.status < 500) break;
    } catch (e) { lastErr = e; }
    await sleep(2500);
  }
  throw lastErr;
}

async function yahooSymbol(isin) {
  const r = await getJson('https://query2.finance.yahoo.com/v1/finance/search?quotesCount=6&newsCount=0&q=' + encodeURIComponent(isin));
  const quotes = (r.quotes || []).filter((q) => q.symbol);
  return ((quotes.find((q) => q.symbol.endsWith('.ST')) || quotes[0] || {}).symbol) || null;
}
async function yahoo(symbol) {
  const r = await getJson('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) + '?range=2y&interval=1d');
  const res = r.chart && r.chart.result && r.chart.result[0];
  if (!res || !res.timestamp) throw new Error('inga data');
  const off = (res.meta && res.meta.gmtoffset) || 0, close = res.indicators.quote[0].close, points = [];
  res.timestamp.forEach((ts, i) => { if (close[i] != null && isFinite(close[i])) points.push([day((ts + off) * 1000), r4(close[i])]); });
  if (points.length < 2) throw new Error('för få kurser');
  return { currency: (res.meta && res.meta.currency) || 'SEK', points };
}
async function morningstar(secId) {
  const start = day(Date.now() - 730 * 86400000);
  const r = await getJson('https://lt.morningstar.com/api/rest.svc/timeseries_price/9vehuxllxs?currencyId=SEK&idtype=Morningstar&frequency=daily&outputType=COMPACTJSON&startDate=' +
    start + '&id=' + encodeURIComponent(secId + ']2]0]FOSWE$$ALL'));
  if (!Array.isArray(r) || r.length < 2) throw new Error('inga data');
  return { currency: 'SEK', points: r.map((p) => [day(p[0] + 7200000), r4(p[1])]) };
}
async function avanzaId(item) {
  const r = await getJson('https://www.avanza.se/_api/search/filtered-search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: item.isin || item.name, limit: 5 }) });
  const want = item.type === 'aktie' ? 'STOCK' : 'FUND';
  const hits = (r.hits || []).filter((h) => h.type === want && h.orderBookId);
  const exact = hits.find((h) => (h.title || '').toLowerCase() === item.name.toLowerCase());
  return ((item.isin ? hits[0] : exact) || {}).orderBookId || null;
}
async function avanza(item, id) {
  if (item.type === 'aktie') {
    const r = await getJson('https://www.avanza.se/_api/price-chart/stock/' + id + '?timePeriod=three_years');
    const points = (r.ohlc || []).filter((o) => o.close != null).map((o) => [day(o.timestamp + 7200000), r4(o.close)]);
    if (points.length < 2) throw new Error('inga data');
    return { currency: 'SEK', points };
  }
  const [chart, guide] = [await getJson('https://www.avanza.se/_api/fund-guide/chart/' + id + '/three_years'), await getJson('https://www.avanza.se/_api/fund-guide/guide/' + id)];
  const nav = +guide.nav, ser = chart.dataSerie || [];
  if (!(nav > 0) || ser.length < 2) throw new Error('inga data');
  const last = 1 + ser[ser.length - 1].y / 100;
  return { currency: guide.currency || 'SEK', points: ser.filter((p) => p.y != null).map((p) => [day(p.x + 7200000), r4(nav * (1 + p.y / 100) / last)]) };
}

const catalog = JSON.parse(await fs.readFile('data/catalog.json', 'utf8'));
let old = { series: {} };
try { old = JSON.parse(await fs.readFile('data/prices.json', 'utf8')); } catch {}
const series = {}, failed = [];
let ok = 0;

for (const item of catalog) {
  const prev = (old.series || {})[item.id];
  const why = [];
  let got = null, source = null, symbol = item.symbol || (prev && prev.symbol) || null;
  const attempt = async (name, fn) => { if (got) return; try { got = await fn(); source = name; } catch (e) { why.push(name + ': ' + e.message); } };

  if (symbol) await attempt('yahoo', () => yahoo(symbol));
  if (!got && item.isin) await attempt('yahoo-isin', async () => { const s = await yahooSymbol(item.isin); if (!s) throw new Error('ingen träff'); const g = await yahoo(s); symbol = s; return g; });
  const sec = /^(0P[0-9A-Z]{8})/.exec(symbol || '');
  if (item.type !== 'aktie' && sec) await attempt('morningstar', () => morningstar(sec[1]));
  await attempt('avanza', async () => { const id = item.avanza || await avanzaId(item); if (!id) throw new Error('ingen träff'); return avanza(item, id); });

  if (got) {
    const merged = new Map(((prev && prev.source === source && prev.points) || []).map((p) => [p[0], p[1]]));
    got.points.forEach((p) => merged.set(p[0], p[1]));
    series[item.id] = { symbol, source, currency: got.currency, points: [...merged.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)) };
    ok++;
    const pts = series[item.id].points;
    console.log('OK   ' + item.name + ' [' + source + '] ' + pts.length + ' dagar, senast ' + pts[pts.length - 1].join(' = ') + (why.length ? '  (' + why.join('; ') + ')' : ''));
  } else {
    if (prev) series[item.id] = prev;
    failed.push(item.name);
    console.log('MISS ' + item.name + '  (' + why.join('; ') + ')');
  }
  await sleep(500);
}

await fs.writeFile('data/prices.json', JSON.stringify({ updated: new Date().toISOString(), failed, series }) + '\n');
console.log(ok + ' av ' + catalog.length + ' hämtade.');
if (catalog.length && ok === 0) process.exit(1);
