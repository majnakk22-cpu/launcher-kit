'use strict';
/* global App, UI */
// Список сборок + создание, импорт модпака, добавление сборки сервера по ссылке.
(() => {
  const { h, icon, toast, fmt } = UI;
  const { api, state } = App;

  function loaderLabel(inst) {
    return inst.loader?.type && inst.loader.type !== 'vanilla' ? `${fmt.loader(inst.loader.type)} ${inst.loader.version || ''}`.trim() : 'Vanilla';
  }

  function showBlocked(blocked) {
    if (!blocked?.length) return;
    UI.modal({
      title: 'Нужно скачать вручную',
      wide: true,
      body: h('div', null,
        h('p', { class: 'muted' }, 'Авторы этих файлов запретили скачивание сторонними лаунчерами. Скачай их с сайта и положи в указанную папку сборки.'),
        h('div', { class: 'list' }, blocked.map((b) => h('div', { class: 'list-row' },
          h('div', { class: 'grow' }, h('div', { class: 't' }, b.title), h('div', { class: 'd' }, `${b.folder}/${b.fileName}`)),
          b.url ? h('button', { class: 'btn btn-sm', onClick: () => api.app.openExternal(b.url) }, icon('external'), 'Открыть') : null)))),
      actions: [{ label: 'Понятно', primary: true }],
    });
  }
  App.showBlocked = showBlocked;

  async function openCreate() {
    const name = h('input', { class: 'input', placeholder: 'Моя сборка' });
    const mcSelect = h('select', { class: 'select' }, h('option', null, 'Загрузка…'));
    const snapshots = h('input', { type: 'checkbox' });
    const loaderVersion = h('select', { class: 'select', disabled: true }, h('option', { value: '' }, '—'));
    let loaderType = 'vanilla';
    const seg = h('div', { class: 'segmented' });

    const loadMc = async () => {
      try {
        const list = await api.versions.minecraft({ types: snapshots.checked ? ['release', 'snapshot'] : ['release'] });
        mcSelect.replaceChildren(...list.map((v) => h('option', { value: v.id }, v.type === 'release' ? v.id : `${v.id} (${v.type})`)));
        loadLoaderVersions();
      } catch (e) { mcSelect.replaceChildren(h('option', { value: '' }, 'Нет сети')); toast(e.message, 'error'); }
    };
    const loadLoaderVersions = async () => {
      if (loaderType === 'vanilla') { loaderVersion.disabled = true; loaderVersion.replaceChildren(h('option', { value: '' }, '—')); return; }
      loaderVersion.disabled = true;
      loaderVersion.replaceChildren(h('option', { value: '' }, 'Загрузка…'));
      try {
        const list = await api.versions.loaderVersions(loaderType, mcSelect.value);
        if (!list.length) { loaderVersion.replaceChildren(h('option', { value: '' }, `Нет ${fmt.loader(loaderType)} для ${mcSelect.value}`)); return; }
        const hasRec = list.some((v) => v.recommended);
        loaderVersion.replaceChildren(
          hasRec ? h('option', { value: 'recommended' }, 'Рекомендуемая') : null,
          h('option', { value: 'latest' }, 'Последняя стабильная'),
          ...list.map((v) => h('option', { value: v.version }, `${v.version}${v.recommended ? ' ★' : ''}${v.stable ? '' : ' (beta)'}`)));
        loaderVersion.disabled = false;
      } catch (e) { loaderVersion.replaceChildren(h('option', { value: '' }, 'Ошибка загрузки')); toast(e.message, 'error'); }
    };

    const loaders = await api.versions.loaders();
    seg.replaceChildren(...loaders.map((l) => {
      const b = h('button', { class: l.id === loaderType ? 'active' : '', onClick: () => { loaderType = l.id; [...seg.children].forEach((c) => c.classList.toggle('active', c === b)); loadLoaderVersions(); } }, l.name);
      return b;
    }));
    const hint = h('div');
    const updateHint = () => {
      const msgs = [];
      const sel = mcSelect.selectedOptions[0]?.textContent || '';
      if (/snapshot/.test(sel)) msgs.push(['warn', 'Снапшоты — тестовые версии: могут ломать миры, моды под них почти не выходят.']);
      const nm = name.value.trim().toLowerCase();
      if (nm && state.instances.some((i) => i.name.toLowerCase() === nm)) msgs.push(['warn', 'Сборка с таким названием уже есть — новая получит другую папку.']);
      if (loaderType === 'forge' && /^1\.(2[1-9]|[3-9]\d)/.test(mcSelect.value)) msgs.push(['info', 'Для новых версий большинство модов выходит под NeoForge и Fabric, а не под Forge.']);
      hint.replaceChildren(...msgs.map(([t, m]) => UI.alert(t, m)));
    };
    name.addEventListener('input', updateHint);
    mcSelect.addEventListener('change', updateHint);
    seg.addEventListener('click', updateHint);
    mcSelect.addEventListener('change', loadLoaderVersions);
    snapshots.addEventListener('change', loadMc);
    loadMc();

    UI.modal({
      title: 'Новая сборка',
      body: h('div', null,
        h('div', { class: 'field' }, h('label', null, 'Название'), name),
        h('div', { class: 'field' }, h('label', null, 'Версия Minecraft'), mcSelect),
        h('label', { class: 'check small muted' }, snapshots, 'Показывать снапшоты'),
        h('div', { class: 'field' }, h('label', null, 'Модлоадер'), seg),
        h('div', { class: 'field' }, h('label', null, 'Версия модлоадера'), loaderVersion),
        hint),
      actions: [
        { label: 'Отмена' },
        {
          label: 'Создать',
          primary: true,
          onClick: async () => {
            if (!mcSelect.value) throw new Error('Выбери версию Minecraft');
            if (loaderType !== 'vanilla' && !loaderVersion.value) throw new Error('Нет подходящей версии модлоадера');
            const inst = await api.instances.create({
              name: name.value.trim() || `${fmt.loader(loaderType)} ${mcSelect.value}`,
              minecraft: mcSelect.value,
              loader: { type: loaderType, version: loaderType === 'vanilla' ? null : loaderVersion.value },
            });
            await App.loadInstances();
            App.select(inst.id);
            toast(`Сборка «${inst.name}» создана`);
          },
        },
      ],
    });
  }

  async function importModpack() {
    const [file] = await api.app.pickFiles({ filters: [{ name: 'Модпаки', extensions: ['mrpack', 'zip'] }] });
    if (!file) return;
    try {
      const r = await App.runTask('Импорт модпака', () => api.modpacks.importFile(file));
      await App.loadInstances();
      App.select(r.instance.id);
      toast(`Модпак «${r.instance.name}» установлен`);
      showBlocked(r.blocked);
    } catch (e) { toast(e.message, 'error'); }
  }

  async function addByUrl() {
    const url = await UI.prompt('Сборка сервера', { label: 'Ссылка на манифест (manifest.json)', placeholder: 'https://example.com/pack/manifest.json', okLabel: 'Добавить' });
    if (!url) return;
    try {
      const inst = await App.runTask('Получение манифеста', () => api.instances.fromManifest(url));
      await App.loadInstances();
      App.select(inst.id);
      toast(`Сборка «${inst.name}» добавлена. Файлы скачаются при первом запуске.`);
    } catch (e) { toast(e.message, 'error'); }
  }

  function card(inst) {
    const running = state.running.has(inst.id);
    return h('div', { class: `inst-card ${inst.id === state.selectedId ? 'selected' : ''}`, onClick: () => App.openInstanceEditor(inst.id) },
      h('div', { class: 'top' }, UI.instIcon(inst),
        h('div', { style: { minWidth: 0 } }, h('div', { class: 'title' }, inst.name), h('div', { class: 'sub' }, `${inst.minecraft} · ${loaderLabel(inst)}`))),
      h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', minHeight: '22px' } },
        running ? h('span', { class: 'badge accent' }, h('span', { class: 'dot on' }), 'Запущена') : null,
        inst.sync ? h('span', { class: 'badge' }, 'Сервер') : null,
        inst.modpack ? h('span', { class: 'badge' }, inst.modpack.provider === 'curseforge' ? 'CurseForge' : 'Modrinth') : null,
        (inst.content?.length || 0) ? h('span', { class: 'badge' }, `${inst.content.length} из каталога`) : null),
      h('div', { class: 'actions', onClick: (e) => e.stopPropagation() },
        running
          ? h('button', { class: 'btn btn-sm', onClick: () => api.game.kill(inst.id) }, icon('stop'), 'Стоп')
          : h('button', { class: 'btn btn-sm btn-primary', onClick: () => { App.select(inst.id); App.launch(inst.id); } }, icon('play'), 'Играть'),
        h('span', { class: 'spacer' }),
        h('span', { class: 'muted small' }, fmt.ago(inst.lastPlayed)),
        h('button', { class: 'icon-btn', title: 'Папка', onClick: () => api.instances.openFolder(inst.id) }, icon('folder'))));
  }

  function render(root, params = {}) {
    const custom = App.featureOn('customInstances');
    root.append(h('div', { class: 'page-head' },
      h('h1', null, 'Сборки'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn', onClick: addByUrl }, icon('link'), 'По ссылке'),
      custom ? h('button', { class: 'btn', onClick: importModpack }, icon('upload'), 'Импорт модпака') : null,
      custom ? h('button', { class: 'btn btn-primary', onClick: openCreate }, icon('plus'), 'Создать') : null));

    if (!state.instances.length) {
      root.append(h('div', { class: 'empty' }, h('h3', null, 'Сборок нет'), h('div', null, 'Создай первую — это займёт пару секунд.')));
    } else {
      root.append(h('div', { class: 'cards' }, state.instances.map(card)));
    }
    if (params.create) { delete params.create; setTimeout(openCreate, 0); }
  }

  App.registerPage('instances', { title: 'Сборки', icon: 'box', render, refreshOn: ['instances', 'running'] });
})();
