import {entries} from '../core/entries.js';
import {storage} from '../core/storage.js?v=account-load-fix-1';
import {esc} from '../core/utils.js';

const state = {
  mode:0,
  calendarMonth:null,
  dashboard:storage.dashboard?.load?.() || (() => {
    try { return JSON.parse(localStorage.getItem('journal_dashboard') || localStorage.getItem('tradeJournalDashboard') || '{}'); }
    catch { return {}; }
  })()
};

const money = value => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n > 0 ? `+${n.toFixed(2)}` : n.toFixed(2);
};

const pct = value => `${Number(value || 0).toFixed(2)}%`;

function dateKey(value) {
  const s = String(value || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const p = s.split('/');
  if (p.length === 3 && p[2].length === 4) return `${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`;
  return '';
}

function parseDate(value) {
  const k = dateKey(value);
  if (!k) return 0;
  const [y,m,d] = k.split('-').map(Number);
  return new Date(y,m-1,d).getTime();
}

function getTrades() {
  return entries.all().map(e => ({
    ...e,
    pnl:Number(e.values?.pnl),
    symbol:e.values?.symbol || 'Unknown',
    direction:e.values?.direction || '',
    entryTf:e.values?.entryTf || '',
    htf:e.values?.htf || '',
    outcome:e.values?.outcome || '',
    date:e.values?.date || '',
    dateKey:dateKey(e.values?.date)
  })).filter(e => Number.isFinite(e.pnl));
}

function calculate() {
  const trades = getTrades();
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl < 0);
  const breakeven = trades.filter(t => t.pnl === 0);
  const net = trades.reduce((sum,t) => sum + t.pnl,0);
  const grossProfit = wins.reduce((sum,t) => sum + t.pnl,0);
  const grossLoss = Math.abs(losses.reduce((sum,t) => sum + t.pnl,0));
  const settings = storage.analysis.load();
  const account = Number(settings.accountSize) || 0;
  const balance = account + net;
  const winRate = trades.length ? wins.length / trades.length * 100 : 0;
  const profitFactor = grossLoss ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
  const avgWin = wins.length ? grossProfit / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  const best = trades.length ? Math.max(...trades.map(t => t.pnl)) : 0;
  const worst = trades.length ? Math.min(...trades.map(t => t.pnl)) : 0;
  const chronological = [...trades].sort((a,b) => parseDate(a.date) - parseDate(b.date));

  let equity = account;
  let peak = account;
  let maxDrawdown = 0;
  const equityPoints = [{date:'Start',equity:account,pnl:0}];

  chronological.forEach(t => {
    equity += t.pnl;
    peak = Math.max(peak,equity);
    maxDrawdown = Math.max(maxDrawdown,peak-equity);
    equityPoints.push({date:t.date,equity,pnl:t.pnl});
  });

  const instruments = {};
  const directions = {};
  const entryTfs = {};
  const htfs = {};
  const daily = {};
  const weekdays = {
    Sun:{trades:0,pnl:0},Mon:{trades:0,pnl:0},Tue:{trades:0,pnl:0},
    Wed:{trades:0,pnl:0},Thu:{trades:0,pnl:0},Fri:{trades:0,pnl:0},Sat:{trades:0,pnl:0}
  };

  trades.forEach(t => {
    if (!instruments[t.symbol]) instruments[t.symbol] = {trades:0,wins:0,losses:0,pnl:0};
    instruments[t.symbol].trades++;
    instruments[t.symbol].pnl += t.pnl;
    if (t.pnl > 0) instruments[t.symbol].wins++;
    if (t.pnl < 0) instruments[t.symbol].losses++;

    if (t.direction) {
      if (!directions[t.direction]) directions[t.direction] = {trades:0,pnl:0,wins:0};
      directions[t.direction].trades++;
      directions[t.direction].pnl += t.pnl;
      if (t.pnl > 0) directions[t.direction].wins++;
    }

    if (t.entryTf) {
      if (!entryTfs[t.entryTf]) entryTfs[t.entryTf] = {trades:0,pnl:0};
      entryTfs[t.entryTf].trades++;
      entryTfs[t.entryTf].pnl += t.pnl;
    }

    if (t.htf) {
      if (!htfs[t.htf]) htfs[t.htf] = {trades:0,pnl:0};
      htfs[t.htf].trades++;
      htfs[t.htf].pnl += t.pnl;
    }

    if (t.dateKey) {
      if (!daily[t.dateKey]) daily[t.dateKey] = {trades:0,pnl:0};
      daily[t.dateKey].trades++;
      daily[t.dateKey].pnl += t.pnl;

      const [y,m,d] = t.dateKey.split('-').map(Number);
      const day = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(y,m-1,d).getDay()];
      weekdays[day].trades++;
      weekdays[day].pnl += t.pnl;
    }
  });

  return {
    trades,wins,losses,breakeven,net,grossProfit,grossLoss,
    account,balance,winRate,profitFactor,avgWin,avgLoss,best,worst,
    maxDrawdown,returnPct:account ? net/account*100 : 0,
    instruments,directions,entryTfs,htfs,daily,weekdays,
    chronological,equityPoints
  };
}

function metric(label,value,cls='') {
  return `<div class="analysis-metric"><div class="analysis-metric-label">${esc(label)}</div><div class="analysis-metric-value ${cls}">${value}</div></div>`;
}

function equityChart(d,large=false) {
  if (!d.trades.length) return `<div class="analysis-empty">Add trades with P/L to see your equity curve.</div>`;

  const points=d.equityPoints;
  const values=points.map(p=>p.equity);
  const minValue=Math.min(...values);
  const maxValue=Math.max(...values);
  const spread=maxValue-minValue;
  const pad=Math.max(spread*.18,Math.abs(maxValue)*.005,10);
  const min=minValue-pad;
  const max=maxValue+pad;
  const range=max-min||1;

  const w=900;
  const h=large?300:210;
  const left=120;
  const right=14;
  const top=14;
  const bottom=28;
  const plotW=w-left-right;
  const plotH=h-top-bottom;

  const point=(value,index)=>({
    x:left+(index/Math.max(points.length-1,1))*plotW,
    y:top+(1-(value-min)/range)*plotH
  });

  const coords=values.map((value,index)=>{
    const q=point(value,index);
    return `${q.x.toFixed(1)},${q.y.toFixed(1)}`;
  }).join(' ');

  const ticks=5;

  const grid=Array.from({length:ticks},(_,i)=>{
    const ratio=i/(ticks-1);
    const value=max-(max-min)*ratio;
    const y=top+plotH*ratio;

    return `
      <line
        x1="${left}"
        y1="${y}"
        x2="${w-right}"
        y2="${y}"
        class="chart-grid-line"
      />
    `;
  }).join('');

  const verticalGrid=points.length>1
    ? points.map((_,i)=>{
        const q=point(values[i],i);
        return `
          <line
            x1="${q.x}"
            y1="${top}"
            x2="${q.x}"
            y2="${top+plotH}"
            class="chart-grid-line chart-grid-vertical"
          />
        `;
      }).join('')
    : '';

  const dots=points.map((p,i)=>{
    const q=point(p.equity,i);

    return `
      <g class="chart-point-wrap">
        <circle
          cx="${q.x}"
          cy="${q.y}"
          r="${large?3.5:3}"
          class="chart-point"
        />
        <title>
          ${esc(p.date||'Start')} · P/L ${money(p.pnl)} · Equity ${money(p.equity)}
        </title>
      </g>
    `;
  }).join('');

  const base=point(d.account,0).y;

  const firstDate=points[0]?.date||'Start';
  const lastDate=points[points.length-1]?.date||'';

  return `
    <div class="analysis-chart ${large?'analysis-chart-large':''}">
      <div class="chart-summary">
        <span>Start <b>${money(values[0])}</b></span>
        <span>Current <b class="${d.net>=0?'positive':'negative'}">${money(values[values.length-1])}</b></span>
        <span>Change <b class="${d.net>=0?'positive':'negative'}">${money(d.net)}</b></span>
      </div>

      <div class="chart-frame">
        <div class="chart-y-labels">
          <span>${moneyShort(max)}</span>
          <span>${moneyShort(min+(max-min)*.75)}</span>
          <span>${moneyShort(min+(max-min)*.5)}</span>
          <span>${moneyShort(min+(max-min)*.25)}</span>
          <span>${moneyShort(min)}</span>
        </div>

        <svg
          viewBox="0 0 ${w} ${h}"
          preserveAspectRatio="none"
          aria-label="Equity curve"
        >
          <rect
            x="${left}"
            y="${top}"
            width="${plotW}"
            height="${plotH}"
            rx="6"
            class="chart-plot-bg"
          />

          ${grid}
          ${verticalGrid}

          <line
            x1="${left}"
            y1="${base}"
            x2="${w-right}"
            y2="${base}"
            class="chart-baseline"
          />

          <polyline
            points="${coords}"
            class="chart-line"
            fill="none"
          />

          ${dots}
        </svg>

        <div class="chart-x-labels">
          <span>${esc(String(firstDate).slice(0,10))}</span>
          <span>${esc(String(lastDate).slice(0,10))}</span>
        </div>
      </div>
    </div>
  `;
}

function moneyShort(value) {
  const n=Number(value);
  if (!Number.isFinite(n)) return '—';

  const abs=Math.abs(n);

  if(abs>=1000000) return `${n<0?'-':''}$${(abs/1000000).toFixed(2)}M`;
  if(abs>=1000) return `${n<0?'-':''}$${(abs/1000).toFixed(2)}k`;

  return `${n<0?'-':''}$${abs.toFixed(0)}`;
}

function dailyChart(d) {
  const rows = Object.entries(d.daily).sort((a,b) => a[0].localeCompare(b[0])).slice(-30);

  if (!rows.length) return `<div class="analysis-empty">No daily P/L data yet.</div>`;

  const max = Math.max(...rows.map(x => Math.abs(x[1].pnl)),1);

  return `
    <div class="daily-chart">
      ${rows.map(([date,v]) => {
        const height = Math.max(5,Math.abs(v.pnl)/max*100);
        const positive = v.pnl >= 0;
        const label = date.slice(8);
        return `
          <div class="daily-bar-wrap" title="${esc(date)}: ${money(v.pnl)}">
            <div class="daily-zero"></div>
            <div class="daily-bar ${positive ? 'profit' : 'loss'}" style="height:${height}%"></div>
            <span>${label}</span>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function calendar(d) {
  const latest = d.chronological.length ? d.chronological[d.chronological.length-1].dateKey : '';
  if (!state.calendarMonth) state.calendarMonth = latest ? latest.slice(0,7) : new Date().toISOString().slice(0,7);

  const [year,month] = state.calendarMonth.split('-').map(Number);
  const first = new Date(year,month-1,1);
  const days = new Date(year,month,0).getDate();
  const offset = first.getDay();
  const monthName = first.toLocaleString('en',{month:'long',year:'numeric'});
  const max = Math.max(...Object.values(d.daily).map(v => Math.abs(v.pnl)),1);

  let cells = '';

  for (let i=0;i<offset;i++) cells += `<div class="calendar-cell empty"></div>`;

  for (let day=1;day<=days;day++) {
    const key = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const v = d.daily[key];
    const amount = v?.pnl || 0;
    const intensity = v ? Math.max(.15,Math.min(1,Math.abs(amount)/max)) : 0;
    const cls = !v ? '' : amount > 0 ? 'calendar-profit' : amount < 0 ? 'calendar-loss' : 'calendar-be';
    cells += `
      <div class="calendar-cell ${cls}" style="--intensity:${intensity}" title="${key}${v ? ` · ${money(amount)} · ${v.trades} trade${v.trades===1?'':'s'}` : ''}">
        <span>${day}</span>
        ${v ? `<b>${money(amount)}</b>` : ''}
      </div>
    `;
  }

  return `
    <div class="calendar-head">
      <button class="calendar-nav" id="calendarPrev" type="button">‹</button>
      <strong>${monthName}</strong>
      <button class="calendar-nav" id="calendarNext" type="button">›</button>
    </div>
    <div class="calendar-weekdays">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(x => `<span>${x}</span>`).join('')}</div>
    <div class="trade-calendar">${cells}</div>
  `;
}

function distribution(d) {
  const total = d.trades.length || 1;
  const win = d.wins.length/total*100;
  const loss = d.losses.length/total*100;
  const be = d.breakeven.length/total*100;

  return `
    <div class="result-bars">
      <div class="result-row"><span>Profit</span><div><i class="bar-profit" style="width:${win}%"></i></div><b>${d.wins.length}</b></div>
      <div class="result-row"><span>Loss</span><div><i class="bar-loss" style="width:${loss}%"></i></div><b>${d.losses.length}</b></div>
      <div class="result-row"><span>Break-even</span><div><i class="bar-be" style="width:${be}%"></i></div><b>${d.breakeven.length}</b></div>
    </div>
  `;
}

function instrumentBars(d) {
  const rows = Object.entries(d.instruments).sort((a,b) => b[1].pnl-a[1].pnl);
  if (!rows.length) return `<div class="analysis-empty">No instrument data yet.</div>`;
  const max = Math.max(...rows.map(x => Math.abs(x[1].pnl)),1);

  return rows.map(([name,v]) => `
    <div class="performance-row">
      <div class="performance-row-top"><span>${esc(name)}</span><strong class="${v.pnl>0?'positive':v.pnl<0?'negative':''}">${money(v.pnl)}</strong></div>
      <div class="performance-track"><i class="${v.pnl>=0?'profit':'loss'}" style="width:${Math.max(4,Math.abs(v.pnl)/max*100)}%"></i></div>
      <small>${v.trades} trades · ${v.wins} wins</small>
    </div>
  `).join('');
}

function weekdayBars(d) {
  const rows = Object.entries(d.weekdays);
  const max = Math.max(...rows.map(x => Math.abs(x[1].pnl)),1);

  return rows.map(([day,v]) => `
    <div class="weekday-row">
      <span>${day}</span>
      <div><i class="${v.pnl>=0?'profit':'loss'}" style="width:${v.trades ? Math.max(4,Math.abs(v.pnl)/max*100) : 0}%"></i></div>
      <strong class="${v.pnl>0?'positive':v.pnl<0?'negative':''}">${v.trades ? money(v.pnl) : '—'}</strong>
    </div>
  `).join('');
}

function directionDonut(d) {
  const long = d.directions.Long?.trades || 0;
  const short = d.directions.Short?.trades || 0;
  const total = long+short || 1;
  const longPct = long/total*100;

  return `
    <div class="direction-visual">
      <div class="direction-donut" style="--long:${longPct}%"></div>
      <div class="direction-legend">
        <div><i></i><span>Long</span><b>${long}</b></div>
        <div><i></i><span>Short</span><b>${short}</b></div>
      </div>
    </div>
  `;
}

function accountBlock(settings) {
  if (!settings.accountSize) {
    return `
      <div class="account-setup">
        <div class="account-setup-icon">$</div>
        <div><h3>Set account size</h3><p>Enter your starting account size to calculate balance, return and equity.</p></div>
        <div class="account-input-row"><input id="analysisAccountInput" type="number" min="0" step="0.01" placeholder="5000"><button class="btn-primary" id="btnSaveAccount" type="button">Save</button></div>
      </div>
    `;
  }

  return `
    <div class="account-strip">
      <div><span>Account size</span><strong>${Number(settings.accountSize).toFixed(2)}</strong></div>
      <button class="analysis-change-account" id="btnChangeAccount" type="button">Change</button>
    </div>
  `;
}

function overview(d,settings) {
  return `
    <div class="analysis-head">
      <div><div class="analysis-kicker">PERFORMANCE</div><h2>Trading overview</h2><div class="analysis-sub">${d.trades.length} recorded trades</div></div>
      <button class="analysis-close" id="btnAnalysisClose" type="button">×</button>
    </div>
    ${accountBlock(settings)}
    <div class="analysis-grid">
      ${metric('Balance',settings.accountSize ? Number(d.balance).toFixed(2) : '—',d.net>=0?'positive':'negative')}
      ${metric('Net P/L',money(d.net),d.net>0?'positive':d.net<0?'negative':'')}
      ${metric('Return',settings.accountSize ? pct(d.returnPct) : '—',d.returnPct>0?'positive':d.returnPct<0?'negative':'')}
      ${metric('Win rate',pct(d.winRate))}
      ${metric('Profit factor',d.profitFactor===Infinity?'∞':d.profitFactor.toFixed(2))}
      ${metric('Max drawdown',d.trades.length ? money(-d.maxDrawdown) : '—','negative')}
    </div>
    <div class="analysis-section overview-chart-section"><div class="analysis-section-head">P/L curve</div>${equityChart(d)}</div>
  `;
}

function detail(d,settings) {
  return `
    <div class="detail-head">
      <div><div class="analysis-kicker">ANALYTICS</div><h2>Detailed performance</h2><div class="analysis-sub">${d.trades.length} trades analysed</div></div>
      <button class="detail-back" id="btnDetailBack" type="button">← Overview</button>
    </div>

    ${accountBlock(settings)}

    <div class="detail-metrics">
      ${metric('Balance',settings.accountSize ? Number(d.balance).toFixed(2) : '—',d.net>=0?'positive':'negative')}
      ${metric('Net P/L',money(d.net),d.net>0?'positive':d.net<0?'negative':'')}
      ${metric('Return',settings.accountSize ? pct(d.returnPct) : '—',d.returnPct>0?'positive':d.returnPct<0?'negative':'')}
      ${metric('Win rate',pct(d.winRate))}
      ${metric('Profit factor',d.profitFactor===Infinity?'∞':d.profitFactor.toFixed(2))}
      ${metric('Max drawdown',money(-d.maxDrawdown),'negative')}
      ${metric('Average win',d.wins.length ? money(d.avgWin) : '—','positive')}
      ${metric('Average loss',d.losses.length ? money(-d.avgLoss) : '—','negative')}
      ${metric('Best trade',d.trades.length ? money(d.best) : '—','positive')}
      ${metric('Worst trade',d.trades.length ? money(d.worst) : '—','negative')}
    </div>

    <div class="detail-layout dashboard-layout">

      <section class="detail-card dashboard-card" data-dashboard-id="equity">
        <div class="detail-card-head">
          <strong>Equity curve</strong>
          <span>Account progression</span>
        </div>
        ${equityChart(d,true)}
        <span class="dashboard-resize" aria-label="Resize equity curve"></span>
      </section>

      <section class="detail-card dashboard-card" data-dashboard-id="daily">
        <div class="detail-card-head">
          <strong>Daily P/L</strong>
          <span>Last 30 trading days</span>
        </div>
        ${dailyChart(d)}
        <span class="dashboard-resize" aria-label="Resize daily P/L"></span>
      </section>

      <section class="detail-card dashboard-card" data-dashboard-id="outcomes">
        <div class="detail-card-head">
          <strong>Trade outcomes</strong>
          <span>Win / loss distribution</span>
        </div>
        ${distribution(d)}
        <span class="dashboard-resize" aria-label="Resize trade outcomes"></span>
      </section>

      <section class="detail-card dashboard-card" data-dashboard-id="calendar">
        <div class="detail-card-head">
          <strong>Trading calendar</strong>
          <span>Daily P/L heatmap</span>
        </div>
        ${calendar(d)}
        <span class="dashboard-resize" aria-label="Resize trading calendar"></span>
      </section>

      <section class="detail-card dashboard-card" data-dashboard-id="instrument">
        <div class="detail-card-head">
          <strong>By instrument</strong>
          <span>Net P/L by market</span>
        </div>
        <div class="performance-list">${instrumentBars(d)}</div>
        <span class="dashboard-resize" aria-label="Resize instrument card"></span>
      </section>

      <section class="detail-card dashboard-card" data-dashboard-id="direction">
        <div class="detail-card-head">
          <strong>Long vs Short</strong>
          <span>Trade distribution</span>
        </div>
        ${directionDonut(d)}
        <span class="dashboard-resize" aria-label="Resize direction card"></span>
      </section>

      <section class="detail-card dashboard-card" data-dashboard-id="weekday">
        <div class="detail-card-head">
          <strong>Day of week</strong>
          <span>Where your P/L comes from</span>
        </div>
        <div class="weekday-list">${weekdayBars(d)}</div>
        <span class="dashboard-resize" aria-label="Resize weekday card"></span>
      </section>

    </div>
  `;
}
function dashboardDefaults(id){
  const defaults = {
    equity:{col:7,row:2,minCol:6},
    daily:{col:5,row:1,minCol:4},
    outcomes:{col:5,row:1,minCol:4},
    calendar:{col:7,row:2,minCol:6},
    instrument:{col:5,row:2,minCol:4},
    direction:{col:4,row:1,minCol:3},
    weekday:{col:3,row:1,minCol:3}
  };

  return defaults[id] || {col:6,row:1,minCol:3};
}

function applyDashboardSize(card){
  const id=card.dataset.dashboardId;
  const size=state.dashboard[id] || dashboardDefaults(id);

  card.style.setProperty('--dash-col',size.col);
  card.style.setProperty('--dash-row',size.row);
}

function initDashboard(){
  const layout=document.querySelector('.dashboard-layout');
  if(!layout)return;

  const cards=[...layout.querySelectorAll('.dashboard-card')];

  cards.forEach(card=>{
    applyDashboardSize(card);

    const handle=card.querySelector('.dashboard-resize');
    if(!handle)return;

    handle.addEventListener('pointerdown',e=>{
      e.preventDefault();
      e.stopPropagation();

      const id=card.dataset.dashboardId;
      const start={...(state.dashboard[id] || dashboardDefaults(id))};
      const layoutRect=layout.getBoundingClientRect();
      const cardRect=card.getBoundingClientRect();
      const styles=getComputedStyle(layout);
      const gap=parseFloat(styles.columnGap)||10;
      const rowGap=parseFloat(styles.rowGap)||10;
      const columns=12;
      const colWidth=Math.max(1,(layoutRect.width-gap*(columns-1))/columns);
      const rowHeight=Math.max(1,cardRect.height/Math.max(1,start.row));
      const cellWidth=colWidth+gap;
      const cellHeight=rowHeight+rowGap;

      const startX=e.clientX;
      const startY=e.clientY;
      let latestX=startX;
      let latestY=startY;
      let raf=0;
      let lastCol=start.col;
      let lastRow=start.row;

      card.classList.add('dashboard-resizing');
      document.body.classList.add('dashboard-is-resizing');
      handle.setPointerCapture?.(e.pointerId);

      const render=()=>{
        raf=0;

        const dx=latestX-startX;
        const dy=latestY-startY;
        const rawCol=start.col+(dx/cellWidth);
        const rawRow=start.row+(dy/cellHeight);

        const col=Math.max(
          start.minCol,
          Math.min(columns,Math.round(rawCol))
        );
        const row=Math.max(
          1,
          Math.min(5,Math.round(rawRow))
        );

        const colFraction=rawCol-col;
        const rowFraction=rawRow-row;

        if(col!==lastCol || row!==lastRow){
          state.dashboard[id]={col,row,minCol:start.minCol};
          applyDashboardSize(card);
          lastCol=col;
          lastRow=row;
        }

        /*
         * Keep the pointer movement visually continuous between grid
         * boundaries. The grid still determines the final layout, while
         * transform fills the sub-cell movement instead of waiting for the
         * next grid step.
         */
        const sx=1+(colFraction*cellWidth)/Math.max(1,cardRect.width);
        const sy=1+(rowFraction*cellHeight)/Math.max(1,cardRect.height);

        card.style.transformOrigin='top left';
        card.style.transform=`scale(${Math.max(.96,Math.min(1.04,sx))},${Math.max(.96,Math.min(1.04,sy))})`;
      };

      const move=ev=>{
        latestX=ev.clientX;
        latestY=ev.clientY;

        if(!raf)raf=requestAnimationFrame(render);
      };

      const stop=()=>{
        if(raf){
          cancelAnimationFrame(raf);
          raf=0;
        }

        render();

        if (storage.dashboard?.save) storage.dashboard.save(state.dashboard);
        else localStorage.setItem('journal_dashboard', JSON.stringify(state.dashboard));

        card.style.transform='';
        card.style.transformOrigin='';
        card.classList.remove('dashboard-resizing');
        document.body.classList.remove('dashboard-is-resizing');

        try{
          if(handle.hasPointerCapture?.(e.pointerId)){
            handle.releasePointerCapture(e.pointerId);
          }
        }catch{}

        document.removeEventListener('pointermove',move);
        document.removeEventListener('pointerup',stop);
        document.removeEventListener('pointercancel',stop);
      };

      document.addEventListener('pointermove',move,{passive:false});
      document.addEventListener('pointerup',stop,{once:true});
      document.addEventListener('pointercancel',stop,{once:true});
    });
  });
}
function bind() {
  document.querySelector('#btnAnalysisClose')?.addEventListener('click',close);
  document.querySelector('#btnDetailed')?.addEventListener('click',openDetail);
  document.querySelector('#btnDetailBack')?.addEventListener('click',openOverview);
  document.querySelector('#btnSaveAccount')?.addEventListener('click',saveAccount);

  document.querySelector('#btnChangeAccount')?.addEventListener('click',() => {
    const settings = storage.analysis.load();
    const value = prompt('Enter account size',settings.accountSize);
    if (value !== null && Number(value) > 0) {
      storage.analysis.save({accountSize:Number(value)});
      render();
    }
  });

  document.querySelector('#calendarPrev')?.addEventListener('click',() => shiftCalendar(-1));
  document.querySelector('#calendarNext')?.addEventListener('click',() => shiftCalendar(1));

  if(state.mode===2) initDashboard();
}

function shiftCalendar(amount) {
  const [y,m] = state.calendarMonth.split('-').map(Number);
  const d = new Date(y,m-1+amount,1);
  state.calendarMonth = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  render();
}

function saveAccount() {
  const input = document.querySelector('#analysisAccountInput');
  const value = Number(input?.value);
  if (!Number.isFinite(value) || value <= 0) {
    input?.focus();
    return;
  }
  storage.analysis.save({accountSize:value});
  render();
}

function render(){
  const shell=document.querySelector('.journal-shell');
  const panel=document.querySelector('.analysis-panel');
  if(!shell||!panel)return;

  const settings=storage.analysis.load();
  const d=calculate();

  shell.classList.toggle('analysis-open',state.mode>0);
  shell.classList.toggle('analysis-detail',state.mode===2);
  panel.classList.toggle('open',state.mode>0);
  panel.classList.toggle('detail-mode',state.mode===2);

  shell.querySelector('.detail-trigger-wrap')?.remove();

  if(state.mode===0){
    panel.innerHTML='';
    return;
  }

  panel.innerHTML=state.mode===1?overview(d,settings):detail(d,settings);

  if(state.mode===1){
    shell.insertAdjacentHTML('beforeend',`
      <div class="detail-trigger-wrap">
        <button class="detail-trigger" id="btnDetailed" type="button" aria-label="Open detailed analytics">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 19V5"/>
            <path d="M4 19h16"/>
            <path d="m7 15 3-4 3 2 5-7"/>
          </svg>
        </button>
      </div>
    `);
  }

  bind();
}

function openOverview() {
  state.mode = 1;
  render();
}

export function returnToOverview() {
  openOverview();
}

function openDetail() {
  const shell = document.querySelector('.journal-shell');
  const trigger = document.querySelector('.detail-trigger');

  if (!shell || !trigger) {
    state.mode = 2;
    render();
    return;
  }

  shell.classList.add('detail-transitioning');
  trigger.classList.add('detail-morph');

  setTimeout(() => {
    state.mode = 2;
    render();
    shell.classList.remove('detail-transitioning');
  }, 320);
}

export function openAnalysis() {
  state.mode = 1;
  render();
}

export function close() {
  state.mode = 0;
  render();
}

export function toggleAnalysis() {
  state.mode === 0 ? openOverview() : close();
}

export function initAnalysis() {
  document.querySelector('#btnAnalysis')?.addEventListener('click',toggleAnalysis);
  window.addEventListener('entries:changed',() => {
    if (state.mode > 0) render();
  });
}

export function refreshAnalysis() {
  if (state.mode > 0) render();
}
