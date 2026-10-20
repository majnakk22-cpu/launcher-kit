'use strict';
/* global App, UI, navigator */
// Консоль: логи игры (по сборкам) и лог лаунчера.
(() => {
  const { h, icon, toast } = UI;
  const { api, state } = App;
  let view = { source: 'launcher', box: null, autoscroll: true };

  function cls(line, stream, level) {
    if (level) return level === 'error' ? 'l-error' : level === 'warn' ? 'l-warn' : 'l-launcher';
    if (/\b(ERROR|FATAL|Exception)\b/.test(line) || stream === 'stderr') return 'l-error';
    if (/\bWARN\b/.test(line)) return 'l-warn';
    return 'l-info';
  }

  function lineEl(entry) {
    if (view.source === 'launcher') {
      const t = new Date(entry.time).toLocaleTimeString('ru-RU');
      return h('div', { class: cls('', null, entry.level) }, `[${t}] [${entry.level}] ${entry.message}`);
    }
    return h('div', { class: cls(entry.line, entry.stream) }, entry.line);
  }

  function entries() {
    return view.source === 'launcher' ? state.launcherLogs : (state.gameLogs.get(view.source) || []);
  }

  function fill() {
    const list = entries();
    view.box.replaceChildren(...list.slice(-2000).map(lineEl));
    if (!list.length) view.box.append(h('div', { class: 'muted' }, view.source === 'launcher' ? 'Лог пуст' : 'Логи появятся после запуска сборки'));
    view.box.scrollTop = view.box.scrollHeight;
  }

  function render(root, params = {}) {
    if (params.instanceId) { view.source = params.instanceId; delete params.instanceId; }
    const sel = h('select', { class: 'select', onChange: (e) => { view.source = e.target.value; fill(); } },
      h('option', { value: 'launcher', selected: view.source === 'launcher' }, 'Лаунчер'),
      state.instances.map((i) => h('option', { value: i.id, selected: view.source === i.id }, `Игра: ${i.name}${state.running.has(i.id) ? ' ●' : ''}`)));
    view.box = h('div', { class: 'console' });
    view.box.addEventListener('scroll', () => {
      const b = view.box;
      view.autoscroll = b.scrollHeight - b.scrollTop - b.clientHeight < 40;
    });
    root.append(
      h('div', { class: 'page-head' }, h('h1', null, 'Консоль'), h('span', { class: 'spacer' }), sel,
        h('button', { class: 'btn', onClick: () => { navigator.clipboard.writeText(entries().map((e) => e.line ?? `[${e.level}] ${e.message}`).join('\n')); toast('Скопировано'); } }, 'Копировать'),
        h('button', { class: 'btn btn-ghost', onClick: () => { if (view.source === 'launcher') state.launcherLogs.length = 0; else state.gameLogs.set(view.source, []); fill(); } }, icon('trash'))),
      view.box);
    fill();
  }

  function append(entry) {
    if (!view.box) return;
    if (view.box.firstChild?.classList?.contains('muted')) view.box.replaceChildren();
    view.box.append(lineEl(entry));
    while (view.box.childNodes.length > 2500) view.box.firstChild.remove();
    if (view.autoscroll) view.box.scrollTop = view.box.scrollHeight;
  }

  App.registerPage('console', {
    title: 'Консоль',
    icon: 'terminal',
    feature: 'console',
    render,
    onEvent(ev, d) {
      if (ev === 'launcher-log' && view.source === 'launcher') append(d);
      if (ev === 'game-log' && view.source === d.instanceId) append(d);
    },
  });
})();
