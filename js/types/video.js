import {esc} from '../core/utils.js';
import {storage} from '../core/storage.js?v=account-load-fix-1';
import {uid} from '../core/utils.js';

const localVideoWrites = new WeakMap();

const normalise = v => {
  if (!v) return [];
  if (Array.isArray(v.media)) return v.media;
  if (v.kind === 'local' && v.blobKey) return [{kind:'local', blobKey:v.blobKey, localOnly:Boolean(v.localOnly), mime:v.mime || 'video/*', name:v.name || 'Video'}];
  if (v.kind === 'url' && v.url) return [{kind:'url', url:v.url, name:v.name || v.url}];
  if (v.file) return [{kind:'pending', file:v.file, mime:v.file.type, name:v.file.name}];
  return [];
};

const icon = kind => kind === 'image'
  ? `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m4 17 5-5 3 3 2-2 6 6"/></svg>`
  : `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m10 9 5 3-5 3z"/></svg>`;

const mediaKind = item => item?.mime?.startsWith('image/') ? 'image' : 'video';
const titleFor = item => item?.name || (mediaKind(item) === 'image' ? 'Image' : 'Video');

const markEntryVideoLocal = (entryId, fieldKey, blobKey) => {
  const entries = storage.entries.load();
  const entry = entries.find(item => String(item.id) === String(entryId));
  const value = entry?.values?.[fieldKey];
  const item = Array.isArray(value?.media)
    ? value.media.find(media => media?.blobKey === blobKey)
    : value?.blobKey === blobKey ? value : null;
  if (!item || item.localOnly) return;
  item.localOnly = true;
  storage.entries.save(entries);
};

const itemMarkup = (item, i) => {
  const kind = item.kind === 'url' ? 'link' : mediaKind(item);
  const label = titleFor(item);
  return `<div class="media-edit-item" data-media-index="${i}" data-kind="${esc(item.kind || '')}" data-blob="${esc(item.blobKey || '')}" data-local-only="${item.localOnly ? 'true' : 'false'}" data-mime="${esc(item.mime || '')}" data-name="${esc(item.name || '')}" data-url="${esc(item.url || '')}">
    <div class="media-edit-thumb">
      ${item.kind === 'url' ? `<div class="media-link-thumb">${icon('video')}<span>LINK</span></div>` : `<div class="media-placeholder" data-preview-placeholder>${icon(kind)}</div>`}
      <span class="media-type-badge">${kind === 'image' ? 'IMG' : kind === 'link' ? 'LINK' : 'VIDEO'}</span>
    </div>
    <div class="media-edit-meta"><strong>${esc(label)}</strong><span>${kind === 'image' ? 'Photo' : kind === 'link' ? 'Online media' : 'Video'}</span></div>
    <button class="media-remove" type="button" data-media-remove="${i}" aria-label="Remove ${esc(label)}">×</button>
  </div>`;
};

export default {
  label:'Media',
  block:true,

  render(f, v) {
    const media = normalise(v);
    return `<div class="media-field" data-media-field>
      <div class="media-field-head">
        <div><strong>Media</strong><span>Add screenshots, chart images and videos to this trade.</span></div>
        <div class="media-actions">
          <button class="media-add-link" type="button" data-media-link>Link</button>
          <button class="media-add" type="button" data-media-add aria-label="Add photos or videos"><span>+</span><b>Add</b></button>
        </div>
      </div>
      <input class="media-file-input" type="file" accept="image/*,video/*" multiple hidden>
      <div class="media-link-box hidden" data-media-link-box>
        <input type="url" class="media-link-input" placeholder="https://..." autocomplete="off">
        <button class="btn-primary btn-sm" type="button" data-media-link-add>Add link</button>
      </div>
      <div class="media-edit-list" data-media-list>
        ${media.length ? media.map(itemMarkup).join('') : `<div class="media-empty" data-media-empty><span>＋</span><div><strong>No media added</strong><small>Click Add to attach photos or videos</small></div></div>`}
      </div>
      <div class="note">Images sync across devices. Videos stay in local browser storage; other devices show a message when no local copy is available.</div>
    </div>`;
  },

  read(box) {
    const root = box.querySelector('[data-media-field]');
    const items = [];
    const removed = root.__mediaRemoved || new Set();

    root.querySelectorAll('.media-edit-item').forEach(el => {
      const kind = el.dataset.kind;
      if (kind === 'pending') {
        const pendingIndex = Number(el.dataset.pendingIndex);
        const file = root.__mediaPending?.[pendingIndex];
        if (file) items.push({kind:'pending', file, mime:file.type, name:file.name});
        return;
      }
      if (kind === 'url') {
        if (el.dataset.url) items.push({kind:'url', url:el.dataset.url, name:el.dataset.url});
        return;
      }
      if (el.dataset.blob && !removed.has(el.dataset.blob)) {
        items.push({kind:'local', blobKey:el.dataset.blob, localOnly:el.dataset.localOnly === 'true', mime:el.dataset.mime || '', name:el.dataset.name || ''});
      }
    });

    return items.length || removed.size ? {media:items, removeKeys:[...removed]} : null;
  },

  bind(box, f, changed) {
    const root = box.querySelector('[data-media-field]');
    if (!root) return;
    root.__mediaPending = [];
    root.__mediaRemoved = new Set();
    root.__previewUrls = [];

    const list = root.querySelector('[data-media-list]');
    const fileInput = root.querySelector('.media-file-input');
    const linkBox = root.querySelector('[data-media-link-box]');

    const empty = () => {
      const has = !!list.querySelector('.media-edit-item');
      list.querySelector('[data-media-empty]')?.remove();
      if (!has) list.insertAdjacentHTML('afterbegin', `<div class="media-empty" data-media-empty><span>＋</span><div><strong>No media added</strong><small>Click Add to attach photos or videos</small></div></div>`);
    };

    const preview = (el, file) => {
      const url = URL.createObjectURL(file);
      root.__previewUrls.push(url);
      const holder = el.querySelector('.media-placeholder');
      if (!holder) return;
      if (file.type.startsWith('image/')) holder.innerHTML = `<img src="${url}" alt="">`;
      else holder.innerHTML = `<video src="${url}" muted playsinline preload="metadata"></video>`;
      holder.classList.add('has-preview');
    };

    const addFiles = files => {
      const start = root.__mediaPending.length;
      [...files].forEach(file => root.__mediaPending.push(file));
      [...files].forEach((file, offset) => {
        const i = start + offset;
        list.querySelector('[data-media-empty]')?.remove();
        list.insertAdjacentHTML('beforeend', itemMarkup({kind:'pending', file, mime:file.type, name:file.name}, i).replace(`data-media-index="${i}"`, `data-media-index="pending-${i}"`).replace(`data-kind="pending"`, `data-kind="pending" data-pending-index="${i}"`));
        const el = list.querySelector(`[data-media-index="pending-${i}"]`);
        if (el) {
          preview(el, file);
          if (!file.type.startsWith('image/')) {
            const blobKey = `local-video:${uid()}`;
            const status = el.querySelector('.media-edit-meta span');
            if (status) status.textContent = 'Saving on this device…';
            const write = storage.putVideo(blobKey, file);
            localVideoWrites.set(file, {blobKey, promise:write});
            write.then(() => {
              if (!el.isConnected || root.__mediaPending[i] !== file) {
                storage.deleteVideo(blobKey);
                localVideoWrites.delete(file);
                return;
              }
              root.__mediaPending[i] = null;
              el.dataset.kind = 'local';
              el.dataset.blob = blobKey;
              el.dataset.localOnly = 'true';
              el.dataset.mime = file.type || 'video/*';
              el.dataset.name = file.name || 'Video';
              el.removeAttribute('data-pending-index');
              if (status) status.textContent = 'Stored on this device';
              localVideoWrites.delete(file);
              changed?.();
            }).catch(() => {
              localVideoWrites.delete(file);
              if (status) status.textContent = 'Local save will retry with the entry';
            });
          }
        }
      });
      changed?.();
    };

    root.querySelector('[data-media-add]')?.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => { if (fileInput.files.length) addFiles(fileInput.files); fileInput.value=''; });

    root.querySelector('[data-media-link]')?.addEventListener('click', () => {
      linkBox.classList.toggle('hidden');
      if (!linkBox.classList.contains('hidden')) linkBox.querySelector('input')?.focus();
    });

    root.querySelector('[data-media-link-add]')?.addEventListener('click', () => {
      const input = linkBox.querySelector('input');
      const url = input.value.trim();
      if (!url) return input.focus();
      const i = `url-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
      list.querySelector('[data-media-empty]')?.remove();
      list.insertAdjacentHTML('beforeend', itemMarkup({kind:'url', url, name:url}, i));
      input.value='';
      linkBox.classList.add('hidden');
      changed?.();
    });

    list.addEventListener('click', e => {
      const btn = e.target.closest('[data-media-remove]');
      if (!btn) return;
      const item = btn.closest('.media-edit-item');
      if (!item) return;
      if (item.dataset.kind === 'local' && item.dataset.blob) root.__mediaRemoved.add(item.dataset.blob);
      if (item.dataset.kind === 'pending') {
        const i = Number(item.dataset.pendingIndex);
        root.__mediaPending[i] = null;
      }
      item.remove();
      empty();
      changed?.();
    });

    root.querySelectorAll('.media-edit-item').forEach(el => {
      if (el.dataset.kind !== 'local' || !el.dataset.blob) return;
      const localOnly = el.dataset.localOnly === 'true';
      storage.getVideo(el.dataset.blob, localOnly).then(blob => {
        if (!el.isConnected) return;
        const holder = el.querySelector('.media-placeholder');
        if (!holder) return;
        if (!blob) {
          if (localOnly) holder.innerHTML = `<span class="media-local-only-note">Video is stored locally on another device</span>`;
          return;
        }
        const mime = blob.type || '';
        el.dataset.mime = mime;
        if (!localOnly && !mime.startsWith('image/')) {
          storage.putVideo(el.dataset.blob, blob).then(() => {
            el.dataset.localOnly = 'true';
          }).catch(() => {});
        }
        const url = URL.createObjectURL(blob);
        root.__previewUrls.push(url);
        if (mime.startsWith('image/')) holder.innerHTML = `<img src="${url}" alt="">`;
        else holder.innerHTML = `<video src="${url}" muted playsinline preload="metadata"></video>`;
        holder.classList.add('has-preview');
      });
    });
  },

  async persist(v, {entryId, field}) {
    const media = Array.isArray(v?.media) ? v.media : [];
    for (const key of v?.removeKeys || []) await storage.deleteVideo(key);
    const out = [];
    for (const item of media) {
      if (item?.kind === 'pending' && item.file) {
        const mime = item.file.type || '';
        let blobKey;
        const localWrite = !mime.startsWith('image/') ? localVideoWrites.get(item.file) : null;
        if (localWrite) {
          await localWrite.promise;
          blobKey = localWrite.blobKey;
        } else {
          blobKey = `${entryId}:${field.key}:${uid()}`;
          await storage.putVideo(blobKey, item.file);
        }
        localVideoWrites.delete(item.file);
        out.push({kind:'local', blobKey, localOnly:!mime.startsWith('image/'), mime, name:item.file.name || 'Media'});
      } else if (item?.kind === 'local' && item.blobKey) {
        out.push({kind:'local', blobKey:item.blobKey, localOnly:Boolean(item.localOnly), mime:item.mime || '', name:item.name || 'Media'});
      } else if (item?.kind === 'url' && item.url) {
        out.push({kind:'url', url:item.url, name:item.name || item.url});
      }
    }
    return out.length ? {media:out} : null;
  },

  cleanup: v => {
    const media = normalise(v);
    media.forEach(item => { if (item?.kind === 'local' && item.blobKey) storage.deleteVideo(item.blobKey); });
  },

  view: (f, v) => {
    const media = normalise(v);
    if (!media.length) return '';
    return `<div class="media-gallery ${media.length === 1 ? 'single' : ''}" data-media-gallery>${media.map((item, i) => {
      const kind = item.kind === 'url' ? 'link' : mediaKind(item);
      if (item.kind === 'url') return `<a class="media-card media-link-card" href="${esc(item.url)}" target="_blank" rel="noopener"><span class="media-card-icon">↗</span><span>${esc(item.name || item.url)}</span></a>`;
      if (kind === 'image') return `<div class="media-card"><img class="media-image" data-media-blob="${esc(item.blobKey)}" alt="${esc(item.name || 'Trade image')}" loading="lazy"><span class="media-card-label">Photo</span></div>`;
      return `<div class="media-card"><video class="media-video ${item.localOnly ? 'hidden' : ''}" controls preload="metadata" data-media-blob="${esc(item.blobKey)}"></video>${item.localOnly ? `<div class="media-video-unavailable">Video is stored locally on another device</div>` : ''}<span class="media-card-label">Video</span></div>`;
    }).join('')}</div>`;
  },

  async mounted(root, f, v) {
    const media = normalise(v);
    for (const item of media) {
      if (item.kind !== 'local' || !item.blobKey) continue;
      const el = [...root.querySelectorAll('[data-media-blob]')].find(x => x.dataset.mediaBlob === item.blobKey);
      if (!el || el.src) continue;
      const localOnly = Boolean(item.localOnly);
      const blob = await storage.getVideo(item.blobKey, localOnly);
      if (blob) {
        el.src = URL.createObjectURL(blob);
        el.classList.remove('hidden');
        el.closest('.media-card')?.querySelector('.media-video-unavailable')?.remove();
        if (!localOnly && mediaKind(item) === 'video') {
          await storage.putVideo(item.blobKey, blob);
          item.localOnly = true;
          markEntryVideoLocal(root.dataset.id, f.key, item.blobKey);
        }
      }
    }
  },

  isDone: v => normalise(v).length > 0
};
