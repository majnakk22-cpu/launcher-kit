'use strict';
/* global App, UI */
// Менеджер загрузок: что качается сейчас, задания, очередь файлов, история.
(() => {
  const { h, icon, fmt, toast } = UI;
  const { api, state } = App;

  const STATUS = {
    checking: ['Проверка', ''],
    queued: ['В очереди', ''],
    downloading: ['Загрузка', 'accent'],
    done: ['Готово', 'accent'],
    failed: ['Ошибка', 'danger'],
    cancelled: ['Отменено', 'warn'],
  };
  let root = null;

  function bar(ratio) {
    return h('div', { class: 'task-bar', style: { width: '100%' } }, h('div', { class: 'task-fill', style: { width: `${Math.min(100, Math.max(0, ratio * 100)).toFixed(1)}%` } }));
  }

  function jobRatio(j) {
    if (j.status === 'done') return 1;
    return j.totalBytes ? j.bytes / j.totalBytes : (j.total ? j.done / j.total : 0);
  }

  function jobRow(j) {
    const [label, cls] = STATUS[j.status] || [j.status, ''];
    const live = !['done', 'failed', 'cancelled'].includes(j.status);
    const sizeText = j.totalBytes ? `${fmt.bytes(j.bytes)} / ${fmt.bytes(j.totalBytes)}` : '';
    return h('div', { class: 'list-row' },
      h('div', { class: 'grow' },
        h('div', { class: 't' }, j.label),
        h('div', { class: 'meta-line' },
          h('span', { class: `badge ${cls}` }, label),
          h('span', null, `${j.done} / ${j.total} файлов`),
          sizeText ? h('span', null, sizeText) : null,
          j.failed ? h('span', { class: 'badge warn' }, `не скачано: ${j.failed}`) : null,
          j.finishedAt ? h('span', null, fmt.ago(j.finishedAt)) : null),
        live ? h('div', { style: { marginTop: '8px' } }, bar(jobRatio(j))) : null,
        j.error ? h('div', { class: 'small', style: { color: 'var(--danger)', marginTop: '6px', wordBreak: 'break-word' } }, j.error) : null),
      live ? h('button', { class: 'btn btn-sm btn-danger', onClick: async () => { await api.downloads.cancel(j.id); toast(`Отменено: ${j.label}`, 'warn'); } }, icon('x'), 'Отменить') : null);
  }

  function fileRow(f, active) {
    const ratio = f.size ? f.received / f.size : 0;
    return h('div', { class: 'dl-file' },
      h('div', { class: 'dl-file-name' }, h('span', { class: 'mono' }, f.file), h('span', { class: 'muted small' }, f.label)),
      active ? bar(f.size ? ratio : 0.05) : null,
      h('div', { class: 'muted small dl-file-size' }, active ? `${fmt.bytes(f.received)}${f.size ? ` / ${fmt.bytes(f.size)}` : ''}` : (f.size ? fmt.bytes(f.size) : '')));
  }

  function draw() {
    if (!root) return;
    const s = state.downloads || { jobs: [], active: [], queue: [], queued: 0, speed: 0, paused: false };
    const live = s.jobs.filter((j) => !['done', 'failed', 'cancelled'].includes(j.status));
    const history = s.jobs.filter((j) => ['done', 'failed', 'cancelled'].includes(j.status));

    const head = h('div', { class: 'page-head' },
      h('h1', null, 'Загрузки'),
      s.active.length ? h('span', { class: 'badge accent' }, `${fmt.bytes(s.speed)}/с`) : null,
      s.paused ? h('span', { class: 'badge warn' }, 'Пауза') : null,
      h('span', { class: 'spacer' }),
      s.paused
        ? h('button', { class: 'btn', onClick: () => api.downloads.resume() }, icon('play'), 'Продолжить')
        : h('button', { class: 'btn', disabled: !live.length, onClick: () => api.downloads.pause() }, icon('pause'), 'Пауза'),
      h('button', { class: 'btn btn-danger', disabled: !live.length, onClick: async () => {
        if (await UI.confirm('Отменить все загрузки?', 'Запущенные установки и обновления будут прерваны.', { okLabel: 'Отменить всё', danger: true })) api.downloads.cancelAll();
      } }, 'Отменить всё'));

    const blocks = [head];
    if (s.paused) blocks.push(UI.alert('warn', 'Очередь на паузе: начатые файлы докачаются, новые не стартуют.'));

    if (!live.length && !history.length) {
      blocks.push(h('div', { class: 'empty' }, h('h3', null, 'Сейчас ничего не загружается'), h('div', null, 'Здесь появятся загрузки игры, модлоадеров, Java, модов и модпаков.')));
    } else {
      if (s.active.length) {
        blocks.push(h('div', { class: 'section-title' }, `Сейчас качается · ${s.active.length} из ${s.concurrency} потоков`),
          h('div', { class: 'card dl-files' }, s.active.map((f) => fileRow(f, true))));
      }
      if (live.length) blocks.push(h('div', { class: 'section-title' }, 'Задания'), h('div', { class: 'list' }, live.map(jobRow)));
      if (s.queued) {
        blocks.push(h('div', { class: 'section-title' }, `Очередь · ${s.queued} файл(ов)`),
          h('div', { class: 'card dl-files dl-queue' }, s.queue.map((f) => fileRow(f, false)),
            s.queued > s.queue.length ? h('div', { class: 'muted small', style: { padding: '8px 0 0' } }, `…и ещё ${s.queued - s.queue.length}`) : null));
      }
      if (history.length) {
        blocks.push(h('div', { class: 'section-title', style: { display: 'flex', alignItems: 'center' } }, 'История',
          h('span', { style: { flex: 1 } }), h('button', { class: 'btn btn-ghost btn-sm', onClick: () => api.downloads.clear() }, 'Очистить')),
        h('div', { class: 'list' }, history.map(jobRow)));
      }
    }
    root.replaceChildren(...blocks);
  }

  App.registerPage('downloads', {
    title: 'Загрузки',
    icon: 'download',
    badge: () => (state.downloads?.jobs || []).filter((j) => !['done', 'failed', 'cancelled'].includes(j.status)).length,
    render(r) { root = r; draw(); },
    onEvent(ev) { if (ev === 'downloads') draw(); },
  });
})();
