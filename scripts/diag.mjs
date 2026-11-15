const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const O = 'https://straffspark.github.io';
async function probe(label, url, opt = {}) {
  try {
    const r = await fetch(url, { ...opt, headers: { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', Origin: O, Referer: O + '/', ...(opt.headers || {}) } });
    const t = await r.text();
    console.log('## ' + label + ' -> ' + r.status + ' ACAO=' + r.headers.get('access-control-allow-origin') + ' len=' + t.length + ' :: ' + t.slice(0, opt.show || 200).replace(/\s+/g, ' '));
  } catch (e) { console.log('## ' + label + ' -> ERR ' + e.message + ' ' + (e.cause ? e.cause.code || e.cause.message : '')); }
}
const J = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
await probe('avanza search', 'https://www.avanza.se/_api/search/filtered-search', { ...J, body: JSON.stringify({ query: 'Handelsbanken Global Index', limit: 3 }) });
await probe('avanza search preflight', 'https://www.avanza.se/_api/search/filtered-search', { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
await probe('avanza fund chart', 'https://www.avanza.se/_api/fund-guide/chart/2084/one_year');
await probe('avanza stock chart', 'https://www.avanza.se/_api/price-chart/stock/5269?timePeriod=one_year');
await probe('yahoo chart', 'https://query1.finance.yahoo.com/v8/finance/chart/VOLV-B.ST?range=5d&interval=1d');
await probe('yahoo search', 'https://query2.finance.yahoo.com/v1/finance/search?quotesCount=6&newsCount=0&q=Handelsbanken%20Global%20Index', { show: 500 });
const q = '?currencyId=SEK&idtype=Morningstar&frequency=daily&startDate=2026-11-01&outputType=COMPACTJSON&id=';
await probe('ms timeseries fund', 'https://lt.morningstar.com/api/rest.svc/timeseries_price/9vehuxllxs' + q + encodeURIComponent('0P00000L3H]2]0]FOSWE$$ALL'));
await probe('ms timeseries stock', 'https://lt.morningstar.com/api/rest.svc/timeseries_price/9vehuxllxs' + q + encodeURIComponent('0P0000A5WP]3]0]E0WWE$$ALL'));
const sc = '&page=1&pageSize=5&sortOrder=LegalName%20asc&outputType=json&version=1&languageId=sv-SE&currencyId=SEK&securityDataPoints=SecId%7CName%7CLegalName%7CISIN%7CTicker%7CExchangeId%7CClosePrice%7CUniverse&term=';
for (const tok of ['klr5zyak8x', '9vehuxllxs']) {
  await probe('ms screener funds ' + tok, 'https://lt.morningstar.com/api/rest.svc/' + tok + '/security/screener?universeIds=FOSWE%24%24ALL' + sc + 'Handelsbanken%20Global%20Index', { show: 500 });
  await probe('ms screener stocks ' + tok, 'https://lt.morningstar.com/api/rest.svc/' + tok + '/security/screener?universeIds=E0EXG%24XSTO' + sc + 'Volvo', { show: 500 });
}
