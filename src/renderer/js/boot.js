'use strict';
/* global App, UI, document */
// Запуск интерфейса после регистрации всех страниц.
App.init().catch((e) => {
  console.error(e);
  document.getElementById('content').replaceChildren(UI.h('div', { class: 'empty' }, UI.h('h3', null, 'Не удалось запустить интерфейс'), e.message));
});
