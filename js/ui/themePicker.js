import {storage} from '../core/storage.js?v=account-load-fix-1';
import {$, $$} from '../core/utils.js';
// Add palettes here and token values in css/tokens.css.
const THEMES = [
  {id:'clarity',name:'Clarity',mode:'light',bg:'#f0f4f6',card:'#ffffff',accent:'#203749'},
  {id:'sandstone',name:'Sandstone',mode:'light',bg:'#f4f0e8',card:'#fffdf8',accent:'#9b704d'},
  {id:'light',name:'Light',mode:'light',bg:'#f6f7f9',card:'#ffffff',accent:'#2563eb'},
  {id:'dark',name:'Dark',mode:'dark',bg:'#0f1115',card:'#181b21',accent:'#3b82f6'},
  {id:'slate',name:'Slate',mode:'dark',bg:'#1a1d24',card:'#242832',accent:'#818cf8'},
  {id:'ocean',name:'Ocean',mode:'light',bg:'#f0f9f9',card:'#ffffff',accent:'#0d9488'},
  {id:'sunset',name:'Sunset',mode:'dark',bg:'#1f1512',card:'#2b1e19',accent:'#f97316'},
  {id:'lavender',name:'Lavender',mode:'light',bg:'#f3f0fa',card:'#fffdfd',accent:'#7961b1'},
  {id:'rose',name:'Rose',mode:'light',bg:'#fff1f2',card:'#fffafa',accent:'#c35b76'},
  {id:'arctic',name:'Arctic',mode:'light',bg:'#edf6fb',card:'#fcfeff',accent:'#2586aa'},
  {id:'forest',name:'Forest',mode:'dark',bg:'#111d19',card:'#192923',accent:'#65b989'},
  {id:'midnight',name:'Midnight',mode:'dark',bg:'#0d1525',card:'#151f33',accent:'#60a5fa'},
  {id:'graphite',name:'Graphite',mode:'dark',bg:'#181a1d',card:'#22252a',accent:'#b7c36a'},
  {id:'celadon',name:'Celadon',mode:'light',bg:'#eff5f0',card:'#fbfffc',accent:'#4e8d68'},
  {id:'orchid',name:'Orchid',mode:'light',bg:'#f8f0fb',card:'#fffcff',accent:'#a45ab4'},
  {id:'citrus',name:'Citrus',mode:'light',bg:'#f5f6e9',card:'#fffef5',accent:'#87962e'},
  {id:'cobalt',name:'Cobalt',mode:'dark',bg:'#101a31',card:'#192849',accent:'#6a8cff'},
  {id:'mocha',name:'Mocha',mode:'dark',bg:'#211a17',card:'#30251f',accent:'#d19a69'},
  {id:'cherry',name:'Cherry',mode:'dark',bg:'#24131b',card:'#321d28',accent:'#f06c9b'}
];
// Keep the top bar compact; every theme remains available in the full gallery.
const SWATCH_IDS = ['clarity','sandstone','light','dark','slate'];
const THEME_MAP = Object.fromEntries(THEMES.map(theme => [theme.id, theme]));
const swatchStyle = theme => `linear-gradient(135deg,${theme.bg} 50%,${theme.accent} 50%)`;
let themeFilter = 'all';

function renderGallery() {
  const gallery = $('#themeGallery');
  if (!gallery) return;
  gallery.innerHTML = THEMES.filter(theme => themeFilter === 'all' || theme.mode === themeFilter).map(theme => `
    <button class="theme-choice${document.documentElement.dataset.theme === theme.id ? ' active' : ''}" type="button" data-theme-choice="${theme.id}" style="--preview-bg:${theme.bg};--preview-card:${theme.card};--preview-accent:${theme.accent}" aria-pressed="${document.documentElement.dataset.theme === theme.id}">
      <span class="theme-preview" aria-hidden="true"><span></span><i></i><b></b></span>
      <span class="theme-choice-copy"><strong>${theme.name}</strong><small>${theme.mode === 'light' ? 'Light' : 'Dark'} appearance</small></span>
      <span class="theme-choice-check" aria-hidden="true">✓</span>
    </button>`).join('');
}

function closeGallery() {
  const modal = $('#themeLibrary');
  modal?.classList.remove('show');
  $('#themeMore')?.setAttribute('aria-expanded', 'false');
  window.setTimeout(() => { if (modal && !modal.classList.contains('show')) modal.classList.add('hidden'); }, 230);
}

function openGallery() {
  const modal = $('#themeLibrary');
  modal.classList.remove('hidden');
  requestAnimationFrame(() => modal.classList.add('show'));
  $('#themeMore').setAttribute('aria-expanded', 'true');
}

export function applyTheme(name) {
  document.documentElement.setAttribute('data-theme', name);
  storage.theme.save(name);
  $$('.swatch').forEach(s => {
    const active = s.dataset.theme === name;
    s.classList.toggle('active', active);
    s.setAttribute('aria-pressed', String(active));
  });
  const hasExtra = !SWATCH_IDS.includes(name);
  $('#themeMore')?.classList.toggle('has-extra-theme', hasExtra);
  $$('[data-theme-choice]').forEach(choice => {
    const active = choice.dataset.themeChoice === name;
    choice.classList.toggle('active', active);
    choice.setAttribute('aria-pressed', String(active));
  });
}
export function initThemePicker() {
  $('#themeRow').innerHTML = SWATCH_IDS.map(id => {
    const theme = THEME_MAP[id];
    return `<button class="swatch" type="button" data-theme="${id}" title="${theme.name}" aria-label="Use ${theme.name} theme" aria-pressed="false" style="background:${swatchStyle(theme)}"></button>`;
  }).join('');
  $('#themeRow').addEventListener('click', e => { const s = e.target.closest('.swatch'); if (s) applyTheme(s.dataset.theme); });
  const modal = document.createElement('div');
  modal.className = 'modal theme-library hidden';
  modal.id = 'themeLibrary';
  modal.innerHTML = `<section class="modal-box theme-library-box" role="dialog" aria-modal="true" aria-labelledby="themeLibraryTitle">
    <header class="theme-library-header"><div><span class="theme-library-kicker">PERSONALIZE</span><h2 id="themeLibraryTitle">Choose your theme</h2><p>Find a look that feels right for your journal.</p></div><button class="theme-library-close" type="button" aria-label="Close themes">×</button></header>
    <nav class="theme-filters" aria-label="Filter themes"><button type="button" data-theme-filter="all" class="active">All themes</button><button type="button" data-theme-filter="light">Light</button><button type="button" data-theme-filter="dark">Dark</button></nav>
    <div class="theme-gallery" id="themeGallery"></div>
  </section>`;
  document.body.append(modal);
  renderGallery();
  $('#themeMore').addEventListener('click', openGallery);
  modal.addEventListener('click', event => {
    if (event.target === modal || event.target.closest('.theme-library-close')) { closeGallery(); return; }
    const filter = event.target.closest('[data-theme-filter]');
    if (filter) {
      themeFilter = filter.dataset.themeFilter;
      modal.querySelectorAll('[data-theme-filter]').forEach(button => button.classList.toggle('active', button === filter));
      renderGallery();
      return;
    }
    const choice = event.target.closest('[data-theme-choice]');
    if (choice) { applyTheme(choice.dataset.themeChoice); closeGallery(); }
  });
  window.addEventListener('keydown', event => { if (event.key === 'Escape' && modal.classList.contains('show')) closeGallery(); });
  const savedTheme = storage.theme.load();
  // Replace the retired System swatch with Sandstone for existing installations.
  applyTheme(savedTheme === 'system' ? 'sandstone' : savedTheme);
}
