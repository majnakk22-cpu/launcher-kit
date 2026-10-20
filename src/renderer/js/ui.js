'use strict';
// Мини-набор UI-утилит без фреймворков: h() для DOM, иконки, тосты, модалки, форматирование.
/* global window, document */

const UI = (() => {
  /** h('div', {class:'x', onClick: fn}, 'text', childNode, [arrays]) */
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { children.unshift(attrs); attrs = null; }
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v; // только для статичных иконок!
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    const add = (c) => {
      if (c === null || c === undefined || c === false) return;
      if (Array.isArray(c)) c.forEach(add);
      else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    };
    children.forEach(add);
    return el;
  }

  const P = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const ICONS = {
    home: P('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>'),
    box: P('<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/>'),
    compass: P('<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>'),
    user: P('<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>'),
    settings: P('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
    terminal: P('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3"/><path d="M13 15h4"/>'),
    play: P('<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>'),
    stop: P('<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>'),
    folder: P('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
    trash: P('<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>'),
    refresh: P('<path d="M20 11a8 8 0 0 0-14.9-3.5L4 9"/><path d="M4 4v5h5"/><path d="M4 13a8 8 0 0 0 14.9 3.5L20 15"/><path d="M20 20v-5h-5"/>'),
    plus: P('<path d="M12 5v14M5 12h14"/>'),
    upload: P('<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>'),
    download: P('<path d="M12 4v12"/><path d="m7 11 5 5 5-5"/><path d="M4 20h16"/>'),
    link: P('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>'),
    edit: P('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>'),
    x: P('<path d="M6 6l12 12M18 6 6 18"/>'),
    external: P('<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>'),
    server: P('<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>'),
    check: P('<path d="m5 12 5 5L20 7"/>'),
    sliders: P('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'),
    pause: P('<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/>'),
    filter: P('<path d="M4 5h16l-6 8v5l-4 2v-7z"/>'),
    microsoft: '<svg viewBox="0 0 24 24"><rect x="2" y="2" width="9.5" height="9.5" fill="#f25022"/><rect x="12.5" y="2" width="9.5" height="9.5" fill="#7fba00"/><rect x="2" y="12.5" width="9.5" height="9.5" fill="#00a4ef"/><rect x="12.5" y="12.5" width="9.5" height="9.5" fill="#ffb900"/></svg>',
  };
  const icon = (name) => h('span', { style: { display: 'inline-flex' }, html: ICONS[name] || '' });

  function toast(message, type = 'info', ms = 4500) {
    const el = h('div', { class: `toast ${type}` }, message);
    document.getElementById('toasts').appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  /**
   * modal({ title, body, actions:[{label, primary, danger, onClick}], wide, onClose, beforeClose })
   * onClick может вернуть false (или Promise<false>), чтобы окно не закрывалось.
   * beforeClose() -> Promise<boolean> вызывается при закрытии крестиком/Esc/фоном/кнопкой без onClick
   * (например, чтобы спросить про несохранённые изменения).
   */
  function modal({ title, body, actions = [], wide = false, onClose, beforeClose } = {}) {
    const root = document.getElementById('modal-root');
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
      onClose?.();
    };
    const tryClose = async () => {
      if (closed) return;
      if (beforeClose && !(await beforeClose())) return;
      close();
    };
    // Esc закрывает только верхнее окно
    const onKey = (e) => { if (e.key === 'Escape' && root.lastElementChild === backdrop) tryClose(); };
    const btns = actions.map((a) => {
      const b = h('button', { class: `btn ${a.primary ? 'btn-primary' : ''} ${a.danger ? 'btn-danger' : ''}` }, a.label);
      b.addEventListener('click', async () => {
        if (!a.onClick) { tryClose(); return; }
        b.disabled = true;
        try {
          const r = await a.onClick();
          if (r !== false) close();
        } catch (e) {
          toast(e.message, 'error');
        } finally { b.disabled = false; }
      });
      return b;
    });
    const box = h('div', { class: `modal ${wide ? 'wide' : ''}` }, title ? h('h2', null, title) : null, body, btns.length ? h('div', { class: 'modal-actions' }, btns) : null);
    const backdrop = h('div', { class: 'modal-backdrop', onMousedown: (e) => { if (e.target === backdrop) tryClose(); } }, box);
    root.appendChild(backdrop);
    document.addEventListener('keydown', onKey);
    setTimeout(() => box.querySelector('input, select')?.focus(), 30);
    return { close, tryClose, el: box };
  }

  /** Плашка-предупреждение. type: info | warn | danger. action: { label, onClick } */
  function alert(type, text, action = null) {
    return h('div', { class: `alert ${type}` },
      h('span', { class: 'alert-icon' }, type === 'danger' ? '!' : type === 'warn' ? '!' : 'i'),
      h('div', { class: 'alert-text' }, text),
      action ? h('button', { class: 'btn btn-sm', onClick: action.onClick }, action.label) : null);
  }

  function confirm(title, text, { okLabel = 'Да', danger = false } = {}) {
    return new Promise((resolve) => {
      let answered = false;
      modal({
        title,
        body: h('p', { class: 'muted' }, text),
        actions: [
          { label: 'Отмена', onClick: () => { answered = true; resolve(false); } },
          { label: okLabel, primary: !danger, danger, onClick: () => { answered = true; resolve(true); } },
        ],
        onClose: () => { if (!answered) resolve(false); },
      });
    });
  }

  function prompt(title, { label = '', value = '', placeholder = '', okLabel = 'OK' } = {}) {
    return new Promise((resolve) => {
      const input = h('input', { class: 'input', value, placeholder });
      let done = false;
      const m = modal({
        title,
        body: h('div', { class: 'field' }, label ? h('label', null, label) : null, input),
        actions: [
          { label: 'Отмена' },
          { label: okLabel, primary: true, onClick: () => { done = true; resolve(input.value.trim()); } },
        ],
        onClose: () => { if (!done) resolve(null); },
      });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { done = true; resolve(input.value.trim()); m.close(); } });
    });
  }

  const fmt = {
    bytes(n) {
      if (!n) return '0 Б';
      const u = ['Б', 'КБ', 'МБ', 'ГБ'];
      const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
      return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
    },
    num(n) {
      if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
      if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
      return String(n || 0);
    },
    duration(ms) {
      const m = Math.floor((ms || 0) / 60000);
      if (m < 60) return `${m} мин`;
      return `${Math.floor(m / 60)} ч ${m % 60} мин`;
    },
    ago(ts) {
      if (!ts) return 'никогда';
      const d = (Date.now() - new Date(ts).getTime()) / 1000;
      if (d < 60) return 'только что';
      if (d < 3600) return `${Math.floor(d / 60)} мин назад`;
      if (d < 86400) return `${Math.floor(d / 3600)} ч назад`;
      if (d < 86400 * 30) return `${Math.floor(d / 86400)} дн назад`;
      return new Date(ts).toLocaleDateString('ru-RU');
    },
    loader(type) {
      return { vanilla: 'Vanilla', forge: 'Forge', neoforge: 'NeoForge', fabric: 'Fabric', quilt: 'Quilt' }[type] || type;
    },
    stripMc(s) { return String(s || '').replace(/§./g, ''); },
  };

  function initials(name) { return (String(name || '?').trim()[0] || '?').toUpperCase(); }

  function instIcon(inst, cls = '') {
    const el = h('div', { class: `inst-icon ${cls}` });
    if (inst?.icon && /^(https?:|data:)/.test(inst.icon)) el.appendChild(h('img', { src: inst.icon, alt: '' }));
    else el.textContent = initials(inst?.name);
    return el;
  }

  function avatar(account, cls = '') {
    const el = h('div', { class: `avatar ${cls}` });
    if (account?.uuid) {
      const img = h('img', { src: `https://mc-heads.net/avatar/${account.uuid}/64`, alt: '' });
      img.onerror = () => { img.remove(); el.textContent = initials(account.name); };
      el.appendChild(img);
    } else el.textContent = initials(account?.name);
    return el;
  }

  function sw(checked, onChange) {
    const input = h('input', { type: 'checkbox', checked: Boolean(checked) });
    input.addEventListener('change', () => onChange(input.checked));
    return h('label', { class: 'switch' }, input, h('span'));
  }

  return { h, icon, toast, modal, alert, confirm, prompt, fmt, instIcon, avatar, sw, ICONS };
})();

window.UI = UI;
