'use strict';
/* global App, UI */
// Окно настроек сборки: параметры, моды/ресурспаки/шейдеры, обслуживание.
(() => {
  const { h, icon, toast, fmt } = UI;
  const { api, state } = App;

  function generalTab(inst, ctx) {
    const locked = Boolean(inst.sync?.locked);
    const f = {
      name: h('input', { class: 'input', value: inst.name }),
      icon: h('input', { class: 'input', value: inst.icon || '', placeholder: 'https://… или data:image/png;base64,…' }),
      minMem: h('input', { class: 'input', type: 'number', min: 256, step: 256, value: inst.java?.minMemory || '', placeholder: `по умолчанию ${state.settings.memory?.min}` }),
      maxMem: h('input', { class: 'input', type: 'number', min: 512, step: 256, value: inst.java?.maxMemory || '', placeholder: `по умолчанию ${state.settings.memory?.max}` }),
      javaPath: h('input', { class: 'input', value: inst.java?.path || '', placeholder: 'Автоматически (Java от Mojang)' }),
      jvmArgs: h('textarea', { class: 'input', rows: 3, placeholder: '-XX:+UseG1GC' }, (inst.java?.args || []).join('\n')),
      width: h('input', { class: 'input', type: 'number', value: inst.window?.width || 1280 }),
      height: h('input', { class: 'input', type: 'number', value: inst.window?.height || 720 }),
      address: h('input', { class: 'input', value: inst.server?.address || '', placeholder: 'play.example.com', disabled: locked }),
      port: h('input', { class: 'input', type: 'number', value: inst.server?.port || 25565, disabled: locked }),
    };
    let fullscreen = Boolean(inst.window?.fullscreen);
    let autoConnect = Boolean(inst.server?.autoConnect);

    const detect = h('button', { class: 'btn btn-sm', onClick: async () => {
      detect.disabled = true;
      try {
        const javas = await api.settings.detectJava();
        if (!javas.length) { toast('Java в системе не найдена', 'warn'); return; }
        const jm = UI.modal({
          title: 'Найденные Java',
          body: h('div', { class: 'list' }, javas.map((j) => h('div', { class: 'list-row' },
            h('div', { class: 'grow' }, h('div', { class: 't' }, `Java ${j.major}`), h('div', { class: 'd mono' }, j.path)),
            h('button', { class: 'btn btn-sm', onClick: () => { f.javaPath.value = j.path; jm.close(); } }, 'Выбрать')))),
          actions: [{ label: 'Закрыть' }],
        });
      } finally { detect.disabled = false; }
    } }, 'Найти');

    const num = (el) => (el.value ? parseInt(el.value, 10) : null);
    const collect = () => ({
      name: f.name.value.trim() || inst.name,
      icon: f.icon.value.trim() || null,
      java: { minMemory: num(f.minMem), maxMemory: num(f.maxMem), path: f.javaPath.value.trim() || null, args: f.jvmArgs.value.split('\n').map((x) => x.trim()).filter(Boolean) },
      window: { width: num(f.width) || 1280, height: num(f.height) || 720, fullscreen },
      ...(locked ? {} : { server: { address: f.address.value.trim(), port: num(f.port) || 25565, autoConnect } }),
    });
    const initial = JSON.stringify(collect());
    ctx.isDirty = () => JSON.stringify(collect()) !== initial;

    // Предупреждения по памяти
    const memHint = h('div');
    const checkMemory = () => {
      const min = num(f.minMem) || state.settings.memory?.min;
      const max = num(f.maxMem) || state.settings.memory?.max;
      const w = App.memoryWarning(min, max, inst.loader?.type && inst.loader.type !== 'vanilla');
      memHint.replaceChildren(w ? h('div', { class: w.level === 'error' ? 'field-error' : 'field-warn', style: { marginTop: '-6px', marginBottom: '12px' } }, w.text) : '');
      return w;
    };
    f.minMem.addEventListener('input', checkMemory);
    f.maxMem.addEventListener('input', checkMemory);
    checkMemory();

    ctx.save = async () => {
      const w = checkMemory();
      if (w?.level === 'error') throw new Error(w.text);
      await api.instances.update(inst.id, collect());
      await App.loadInstances();
      toast('Сохранено');
    };

    return h('div', null,
      h('div', { class: 'grid-2' },
        h('div', { class: 'field' }, h('label', null, 'Название'), f.name),
        h('div', { class: 'field' }, h('label', null, 'Иконка (URL)'), f.icon)),
      h('div', { class: 'kv', style: { marginBottom: '16px' } },
        h('div', { class: 'k' }, 'Версия'), h('div', null, `Minecraft ${inst.minecraft} · ${inst.loader?.type && inst.loader.type !== 'vanilla' ? `${fmt.loader(inst.loader.type)} ${inst.loader.version || ''}` : 'Vanilla'}`),
        h('div', { class: 'k' }, 'Папка'), h('div', { class: 'mono small' }, inst.id),
        inst.sync ? [h('div', { class: 'k' }, 'Манифест'), h('div', { class: 'mono small', style: { wordBreak: 'break-all' } }, inst.sync.url)] : null),
      h('div', { class: 'section-title' }, 'Java и память'),
      h('div', { class: 'grid-2' },
        h('div', { class: 'field' }, h('label', null, 'Мин. память, МБ'), f.minMem),
        h('div', { class: 'field' }, h('label', null, 'Макс. память, МБ'), f.maxMem)),
      memHint,
      h('div', { class: 'field' }, h('label', null, 'Путь к Java'), h('div', { class: 'row', style: { alignItems: 'center' } }, f.javaPath, h('div', { style: { flex: '0 0 auto' } }, detect))),
      h('div', { class: 'field' }, h('label', null, 'Аргументы JVM (по одному в строке)'), f.jvmArgs),
      h('div', { class: 'section-title' }, 'Окно игры'),
      h('div', { class: 'grid-2' },
        h('div', { class: 'field' }, h('label', null, 'Ширина'), f.width),
        h('div', { class: 'field' }, h('label', null, 'Высота'), f.height)),
      h('label', { class: 'check' }, UI.sw(fullscreen, (v) => { fullscreen = v; }), 'Полноэкранный режим'),
      h('div', { class: 'section-title' }, 'Сервер'),
      locked ? h('p', { class: 'muted small' }, 'Сервер задаётся манифестом сборки.') : null,
      h('div', { class: 'grid-2' },
        h('div', { class: 'field' }, h('label', null, 'Адрес'), f.address),
        h('div', { class: 'field' }, h('label', null, 'Порт'), f.port)),
      locked ? null : h('label', { class: 'check' }, UI.sw(autoConnect, (v) => { autoConnect = v; }), 'Сразу подключаться к серверу при запуске'));
  }

  function contentTab(inst, close) {
    const wrap = h('div');
    let folder = 'mods';
    const list = h('div', { class: 'list' });
    const seg = h('div', { class: 'segmented' }, [['mods', 'Моды'], ['resourcepacks', 'Ресурспаки'], ['shaderpacks', 'Шейдеры']].map(([id, label]) =>
      h('button', { class: id === folder ? 'active' : '', onClick: (e) => { folder = id; [...seg.children].forEach((c) => c.classList.toggle('active', c === e.target)); load(); } }, label)));

    async function load() {
      list.replaceChildren(h('span', { class: 'spinner' }));
      try {
        const files = await api.content.listLocal(inst.id, folder);
        if (!files.length) { list.replaceChildren(h('div', { class: 'empty' }, 'Пусто. Добавь файлы или найди что-нибудь в каталоге.')); return; }
        list.replaceChildren(...files.map((f) => h('div', { class: `list-row ${f.enabled ? '' : 'disabled'}` },
          UI.sw(f.enabled, async (v) => { await api.content.setEnabled(inst.id, f.path, v); load(); }),
          h('div', { class: 'grow' },
            h('div', { class: 't' }, f.entry?.title || f.fileName.replace(/\.disabled$/, '')),
            h('div', { class: 'meta-line' }, h('span', { class: 'mono' }, f.fileName), f.entry ? h('span', { class: 'badge' }, f.entry.provider === 'curseforge' ? 'CurseForge' : 'Modrinth') : null)),
          h('button', { class: 'icon-btn', title: 'Удалить', onClick: async () => {
            if (!(await UI.confirm('Удалить файл?', f.fileName, { okLabel: 'Удалить', danger: true }))) return;
            await api.content.removeLocal(inst.id, f.path);
            load();
          } }, icon('trash')))));
      } catch (e) { list.replaceChildren(h('div', { class: 'muted' }, e.message)); }
    }

    const checkUpdates = async () => {
      try {
        const ups = await App.runTask('Проверка обновлений', () => api.content.checkUpdates(inst.id));
        if (!ups.length) { toast('Всё актуально'); return; }
        UI.modal({
          title: `Обновления: ${ups.length}`,
          wide: true,
          body: h('div', { class: 'list' }, ups.map((u) => h('div', { class: 'list-row' },
            h('div', { class: 'grow' }, h('div', { class: 't' }, u.entry.title), h('div', { class: 'd' }, `${u.entry.versionNumber || ''} → ${u.latest.versionNumber}`))))),
          actions: [{ label: 'Отмена' }, { label: 'Обновить всё', primary: true, onClick: async () => {
            await App.runTask('Обновление', async () => { for (const u of ups) await api.content.update(inst.id, u.entry.provider, u.entry.projectId); });
            toast('Обновлено'); load();
          } }],
        });
      } catch (e) { toast(e.message, 'error'); }
    };

    wrap.append(
      h('div', { class: 'toolbar' }, seg, h('span', { style: { flex: 1 } }),
        h('button', { class: 'btn btn-sm', onClick: async () => {
          const files = await api.app.pickFiles({ multiple: true, filters: [{ name: 'Файлы', extensions: folder === 'mods' ? ['jar'] : ['zip'] }] });
          if (files.length) { await api.content.addLocal(inst.id, files, folder); load(); }
        } }, icon('plus'), 'Добавить файлы'),
        h('button', { class: 'btn btn-sm', onClick: checkUpdates }, icon('refresh'), 'Обновления'),
        App.featureOn('catalog') ? h('button', { class: 'btn btn-sm btn-primary', onClick: () => { close(); App.navigate('catalog', { instanceId: inst.id, type: folder === 'mods' ? 'mod' : folder === 'shaderpacks' ? 'shader' : 'resourcepack' }); } }, icon('compass'), 'Каталог') : null),
      list);
    load();
    return wrap;
  }

  function maintenanceTab(inst, close) {
    const act = (label, desc, btn) => h('div', { class: 'list-row' }, h('div', { class: 'grow' }, h('div', { class: 't' }, label), h('div', { class: 'd' }, desc)), btn);
    return h('div', { class: 'list' },
      act('Папка сборки', 'Моды, конфиги, миры, скриншоты', h('button', { class: 'btn btn-sm', onClick: () => api.instances.openFolder(inst.id) }, icon('folder'), 'Открыть')),
      inst.sync ? act('Синхронизация с сервером', `Последняя: ${fmt.ago(inst.sync.lastSync)}${inst.sync.lastVersion ? `, версия ${inst.sync.lastVersion}` : ''}`,
        h('button', { class: 'btn btn-sm', onClick: async () => {
          try { const r = await App.runTask('Синхронизация', () => api.instances.sync(inst.id)); toast(`Готово: скачано ${r.downloaded}, удалено ${r.removed.length}`); App.loadInstances(); } catch (e) { toast(e.message, 'error'); }
        } }, icon('refresh'), 'Синхронизировать')) : null,
      inst.modpack?.projectId ? act('Обновить модпак', `Сейчас: ${inst.modpack.versionNumber || '—'}`,
        h('button', { class: 'btn btn-sm', onClick: async () => {
          try { const r = await App.runTask('Обновление модпака', () => api.modpacks.update(inst.id)); toast('Модпак обновлён'); App.showBlocked(r.blocked); App.loadInstances(); } catch (e) { toast(e.message, 'error'); }
        } }, icon('download'), 'Обновить')) : null,
      act('Применить конфиги по умолчанию', 'Язык, звук, графика, сервера и файлы со страницы «Конфиги» — поверх текущих настроек сборки',
        h('button', { class: 'btn btn-sm', onClick: async () => {
          if (!(await UI.confirm('Применить конфиги по умолчанию?', `Настройки «${inst.name}» будут перезаписаны значениями по умолчанию.`, { okLabel: 'Применить' }))) return;
          try { const r = await api.defaults.applyTo(inst.id); toast(`Готово: настроек ${r.options}, серверов ${r.servers}, файлов ${r.files}`); } catch (e) { toast(e.message, 'error'); }
        } }, icon('sliders'), 'Применить')),
      act('Скачать / проверить файлы игры', 'Установит модлоадер, Java, библиотеки и ассеты без запуска',
        h('button', { class: 'btn btn-sm', onClick: async () => {
          try { await App.runTask('Проверка файлов', () => api.instances.prepare(inst.id)); toast('Все файлы на месте'); } catch (e) { toast(e.message, 'error'); }
        } }, icon('check'), 'Проверить')),
      act('Удалить сборку', 'Удалит папку сборки вместе с мирами и настройками', h('button', { class: 'btn btn-sm btn-danger', onClick: async () => {
        if (!(await UI.confirm('Удалить сборку?', `«${inst.name}» будет удалена вместе с мирами. Это необратимо.`, { okLabel: 'Удалить', danger: true }))) return;
        await api.instances.remove(inst.id);
        close();
        await App.loadInstances();
        toast('Сборка удалена');
      } }, icon('trash'), 'Удалить')));
  }

  App.openInstanceEditor = async (id) => {
    const inst = await api.instances.get(id);
    App.select(id);
    const ctx = {};
    const body = h('div');
    const tabs = h('div', { class: 'tabs' });
    const panes = {};
    let m;
    const guard = { isDirty: () => Boolean(ctx.isDirty?.()), save: () => ctx.save(), title: inst.name };
    const dirtyBadge = h('span', { class: 'badge warn', hidden: true, style: { marginLeft: 'auto', alignSelf: 'center' } }, h('span', { class: 'dirty-dot' }), 'Не сохранено');
    const show = (name) => {
      [...tabs.querySelectorAll('button')].forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
      saveBtnHolder.hidden = name !== 'general';
      // Вкладки создаются один раз — правки на «Основном» не теряются при переключении
      if (!panes[name]) {
        panes[name] = name === 'general' ? generalTab(inst, ctx)
          : name === 'content' ? contentTab(inst, () => m.tryClose())
            : maintenanceTab(inst, () => m.close());
      }
      body.replaceChildren(panes[name]);
    };
    [['general', 'Основное'], ['content', 'Моды и ресурсы'], ['maint', 'Обслуживание']].forEach(([k, label]) => tabs.append(h('button', { 'data-tab': k, onClick: () => show(k) }, label)));
    tabs.append(dirtyBadge);
    const saveBtnHolder = h('div', { class: 'modal-actions' },
      h('button', { class: 'btn', onClick: () => m.tryClose() }, 'Закрыть'),
      h('button', { class: 'btn btn-primary', onClick: async () => { try { await ctx.save(); m.close(); } catch (e) { toast(e.message, 'error'); } } }, 'Сохранить'));
    const content = h('div', null,
      state.running.has(inst.id) ? UI.alert('warn', 'Сборка сейчас запущена — изменения применятся после перезапуска игры.') : null,
      tabs, body, saveBtnHolder);
    content.addEventListener('input', () => { dirtyBadge.hidden = !guard.isDirty(); });
    content.addEventListener('change', () => { dirtyBadge.hidden = !guard.isDirty(); });
    m = UI.modal({
      title: inst.name,
      wide: true,
      body: content,
      beforeClose: () => App.confirmDiscard(guard),
    });
    show('general');
  };
})();
