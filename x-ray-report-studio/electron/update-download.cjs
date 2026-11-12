const https = require('node:https');

function downloadHttps(url, limit, redirects = 0, onProgress = () => {}, get = https.get) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Слишком много перенаправлений при загрузке обновления.'));
    let target;
    try { target = new URL(url); } catch { return reject(new Error('Недопустимый источник обновления.')); }
    if (target.protocol !== 'https:' || !['raw.githubusercontent.com', 'github.com', 'objects.githubusercontent.com'].includes(target.hostname)
        || target.username || target.password) return reject(new Error('Недопустимый источник обновления.'));
    const request = get(target, { timeout: 30000, headers: { 'User-Agent': 'MRI-Report-Studio-Updater', 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' } }, response => {
      if ([301,302,303,307,308].includes(response.statusCode) && response.headers.location) {
        response.resume(); return resolve(downloadHttps(new URL(response.headers.location, target).toString(), limit, redirects + 1, onProgress, get));
      }
      if (response.statusCode !== 200) { response.resume(); return reject(new Error(`Сервер обновлений ответил ${response.statusCode}.`)); }
      const chunks = []; let total = 0, done = false;
      const expected = Number(response.headers['content-length']) || 0;
      if (expected > limit) { response.resume(); request.destroy(new Error('Файл обновления больше допустимого размера.')); return; }
      onProgress({ loaded: 0, total: expected, percent: expected ? 0 : null });
      response.on('data', chunk => {
        total += chunk.length;
        if (total > limit) request.destroy(new Error('Файл обновления больше допустимого размера.'));
        else { chunks.push(chunk); onProgress({ loaded: total, total: expected, percent: expected ? Math.min(100, Math.round(total / expected * 100)) : null }); }
      });
      response.on('error', reject);
      response.on('end', () => {
        done = true;
        if (expected && total !== expected) reject(new Error('Загрузка обновления завершилась не полностью.'));
        else resolve(Buffer.concat(chunks));
      });
      response.on('close', () => { if (!done) reject(new Error('Соединение прервано до завершения загрузки.')); });
    });
    request.on('timeout', () => request.destroy(new Error('Время ожидания сервера обновлений истекло.')));
    request.on('error', reject);
  });
}

module.exports = { downloadHttps };
