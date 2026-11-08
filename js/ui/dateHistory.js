import {entries} from '../core/entries.js';
import {esc} from '../core/utils.js';

const panel = document.querySelector('#dateHistory');
const toggle = document.querySelector('#dateHistoryToggle');
const content = document.querySelector('#dateHistoryContent');
const list = document.querySelector('#dateHistoryList');
const monthLabel = document.querySelector('#dateHistoryMonth');
const previous = document.querySelector('#dateHistoryPrev');
const next = document.querySelector('#dateHistoryNext');
let visibleMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

function alignCurrentDay() {
  const now = new Date();
  if (visibleMonth.getFullYear() !== now.getFullYear() || visibleMonth.getMonth() !== now.getMonth()) return;
  const today = list.querySelector('.date-history-day.today');
  if (!today || !list.clientHeight) return;
  const panelRect = panel.getBoundingClientRect();
  const dayRect = today.getBoundingClientRect();
  list.scrollTop += dayRect.top + dayRect.height / 2 - (panelRect.top + panelRect.height / 2);
}

function dateKey(value) {
  const text = String(value || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parts = text.split('/');
  if (parts.length === 3 && parts[2].length === 4) return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
  return '';
}

function render() {
  const year = visibleMonth.getFullYear();
  const monthIndex = visibleMonth.getMonth();
  const monthKey = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
  monthLabel.textContent = visibleMonth.toLocaleDateString(undefined, {month:'long', year:'numeric'});
  const days = new Map();
  entries.all().forEach(entry => {
    const key = dateKey(entry.values?.date);
    if (!key?.startsWith(monthKey)) return;
    if (!days.has(key)) days.set(key, new Set());
    days.get(key).add(entry.values?.direction);
  });
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const count = new Date(year, monthIndex + 1, 0).getDate();
  list.innerHTML = Array.from({length:count}, (_, index) => {
    const day = index + 1;
    const key = `${monthKey}-${String(day).padStart(2, '0')}`;
    const weekday = new Date(year, monthIndex, day).toLocaleDateString(undefined, {weekday:'short'});
    const directions = days.get(key) || new Set();
    const hasLong = directions.has('Long');
    const hasShort = directions.has('Short');
    const marks = `${hasLong ? '<span class="date-history-mark long" aria-label="Long trade">↗</span>' : ''}${hasShort ? '<span class="date-history-mark short" aria-label="Short trade">↘</span>' : ''}`;
    return `<button class="date-history-day${key === todayKey ? ' today' : ''}${directions.size ? ' traded' : ''}" type="button" data-history-date="${key}" aria-label="${key === todayKey ? 'Current day, ' : ''}${esc(weekday)} ${day}${directions.size ? ', trade recorded' : ', no trade'}" title="${esc(weekday)} ${day}${directions.size ? ' · trade recorded' : ''}"><span class="date-history-date-label">${key === todayKey ? '<strong>Current day</strong>' : `<span>${esc(weekday)}</span>`}<b>${day}</b></span><span class="date-history-marks">${marks}</span></button>`;
  }).join('');
  requestAnimationFrame(alignCurrentDay);
}

function setExpanded(expanded) {
  panel.classList.toggle('expanded', expanded);
  toggle.setAttribute('aria-expanded', String(expanded));
  toggle.title = expanded ? 'Collapse calendar' : 'Open calendar';
  content.hidden = !expanded;
  if (expanded) requestAnimationFrame(alignCurrentDay);
}

export function initDateHistory() {
  if (!panel || !toggle || !list) return;
  // Start collapsed on each page load; users can expand it when they need it.
  setExpanded(false);
  render();
  toggle.addEventListener('click', () => setExpanded(!panel.classList.contains('expanded')));
  previous.addEventListener('click', () => { visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1); render(); });
  next.addEventListener('click', () => { visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1); render(); });
  window.addEventListener('entries:changed', render);
  list.addEventListener('click', event => {
    const button = event.target.closest('[data-history-date]');
    if (!button) return;
    const card = [...document.querySelectorAll('#entries .card[data-id]')].find(element => dateKey(element.dataset.date) === button.dataset.historyDate);
    if (card) {
      card.scrollIntoView({behavior:'smooth', block:'center'});
      card.classList.add('date-history-target');
      window.setTimeout(() => card.classList.remove('date-history-target'), 1400);
    }
  });
}
