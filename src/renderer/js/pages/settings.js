'use strict';
/* global App, UI */
// Глобальные настройки лаунчера (с предупреждением о несохранённых изменениях).
(() => {
  const { h, toast } = UI;
  const { api, state } = App;

  function render(root) {
    const st = state.settings;
    const totalMb = state.info?.totalMemoryMb || 32768;
    const maxMem = h('input', { type: 'range', min: 1024, max: Math.max(4096, Math.floor(totalMb / 512) * 512), step: 512, value: st.memory?.max || 4096 });
    const minMem = h('input', { class: 'input', type: 'number', min: 256, step: 256, value: st.memory?.min || 1024 });
    const maxLabel = h('strong', null, '');
    const memHint = h('div');
    const syncWarn = h('div');
    const javaArgs = h('textarea', { class: 'input', rows: 3, placeholder: '-XX:+UseG1GC\n-XX:+UnlockExperimentalVMOptions' }, (st.javaArgs || []).join('\n'));
    const threads = h('input', { class: 'input', type: 'number', min: 1, max: 32, value: st.downloadThreads || 8 });
    const after = h('select', { class: 'select' },
      [['keep', 'Оставлять открытым'], ['minimize', 'Сворачивать'], ['hide', 'Скрывать до закрытия игры']].map(([v, l]) => h('option', { value: v, selected: st.afterLaunch === v }, l)));
    const cfKey = h('input', { class: 'input', type: 'password', value: st.curseforgeApiKey || '', placeholder: state.config.curseforge?.apiKey ? 'Задан в конфиге лаунчера' : 'Ключ с console.curseforge.com' });
    let autoSync = st.autoSync !== false;

    const collect = () => ({
      memory: { min: parseInt(minMem.value, 10) || 1024, max: parseInt(maxMem.value, 10) },
      javaArgs: javaArgs.value.split('\n').map((s) => s.trim()).filter(Boolean),
      downloadThreads: Math.max(1, Math.min(32, parseInt(threads.value, 10) || 8)),
      afterLaunch: after.value,
      autoSync,
      curseforgeApiKey: cfKey.value.trim(),
    });
    let saved = JSON.stringify(collect());
    const isDirty = () => JSON.stringify(collect()) !== saved;

    const dirtyBadge = h('span', { class: 'badge warn' }, h('span', { class: 'dirty-dot' }), 'Не сохранено');
    const saveBtn = h('button', { class: 'btn btn-primary' }, 'Сохранить');
    const resetBtn = h('button', { class: 'btn btn-ghost', onClick: () => { App.clearGuard(); App.navigate('settings'); } }, 'Отменить изменения');

    const checkMemory = () => {
      const c = collect();
      const w = App.memoryWarning(c.memory.min, c.memory.max);
      memHint.replaceChildren(w ? h('div', { class: w.level === 'error' ? 'field-error' : 'field-warn', style: { marginBottom: '12px' } }, w.text) : '');
      return w;
    };
    const refresh = () => {
      maxLabel.textContent = `${(maxMem.value / 1024).toFixed(1)} ГБ`;
      const d = isDirty();
      dirtyBadge.hidden = !d;
      resetBtn.hidden = !d;
      saveBtn.disabled = !d;
      checkMemory();
      syncWarn.replaceChildren(autoSync ? '' : UI.alert('warn', 'Без синхронизации у игроков могут остаться старые моды, и сервер их не пустит.'));
    };

    const save = async () => {
      const w = checkMemory();
      if (w?.level === 'error') throw new Error(w.text);
      await api.settings.set(collect());
      await App.loadSettings();
      saved = JSON.stringify(collect());
      refresh();
      toast('Настройки сохранены');
    };
    saveBtn.addEventListener('click', () => save().catch((e) => toast(e.message, 'error')));
    App.setGuard({ isDirty, save, title: 'Настройки' });

    const page = h('div', null,
      h('div', { class: 'page-head' }, h('h1', null, 'Настройки'), dirtyBadge, h('span', { class: 'spacer' }), resetBtn, saveBtn),
      h('div', { class: 'card' },
        h('div', { class: 'section-title', style: { marginTop: 0 } }, 'Память по умолчанию'),
        h('div', { class: 'field' }, h('label', null, 'Максимум: ', maxLabel), maxMem,
          h('span', { class: 'hint' }, `Всего памяти в компьютере: ${(totalMb / 1024).toFixed(1)} ГБ. Сборка может переопределить это в своих настройках. Для больших модпаков ставь 6–8 ГБ.`)),
        memHint,
        h('div', { class: 'field', style: { maxWidth: '240px' } }, h('label', null, 'Минимум, МБ'), minMem),
        h('div', { class: 'field' }, h('label', null, 'Аргументы JVM для всех сборок'), javaArgs)),
      h('div', { class: 'card', style: { marginTop: '14px' } },
        h('div', { class: 'section-title', style: { marginTop: 0 } }, 'Поведение'),
        h('div', { class: 'grid-2' },
          h('div', { class: 'field' }, h('label', null, 'После запуска игры'), after),
          h('div', { class: 'field' }, h('label', null, 'Потоков загрузки'), threads)),
        h('label', { class: 'check' }, UI.sw(autoSync, (v) => { autoSync = v; refresh(); }), 'Синхронизировать сборки серверов перед запуском'),
        syncWarn),
      state.config.content?.curseforge !== false ? h('div', { class: 'card', style: { marginTop: '14px' } },
        h('div', { class: 'section-title', style: { marginTop: 0 } }, 'CurseForge'),
        h('div', { class: 'field' }, h('label', null, 'API-ключ'), cfKey,
          h('span', { class: 'hint' }, 'Нужен для каталога и модпаков CurseForge. Бесплатно: ',
            h('a', { href: '#', onClick: (e) => { e.preventDefault(); api.app.openExternal('https://console.curseforge.com/'); } }, 'console.curseforge.com')))) : null,
      h('div', { class: 'card', style: { marginTop: '14px' } },
        h('div', { class: 'section-title', style: { marginTop: 0 } }, 'О лаунчере'),
        h('div', { class: 'kv' },
          h('div', { class: 'k' }, 'Версия'), h('div', null, state.info.version || '—'),
          h('div', { class: 'k' }, 'Папка данных'), h('div', null, h('a', { href: '#', class: 'mono small', onClick: (e) => { e.preventDefault(); api.app.openPath(state.info.dataDir); } }, state.info.dataDir)),
          h('div', { class: 'k' }, 'Electron / Node'), h('div', null, `${state.info.versions.electron} / ${state.info.versions.node}`)),
        h('button', { class: 'btn btn-sm', style: { marginTop: '14px' }, onClick: async () => {
          try {
            const u = await api.app.checkUpdate();
            if (u.available) { state.update = u; App.emit('update', u); toast(`Доступна версия ${u.latest}`); }
            else toast(state.config.updates?.url ? 'У тебя последняя версия' : 'Адрес обновлений не задан в launcher.config.json', state.config.updates?.url ? 'info' : 'warn');
          } catch (e) { toast(`Не удалось проверить: ${e.message}`, 'error'); }
        } }, 'Проверить обновления')),
    );
    page.addEventListener('input', refresh);
    page.addEventListener('change', refresh);
    root.append(page);
    refresh();
  }

  App.registerPage('settings', { title: 'Настройки', icon: 'settings', render });
})();
