'use strict';

/** Выполняет worker(item) для всех items, не больше `limit` одновременно. Первая ошибка прерывает очередь. */
async function runPool(items, limit, worker) {
  let index = 0;
  let failed = null;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (!failed && index < items.length) {
      const i = index++;
      try { await worker(items[i], i); } catch (e) { failed = failed || e; }
    }
  });
  await Promise.all(runners);
  if (failed) throw failed;
}

module.exports = { runPool };
