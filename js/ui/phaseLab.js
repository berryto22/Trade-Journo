import {getCloud} from '../core/cloud.js';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const colors = {TREND:'#2e86de', CONTRACTION:'#f39c12', CONSOLIDATION:'#7f8c8d', EXPANSION:'#9b59b6'};

function mean(values) { const a = values.filter(Number.isFinite); return a.length ? a.reduce((x,y) => x+y, 0) / a.length : NaN; }
function std(values) { const m = mean(values); const a = values.filter(Number.isFinite); return a.length ? Math.sqrt(mean(a.map(v => (v-m)**2))) : NaN; }
function rolling(values, n, fn) { return values.map((_, i) => i + 1 < n ? NaN : fn(values.slice(i-n+1, i+1))); }
function shift(values, n) { return values.map((_, i) => i < n ? NaN : values[i-n]); }
function diff(values) { return values.map((v,i) => i ? v-values[i-1] : NaN); }
function ema(values, n) { const out = Array(values.length).fill(NaN); const alpha = 1/n; let last = NaN; values.forEach((v,i) => { if (!Number.isFinite(v)) return; last = Number.isFinite(last) ? alpha*v + (1-alpha)*last : v; out[i] = last; }); return out; }
function atr(rows, n=14) {
  const tr = rows.map((r,i) => i ? Math.max(r.high-r.low, Math.abs(r.high-rows[i-1].close), Math.abs(r.low-rows[i-1].close)) : r.high-r.low);
  return ema(tr,n);
}
function slope(values, n=20) {
  const x = Array.from({length:n}, (_,i) => i-(n-1)/2); const den = x.reduce((a,v) => a+v*v,0);
  return values.map((_,i) => i+1<n ? NaN : x.reduce((a,v,j) => a+v*values[i-n+1+j],0)/den);
}
function percentileRank(values, n=252) {
  return values.map((v,i) => { if (i+1<n || !Number.isFinite(v)) return NaN; const a=values.slice(i-n+1,i+1).filter(Number.isFinite); return a.filter(x => x <= v).length/a.length; });
}
function classify(rows) {
  const c=rows.map(r=>r.close), h=rows.map(r=>r.high), l=rows.map(r=>r.low), v=rows.map(r=>r.volume||1), a=atr(rows);
  const er20=c.map((x,i)=>i<20?NaN:Math.abs(x-c[i-20])/diff(c).slice(i-19,i+1).reduce((s,z)=>s+Math.abs(z||0),0));
  const er10=c.map((x,i)=>i<10?NaN:Math.abs(x-c[i-10])/diff(c).slice(i-9,i+1).reduce((s,z)=>s+Math.abs(z||0),0));
  const atrAvg=rolling(a,100,mean), atrRatio=a.map((x,i)=>x/atrAvg[i]);
  const bbw=c.map((_,i)=>i<20?NaN:4*std(c.slice(i-19,i+1))/mean(c.slice(i-19,i+1)));
  const bbwPct=percentileRank(bbw);
  const recentRange=h.map((_,i)=>i<10?NaN:Math.max(...h.slice(i-9,i+1))-Math.min(...l.slice(i-9,i+1)));
  const priorRange=h.map((_,i)=>i<30?NaN:Math.max(...h.slice(i-29,i-9))-Math.min(...l.slice(i-29,i-9)));
  const compression=recentRange.map((x,i)=>x/priorRange[i]);
  const disp=c.map((x,i)=>i<20?NaN:(x-c[i-20])/a[i]);
  const adx=rolling(rows.map((r,i)=>i?Math.abs((r.high-rows[i-1].high)-(r.low-rows[i-1].low)):0),14,mean).map(x=>x*100/(mean(a)||1));
  const states=[]; let previous=null;
  rows.forEach((r,i)=>{
    const ph=i>=21 && r.high>Math.max(...h.slice(i-21,i-1)) && r.close<Math.max(...h.slice(i-21,i-1)) && r.high-r.low>=a[i];
    const pl=i>=21 && r.low<Math.min(...l.slice(i-21,i-1)) && r.close>Math.min(...l.slice(i-21,i-1)) && r.high-r.low>=a[i];
    const trend=adx[i]>22 && er20[i]>.30 && Math.abs(disp[i])>2.5;
    const expansion=ph||pl||(atrRatio[i]>1.25&&er20[i]<.30);
    const contraction=compression[i]<.70&&bbwPct[i]<.35;
    const consolidation=er20[i]<.25&&adx[i]<22;
    let state=trend?'TREND':expansion?'EXPANSION':contraction?'CONTRACTION':consolidation?'CONSOLIDATION':previous;
    if (state==='TREND' && er20[i]<.15) state='CONSOLIDATION';
    states.push(state||'CONSOLIDATION'); if (state) previous=state;
  });
  const age=[]; states.forEach((s,i)=>age.push(i&&s===states[i-1]?age[i-1]+1:1));
  return rows.map((r,i)=>({...r, state:states[i], age:age[i], adx:adx[i], er20:er20[i], er10:er10[i], atr:a[i], atrRatio:atrRatio[i], bbwPct:bbwPct[i], compression:compression[i], disp:disp[i], volumeRatio:v[i]/(rolling(v,50,mean)[i]||v[i])}));
}
async function loadRows(symbol, interval) {
  if (symbol==='DEMO') return demoRows();
  const db = getCloud();
  if (!db) throw new Error('Connect Supabase and deploy the market-data function first.');
  const {data, error} = await db.functions.invoke('market-data', {body:{symbol, interval}});
  if (error) {
    let details;
    try { details = await error.context?.json(); } catch {}
    throw new Error(details?.error || error.message || 'Market data request failed.');
  }
  if (!Array.isArray(data?.rows)) throw new Error(data?.error || 'No market data returned.');
  return data.rows.map(row => ({...row, time:new Date(row.time * 1000)}));
}
function demoRows() { let price=1800; return Array.from({length:700},(_,i)=>{ const phase=i%160<45?.004:i%160<85?0:i%160<120?-.003:0; const move=phase+(Math.random()-.5)*.012; const open=price; price*=Math.exp(move); return {time:new Date(Date.now()-(700-i)*86400000),open,close:price,high:Math.max(open,price)*1.003,low:Math.min(open,price)*.997,volume:1000+Math.random()*4000}; }); }
function drawChart(canvas, rows) { const ctx=canvas.getContext('2d'), w=canvas.width=canvas.clientWidth*devicePixelRatio, h=canvas.height=canvas.clientHeight*devicePixelRatio; ctx.scale(devicePixelRatio,devicePixelRatio); const W=canvas.clientWidth,H=canvas.clientHeight, view=rows.slice(-180), min=Math.min(...view.map(r=>r.low)),max=Math.max(...view.map(r=>r.high)), range=max-min||1; ctx.clearRect(0,0,W,H); view.forEach((r,i)=>{const x=i/(view.length-1)*W, y=v=>H-((v-min)/range)*H*.82-10; ctx.fillStyle=colors[r.state]||'#999'; ctx.globalAlpha=.16; ctx.fillRect(x,0,W/view.length+1,H); ctx.globalAlpha=1; ctx.strokeStyle=r.close>=r.open?'#27ae60':'#c0392b'; ctx.beginPath();ctx.moveTo(x,y(r.high));ctx.lineTo(x,y(r.low));ctx.stroke();ctx.fillRect(x-2,y(Math.max(r.open,r.close)),4,Math.max(1,Math.abs(y(r.open)-y(r.close)))); }); }
function render(rows) { const latest=rows.at(-1), content=$('#phaseLabContent'); const trend=latest.state==='TREND', risk=trend?Math.min(.95,Math.max(.05,.35+(latest.adx-22)/100+(latest.er20<.22?.25:0))):Math.min(.95,Math.max(.05,.20+(latest.atrRatio>1.15?.25:0)+(latest.state==='EXPANSION'?.25:0))); content.innerHTML=`<div class="phase-lab-metrics"><div><span>Current phase</span><strong style="color:${colors[latest.state]}">${esc(latest.state)}${trend?(latest.disp>=0?' ▲':' ▼'):''}</strong></div><div><span>Phase age</span><strong>${latest.age} bars</strong></div><div><span>${trend?'Trend-end':'Trend-start'} estimate</span><strong>${Math.round(risk*100)}%</strong></div><div><span>Last close</span><strong>${latest.close.toLocaleString(undefined,{maximumFractionDigits:2})}</strong></div></div><div class="phase-lab-readout">${trend?'The current trend shows transition risk based on efficiency, volatility, and phase age.':'The market is not currently classified as a trend. Watch expansion and volatility for a possible transition.'}</div><canvas class="phase-lab-chart" id="phaseLabChart" aria-label="Market phase chart"></canvas><div class="phase-lab-legend">${Object.entries(colors).map(([key,color])=>`<span><i style="background:${color}"></i>${key}</span>`).join('')}</div><div class="phase-lab-facts"><span>ADX <b>${Number(latest.adx||0).toFixed(1)}</b></span><span>Efficiency <b>${Number(latest.er20||0).toFixed(2)}</b></span><span>ATR ratio <b>${Number(latest.atrRatio||0).toFixed(2)}</b></span><span>Squeeze percentile <b>${Number(latest.bbwPct||0).toFixed(0)}%</b></span></div>`; drawChart($('#phaseLabChart'),rows); }
export function initPhaseLab() { const panel=$('#phaseLab'); $('#btnPhaseLab')?.addEventListener('click',()=>panel.classList.remove('hidden')); $('#phaseLabClose')?.addEventListener('click',()=>panel.classList.add('hidden')); panel?.addEventListener('click',e=>{if(e.target===panel)panel.classList.add('hidden');}); $('#phaseLabForm')?.addEventListener('submit',async e=>{e.preventDefault(); const status=$('#phaseLabStatus'); status.textContent='Loading market data and classifying phases…'; try { const rows=classify(await loadRows($('#phaseLabSymbol').value,$('#phaseLabTimeframe').value)); if(rows.length<80) throw new Error('Not enough bars for a useful phase analysis.'); render(rows); status.textContent=`Analysed ${rows.length.toLocaleString()} bars · last closed bar ${rows.at(-1).time.toLocaleString()}`; } catch(error) { status.textContent=`Could not analyse this instrument: ${error.message}`; $('#phaseLabContent').innerHTML=''; } }); }
