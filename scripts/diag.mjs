const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
async function probe(label, url, opt = {}) {
  try {
    const r = await fetch(url, { ...opt, headers: { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', 'Accept-Language': 'sv-SE,sv;q=0.9,en;q=0.8', ...(opt.headers || {}) } });
    const t = await r.text();
    console.log('## ' + label + ' -> ' + r.status + ' len=' + t.length + ' :: ' + t.slice(0, opt.show || 260).replace(/\s+/g, ' '));
    return { r, t };
  } catch (e) { console.log('## ' + label + ' -> ERR ' + e.message + ' ' + (e.cause ? e.cause.code || e.cause.message : '')); return {}; }
}
await probe('yahoo q1 winUA', 'https://query1.finance.yahoo.com/v8/finance/chart/VOLV-B.ST?range=5d&interval=1d');
await probe('yahoo curlUA', 'https://query1.finance.yahoo.com/v8/finance/chart/VOLV-B.ST?range=5d&interval=1d', { headers: { 'User-Agent': 'curl/8.5.0' } });
await probe('avanza fund chart', 'https://www.avanza.se/_api/fund-guide/chart/2084/one_year');
await probe('avanza fund guide', 'https://www.avanza.se/_api/fund-guide/guide/2084', { show: 400 });
await probe('avanza stock chart', 'https://www.avanza.se/_api/price-chart/stock/5269?timePeriod=one_year');
await probe('avanza search post', 'https://www.avanza.se/_api/search/filtered-search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'SE0005188836', limit: 5 }), show: 500 });
await probe('avanza search name', 'https://www.avanza.se/_api/search/filtered-search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'Spiltan Räntefond Sverige', limit: 5 }), show: 500 });
await probe('lf fondlista', 'https://lf.fondlista.se/sv/1/details/SE0000837247', { show: 120 });
const q = '?currencyId=SEK&idtype=Morningstar&frequency=daily&startDate=2026-11-01&outputType=COMPACTJSON&id=';
await probe('ms lt', 'https://lt.morningstar.com/api/rest.svc/timeseries_price/9vehuxllxs' + q + encodeURIComponent('0P00000L3H]2]0]FOSWE$$ALL'));
await probe('ms lt plain', 'https://lt.morningstar.com/api/rest.svc/timeseries_price/9vehuxllxs' + q + '0P00000L3H');
await probe('ms uk', 'https://tools.morningstar.co.uk/api/rest.svc/timeseries_price/t92wz0sj7c' + q + encodeURIComponent('0P00000L3H]2]0]FOSWE$$ALL'));
await probe('ms uk isin', 'https://tools.morningstar.co.uk/api/rest.svc/timeseries_price/t92wz0sj7c?currencyId=SEK&idtype=Isin&frequency=daily&startDate=2026-11-01&outputType=COMPACTJSON&id=SE0005188836');
