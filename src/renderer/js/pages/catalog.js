'use strict';
/* global App, UI */
// Каталог Modrinth / CurseForge: моды, модпаки, ресурспаки, шейдеры — с фильтрами и предупреждениями.
(() => {
  const { h, icon, toast, fmt } = UI;
  const { api, state } = App;

  const TYPES = [['mod', 'Моды'], ['modpack', 'Модпаки'], ['resourcepack', 'Ресурспаки'], ['shader', 'Шейдеры']];
  const SORTS = [['relevance', 'По релевантности'], ['downloads', 'По загрузкам'], ['updated', 'Недавно обновлённые'], ['newest', 'Новые']];
  const LOADERS = [['', 'Любой модлоадер'], ['forge', 'Forge'], ['neoforge', 'NeoForge'], ['fabric', 'Fabric'], ['quilt', 'Quilt']];
  const PAGE = 20;

  const s = {
    provider: 'modrinth', type: 'mod', instanceId: null, query: '', sort: 'relevance',
    categories: [], showCategories: false, hideInstalled: false,
    packVersion: '', packLoader: '', // фильтры для модпаков (у них нет целевой сборки)
    hits: [], total: 0, offset: 0, loading: false, providers: null, error: null,
  };
  const categoryCache = new Map();
  let mcVersions = null;
  let els = null;
  let searchTimer = null;
  let reqSeq = 0;
  let lastKey = null;

  function targetInstance() { return state.instances.find((i) => i.id === s.instanceId) || null; }
  function isInstalled(hit) {
    const inst = targetInstance();
    return Boolean(inst?.content?.some((c) => c.provider === hit.provider && String(c.projectId) === String(hit.id)));
  }

  async function search(reset = true) {
    if (s.type !== 'modpack' && !targetInstance()) { s.hits = []; s.total = 0; renderResults(); return; }
    const seq = ++reqSeq;
    if (reset) { s.offset = 0; s.hits = []; }
    s.loading = true; s.error = null;
    renderResults();
    try {
      const params = { query: s.query, type: s.type, sort: s.sort, offset: s.offset, limit: PAGE, categories: s.categories };
      if (s.type === 'modpack') {
        if (s.packVersion) params.mcVersion = s.packVersion;
        if (s.packLoader) params.loader = s.packLoader;
      } else params.instanceId = s.instanceId;
      const r = await api.content.search(s.provider, params);
      if (seq !== reqSeq) return;
      s.hits = reset ? r.hits : [...s.hits, ...r.hits];
      s.total = r.total;
    } catch (e) {
      if (seq === reqSeq) s.error = e.message;
    } finally {
      if (seq === reqSeq) { s.loading = false; renderResults(); }
    }
  }

  async function install(hit, versionId = null, btn = null) {
    if (btn) btn.disabled = true;
    try {
      if (s.type === 'modpack') {
        const r = await App.runTask(`Установка модпака ${hit.title}`, () => api.modpacks.install({ provider: hit.provider, projectId: hit.id, versionId, title: hit.title }));
        await App.loadInstances();
        App.select(r.instance.id);
        toast(`Модпак «${hit.title}» установлен`);
        App.showBlocked?.(r.blocked);
      } else {
        const inst = targetInstance();
        const r = await App.runTask(`Установка ${hit.title}`, () => api.content.install(s.instanceId, { provider: hit.provider, projectId: hit.id, versionId, type: s.type, title: hit.title }));
        await App.loadInstances();
        const deps = r.installed.length - 1;
        toast(`«${hit.title}» установлен${deps > 0 ? ` (+${deps} зависимост${deps === 1 ? 'ь' : 'и'})` : ''}${state.running.has(inst?.id) ? '. Перезапусти игру, чтобы он заработал.' : ''}`, state.running.has(inst?.id) ? 'warn' : 'info');
        App.showBlocked?.(r.blocked);
        renderResults();
      }
    } catch (e) {
      toast(App.isCancel(e) ? 'Установка отменена' : e.message, App.isCancel(e) ? 'warn' : 'error');
    } finally { if (btn) btn.disabled = false; }
  }

  async function chooseVersion(hit) {
    const list = h('div', { class: 'list' }, h('span', { class: 'spinner' }));
    let onlyRelease = false;
    let versions = [];
    const draw = () => {
      const shown = versions.filter((v) => !onlyRelease || v.releaseType === 'release').slice(0, 60);
      if (!shown.length) { list.replaceChildren(h('div', { class: 'empty' }, 'Нет совместимых версий')); return; }
      list.replaceChildren(...shown.map((v) => h('div', { class: 'list-row' },
        h('div', { class: 'grow' },
          h('div', { class: 't' }, v.name || v.versionNumber),
          h('div', { class: 'meta-line' },
            h('span', { class: `badge ${v.releaseType === 'release' ? 'accent' : 'warn'}` }, v.releaseType),
            h('span', null, v.gameVersions.slice(0, 4).join(', ')),
            v.loaders.length ? h('span', null, v.loaders.join(', ')) : null,
            h('span', null, fmt.ago(v.date)))),
        h('button', { class: 'btn btn-sm btn-primary', onClick: () => { m.close(); install(hit, v.id); } }, 'Установить'))));
    };
    const m = UI.modal({
      title: `Версии: ${hit.title}`,
      wide: true,
      body: h('div', null, h('label', { class: 'check small' }, UI.sw(false, (v) => { onlyRelease = v; draw(); }), 'Только релизы (без beta/alpha)'), list),
      actions: [{ label: 'Закрыть' }],
    });
    try {
      const params = s.type === 'modpack' ? { type: 'modpack' } : { instanceId: s.instanceId, type: s.type };
      versions = await api.content.versions(hit.provider, hit.id, params);
      draw();
    } catch (e) { list.replaceChildren(h('div', { class: 'muted' }, e.message)); }
  }

  function row(hit) {
    const installed = s.type !== 'modpack' && isInstalled(hit);
    const btn = h('button', { class: `btn btn-sm ${installed ? '' : 'btn-primary'}`, disabled: installed || Boolean(state.task) }, installed ? icon('check') : icon('download'), installed ? 'Установлено' : 'Установить');
    btn.addEventListener('click', () => install(hit, null, btn));
    return h('div', { class: 'list-row' },
      hit.iconUrl ? h('img', { class: 'icon', src: hit.iconUrl, alt: '', loading: 'lazy' }) : h('div', { class: 'icon' }),
      h('div', { class: 'grow' },
        h('div', { class: 't' }, hit.title, hit.author ? h('span', { class: 'muted small', style: { fontWeight: 400 } }, `  от ${hit.author}`) : null),
        h('div', { class: 'd' }, hit.description || ''),
        h('div', { class: 'meta-line' },
          h('span', null, `⬇ ${fmt.num(hit.downloads)}`),
          hit.updatedAt ? h('span', null, `обновлён ${fmt.ago(hit.updatedAt)}`) : null,
          ...(hit.categories || []).slice(0, 3).map((c) => h('span', { class: 'badge' }, c)))),
      h('div', { style: { display: 'flex', gap: '6px', flex: 'none' } },
        hit.url ? h('button', { class: 'icon-btn', title: 'Открыть страницу', onClick: () => api.app.openExternal(hit.url) }, icon('external')) : null,
        h('button', { class: 'btn btn-sm', onClick: () => chooseVersion(hit) }, 'Версии'),
        btn));
  }

  function renderResults() {
    if (!els) return;
    const box = els.results;
    if (s.type !== 'modpack' && !targetInstance()) {
      box.replaceChildren(h('div', { class: 'empty' }, h('h3', null, 'Выбери сборку'), h('div', null, 'Каталог покажет только то, что подходит к её версии и модлоадеру.')));
      return;
    }
    if (s.error) { box.replaceChildren(UI.alert('danger', `Ошибка: ${s.error}`, { label: 'Повторить', onClick: () => search() })); return; }
    const hits = s.hideInstalled && s.type !== 'modpack' ? s.hits.filter((x) => !isInstalled(x)) : s.hits;
    const items = hits.map(row);
    if (s.loading) items.push(h('div', { style: { textAlign: 'center', padding: '20px' } }, h('span', { class: 'spinner' })));
    else if (!hits.length) items.push(h('div', { class: 'empty' }, s.categories.length || s.query ? 'Ничего не найдено — попробуй убрать часть фильтров' : 'Ничего не найдено'));
    if (!s.loading && s.hits.length < s.total) {
      items.push(h('div', { style: { textAlign: 'center', padding: '10px' } },
        h('button', { class: 'btn', onClick: () => { s.offset += PAGE; search(false); } }, `Показать ещё (${s.hits.length} из ${fmt.num(s.total)})`)));
    }
    box.replaceChildren(h('div', { class: 'list' }, items));
  }

  /** Плашки-предупреждения о выбранной сборке и источнике. */
  function warnings(providers) {
    const out = [];
    const cf = providers.find((p) => p.id === 'curseforge');
    if (cf && !cf.available) out.push(UI.alert('info', 'CurseForge отключён: для него нужен бесплатный API-ключ.', { label: 'Указать ключ', onClick: () => App.navigate('settings') }));
    if (s.type === 'modpack') return out;
    const inst = targetInstance();
    if (!inst) return out;
    if (s.type === 'mod' && (!inst.loader?.type || inst.loader.type === 'vanilla')) {
      out.push(UI.alert('warn', `У сборки «${inst.name}» нет модлоадера — моды в ней работать не будут. Выбери сборку с Forge/Fabric/NeoForge или создай новую.`));
    }
    if (s.type === 'shader' && !['fabric', 'quilt', 'neoforge', 'forge'].includes(inst.loader?.type)) {
      out.push(UI.alert('warn', 'Для шейдеров нужен мод-загрузчик шейдеров (Iris для Fabric/NeoForge или Oculus для Forge) или OptiFine.'));
    }
    if (state.running.has(inst.id)) out.push(UI.alert('warn', 'Сборка запущена — установленное заработает после перезапуска игры.'));
    if (inst.sync?.url && s.type === 'mod') out.push(UI.alert('info', 'Это сборка сервера: моды, установленные из каталога, синхронизация не удалит, но сервер может их не принять.'));
    return out;
  }

  async function loadCategories(root) {
    const key = `${s.provider}:${s.type}`;
    if (!categoryCache.has(key)) {
      try { categoryCache.set(key, await api.content.categories(s.provider, s.type)); } catch { categoryCache.set(key, []); }
      if (els?.root === root) render(root);
    }
  }

  async function render(root, params = {}) {
    if (params.instanceId) s.instanceId = params.instanceId;
    if (params.type) { s.type = params.type; s.categories = []; }
    delete params.instanceId; delete params.type;
    if (!s.instanceId || !targetInstance()) s.instanceId = state.selectedId;
    if (!s.providers) {
      try { s.providers = await api.content.providers(); } catch { s.providers = []; }
    }
    const providers = s.providers;
    if (!providers.some((p) => p.id === s.provider && p.available)) s.provider = providers.find((p) => p.available)?.id || 'modrinth';

    const provSeg = h('div', { class: 'segmented' }, providers.map((p) => h('button', {
      class: p.id === s.provider ? 'active' : '',
      disabled: !p.available,
      title: p.available ? '' : 'Нужен API-ключ (Настройки)',
      onClick: () => { s.provider = p.id; s.categories = []; render(root); },
    }, p.name)));
    const typeSeg = h('div', { class: 'segmented' }, TYPES.map(([id, label]) => h('button', {
      class: id === s.type ? 'active' : '',
      onClick: () => { s.type = id; s.categories = []; render(root); },
    }, label)));
    const instSelect = h('select', { class: 'select', onChange: (e) => { s.instanceId = e.target.value; render(root); } },
      state.instances.map((i) => h('option', { value: i.id, selected: i.id === s.instanceId }, `${i.name} (${i.minecraft}${i.loader?.type !== 'vanilla' ? `, ${fmt.loader(i.loader.type)}` : ''})`)));
    const input = h('input', { class: 'input', placeholder: 'Поиск…', value: s.query });
    input.addEventListener('input', () => { s.query = input.value; clearTimeout(searchTimer); searchTimer = setTimeout(() => search(), 350); });
    const sortSel = h('select', { class: 'select', onChange: (e) => { s.sort = e.target.value; search(); } },
      SORTS.map(([id, label]) => h('option', { value: id, selected: id === s.sort }, label)));

    // Фильтры для модпаков: версия игры и модлоадер
    let packFilters = null;
    if (s.type === 'modpack') {
      const verSel = h('select', { class: 'select', onChange: (e) => { s.packVersion = e.target.value; search(); } },
        h('option', { value: '' }, 'Любая версия'), (mcVersions || []).map((v) => h('option', { value: v, selected: v === s.packVersion }, v)));
      if (!mcVersions) api.versions.minecraft({ types: ['release'] }).then((l) => { mcVersions = l.map((v) => v.id); if (els?.root === root) render(root); }).catch(() => { mcVersions = []; });
      const ldSel = h('select', { class: 'select', onChange: (e) => { s.packLoader = e.target.value; search(); } },
        LOADERS.map(([v, l]) => h('option', { value: v, selected: v === s.packLoader }, l)));
      packFilters = [verSel, ldSel];
    }

    const cats = categoryCache.get(`${s.provider}:${s.type}`);
    if (!cats) loadCategories(root);
    const activeCount = s.categories.length;
    const filterBtn = h('button', { class: `btn ${s.showCategories || activeCount ? '' : 'btn-ghost'}`, onClick: () => { s.showCategories = !s.showCategories; render(root); } },
      icon('filter'), `Категории${activeCount ? ` · ${activeCount}` : ''}`);
    const hideInst = s.type !== 'modpack'
      ? h('label', { class: 'check', style: { marginBottom: 0 } }, UI.sw(s.hideInstalled, (v) => { s.hideInstalled = v; renderResults(); }), h('span', { class: 'small' }, 'Скрыть установленные'))
      : null;

    let catPanel = null;
    if (s.showCategories) {
      catPanel = h('div', { class: 'card', style: { marginBottom: '14px', padding: '14px' } },
        !cats ? h('span', { class: 'spinner' })
          : !cats.length ? h('div', { class: 'muted small' }, 'Категорий нет')
            : h('div', { class: 'filters', style: { marginBottom: 0 } },
              cats.map((c) => h('button', {
                class: `chip ${s.categories.includes(c.id) ? 'active' : ''}`,
                onClick: () => {
                  s.categories = s.categories.includes(c.id) ? s.categories.filter((x) => x !== c.id) : [...s.categories, c.id];
                  render(root);
                },
              }, c.name)),
              activeCount ? h('button', { class: 'chip', onClick: () => { s.categories = []; render(root); } }, '× Сбросить') : null));
    } else if (activeCount && cats) {
      catPanel = h('div', { class: 'filters' }, s.categories.map((id) => h('button', { class: 'chip active', title: 'Убрать фильтр', onClick: () => { s.categories = s.categories.filter((x) => x !== id); render(root); } }, `${cats.find((c) => c.id === id)?.name || id} ×`)));
    }

    els = { root, results: h('div') };
    root.replaceChildren(
      h('div', { class: 'page-head' }, h('h1', null, 'Каталог'), h('span', { class: 'spacer' }), provSeg),
      ...warnings(providers),
      h('div', { class: 'toolbar' }, typeSeg, s.type !== 'modpack' && state.instances.length ? instSelect : null, ...(packFilters || [])),
      h('div', { class: 'toolbar' }, input, sortSel, filterBtn, hideInst),
      catPanel,
      els.results,
    );
    // Перерисовка без смены фильтров (например, раскрыли панель категорий) — без нового запроса
    const key = JSON.stringify([s.provider, s.type, s.instanceId, s.query, s.sort, s.categories, s.packVersion, s.packLoader]);
    if (key === lastKey && !s.error && (s.hits.length || s.loading)) renderResults();
    else { lastKey = key; search(); }
  }

  App.registerPage('catalog', {
    title: 'Каталог',
    icon: 'compass',
    feature: 'catalog',
    render,
    onEvent(ev) { if (ev === 'instances' || ev === 'task') renderResults(); },
  });
})();
