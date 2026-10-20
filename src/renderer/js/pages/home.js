'use strict';
/* global App, UI */
// Главная: выбранная сборка, большая кнопка «Играть», статус сервера, новости.
(() => {
  const { h, icon, fmt } = UI;
  const { api, state } = App;

  function serverStat(inst) {
    const box = h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Сервер'), h('div', { class: 'v' }, h('span', { class: 'spinner' })), h('div', { class: 's' }, `${inst.server.address}${inst.server.port && inst.server.port !== 25565 ? `:${inst.server.port}` : ''}`));
    api.app.ping(inst.server.address, inst.server.port).then((r) => {
      box.children[1].replaceChildren(h('span', { class: 'dot on' }), `${r.online} / ${r.max}`);
      box.children[2].textContent = fmt.stripMc(r.motd).split('\n')[0] || `${r.version} · ${r.latency} мс`;
      box.title = `${r.version}\n${r.players.join(', ')}`;
    }).catch(() => {
      box.children[1].replaceChildren(h('span', { class: 'dot off' }), 'Офлайн');
    });
    return box;
  }

  /** Плашки над главной: обновление лаунчера, место на диске, нет аккаунта. */
  function banners(root) {
    const box = h('div');
    const u = state.update;
    if (u?.available) {
      box.append(UI.alert('info', `Доступна новая версия лаунчера: ${u.latest} (у тебя ${u.current}).${u.notes ? ` ${u.notes}` : ''}`, {
        label: u.canInstall ? 'Обновить' : 'Скачать',
        onClick: async () => {
          if (!(await App.confirmDiscard())) return;
          try {
            const r = await App.runTask('Обновление лаунчера', () => api.app.installUpdate());
            if (r.opened) toast('Открыта страница загрузки новой версии');
          } catch (e) { toast(e.message, 'error'); }
        },
      }));
    }
    if (!App.activeAccount()) {
      box.append(UI.alert('warn', 'Не выбран аккаунт — без него игру не запустить.', { label: 'Добавить', onClick: () => App.navigate('accounts') }));
    }
    api.app.diskFree().then((d) => {
      const gb = d.free / 1024 ** 3;
      if (gb < 0.5) box.append(UI.alert('danger', `На диске с данными лаунчера почти нет места (${gb.toFixed(2)} ГБ). Загрузка игры не поместится.`));
      else if (gb < 3) box.append(UI.alert('warn', `Мало места на диске: свободно ${gb.toFixed(1)} ГБ. Для сборок с модами нужно 2–5 ГБ.`));
    }).catch(() => {});
    root.append(box);
  }

  function render(root) {
    banners(root);
    const inst = App.selectedInstance();
    if (!inst) {
      root.append(
        h('div', { class: 'page-head' }, h('h1', null, `Добро пожаловать в ${state.config.name || 'лаунчер'}`)),
        h('div', { class: 'empty' },
          h('h3', null, 'Пока нет ни одной сборки'),
          h('div', null, 'Создай свою, установи модпак из каталога или добавь сборку сервера по ссылке.'),
          h('div', { style: { display: 'flex', gap: '10px', justifyContent: 'center' } },
            App.featureOn('customInstances') ? h('button', { class: 'btn btn-primary', onClick: () => App.navigate('instances', { create: true }) }, icon('plus'), 'Создать сборку') : null,
            App.featureOn('catalog') ? h('button', { class: 'btn', onClick: () => App.navigate('catalog', { type: 'modpack' }) }, icon('compass'), 'Модпаки') : null)),
      );
      return;
    }

    const running = state.running.has(inst.id);
    const select = h('select', { class: 'select hero-switch', onChange: (e) => App.select(e.target.value) },
      state.instances.map((i) => h('option', { value: i.id, selected: i.id === inst.id }, i.name)));

    const playBtn = running
      ? h('button', { class: 'btn btn-xl', onClick: () => api.game.kill(inst.id) }, icon('stop'), 'Остановить')
      : h('button', { class: 'btn btn-primary btn-xl', disabled: Boolean(state.task), onClick: () => App.launch(inst.id) }, icon('play'), 'Играть');

    const loader = inst.loader?.type && inst.loader.type !== 'vanilla' ? `${fmt.loader(inst.loader.type)} ${inst.loader.version || ''}` : 'Vanilla';

    root.append(
      h('section', { class: 'hero' },
        h('div', { style: { display: 'flex', gap: '18px', alignItems: 'center' } },
          UI.instIcon(inst, 'xl'),
          h('div', null,
            h('h1', { class: 'hero-title' }, inst.name),
            h('div', { class: 'hero-meta' },
              h('span', { class: 'badge accent' }, `Minecraft ${inst.minecraft}`),
              h('span', { class: 'badge' }, loader),
              inst.sync ? h('span', { class: 'badge' }, icon('server'), `Сборка сервера${inst.sync.lastVersion ? ` · v${inst.sync.lastVersion}` : ''}`) : null,
              inst.modpack ? h('span', { class: 'badge' }, `Модпак · ${inst.modpack.versionNumber || inst.modpack.name || ''}`) : null,
              running ? h('span', { class: 'badge accent' }, h('span', { class: 'dot on' }), 'Запущена') : null))),
        h('div', { class: 'hero-actions' },
          playBtn,
          state.instances.length > 1 ? select : null,
          h('button', { class: 'btn btn-ghost', title: 'Открыть папку', onClick: () => api.instances.openFolder(inst.id) }, icon('folder')),
          h('button', { class: 'btn btn-ghost', title: 'Настройки сборки', onClick: () => App.openInstanceEditor(inst.id) }, icon('settings')))),

      h('div', { class: 'stat-row' },
        h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Аккаунт'),
          h('div', { class: 'v' }, App.activeAccount()?.name || '—'),
          h('div', { class: 's' }, App.activeAccount() ? (App.activeAccount().type === 'microsoft' ? 'Лицензия Microsoft' : 'Офлайн-режим') : 'Добавь аккаунт')),
        inst.server?.address ? serverStat(inst) : null,
        h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Последний запуск'), h('div', { class: 'v' }, fmt.ago(inst.lastPlayed)), h('div', { class: 's' }, `Наиграно: ${fmt.duration(inst.playTimeMs)}`)),
        h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Память'), h('div', { class: 'v' }, `${((inst.java?.maxMemory || state.settings.memory?.max || 0) / 1024).toFixed(1)} ГБ`), h('div', { class: 's' }, 'выделено игре'))),
    );

    if (state.config.news?.url) {
      const list = h('div', { class: 'news' }, h('span', { class: 'spinner' }));
      root.append(h('div', { class: 'section-title' }, 'Новости'), list);
      api.app.news().then((items) => {
        list.replaceChildren(...(items || []).slice(0, 6).map((n) => h('div', { class: 'card news-item' },
          n.image ? h('img', { src: n.image, alt: '' }) : null,
          h('div', { class: 'date' }, n.date ? new Date(n.date).toLocaleDateString('ru-RU') : ''),
          h('strong', null, n.title),
          h('div', { class: 'muted small' }, n.text || ''),
          n.url ? h('a', { href: '#', onClick: (e) => { e.preventDefault(); api.app.openExternal(n.url); } }, 'Подробнее') : null)));
        if (!items?.length) list.replaceChildren(h('div', { class: 'muted' }, 'Новостей пока нет'));
      }).catch((e) => list.replaceChildren(h('div', { class: 'muted' }, `Не удалось загрузить новости: ${e.message}`)));
    }
  }

  App.registerPage('home', { title: 'Главная', icon: 'home', render, refreshOn: ['instances', 'running', 'accounts', 'task', 'update'] });
})();
