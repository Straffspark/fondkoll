const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
async function probe(label, url, headers = {}) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, ...headers } });
    const t = await r.text();
    console.log('## ' + label + ' -> ' + r.status + ' len=' + t.length + ' :: ' + t.slice(0, 220).replace(/\s+/g, ' '));
    return { r, t };
  } catch (e) { console.log('## ' + label + ' -> ERR ' + e.message); return {}; }
}
await probe('yahoo q1 stock', 'https://query1.finance.yahoo.com/v8/finance/chart/VOLV-B.ST?range=5d&interval=1d');
await probe('yahoo q2 stock', 'https://query2.finance.yahoo.com/v8/finance/chart/VOLV-B.ST?range=5d&interval=1d');
await probe('yahoo q2 fund', 'https://query2.finance.yahoo.com/v8/finance/chart/0P00000L3H.ST?range=5d&interval=1d');
await probe('yahoo search isin', 'https://query2.finance.yahoo.com/v1/finance/search?quotesCount=6&newsCount=0&q=SE0005188836');
let cookie = '';
try { const r = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': UA } }); cookie = (r.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; '); console.log('## cookie len ' + cookie.length); } catch (e) { console.log('## cookie ERR ' + e.message); }
const cr = await probe('yahoo crumb', 'https://query2.finance.yahoo.com/v1/test/getcrumb', { Cookie: cookie });
if (cr.t && cr.r.ok) await probe('yahoo q2 crumb', 'https://query2.finance.yahoo.com/v8/finance/chart/VOLV-B.ST?range=5d&interval=1d&crumb=' + encodeURIComponent(cr.t), { Cookie: cookie });
const ms = 'https://tools.morningstar.se/api/rest.svc/timeseries_price/n4omw1k3rh?currencyId=SEK&frequency=daily&startDate=2026-11-01&outputType=COMPACTJSON';
await probe('ms fund id', ms + '&idtype=Morningstar&id=0P00000L3H');
await probe('ms fund id ]2]', ms + '&idtype=Morningstar&id=' + encodeURIComponent('0P00000L3H]2]0]FOSWE$$ALL'));
await probe('ms isin', ms + '&idtype=Isin&id=SE0005188836');
await probe('ms stock isin', ms + '&idtype=Isin&id=SE0000115446');
await probe('stooq', 'https://stooq.com/q/d/l/?s=volv-b.se&i=d');
await probe('stooq2', 'https://stooq.com/q/d/l/?s=volvb.st&i=d');
