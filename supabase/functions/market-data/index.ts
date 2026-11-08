const corsHeaders = {
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS'
};

const json = (body:Record<string, unknown>, status=200) => new Response(JSON.stringify(body), {
  status,
  headers:{...corsHeaders, 'Content-Type':'application/json'}
});

const intervals = new Set(['1d','1wk','1h']);

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', {headers:corsHeaders});
  if (request.method !== 'POST') return json({error:'Method not allowed.'}, 405);

  let payload:{symbol?:string; interval?:string};
  try { payload = await request.json(); }
  catch { return json({error:'Invalid request body.'}, 400); }

  const symbol = String(payload.symbol || '').trim().toUpperCase();
  const interval = String(payload.interval || '1d');
  if (!symbol || symbol.length > 32 || !intervals.has(interval)) return json({error:'Invalid market-data request.'}, 400);

  const now = Math.floor(Date.now() / 1000);
  const lookback = interval === '1h' ? 60 * 60 * 24 * 700 : 60 * 60 * 24 * 3650;
  const endpoint = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  endpoint.searchParams.set('period1', String(now - lookback));
  endpoint.searchParams.set('period2', String(now));
  endpoint.searchParams.set('interval', interval);
  endpoint.searchParams.set('events', 'history');

  try {
    const upstream = await fetch(endpoint, {headers:{'User-Agent':'Trade-Journal/1.0'}});
    if (!upstream.ok) return json({error:`Market data provider returned ${upstream.status}.`}, 502);
    const chart = await upstream.json();
    const result = chart?.chart?.result?.[0];
    const quote = result?.indicators?.quote?.[0];
    if (!result?.timestamp || !quote) return json({error:'No market data returned for this instrument.'}, 404);
    const rows = result.timestamp.map((time:number, i:number) => ({
      time, open:quote.open?.[i], high:quote.high?.[i], low:quote.low?.[i], close:quote.close?.[i], volume:quote.volume?.[i] || 1
    })).filter((row:{open?:number;high?:number;low?:number;close?:number}) => [row.open,row.high,row.low,row.close].every(Number.isFinite));
    return json({symbol, interval, rows});
  } catch (error) {
    console.error('Market data request failed:', error);
    return json({error:'Could not reach the market data provider.'}, 502);
  }
});
