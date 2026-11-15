// Hämtar dagskurser för allt i data/catalog.json och sparar dem i data/prices.json.
// Körs av GitHub Actions (.github/workflows/kurser.yml). Kräver Node 20+.
import fs from 'node:fs/promises';

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (res.ok) return await res.json();
      lastErr = new Error('HTTP ' + res.status);
    } catch (e) { lastErr = e; }
    await sleep(1500 * (i + 1));
  }
  throw lastErr;
}

async function symbolFromIsin(isin) {
  const r = await getJson('https://query2.finance.yahoo.com/v1/finance/search?quotesCount=6&newsCount=0&q=' + encodeURIComponent(isin));
  const quotes = (r.quotes || []).filter((q) => q.symbol);
  const st = quotes.find((q) => q.symbol.endsWith('.ST'));
  return (st || quotes[0] || {}).symbol || null;
}

async function history(symbol) {
  const r = await getJson('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) + '?range=2y&interval=1d');
  const res = r.chart && r.chart.result && r.chart.result[0];
  if (!res || !res.timestamp) throw new Error('inga data');
  const offset = (res.meta && res.meta.gmtoffset) || 0;
  const close = res.indicators.quote[0].close;
  const points = [];
  res.timestamp.forEach((ts, i) => {
    const c = close[i];
    if (c == null || !isFinite(c)) return;
    points.push([new Date((ts + offset) * 1000).toISOString().slice(0, 10), Math.round(c * 10000) / 10000]);
  });
  if (!points.length) throw new Error('inga kurser');
  return { currency: (res.meta && res.meta.currency) || 'SEK', points };
}

const catalog = JSON.parse(await fs.readFile('data/catalog.json', 'utf8'));
let old = { series: {} };
try { old = JSON.parse(await fs.readFile('data/prices.json', 'utf8')); } catch {}
const series = {};
let ok = 0;
const failed = [];

for (const item of catalog) {
  const prev = (old.series || {})[item.id];
  const candidates = [item.symbol, prev && prev.symbol].filter(Boolean);
  let got = null, used = null;
  for (const sym of [...new Set(candidates)]) {
    try { got = await history(sym); used = sym; break; } catch {}
  }
  if (!got && item.isin) {
    try {
      const sym = await symbolFromIsin(item.isin);
      if (sym) { got = await history(sym); used = sym; }
    } catch {}
  }
  if (got) {
    const merged = new Map(((prev && prev.points) || []).map((p) => [p[0], p[1]]));
    got.points.forEach((p) => merged.set(p[0], p[1]));
    series[item.id] = { symbol: used, currency: got.currency, points: [...merged.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)) };
    ok++;
    console.log('OK   ' + item.name + ' (' + used + '), ' + got.points.length + ' dagar');
  } else {
    if (prev) series[item.id] = prev;
    failed.push(item.name);
    console.log('MISS ' + item.name);
  }
  await sleep(400);
}

await fs.writeFile('data/prices.json', JSON.stringify({ updated: new Date().toISOString(), failed, series }) + '\n');
console.log(ok + ' av ' + catalog.length + ' hämtade.');
if (catalog.length && ok === 0) process.exit(1);
