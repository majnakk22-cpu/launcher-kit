'use strict';
/* global App, UI */
// «Конфиги по умолчанию»: настройки игры, сервера и файлы, которые получает каждая новая сборка.
(() => {
  const { h, icon, toast } = UI;
  const { api, state } = App;

  const GROUP_ORDER = ['Общее', 'Управление', 'Звук', 'Графика'];
  const SUBDIRS = [['config', 'config/ — конфиги модов'], ['', 'Корень игровой папки'], ['mods', 'mods/'], ['resourcepacks', 'resourcepacks/'], ['shaderpacks', 'shaderpacks/']];
  let schema = null;

  function display(o, v) {
    if (v === undefined || v === null) return 'не задано';
    if (o.special && o.special[v] !== undefined) return o.special[v];
    if (o.type === 'percent') return `${Math.round(v * (o.scale || 100))}%`;
    if (o.type === 'range') return `${v}${o.unit ? ` ${o.unit}` : ''}`;
    if (o.type === 'bool') return v ? 'Вкл' : 'Выкл';
    if (o.type === 'select') return (o.options.find(([val]) => String(val) === String(v)) || [null, String(v)])[1];
    return String(v);
  }

  async function render(root) {
    root.append(h('div', { class: 'page-head' }, h('h1', null, 'Конфиги по умолчанию')), h('span', { class: 'spinner' }));
    let data;
    try {
      [schema, data] = await Promise.all([schema ? Promise.resolve(schema) : api.defaults.schema(), api.defaults.get()]);
    } catch (e) { root.replaceChildren(UI.alert('danger', e.message)); return; }

    const pick = (d) => ({ enabled: d.enabled, packMode: d.packMode, options: { ...d.options }, extraOptions: d.extraOptions || '', servers: d.servers.map((s) => ({ ...s })) });
    let cur = pick(data);
    let saved = JSON.stringify(cur);
    let files = data.files;
    const isDirty = () => JSON.stringify(cur) !== saved;

    const save = async () => {
      const bad = cur.servers.find((s) => !s.ip.trim());
      if (bad) throw new Error('У сервера в списке не указан адрес');
      const res = await api.defaults.set(cur);
      cur = pick(res);
      saved = JSON.stringify(cur);
      files = res.files;
      refreshHead();
      toast('Конфиги по умолчанию сохранены');
    };
    const guard = { isDirty, save, title: 'Конфиги по умолчанию' };
    App.setGuard(guard);

    // ---------- шапка ----------
    const dirtyBadge = h('span', { class: 'badge warn' }, h('span', { class: 'dirty-dot' }), 'Не сохранено');
    const saveBtn = h('button', { class: 'btn btn-primary', onClick: () => save().catch((e) => toast(e.message, 'error')) }, 'Сохранить');
    const resetBtn = h('button', { class: 'btn btn-ghost', onClick: () => { cur = JSON.parse(saved); drawBody(); refreshHead(); } }, 'Отменить изменения');
    function refreshHead() {
      const d = isDirty();
      dirtyBadge.hidden = !d;
      resetBtn.hidden = !d;
      saveBtn.disabled = !d;
    }
    const changed = () => refreshHead();

    const importBtn = h('button', { class: 'btn', disabled: !state.instances.length, onClick: async () => {
      if (!(await App.confirmDiscard(guard))) return;
      const sel = h('select', { class: 'select' }, state.instances.map((i) => h('option', { value: i.id }, i.name)));
      let keybinds = false;
      let servers = true;
      UI.modal({
        title: 'Взять настройки из сборки',
        body: h('div', null,
          h('p', { class: 'muted small' }, 'Настрой игру в любой сборке как тебе удобно, потом забери её настройки сюда — они станут стандартом для новых сборок.'),
          h('div', { class: 'field' }, h('label', null, 'Сборка'), sel),
          h('label', { class: 'check' }, UI.sw(keybinds, (v) => { keybinds = v; }), 'Забрать раскладку клавиш'),
          h('label', { class: 'check' }, UI.sw(servers, (v) => { servers = v; }), 'Забрать список серверов')),
        actions: [{ label: 'Отмена' }, { label: 'Забрать', primary: true, onClick: async () => {
          await api.defaults.importFrom(sel.value, { keybinds, servers });
          toast('Настройки перенесены');
          App.clearGuard();
          App.navigate('defaults');
        } }],
      });
    } }, icon('download'), 'Взять из сборки');

    const applyAllBtn = h('button', { class: 'btn', disabled: !state.instances.length, onClick: async () => {
      if (isDirty()) {
        if (!(await UI.confirm('Сначала сохранить?', 'Применить можно только сохранённые настройки.', { okLabel: 'Сохранить' }))) return;
        await save();
      }
      if (!(await UI.confirm('Применить ко всем сборкам?', `Настройки, сервера и файлы по умолчанию будут записаны во все сборки (${state.instances.length}) поверх их текущих значений.`, { okLabel: 'Применить', danger: true }))) return;
      try { await App.runTask('Применение конфигов', () => api.defaults.applyToAll()); toast('Готово'); } catch (e) { toast(e.message, 'error'); }
    } }, 'Применить ко всем…');

    const head = h('div', { class: 'page-head' }, h('h1', null, 'Конфиги по умолчанию'), dirtyBadge, h('span', { class: 'spacer' }), resetBtn, saveBtn);
    const tools = h('div', { class: 'toolbar' }, importBtn, applyAllBtn);
    const body = h('div');
    root.replaceChildren(head, tools, body);

    // ---------- тело ----------
    function optionRow(o) {
      const has = cur.options[o.key] !== undefined;
      const value = has ? cur.options[o.key] : o.def;
      const valLabel = h('span', { class: 'val' }, has ? display(o, value) : 'не менять');
      let control;
      const setVal = (v) => { cur.options[o.key] = v; valLabel.textContent = display(o, v); changed(); };
      if (o.type === 'select') {
        control = h('select', { class: 'select', disabled: !has, onChange: (e) => {
          const raw = e.target.value;
          setVal(o.options.some(([v]) => typeof v === 'number') ? Number(raw) : raw);
        } }, o.options.map(([v, l]) => h('option', { value: String(v), selected: String(v) === String(value) }, l)));
      } else if (o.type === 'bool') {
        control = h('select', { class: 'select', disabled: !has, onChange: (e) => setVal(e.target.value === 'true') },
          h('option', { value: 'true', selected: value === true }, 'Включено'), h('option', { value: 'false', selected: value === false }, 'Выключено'));
      } else {
        const isPct = o.type === 'percent';
        control = h('input', { type: 'range', min: o.min, max: o.max, step: isPct ? 0.01 : (o.step || 1), value, disabled: !has });
        control.addEventListener('input', () => setVal(isPct ? Math.round(parseFloat(control.value) * 100) / 100 : parseInt(control.value, 10)));
      }
      const toggle = UI.sw(has, (on) => {
        if (on) { cur.options[o.key] = value; } else { delete cur.options[o.key]; }
        changed();
        row.replaceWith(optionRow(o));
      });
      const row = h('div', { class: `opt-row ${has ? '' : 'unset'}` },
        h('label', null, h('span', null, o.label), valLabel),
        h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, toggle, h('div', { style: { flex: 1 } }, control)));
      return row;
    }

    function serversBlock() {
      const list = h('div', { class: 'list' });
      const draw = () => {
        list.replaceChildren(...cur.servers.map((srv, i) => {
          const name = h('input', { class: 'input', value: srv.name, placeholder: 'Название' });
          const ip = h('input', { class: 'input', value: srv.ip, placeholder: 'play.example.com:25565' });
          name.addEventListener('input', () => { srv.name = name.value; changed(); });
          ip.addEventListener('input', () => { srv.ip = ip.value; changed(); });
          return h('div', { class: 'row', style: { alignItems: 'center' } }, name, ip,
            h('div', { style: { flex: '0 0 auto' } }, h('button', { class: 'icon-btn', title: 'Убрать', onClick: () => { cur.servers.splice(i, 1); changed(); draw(); } }, icon('trash'))));
        }));
        if (!cur.servers.length) list.append(h('div', { class: 'muted small' }, 'Список пуст'));
      };
      draw();
      return h('div', null, list, h('button', { class: 'btn btn-sm', style: { marginTop: '10px' }, onClick: () => { cur.servers.push({ name: '', ip: '' }); changed(); draw(); } }, icon('plus'), 'Добавить сервер'));
    }

    function filesBlock() {
      const box = h('div');
      const subdir = h('select', { class: 'select', style: { width: 'auto' } }, SUBDIRS.map(([v, l]) => h('option', { value: v }, l)));
      const draw = () => {
        box.replaceChildren(
          files.length
            ? h('div', { class: 'list' }, files.map((rel) => h('div', { class: 'list-row', style: { padding: '8px 12px' } },
              h('div', { class: 'grow mono small' }, rel),
              h('button', { class: 'icon-btn', title: 'Удалить', onClick: async () => { files = await api.defaults.removeFile(rel); draw(); } }, icon('trash')))))
            : h('div', { class: 'muted small' }, 'Файлов нет. Сюда можно положить, например, config/sodium-options.json или любимый ресурспак.'),
          h('div', { class: 'toolbar', style: { marginTop: '12px', marginBottom: 0 } },
            h('span', { class: 'muted small' }, 'Куда:'), subdir,
            h('button', { class: 'btn btn-sm', onClick: async () => {
              const picked = await api.app.pickFiles({ multiple: true });
              if (picked.length) { files = await api.defaults.addFiles(picked, subdir.value); draw(); toast(`Добавлено файлов: ${picked.length}`); }
            } }, icon('plus'), 'Добавить файлы'),
            h('button', { class: 'btn btn-sm btn-ghost', onClick: () => api.defaults.openFolder() }, icon('folder'), 'Открыть папку')));
      };
      draw();
      return box;
    }

    function drawBody() {
      const groups = GROUP_ORDER.map((g) => [g, schema.filter((o) => o.group === g)]);
      const packMode = h('select', { class: 'select', onChange: (e) => { cur.packMode = e.target.value; changed(); } },
        [['override', 'Применять поверх их настроек'], ['fill', 'Только то, чего у них нет'], ['skip', 'Не применять']].map(([v, l]) => h('option', { value: v, selected: cur.packMode === v }, l)));
      const extra = h('textarea', { class: 'input', rows: 4, placeholder: 'key_key.zoom:key.keyboard.c\nchatScale:0.8' }, cur.extraOptions);
      extra.addEventListener('input', () => { cur.extraOptions = extra.value; changed(); });

      body.replaceChildren(
        UI.alert('info', 'Эти настройки записываются в каждую новую сборку: созданную вручную — сразу, модпаку — после установки, сборке сервера — после первой синхронизации. Включи переключатель у настройки, чтобы задать её; выключенные остаются как в игре по умолчанию.'),
        h('div', { class: 'card' },
          h('label', { class: 'check' }, UI.sw(cur.enabled, (v) => { cur.enabled = v; changed(); }), 'Применять конфиги по умолчанию к новым сборкам'),
          h('div', { class: 'field', style: { maxWidth: '420px', marginBottom: 0 } }, h('label', null, 'Модпаки и сборки серверов (у них бывают свои настройки)'), packMode)),
        ...groups.map(([g, opts]) => h('div', { class: 'card', style: { marginTop: '14px' } },
          h('div', { class: 'section-title', style: { marginTop: 0 } }, g),
          h('div', { class: 'opt-grid' }, opts.map(optionRow)))),
        h('div', { class: 'card', style: { marginTop: '14px' } },
          h('div', { class: 'section-title', style: { marginTop: 0 } }, 'Свои строки options.txt'),
          h('p', { class: 'muted small', style: { marginTop: 0 } }, 'Любые другие настройки в формате «ключ:значение», по одной в строке. Подсмотреть ключи можно в options.txt любой сборки.'),
          extra),
        h('div', { class: 'card', style: { marginTop: '14px' } },
          h('div', { class: 'section-title', style: { marginTop: 0 } }, 'Серверы в списке «Сетевая игра»'),
          serversBlock()),
        h('div', { class: 'card', style: { marginTop: '14px' } },
          h('div', { class: 'section-title', style: { marginTop: 0 } }, 'Файлы по умолчанию'),
          h('p', { class: 'muted small', style: { marginTop: 0 } }, 'Копируются в игровую папку новой сборки. Добавляются сразу, сохранять не нужно. В сборках серверов моды отсюда может удалить синхронизация.'),
          filesBlock()),
      );
    }

    drawBody();
    refreshHead();
  }

  App.registerPage('defaults', { title: 'Конфиги', icon: 'sliders', render });
})();
