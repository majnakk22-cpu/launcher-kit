# Launcher Kit — каркас Minecraft-лаунчера

Фундамент, из которого можно быстро собрать свой лаунчер: личный, для друзей, для своего сервера.
Electron + чистый Node.js, **без внешних зависимостей в ядре**.

## Что уже умеет

| | |
|---|---|
| **Версии** | Любые релизы и снапшоты Minecraft из официального манифеста Mojang |
| **Модлоадеры** | Vanilla, Forge (в т.ч. старый формат установщика), NeoForge, Fabric, Quilt |
| **Java** | Сама скачивает нужную официальную Java от Mojang (8 / 17 / 21 …) под ОС; можно указать свою |
| **Аккаунты** | Microsoft (лицензия, device-code вход, автообновление токена) и офлайн-ник. Токены шифруются средствами ОС |
| **Сборки** | Отдельная папка на каждую сборку, своя память/Java/аргументы/окно/сервер, автоподключение к серверу |
| **Сервер** | Синхронизация сборки по JSON-манифесту: докачивает изменённое, удаляет лишние моды, не трогает настройки игрока |
| **Каталог** | Modrinth и CurseForge: моды, ресурспаки, шейдеры, модпаки; зависимости ставятся сами; обновления; вкл/выкл модов |
| **Модпаки** | Импорт `.mrpack` и `.zip` CurseForge, установка/обновление из каталога |
| **Загрузки** | Менеджер загрузок: что качается сейчас, задания, очередь файлов, скорость, пауза, отмена, история |
| **Конфиги по умолчанию** | Язык, звук, графика, управление, свои строки `options.txt`, список серверов и любые файлы — автоматически в каждую новую сборку |
| **Предупреждения** | Несохранённые изменения, закрытие во время загрузки, память, место на диске, сборка без модлоадера и т.п. |
| **Прочее** | Пинг сервера (онлайн/MOTD), консоль с логами игры, окно с краш-логом, новости, зеркала загрузок, автообновление лаунчера, CLI |

## Быстрый старт

Нужен **Node.js 20+**.

```bash
npm install
npm start          # запуск лаунчера
npm run dev        # то же + DevTools
npm test           # тесты ядра
```

На Windows можно просто дважды кликнуть `start-dev.bat` — он сам поставит зависимости и запустит лаунчер.

## Сборка в .exe для игроков

Игрокам не нужен Node.js — они получают обычный установщик.

**Вариант 1 — у себя на Windows.** Дважды кликни `build-exe.bat`. Он проверит Node.js, поставит зависимости,
прогонит тесты и соберёт в папку `dist/`:

- `mc-launcher-kit-Setup-<версия>.exe` — установщик (ярлыки на рабочем столе и в «Пуске», выбор папки, русский язык) — его и раздавай;
- `mc-launcher-kit-Portable-<версия>.exe` — один файл, работает без установки.

То же из консоли: `npm run dist:win`. Для Linux — `dist:linux` (AppImage), для macOS — `dist:mac` (dmg, собирать нужно на Mac).

**Вариант 2 — на серверах GitHub, без установки чего-либо.** Залей проект в репозиторий на GitHub, открой
**Actions → Build launcher → Run workflow**. Через несколько минут в результатах появятся файлы для Windows, Linux и macOS.
Если запушить тег (`git tag v0.2.0 && git push --tags`), файлы ещё и прикрепятся к GitHub Release.

Иконка лежит в `build/icon.png` и `build/icon.ico` — замени на свою (PNG 512×512 и ICO с размерами до 256).
Название exe и установщика — в `package.json` → `name`, `productName`, `build.appId`.

> Windows SmartScreen покажет «Система Windows защитила ваш компьютер» — так бывает со всеми неподписанными программами.
> Игроку нужно нажать «Подробнее → Выполнить в любом случае». Убрать это можно только платным сертификатом подписи кода.

## Автообновление лаунчера

1. Подними версию в `package.json` (например, `0.2.0`) и собери новый установщик.
2. Выложи установщик (например, в GitHub Releases) и рядом JSON — образец в `examples/updates.json`.
3. В `launcher.config.json` → `updates.url` укажи ссылку на этот JSON (в той версии, что уже у игроков).

Лаунчер при запуске сравнит версии и покажет плашку «Доступна новая версия». На Windows установленная версия
скачает установщик через менеджер загрузок и тихо обновится; portable-версия и другие ОС откроют страницу загрузки.

## Как сделать из каркаса свой лаунчер

1. Скопируй папку проекта (например, `zero-launcher`).
2. Поменяй `launcher.config.json` — это главный файл кастомизации.
3. Поменяй `name`, `productName`, `build.appId` в `package.json`.
4. Если нужно глубже — правь `src/renderer/css/*.css` и страницы в `src/renderer/js/pages/`.

### launcher.config.json

| Поле | Зачем |
|---|---|
| `id`, `name` | Идентификатор и название в окне. Версия лаунчера берётся из `package.json` |
| `dataDirName` | Имя папки данных (`%APPDATA%/<dataDirName>` на Windows) — у разных лаунчеров должны отличаться |
| `launcherBrand` | Что видит игра в `${launcher_name}` |
| `theme` | Цвета: `accent`, `accentText`, `bg`, `panel`, `panel2`, `text`, `muted`, `radius`, `background` (URL картинки для главной) |
| `microsoft.clientId` | Azure client id для входа через Microsoft (см. ниже) |
| `curseforge.apiKey` | Ключ CurseForge (можно не задавать — игрок введёт в настройках) |
| `content.modrinth` / `content.curseforge` | Включить/выключить источники каталога |
| `features` | `customInstances`, `offlineAccounts`, `microsoftAccounts`, `catalog`, `console` — что показывать игроку |
| `presets` | Сборки, которые лаунчер создаст сам: `[{ "id": "zero", "manifestUrl": "https://…/manifest.json" }]` |
| `news.url` | JSON со списком новостей `[{ "title", "date", "text", "image", "url" }]` |
| `links` | Ссылки внизу меню: `[{ "title": "Discord", "url": "https://…" }]` |
| `mirrors` | Замена адресов загрузки: `{ "https://libraries.minecraft.net/": "https://my-mirror/libs/" }` |
| `defaults` | Стартовые «конфиги по умолчанию» для новых игроков: `{ "options": { "lang": "ru_ru" }, "servers": [{ "name": "Мой сервер", "ip": "play.example.com" }] }` |
| `updates.url` | Ссылка на JSON с последней версией лаунчера (см. «Автообновление») |

**Пример: лаунчер только для своего сервера.** Отключи `customInstances` и `catalog`, добавь сервер в `presets` —
у игрока будет одна сборка, которая сама обновляется, и кнопка «Играть».

```json
{
  "name": "Нулевая зона",
  "dataDirName": ".zero-zone",
  "theme": { "accent": "#f59e0b", "accentText": "#1a1205" },
  "features": { "customInstances": false, "catalog": false },
  "presets": [{ "id": "zero-zone", "manifestUrl": "https://example.com/zero/manifest.json" }]
}
```

## Сборка для своего сервера (манифест)

Лаунчер скачивает `manifest.json` по ссылке и приводит папку сборки к его состоянию.
Подробно формат описан в [docs/MANIFEST.md](docs/MANIFEST.md), пример — в `examples/server-pack/`.

```bash
# 1. Папка с клиентскими файлами (структура как в .minecraft)
#    pack/mods/*.jar, pack/config/..., pack/options.txt
# 2. Описание сборки — examples/server-pack/pack.json
# 3. Генерация манифеста (sha1 и размеры считаются сами):
npm run manifest -- pack --meta pack.json --out pack/manifest.json
# 4. Залей папку pack на любой статический хостинг и дай ссылку на manifest.json
```

Как синхронизация обращается с файлами:

- файлы из манифеста докачиваются, если отличается sha1;
- в `managedDirs` (по умолчанию `mods`) всё постороннее удаляется — кроме того, что совпадает с `keep` (например, `mods/optifine*.jar`);
- файлы с `"mode": "once"` (например, `options.txt`) кладутся только если их нет — настройки игрока не затираются;
- файл, который убрали из манифеста, удаляется у игроков при следующей синхронизации.

## Конфиги по умолчанию

Вкладка **«Конфиги»** — то, что получает каждая новая сборка:

- **настройки игры** (`options.txt`): язык, громкость по категориям, дальность прорисовки, FOV, графика, FPS, масштаб интерфейса,
  чувствительность мыши, автопрыжок и др. У каждой настройки есть переключатель: выключенные игра оставит по умолчанию;
- **свои строки** `options.txt` — любые ключи, например раскладка клавиш;
- **серверы** в списке «Сетевая игра» (пишутся в `servers.dat`, чужие записи не трогаются);
- **файлы** — конфиги модов, ресурспаки, шейдеры, которые копируются в игровую папку.

Когда применяются: новая сборка — сразу; модпак — после распаковки его файлов; сборка сервера — после первой синхронизации.
Для модпаков и серверов можно выбрать: применять поверх их настроек, только недостающее или не применять.
Кнопка **«Взять из сборки»** забирает настройки из сборки, где ты уже всё настроил; **«Применить ко всем»** — записывает их во все существующие сборки.
В настройках сборки (вкладка «Обслуживание») можно применить конфиги к одной сборке.

## Менеджер загрузок

Все загрузки лаунчера (игра, Java, модлоадеры, моды, модпаки, синхронизация, обновление лаунчера) идут через одну очередь
с общим лимитом потоков (настройка «Потоков загрузки»). Во вкладке **«Загрузки»** видно, какие файлы качаются прямо сейчас,
какие задания выполняются, очередь файлов, скорость и историю. Можно поставить всё на паузу, отменить задание или всё сразу.

## Microsoft вход (лицензия)

Для входа нужен свой **Azure client id**:

1. [portal.azure.com](https://portal.azure.com) → **Microsoft Entra ID → App registrations → New registration**.
2. Supported account types: **Personal Microsoft accounts only**. Redirect URI не нужен.
3. В приложении: **Authentication → Allow public client flows → Yes**.
4. Скопируй **Application (client) ID** в `launcher.config.json → microsoft.clientId`.
5. Новые приложения Mojang должна одобрить для доступа к Minecraft API — подай заявку через форму Microsoft/Mojang
   (ищи «Minecraft API access request for Azure app», ссылка вида `aka.ms/mce-reviewappid`). Пока заявку не одобрили,
   вход дойдёт до шага Minecraft и лаунчер покажет понятную ошибку.

Офлайн-аккаунты работают без этого (для серверов с `online-mode=false`). UUID офлайн-игрока считается так же, как на сервере,
поэтому инвентарь не теряется.

## CurseForge

Ключ бесплатный: [console.curseforge.com](https://console.curseforge.com) → API keys. Укажи его в конфиге или в настройках лаунчера.
Некоторые авторы запрещают скачивание сторонними лаунчерами — такие файлы лаунчер не качает, а показывает список со ссылками.

## Устройство проекта

```
launcher.config.json     ← брендинг и функции
src/
  core/                  ← ядро, чистый Node.js, НЕ зависит от Electron
    index.js             createLauncherCore() — собирает все сервисы
    paths.js             раскладка папки данных
    downloader.js        менеджер загрузок: общая очередь, задания, пауза/отмена, sha1, повторы
    settings.js          глобальные настройки
    minecraft/           versions (манифест, inheritsFrom), rules, libraries, assets, arguments
    java/runtime.js      Java от Mojang + поиск системной
    loaders/             fabric/quilt (meta API), forge/neoforge (установщик + processors)
    auth/                offline, microsoft (device code), accounts (хранилище)
    instances/           сборки, синхронизация по манифесту
    content/             modrinth, curseforge, установка с зависимостями, категории, модпаки
    defaults/            конфиги по умолчанию: options.txt, servers.dat, файлы
    launch/launcher.js   подготовка файлов и запуск процесса игры
    util/                fs, http (+зеркала), zip (свой ридер), nbt, maven, server-ping
  main/                  ← Electron main: окно, IPC, шифрование токенов, автообновление
  preload/preload.js     ← безопасный мост window.launcher (contextIsolation + sandbox)
  renderer/              ← интерфейс без фреймворков (HTML + CSS + JS)
    css/theme.css        переменные темы
    js/app.js            состояние, навигация, прогресс, события
    js/pages/*.js        страницы: home, instances, instance-editor, catalog, downloads, defaults, accounts, settings, console
build/                   иконки приложения (замени на свои)
build-exe.bat            сборка .exe в один клик (Windows)
start-dev.bat            запуск из исходников (Windows)
.github/workflows/       сборка на GitHub Actions
tools/
  cli.js                 ядро из командной строки
  build-manifest.js      генератор манифеста сборки сервера
tests/                   node:test — модульные и сквозные тесты
```

### Ядро как библиотека

```js
const { createLauncherCore } = require('./src/core');
const core = await createLauncherCore({ dataDir: './data', config });
core.on('progress', (p) => console.log(p.text, p.done, p.total));
core.on('game-log', (l) => console.log(l.line));
await core.accounts.addOffline('Steve');
const inst = await core.instances.create({ name: 'Test', minecraft: '1.20.1', loader: { type: 'fabric', version: 'latest' } });
await core.content.install(inst.id, { provider: 'modrinth', projectId: 'sodium' });
await core.launcher.launch(inst.id);
```

События ядра: `progress`, `log`, `game-log`, `game-start`, `game-exit`, `downloads`, `instances-changed`, `settings-changed`, `defaults-changed`.

### Как расширять

- **Новая страница:** создай `src/renderer/js/pages/my.js` с `App.registerPage('my', { title, icon, render(root) {} })` и подключи скрипт в `index.html`.
  Если на странице есть форма — вызови `App.setGuard({ isDirty, save, title })`, и лаунчер сам спросит про несохранённые изменения.
  Плашки-предупреждения: `UI.alert('warn' | 'info' | 'danger', 'текст', { label, onClick })`.
- **Новый вызов из UI:** добавь обработчик в `src/main/ipc.js` (`handle('my:thing', …)`) и метод в `src/preload/preload.js`.
- **Свой модлоадер:** объект `{ id, name, listVersions(mc), install(ctx, mc, version, opts) → versionId }` и `core.loaders.register(...)`.
- **Ещё один каталог:** класс с `search / getProject / getVersions / getVersion` в формате как у `content/modrinth.js`, добавь в `core/index.js`.

### Папка данных

```
<dataDir>/
  settings.json, accounts.json      настройки и аккаунты (токены зашифрованы)
  defaults.json, defaults/files/    конфиги по умолчанию
  versions/ libraries/ assets/      общие файлы игры — качаются один раз для всех сборок
  runtime/                          Java от Mojang
  cache/                            манифесты, установщики, скачанные модпаки
  instances/<id>/instance.json      настройки сборки
  instances/<id>/.minecraft/        игровая папка: mods, config, saves, …
```

Переопределить папку: переменная `LAUNCHER_DATA_DIR`, или положи `portable.txt` рядом с exe — данные будут в `data/` рядом с ним.

## CLI

```bash
node tools/cli.js versions
node tools/cli.js loaders forge 1.20.1
node tools/cli.js create "Мой Forge" --mc 1.20.1 --loader forge
node tools/cli.js offline Majn
node tools/cli.js launch moy-forge --server play.example.com:25565
node tools/cli.js search modrinth jei --instance moy-forge
node tools/cli.js install moy-forge modrinth jei
node tools/cli.js import pack.mrpack
```

## Тесты и что проверено

`npm test` — 30 тестов на `node:test`:

- модульные: rules, maven, слияние версий, библиотеки/нативы, аргументы (новый и старый формат), офлайн-UUID (сверен с Java), токены Forge-процессоров, ZIP, пинг сервера;
- **сквозной запуск**: локальный сервер отдаёт version.json, библиотеки, нативы, ассеты и конфиг логов, а вместо Minecraft запускается Java-класс, который проверяет аргументы, classpath и нативы; плюс установка «Forge» через настоящий installer.jar с процессорами, повторный запуск без сети, переустановка при потере файлов, обработка вылета;
- синхронизация по манифесту, каталог Modrinth/CurseForge с фильтрами, импорт `.mrpack` и CurseForge zip, вход Microsoft — всё на mock-серверах;
- менеджер загрузок (общий лимит потоков, очередь, отмена, пауза), конфиги по умолчанию (options.txt, servers.dat, режимы для модпаков), автообновление.

**Не проверено вживую** (в среде разработки не было доступа к серверам Mojang/Forge/Modrinth): реальное скачивание игры,
реальные установщики Forge/NeoForge, реальный вход Microsoft. Логика повторяет официальные форматы, но первый прогон на своём ПК
стоит сделать на паре версий (например, 1.20.1 Forge и 1.21.1 Fabric). Если что-то упадёт — текст ошибки будет во вкладке «Консоль».

Известные ограничения:
- Forge для 1.7.10–1.12.2 со старым установщиком поддержан по формату, но такие версии капризны — проверь отдельно;
- сборка `.exe` настроена, но в среде разработки её не запускали (не было доступа к npm) — первый `build-exe.bat` прогони у себя;
- вход Microsoft — только через код (device code), без встроенного окна браузера.
