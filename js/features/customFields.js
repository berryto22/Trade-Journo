// Notion-style "+ Add field" and removal of user-made fields.
import {events} from '../core/events.js';
import {schema} from '../core/schema.js';
import {types} from '../types/index.js';
import {$, esc} from '../core/utils.js';
import {confirmDialog} from '../ui/dialog.js';

export function init() {
  const opts = Object.entries(types).filter(([, t]) => t.custom).map(([k, t]) => `<option value="${k}">${esc(t.label)}</option>`).join('');
  $('#featureSlot').innerHTML = `<button type="button" class="btn-ghost btn-sm" id="cfToggle">+ Add field</button>
    <div class="collapse" id="cfBox"><div class="inner"><div class="addfield-box">
      <input type="text" id="cfName" placeholder="Field name"><select id="cfType">${opts}</select>
      <input type="text" id="cfOpts" class="hidden" placeholder="Options, comma separated">
      <button type="button" class="btn-primary btn-sm" id="cfAdd">Add</button></div></div></div>`;
  const syncOpts = () => $('#cfOpts').classList.toggle('hidden', !types[$('#cfType').value].needsOptions);
  $('#cfType').onchange = syncOpts; syncOpts();
  $('#cfToggle').onclick = () => $('#cfBox').classList.toggle('open');
  $('#cfAdd').onclick = () => {
    const label = $('#cfName').value.trim(); if (!label) return;
    const type = $('#cfType').value;
    const options = types[type].needsOptions ? $('#cfOpts').value.split(',').map(s => s.trim()).filter(Boolean) : undefined;
    schema.addCustom({key: 'cf_' + Date.now(), type, label, options, custom: true, annotate: true});
    $('#cfName').value = ''; $('#cfOpts').value = ''; $('#cfBox').classList.remove('open');
    events.emit('schema:changed');
  };
  events.on('field:built', ({el, field}) => {
    if (!field.custom) return;
    el.querySelector('.f-tools').insertAdjacentHTML('beforeend', '<button type="button" class="icon-btn" title="Delete field">🗑</button>');
    el.querySelector('.f-tools .icon-btn:last-child').onclick = async () => {
      if (!await confirmDialog(`Remove "${field.label}"?`, 'Existing entries keep their data, but the field disappears.', 'Remove')) return;
      schema.removeCustom(field.key); events.emit('schema:changed');
    };
  });
}
