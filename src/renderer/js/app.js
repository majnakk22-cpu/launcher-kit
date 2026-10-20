'use strict';
// Оболочка интерфейса: состояние, навигация, защита несохранённых изменений, прогресс, события ядра.
/* global window, document, UI */

const App = (() => {
  const { h, icon, toast, fmt } = UI;
  const api = window.launcher;

  const state = {
    info: null,
    config: {},
    instances: [],
    accounts: { activeId: null, accounts: [] },
    settings: {},
    running: new Set(),
    selectedId: null,
    gameLogs: new Map(), // instanceId -> [{line, stream}]
    launcherLogs: [],
    task: null, // { id, text, progress }
    downloads: null, // снимок менеджера загрузок
    update: null, // доступное обновление лаунчера
  };

  const pages = new Map();
  let current = null;
  const bus = new EventTarget();

  function on(event, fn) { bus.addEventListener(event, (e) => fn(e.detail)); }
  /**
   * События интерфейса. Текущая страница получает их так:
   *  - page.onEvent(event, detail), если определён;
   *  - иначе страница перерисовывается, если event есть в page.refreshOn.
   */
  function emit(event, detail) {
    bus.dispatchEvent(new CustomEvent(event, { detail }));
    const page = pages.get(current);
    if (!page) return;
    if (page.onEvent) page.onEvent(event, detail);
    else if (page.refreshOn?.includes(event)) render(current, page.lastParams);
  }

  // ---------- Несохранённые изменения ----------
  // Страница (или окно) с формой регистрирует guard: { isDirty(), save(), title }.
  let guard = null;
  function setGuard(g) { guard = g; }
  function clearGuard(g) { if (!g || guard === g) guard = null; }

  /** true — можно уходить (сохранили или отказались), false — остаёмся. */
  function confirmDiscard(g = guard) {
    if (!g || !g.isDirty()) return Promise.resolve(true);
    return new Promise((resolve) => {
      let answered = false;
      const answer = (v) => { answered = true; resolve(v); };
      UI.modal({
        title: 'Несохранённые изменения',
        body: h('p', { class: 'muted' }, `${g.title ? `«${g.title}»: ` : ''}есть изменения, которые ещё не сохранены.`),
        actions: [
          { label: 'Отмена', onClick: () => answer(false) },
          { label: 'Не сохранять', danger: true, onClick: () => answer(true) },
          { label: 'Сохранить', primary: true, onClick: async () => { await g.save(); answer(true); } },
        ],
        onClose: () => { if (!answered) resolve(false); },
      });
    });
  }

  // ---------- Страницы ----------
  function registerPage(id, def) { pages.set(id, { id, nav: true, ...def }); }

  function featureOn(name) { return state.config.features?.[name] !== false; }

  let navSignature = '';
  function renderNav(force = true) {
    const visible = [...pages.values()].filter((p) => p.nav && (!p.feature || featureOn(p.feature)));
    const badges = visible.map((p) => p.badge?.() || 0);
    const sig = `${current}|${badges.join(',')}`;
    if (!force && sig === navSignature) return;
    navSignature = sig;
    document.getElementById('nav').replaceChildren(...visible.map((p, i) => h('button', {
      class: `nav-item ${current === p.id ? 'active' : ''}`,
      onClick: () => navigate(p.id),
    }, icon(p.icon), h('span', null, p.title),
    badges[i] ? h('span', { class: `nav-badge ${typeof badges[i] === 'number' ? 'count' : ''}` }, typeof badges[i] === 'number' ? String(badges[i]) : '') : null)));
  }

  function render(id, params = {}) {
    const page = pages.get(id);
    if (!page) return;
    current = id;
    page.lastParams = params;
    const root = document.getElementById('content');
    root.replaceChildren();
    root.scrollTop = 0;
    try { page.render(root, params); } catch (e) { root.append(h('div', { class: 'empty' }, `Ошибка страницы: ${e.message}`)); console.error(e); }
    renderNav();
  }

  /** Переход на страницу с проверкой несохранённых изменений. */
  async function navigate(id, params = {}) {
    if (id !== current || guard) {
      if (!(await confirmDiscard())) return false;
    }
    clearGuard();
    render(id, params);
    return true;
  }

  function refreshPage() { if (current) render(current, pages.get(current)?.lastParams); }

  // ---------- Данные ----------
  async function loadInstances() {
    state.instances = await api.instances.list();
    if (!state.instances.some((i) => i.id === state.selectedId)) {
      state.selectedId = state.settings.lastInstanceId && state.instances.some((i) => i.id === state.settings.lastInstanceId)
        ? state.settings.lastInstanceId
        : state.instances[0]?.id || null;
    }
    emit('instances');
  }
  async function loadAccounts() { state.accounts = await api.accounts.list(); renderAccountChip(); emit('accounts'); }
  async function loadSettings() { state.settings = await api.settings.get(); emit('settings'); }

  function selectedInstance() { return state.instances.find((i) => i.id === state.selectedId) || null; }
  function activeAccount() { return state.accounts.accounts.find((a) => a.id === state.accounts.activeId) || null; }
  function select(id) { state.selectedId = id; emit('instances'); }

  // ---------- Аккаунт в сайдбаре ----------
  function renderAccountChip() {
    const chip = document.getElementById('account-chip');
    const acc = activeAccount();
    chip.replaceChildren(
      UI.avatar(acc),
      h('div', { class: 'meta' },
        h('span', { class: 'name' }, acc ? acc.name : 'Войти'),
        h('span', { class: 'sub' }, acc ? (acc.type === 'microsoft' ? 'Microsoft' : 'Офлайн') : 'нет аккаунта')),
    );
    chip.onclick = () => navigate('accounts');
  }

  // ---------- Задачи и прогресс ----------
  let taskSeq = 0;
  /** Выполнить долгую операцию с полосой прогресса внизу. */
  async function runTask(text, promiseFactory) {
    const id = ++taskSeq;
    state.task = { id, text, progress: null };
    renderTask();
    emit('task');
    try {
      return await promiseFactory();
    } finally {
      if (state.task?.id === id) { state.task = null; renderTask(); emit('task'); }
    }
  }

  function renderTask() {
    const bar = document.getElementById('taskbar');
    const t = state.task;
    bar.hidden = !t;
    if (!t) return;
    const p = t.progress;
    document.getElementById('task-text').textContent = t.text;
    const fill = document.getElementById('task-fill');
    let meta = '';
    if (p && (p.totalBytes || p.total)) {
      const ratio = p.totalBytes ? p.bytes / p.totalBytes : p.done / p.total;
      fill.classList.remove('indeterminate');
      fill.style.width = `${Math.min(100, Math.max(0, ratio * 100)).toFixed(1)}%`;
      meta = p.totalBytes ? `${fmt.bytes(p.bytes)} / ${fmt.bytes(p.totalBytes)}` : `${p.done} / ${p.total}`;
    } else {
      fill.classList.add('indeterminate');
      fill.style.width = '';
    }
    if (state.downloads?.speed) meta += `${meta ? ' · ' : ''}${fmt.bytes(state.downloads.speed)}/с`;
    document.getElementById('task-meta').textContent = meta;
  }

  /** Предупреждение о выделенной памяти: { level: 'warn'|'error', text } или null. */
  function memoryWarning(min, max, modded = false) {
    const total = state.info?.totalMemoryMb || 0;
    if (min && max && min > max) return { level: 'error', text: 'Минимум памяти больше максимума — игра не запустится.' };
    if (max && max < 512) return { level: 'error', text: 'Слишком мало памяти: нужно хотя бы 512 МБ.' };
    if (total && max > total * 0.75) return { level: 'warn', text: `Это больше 75% оперативной памяти компьютера (${(total / 1024).toFixed(1)} ГБ) — системе может не хватить памяти, игра будет тормозить.` };
    if (modded && max && max < 3072) return { level: 'warn', text: 'Для сборок с модами обычно нужно от 4 ГБ.' };
    return null;
  }

  const isCancel = (e) => /Загрузка отменена/.test(e?.message || '');

  // ---------- Запуск игры ----------
  async function launch(instanceId, opts = {}) {
    if (!activeAccount()) { toast('Сначала добавь аккаунт', 'warn'); navigate('accounts'); return; }
    if (state.running.has(instanceId)) { toast('Игра уже запущена'); return; }
    state.gameLogs.set(instanceId, []);
    try {
      await runTask('Подготовка к запуску', () => api.game.launch(instanceId, opts));
    } catch (e) {
      if (isCancel(e)) { toast('Запуск отменён', 'warn'); return; }
      UI.modal({ title: 'Не удалось запустить', body: h('pre', { class: 'console', style: { height: 'auto', maxHeight: '50vh' } }, e.message), actions: [{ label: 'Закрыть' }] });
    }
  }

  function showCrash(d) {
    const inst = state.instances.find((i) => i.id === d.instanceId);
    const body = h('div', null,
      h('p', { class: 'muted' }, `Игра «${inst?.name || d.instanceId}» завершилась с кодом ${d.code}.`),
      d.tail?.length ? h('pre', { class: 'console', style: { height: '260px' } }, d.tail.join('\n')) : null);
    const actions = [];
    if (d.crashReport) actions.push({ label: 'Открыть краш-репорт', onClick: () => api.app.openPath(d.crashReport) });
    actions.push({ label: 'Консоль', onClick: () => navigate('console', { instanceId: d.instanceId }) });
    actions.push({ label: 'Закрыть', primary: true });
    UI.modal({ title: 'Игра вылетела', body, actions, wide: true });
  }

  // ---------- Закрытие окна ----------
  let closing = false;
  async function requestClose() {
    if (closing) return;
    closing = true;
    try {
      if (!(await confirmDiscard())) return;
      const busy = state.task || (state.downloads && (state.downloads.active.length || state.downloads.queued));
      if (busy && !(await UI.confirm('Идёт загрузка', 'Если закрыть лаунчер сейчас, загрузка прервётся. Закрыть?', { okLabel: 'Закрыть', danger: true }))) return;
      api.window.close();
    } finally { closing = false; }
  }

  // ---------- Тема ----------
  function applyTheme(theme = {}) {
    const map = { accent: '--accent', accentText: '--accent-text', bg: '--bg', panel: '--panel', panel2: '--panel-2', panel3: '--panel-3', text: '--text', muted: '--muted', radius: '--radius' };
    const root = document.documentElement.style;
    for (const [k, v] of Object.entries(map)) if (theme[k]) root.setProperty(v, theme[k]);
    if (theme.background) root.setProperty('--background-image', `linear-gradient(rgba(0,0,0,.25), rgba(0,0,0,.25)), url("${theme.background}")`);
  }

  // ---------- Инициализация ----------
  async function init() {
    state.info = await api.app.info();
    state.config = state.info.config;
    document.title = state.config.name || 'Launcher';
    document.getElementById('brand-name').textContent = state.config.name || 'Launcher';
    applyTheme(state.config.theme);

    document.querySelectorAll('[data-wc]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.wc === 'close') requestClose(); else api.window[b.dataset.wc]();
    }));
    document.getElementById('links').replaceChildren(...(state.config.links || []).map((l) => h('button', { onClick: () => api.app.openExternal(l.url) }, l.title)));
    document.getElementById('task-open').addEventListener('click', () => navigate('downloads'));

    api.on('window:close-request', () => { api.window.ackClose(); requestClose(); });
    api.on('progress', (p) => {
      if (!state.task) return;
      if (p.text) state.task.text = p.text;
      state.task.progress = (p.total || p.totalBytes) ? p : null;
      renderTask();
    });
    api.on('downloads', (s) => {
      state.downloads = s;
      renderNav(false);
      if (state.task) renderTask();
      emit('downloads', s);
    });
    api.on('log', (l) => {
      state.launcherLogs.push(l);
      if (state.launcherLogs.length > 3000) state.launcherLogs.shift();
      emit('launcher-log', l);
    });
    api.on('game-log', (l) => {
      const arr = state.gameLogs.get(l.instanceId) || [];
      arr.push(l);
      if (arr.length > 8000) arr.splice(0, arr.length - 8000);
      state.gameLogs.set(l.instanceId, arr);
      emit('game-log', l);
    });
    api.on('game-start', (d) => { state.running.add(d.instanceId); emit('running'); renderNav(); });
    api.on('game-exit', (d) => {
      state.running.delete(d.instanceId);
      emit('running');
      renderNav();
      if (d.code !== 0 && d.code !== null) showCrash(d);
      loadInstances();
    });
    api.on('instances-changed', () => loadInstances());
    api.on('settings-changed', (s) => { state.settings = s; emit('settings'); });

    await Promise.all([loadSettings(), loadAccounts()]);
    await loadInstances();
    (await api.game.running()).forEach((id) => state.running.add(id));
    state.downloads = await api.downloads.snapshot().catch(() => null);
    render('home');

    // Проверка обновления лаунчера (не блокирует запуск)
    api.app.checkUpdate().then((u) => {
      if (u?.available) { state.update = u; emit('update', u); }
    }).catch(() => {});
  }

  return {
    api, state, h, on, emit, registerPage, navigate, refreshPage, featureOn,
    setGuard, clearGuard, confirmDiscard, requestClose,
    loadInstances, loadAccounts, loadSettings, selectedInstance, activeAccount, select,
    runTask, launch, init, isCancel, memoryWarning,
  };
})();

window.App = App;
