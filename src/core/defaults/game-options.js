'use strict';
// Описание настроек options.txt, которые можно задать «по умолчанию» для новых сборок.
// Значения в UI храним в «человеческом» виде (FOV 70, громкость 0..1), в файл пишем как ждёт игра.

const LANGS = [
  ['ru_ru', 'Русский'], ['en_us', 'English (US)'], ['en_gb', 'English (UK)'], ['uk_ua', 'Українська'], ['be_by', 'Беларуская'],
  ['kk_kz', 'Қазақша'], ['de_de', 'Deutsch'], ['fr_fr', 'Français'], ['es_es', 'Español'], ['pl_pl', 'Polski'],
  ['pt_br', 'Português (Brasil)'], ['tr_tr', 'Türkçe'], ['zh_cn', '简体中文'], ['ja_jp', '日本語'], ['ko_kr', '한국어'],
];

const sound = (key, label) => ({ key, label, group: 'Звук', type: 'percent', min: 0, max: 1, def: 1 });
const bool = (key, label, group, def) => ({ key, label, group, type: 'bool', def });

const GAME_OPTIONS = [
  { key: 'lang', label: 'Язык игры', group: 'Общее', type: 'select', options: LANGS, def: 'en_us' },
  bool('autoJump', 'Автопрыжок', 'Общее', false),
  bool('pauseOnLostFocus', 'Пауза при сворачивании', 'Общее', true),
  { key: 'tutorialStep', label: 'Подсказки обучения', group: 'Общее', type: 'select', options: [['none', 'Не показывать'], ['movement', 'Показывать']], def: 'movement' },
  bool('skipMultiplayerWarning', 'Не показывать предупреждение о сетевой игре', 'Общее', false),
  bool('onboardAccessibility', 'Экран спецвозможностей при первом запуске', 'Общее', true),
  { key: 'narrator', label: 'Экранный диктор', group: 'Общее', type: 'select', options: [[0, 'Выключен'], [1, 'Всё'], [2, 'Только чат'], [3, 'Только интерфейс']], def: 0 },
  { key: 'mouseSensitivity', label: 'Чувствительность мыши', group: 'Управление', type: 'percent', min: 0, max: 1, def: 0.5, scale: 200 },
  bool('invertYMouse', 'Инверсия мыши по Y', 'Управление', false),
  bool('rawMouseInput', 'Прямой ввод мыши', 'Управление', true),
  bool('toggleCrouch', 'Приседание: переключение', 'Управление', false),
  bool('toggleSprint', 'Бег: переключение', 'Управление', false),

  sound('soundCategory_master', 'Общая громкость'),
  sound('soundCategory_music', 'Музыка'),
  sound('soundCategory_record', 'Проигрыватели и нотные блоки'),
  sound('soundCategory_weather', 'Погода'),
  sound('soundCategory_block', 'Блоки'),
  sound('soundCategory_hostile', 'Враждебные существа'),
  sound('soundCategory_neutral', 'Дружелюбные существа'),
  sound('soundCategory_player', 'Игроки'),
  sound('soundCategory_ambient', 'Окружение'),
  sound('soundCategory_voice', 'Голос / речь'),

  { key: 'renderDistance', label: 'Дальность прорисовки', group: 'Графика', type: 'range', min: 2, max: 32, step: 1, def: 12, unit: 'чанков' },
  { key: 'simulationDistance', label: 'Дальность симуляции', group: 'Графика', type: 'range', min: 5, max: 32, step: 1, def: 12, unit: 'чанков' },
  { key: 'graphicsMode', label: 'Качество графики', group: 'Графика', type: 'select', options: [[0, 'Быстрая'], [1, 'Детальная'], [2, 'Потрясающая']], def: 1 },
  { key: 'maxFps', label: 'Макс. FPS', group: 'Графика', type: 'range', min: 10, max: 260, step: 10, def: 120, special: { 260: 'Без ограничения' } },
  bool('enableVsync', 'Вертикальная синхронизация', 'Графика', true),
  { key: 'fov', label: 'Поле зрения (FOV)', group: 'Графика', type: 'range', min: 30, max: 110, step: 1, def: 70, special: { 70: 'Нормальное', 110: 'Quake Pro' } },
  { key: 'guiScale', label: 'Масштаб интерфейса', group: 'Графика', type: 'select', options: [[0, 'Авто'], [1, '1'], [2, '2'], [3, '3'], [4, '4']], def: 0 },
  { key: 'gamma', label: 'Яркость', group: 'Графика', type: 'percent', min: 0, max: 1, def: 0.5, special: { 0: 'Мрачно', 1: 'Ярко' } },
  { key: 'particles', label: 'Частицы', group: 'Графика', type: 'select', options: [[0, 'Все'], [1, 'Уменьшено'], [2, 'Минимум']], def: 0 },
  { key: 'mipmapLevels', label: 'Уровни MIP-текстур', group: 'Графика', type: 'range', min: 0, max: 4, step: 1, def: 4 },
  { key: 'biomeBlendRadius', label: 'Смешивание биомов', group: 'Графика', type: 'range', min: 0, max: 7, step: 1, def: 2 },
  bool('entityShadows', 'Тени сущностей', 'Графика', true),
  bool('fullscreen', 'Полноэкранный режим', 'Графика', false),
  bool('bobView', 'Покачивание камеры', 'Графика', true),
];

const BY_KEY = new Map(GAME_OPTIONS.map((o) => [o.key, o]));

/** Значение из UI -> строки для options.txt { key: 'value', ... } */
function encodeOption(key, value) {
  const o = BY_KEY.get(key);
  if (!o || value === null || value === undefined || value === '') return {};
  if (key === 'fov') return { fov: String(Math.round(((Number(value) - 70) / 40) * 1000) / 1000) };
  if (key === 'graphicsMode') return { graphicsMode: String(value), fancyGraphics: String(Number(value) > 0) }; // fancyGraphics — для версий до 1.16
  if (o.type === 'bool') return { [key]: String(Boolean(value)) };
  return { [key]: String(value) };
}

/** Строка из options.txt -> значение для UI (или undefined, если ключ не наш). */
function decodeOption(key, raw) {
  const o = BY_KEY.get(key);
  if (!o) return undefined;
  const s = String(raw).replace(/^"|"$/g, '');
  if (key === 'fov') return Math.round(70 + parseFloat(s) * 40);
  if (o.type === 'bool') return s === 'true';
  if (o.type === 'percent') return parseFloat(s);
  if (o.type === 'range') return parseInt(s, 10);
  if (o.type === 'select') {
    const num = o.options.some(([v]) => typeof v === 'number');
    return num ? parseInt(s, 10) : s;
  }
  return s;
}

/** options.txt -> Map (порядок строк сохраняется) */
function parseOptionsTxt(text) {
  const map = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const i = line.indexOf(':');
    if (i <= 0) continue;
    map.set(line.slice(0, i), line.slice(i + 1));
  }
  return map;
}

function serializeOptionsTxt(map) {
  return `${[...map].map(([k, v]) => `${k}:${v}`).join('\n')}\n`;
}

/** Свободный текст "key:value" построчно -> объект */
function parseExtra(text) {
  return Object.fromEntries(parseOptionsTxt(text));
}

/** Описание для UI (только данные — передаётся через IPC). */
function schemaForUi() {
  return GAME_OPTIONS;
}

module.exports = { GAME_OPTIONS, encodeOption, decodeOption, parseOptionsTxt, serializeOptionsTxt, parseExtra, schemaForUi, LANGS };
