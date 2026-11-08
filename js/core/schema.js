// THE list of every field. Add a checklist item = add one object here.
// Field props: key, type, label, options, colors, sub, default, showIf,
//   check (counts in score), pill (shown in card header), annotate (🏷/💬 icons), other (select: allow custom text)
import {storage} from './storage.js?v=account-load-fix-1';

export const BUILTIN = [
  {key:'date', type:'date', label:'Date', default:'@today'},

  {
    key:'symbol',
    type:'instrument',
    label:'Instrument',
    default:'XAUUSD',
    pill:true
  },

  {
    key:'direction',
    type:'direction',
    label:'Direction',
    default:'Long',
    pill:true
  },

  {
    key:'entryTf',
    type:'timeframe',
    label:'Entry timeframe',
    group:'entry',
    default:'M15'
  },

  {
    key:'htf',
    type:'timeframe',
    label:'Higher timeframe',
    group:'htf',
    default:'H4'
  },

  {
    key:'outcome',
    type:'pills',
    label:'Trade result',
    options:['Profit','Loss','Break-even'],
    colors:{
      Profit:'good',
      Loss:'bad',
      'Break-even':'warn'
    },
    pill:true
  },

  {
    key:'pnl',
    type:'number',
    label:'P/L amount',
    placeholder:'e.g. 125 or -80'
  },
  {key:'wait', type:'checkbox', label:'Waited for a contraction to form after the trend phase', check:true, annotate:true},
  {key:'nature', type:'pills', label:'Determined the nature of the market on the HTF', sub:'Trading approach differs depending on the answer.',
    options:['Trend','Contraction','Expansion'], colors:{Trend:'accent', Contraction:'warn', Expansion:'purple'}, check:true, pill:true, annotate:true},
  {key:'bias', type:'pills', label:'Determined bias', options:['Buy','Sell'], colors:{Buy:'good', Sell:'bad'}, check:true, pill:true, annotate:true},
  {key:'structure', type:'tags', label:'Marked out the important points / structure', check:true, annotate:true},
  {key:'extreme', type:'checkbox', label:'Trading at the extreme, after a liquidity grab', showIf:{key:'nature', in:['Contraction']}, check:true, annotate:true},
  {key:'notTakingPOC', type:'checkbox', label:'Avoiding entries at the POC', showIf:{key:'nature', in:['Contraction']}, check:true, annotate:true},
  {key:'tpLiquidity', type:'checkbox', label:'Determined take-profit at the next liquidity level', showIf:{key:'nature', in:['Contraction']}, check:true, annotate:true},
  {key:'trendEnd', type:'checkbox', label:'Identified where the trend phase is likely to end', showIf:{key:'nature', notIn:['Contraction']}, check:true, annotate:true},
  {key:'retail', type:'checkbox', label:'Read retail emotion', check:true, annotate:true},
  {key:'perspective', type:'checkbox', label:'Considered the opposite perspective', check:true, annotate:true},

  {key:'notes', type:'textarea', label:'Notes', placeholder:'Setup notes, invalidation...'},
  {key:'video', type:'video', label:'Video'}
];

let custom = storage.custom.load();
export const schema = {
  all: () => [...BUILTIN, ...custom],
  get: key => schema.all().find(f => f.key === key),
  addCustom(f) { custom.push(f); storage.custom.save(custom); },
  removeCustom(key) { custom = custom.filter(f => f.key !== key); storage.custom.save(custom); }
};
