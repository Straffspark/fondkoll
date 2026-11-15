const O = 'https://straffspark.github.io';
async function probe(label, url, show) {
  try {
    const r = await fetch(url, { headers: { Origin: O, Referer: O + '/', Accept: 'application/json' } });
    const t = await r.text();
    console.log('## ' + label + ' -> ' + r.status + ' ACAO=' + r.headers.get('access-control-allow-origin') + ' len=' + t.length + ' :: ' + t.slice(0, show || 240).replace(/\s+/g, ' '));
  } catch (e) { console.log('## ' + label + ' -> ERR ' + e.message); }
}
const B = 'https://lt.morningstar.com/api/rest.svc/9vehuxllxs/security/screener?page=1&pageSize=4&sortOrder=LegalName%20asc&outputType=json&version=1&languageId=sv-SE&currencyId=SEK&securityDataPoints=SecId%7CName%7CISIN%7CTicker%7CClosePrice%7CPriceCurrency%7CCategoryName%7CGlobalAssetClassId%7CLargestSector%7CUniverse';
await probe('funds cat', B + '&universeIds=FOSWE%24%24ALL&term=Spiltan%20R%C3%A4ntefond', 900);
await probe('funds mix', B + '&universeIds=FOSWE%24%24ALL&term=Access%20Mix', 700);
await probe('funds isin', B + '&universeIds=FOSWE%24%24ALL&term=SE0005188836', 500);
await probe('stocks', B + '&universeIds=E0EXG%24XSTO&term=Investor', 700);
await probe('stocks ticker', B + '&universeIds=E0EXG%24XSTO&term=ERIC%20B', 500);
await probe('both universes', B + '&universeIds=FOSWE%24%24ALL%7CE0EXG%24XSTO&term=Swedbank', 900);
await probe('stocks first north', B + '&universeIds=E0EXG%24XSTO%7CE0EXG%24FNSE&term=Fastator', 500);
const T = 'https://lt.morningstar.com/api/rest.svc/timeseries_price/9vehuxllxs?currencyId=SEK&idtype=Morningstar&frequency=daily&outputType=COMPACTJSON&startDate=2024-11-15&id=';
await probe('ts stock 2y ]3]', T + encodeURIComponent('0P0000A6H8]3]0]E0WWE$$ALL'), 120);
await probe('ts stock plain universe', T + encodeURIComponent('0P0000A6H8]3]0]E0EXG$XSTO'), 120);
await probe('ts fund 2y', T + encodeURIComponent('F00001T2FY]2]0]FOSWE$$ALL'), 120);
await probe('ts bad id', T + 'XXXX', 120);
