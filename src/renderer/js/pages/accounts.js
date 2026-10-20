'use strict';
/* global App, UI */
// Аккаунты: офлайн-ник и вход через Microsoft (device code).
(() => {
  const { h, icon, toast } = UI;
  const { api, state } = App;

  async function addOffline() {
    const name = await UI.prompt('Офлайн-аккаунт', { label: 'Ник (3–16 символов: латиница, цифры, _)', placeholder: 'Steve', okLabel: 'Добавить' });
    if (!name) return;
    try { await api.accounts.addOffline(name); await App.loadAccounts(); toast(`Аккаунт ${name} добавлен`); } catch (e) { toast(e.message, 'error'); }
  }

  async function loginMicrosoft() {
    let flow;
    try { flow = await api.accounts.msStart(); } catch (e) { toast(e.message, 'error'); return; }
    let off = null;
    const status = h('div', { class: 'muted small', style: { textAlign: 'center', marginTop: '12px' } }, h('span', { class: 'spinner' }), '  Ждём подтверждения…');
    const m = UI.modal({
      title: 'Вход через Microsoft',
      body: h('div', null,
        h('p', null, 'В браузере открылась страница входа. Введи там этот код (он уже скопирован в буфер обмена):'),
        h('div', { class: 'code-box' }, flow.userCode),
        h('p', { class: 'muted small', style: { textAlign: 'center' } },
          'Страница не открылась? ', h('a', { href: '#', onClick: (e) => { e.preventDefault(); api.app.openExternal(flow.verificationUri); } }, flow.verificationUri)),
        status),
      actions: [{ label: 'Отмена', onClick: () => { api.accounts.msCancel(); } }],
      onClose: () => { off?.(); api.accounts.msCancel(); },
    });
    off = api.on('auth:ms-result', async (r) => {
      off();
      off = null;
      if (r.ok) {
        m.close();
        await App.loadAccounts();
        toast(`Добро пожаловать, ${r.account.name}!`);
      } else {
        status.replaceChildren(h('span', { style: { color: 'var(--danger)' } }, r.error));
      }
    });
  }

  function render(root) {
    const { accounts, activeId } = state.accounts;
    const cfg = state.config.features || {};
    root.append(h('div', { class: 'page-head' },
      h('h1', null, 'Аккаунты'),
      h('span', { class: 'spacer' }),
      cfg.offlineAccounts !== false ? h('button', { class: 'btn', onClick: addOffline }, icon('user'), 'Офлайн-ник') : null,
      cfg.microsoftAccounts !== false ? h('button', { class: 'btn btn-primary', disabled: !state.config.microsoft?.clientId || state.config.microsoft.clientId.includes('YOUR'), onClick: loginMicrosoft }, icon('microsoft'), 'Войти через Microsoft') : null));

    const msId = state.config.microsoft?.clientId || '';
    if (cfg.microsoftAccounts !== false && (!msId || msId.includes('YOUR'))) {
      root.append(UI.alert('warn', 'Вход через Microsoft не настроен: в launcher.config.json не указан microsoft.clientId (инструкция в README). Пока доступны только офлайн-аккаунты.'));
    }
    if (accounts.some((a) => a.type === 'offline') && !accounts.some((a) => a.type === 'microsoft')) {
      root.append(UI.alert('info', 'Офлайн-аккаунт пустят только на серверы без проверки лицензии (online-mode=false).'));
    }
    if (!accounts.length) {
      root.append(h('div', { class: 'empty' }, h('h3', null, 'Нет аккаунтов'), h('div', null, 'Войди через Microsoft (лицензия) или добавь офлайн-ник для серверов без авторизации.')));
      return;
    }
    root.append(h('div', { class: 'list' }, accounts.map((a) => h('div', { class: 'list-row' },
      UI.avatar(a, 'lg'),
      h('div', { class: 'grow' },
        h('div', { class: 't' }, a.name),
        h('div', { class: 'meta-line' },
          h('span', { class: `badge ${a.type === 'microsoft' ? 'accent' : ''}` }, a.type === 'microsoft' ? 'Microsoft' : 'Офлайн'),
          h('span', { class: 'mono' }, a.uuid))),
      a.id === activeId
        ? h('span', { class: 'badge accent' }, icon('check'), 'Активен')
        : h('button', { class: 'btn btn-sm', onClick: async () => { await api.accounts.setActive(a.id); await App.loadAccounts(); } }, 'Выбрать'),
      h('button', { class: 'icon-btn', title: 'Удалить', onClick: async () => {
        if (!(await UI.confirm('Удалить аккаунт?', a.name, { okLabel: 'Удалить', danger: true }))) return;
        await api.accounts.remove(a.id);
        await App.loadAccounts();
      } }, icon('trash'))))));
  }

  App.registerPage('accounts', { title: 'Аккаунты', icon: 'user', render, refreshOn: ['accounts'] });
})();
