/**
 * EnergySight REST API — Практична робота №4
 * Node.js + вбудований http (без npm-залежностей)
 *
 * Ендпоінти:
 *   GET    /api/objects                  — список об'єктів
 *   GET    /api/objects/:id              — один об'єкт
 *   GET    /api/objects/:id/parameters   — параметри (потужність, напруга тощо)
 *   POST   /api/objects/:id/parameters   — додати запис параметрів
 *   GET    /api/objects/:id/history      — історія вимірювань
 *   DELETE /api/objects/:id/history      — очистити історію
 *   GET    /api/objects/:id/export.csv   — CSV-дамп параметрів
 *   GET    /api/health                   — перевірка стану сервера
 *
 * Запуск: node server.js
 * Порт:   3002
 */

'use strict';

const http = require('http');
const url  = require('url');
const fs   = require('fs');
const path = require('path');

const PORT = 3002;

// ════════════════════════════════════════════
//  IN-MEMORY БАЗА ДАНИХ
// ════════════════════════════════════════════

/** Довідник об'єктів */
const OBJECTS = {
  1: {
    id: 1,
    name: 'ТЕС «Придніпровська»',
    type: 'thermal',
    location: 'м. Дніпро',
    nominalPowerMW: 900,
    voltageKV: 220,
    commissionYear: 1954,
    status: 'operating',
  },
  2: {
    id: 2,
    name: 'ГЕС «Дніпровська»',
    type: 'hydro',
    location: 'м. Запоріжжя',
    nominalPowerMW: 651.5,
    voltageKV: 154,
    commissionYear: 1932,
    status: 'operating',
  },
  3: {
    id: 3,
    name: 'СЕС «Херсонська»',
    type: 'solar',
    location: 'Херсонська обл.',
    nominalPowerMW: 200,
    voltageKV: 35,
    commissionYear: 2020,
    status: 'operating',
  },
  4: {
    id: 4,
    name: 'ВЕС «Очаківська»',
    type: 'wind',
    location: 'Миколаївська обл.',
    nominalPowerMW: 150,
    voltageKV: 35,
    commissionYear: 2018,
    status: 'maintenance',
  },
};

/** Параметри вимірювань: { [objectId]: [ {id, ts, power, voltage, current, frequency, loadPercent} ] } */
const parameters = {};
let nextParamId = 1;

/** Генеруємо початкові дані */
function seedData() {
  const now = Date.now();
  for (const id of Object.keys(OBJECTS)) {
    parameters[id] = [];
    const obj = OBJECTS[id];
    for (let i = 29; i >= 0; i--) {
      const ts = new Date(now - i * 120_000).toISOString(); // кожні 2 хв
      const load = 0.55 + Math.random() * 0.35;
      parameters[id].push({
        id:          nextParamId++,
        objectId:    +id,
        timestamp:   ts,
        powerMW:     +(obj.nominalPowerMW * load).toFixed(2),
        voltageKV:   +(obj.voltageKV * (0.97 + Math.random() * 0.06)).toFixed(2),
        currentKA:   +(obj.nominalPowerMW * load / obj.voltageKV / Math.sqrt(3) * 0.001).toFixed(4),
        frequencyHz: +(49.95 + Math.random() * 0.10).toFixed(3),
        loadPercent: +(load * 100).toFixed(1),
      });
    }
  }
}

seedData();

// ════════════════════════════════════════════
//  HTTP-УТИЛІТИ
// ════════════════════════════════════════════

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJSON(res, data, status = 200) {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data, null, 2));
}

function sendError(res, status, message, details = null) {
  sendJSON(res, {
    error:   { code: status, message, ...(details ? { details } : {}) },
    timestamp: new Date().toISOString(),
  }, status);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; if (raw.length > 1e5) req.destroy(); });
    req.on('end',  () => {
      try   { resolve(raw ? JSON.parse(raw) : {}); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

/** Об'єкт метаданих відповіді */
function meta(total = null) {
  return {
    apiVersion: '1.0',
    timestamp: new Date().toISOString(),
    ...(total !== null ? { total } : {}),
  };
}

// ════════════════════════════════════════════
//  ВАЛІДАЦІЯ ПАРАМЕТРІВ (POST)
// ════════════════════════════════════════════

function validateParams(body, obj) {
  const errors = [];
  const { powerMW, voltageKV, currentKA, frequencyHz, loadPercent } = body;

  if (powerMW === undefined) errors.push('powerMW is required');
  else if (typeof powerMW !== 'number' || powerMW < 0 || powerMW > obj.nominalPowerMW * 1.1)
    errors.push(`powerMW must be a number in [0, ${obj.nominalPowerMW * 1.1}]`);

  if (voltageKV !== undefined && (typeof voltageKV !== 'number' || voltageKV < 0))
    errors.push('voltageKV must be a non-negative number');

  if (frequencyHz !== undefined && (typeof frequencyHz !== 'number' || frequencyHz < 45 || frequencyHz > 55))
    errors.push('frequencyHz must be in [45, 55]');

  if (loadPercent !== undefined && (typeof loadPercent !== 'number' || loadPercent < 0 || loadPercent > 110))
    errors.push('loadPercent must be in [0, 110]');

  return errors;
}

// ════════════════════════════════════════════
//  РОУТЕР
// ════════════════════════════════════════════

async function router(req, res) {
  if (req.method === 'OPTIONS') {
    cors(res);
    res.writeHead(204);
    return res.end();
  }

  const parsed   = url.parse(req.url, true);
  const pathname = parsed.pathname.replace(/\/+$/, ''); // trim trailing slash
  const query    = parsed.query;
  const parts    = pathname.split('/').filter(Boolean); // ['api', 'objects', '1', 'parameters']
  const method   = req.method;

  // ── GET /api/health ─────────────────────────────────
  if (method === 'GET' && pathname === '/api/health') {
    return sendJSON(res, {
      status:  'ok',
      uptime:  Math.round(process.uptime()),
      objects: Object.keys(OBJECTS).length,
      ...meta(),
    });
  }

  // ── GET /api/objects ────────────────────────────────
  if (method === 'GET' && pathname === '/api/objects') {
    const list = Object.values(OBJECTS).map(o => ({
      ...o,
      paramCount: (parameters[o.id] || []).length,
    }));
    return sendJSON(res, { data: list, ...meta(list.length) });
  }

  // ── GET /api/objects/:id ─────────────────────────────
  if (method === 'GET' && parts.length === 3 && parts[0] === 'api' && parts[1] === 'objects') {
    const id = parts[2];
    const obj = OBJECTS[id];
    if (!obj) return sendError(res, 404, `Object ${id} not found`);
    const params = parameters[id] || [];
    const last   = params[params.length - 1] || null;
    return sendJSON(res, { data: { ...obj, lastMeasurement: last }, ...meta() });
  }

  // ── GET /api/objects/:id/parameters ─────────────────
  if (method === 'GET' && parts[3] === 'parameters') {
    const id = parts[2];
    if (!OBJECTS[id]) return sendError(res, 404, `Object ${id} not found`);
    const list = parameters[id] || [];

    // Фільтр за діапазоном дат
    let result = list;
    if (query.from) {
      const from = new Date(query.from);
      if (isNaN(from)) return sendError(res, 400, 'Invalid "from" date');
      result = result.filter(p => new Date(p.timestamp) >= from);
    }
    if (query.to) {
      const to = new Date(query.to);
      if (isNaN(to)) return sendError(res, 400, 'Invalid "to" date');
      result = result.filter(p => new Date(p.timestamp) <= to);
    }
    // Ліміт
    const limit = parseInt(query.limit) || 100;
    result = result.slice(-Math.min(limit, 500));

    return sendJSON(res, { data: result, ...meta(result.length) });
  }

  // ── POST /api/objects/:id/parameters ────────────────
  if (method === 'POST' && parts[3] === 'parameters') {
    const id = parts[2];
    const obj = OBJECTS[id];
    if (!obj) return sendError(res, 404, `Object ${id} not found`);

    let body;
    try   { body = await readBody(req); }
    catch { return sendError(res, 400, 'Invalid JSON body'); }

    const errors = validateParams(body, obj);
    if (errors.length) return sendError(res, 422, 'Validation failed', errors);

    const record = {
      id:          nextParamId++,
      objectId:    +id,
      timestamp:   body.timestamp || new Date().toISOString(),
      powerMW:     +body.powerMW.toFixed(2),
      voltageKV:   body.voltageKV   !== undefined ? +body.voltageKV.toFixed(2)   : null,
      currentKA:   body.currentKA   !== undefined ? +body.currentKA.toFixed(4)   : null,
      frequencyHz: body.frequencyHz !== undefined ? +body.frequencyHz.toFixed(3) : null,
      loadPercent: body.loadPercent !== undefined ? +body.loadPercent.toFixed(1) : null,
    };

    if (!parameters[id]) parameters[id] = [];
    parameters[id].push(record);

    return sendJSON(res, { data: record, ...meta() }, 201);
  }

  // ── GET /api/objects/:id/history ─────────────────────
  if (method === 'GET' && parts[3] === 'history') {
    const id = parts[2];
    if (!OBJECTS[id]) return sendError(res, 404, `Object ${id} not found`);
    const list = (parameters[id] || []).slice(-60);
    // Агрегована статистика
    const powers = list.map(p => p.powerMW);
    const avg = arr => arr.length ? +(arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(2) : null;
    const stats = {
      count:   list.length,
      avgPowerMW: avg(powers),
      maxPowerMW: powers.length ? +(Math.max(...powers)).toFixed(2) : null,
      minPowerMW: powers.length ? +(Math.min(...powers)).toFixed(2) : null,
    };
    return sendJSON(res, { data: list, stats, ...meta(list.length) });
  }

  // ── DELETE /api/objects/:id/history ──────────────────
  if (method === 'DELETE' && parts[3] === 'history') {
    const id = parts[2];
    if (!OBJECTS[id]) return sendError(res, 404, `Object ${id} not found`);
    const deleted = (parameters[id] || []).length;
    parameters[id] = [];
    return sendJSON(res, { message: `Deleted ${deleted} records`, ...meta() });
  }

  // ── GET /api/objects/:id/export.csv ──────────────────
  if (method === 'GET' && parts[3] === 'export.csv') {
    const id = parts[2];
    if (!OBJECTS[id]) { res.writeHead(404); return res.end('Not found'); }
    const limit = Math.min(500, parseInt(query.limit) || 200);
    const rows  = (parameters[id] || []).slice(-limit);
    const bom   = '\uFEFF';
    const header = 'ID,ObjectID,Час,Потужність (МВт),Напруга (кВ),Струм (кА),Частота (Гц),Завантаженість (%)\r\n';
    const body   = rows.map(r =>
      `${r.id},${r.objectId},${r.timestamp},${r.powerMW},${r.voltageKV ?? ''},${r.currentKA ?? ''},${r.frequencyHz ?? ''},${r.loadPercent ?? ''}`
    ).join('\r\n');
    const csv = bom + header + body;
    cors(res);
    res.writeHead(200, {
      'Content-Type':        'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="object${id}_${new Date().toISOString().slice(0,10)}.csv"`,
    });
    return res.end(csv);
  }

  // ── Serve index.html ──────────────────────────────────
  if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    try {
      const html = fs.readFileSync(path.join(__dirname, '..', 'client', 'index.html'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    } catch {
      return sendError(res, 500, 'index.html not found');
    }
  }

  sendError(res, 404, `Route not found: ${method} ${pathname}`);
}

// ════════════════════════════════════════════
//  ЗАПУСК СЕРВЕРА
// ════════════════════════════════════════════

const server = http.createServer(async (req, res) => {
  const start = Date.now();
  try {
    await router(req, res);
  } catch (err) {
    console.error('[ERROR]', err.message);
    sendError(res, 500, 'Internal server error');
  }
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} → ${res.statusCode} (${Date.now() - start}ms)`);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║     EnergySight REST API v1.0        ║');
  console.log('╠══════════════════════════════════════╣');
  console.log(`║  http://localhost:${PORT}/api/objects    ║`);
  console.log(`║  http://localhost:${PORT}/api/health     ║`);
  console.log('╚══════════════════════════════════════╝\n');
  console.log('Ендпоінти:');
  console.log('  GET  /api/health');
  console.log('  GET  /api/objects');
  console.log('  GET  /api/objects/:id');
  console.log('  GET  /api/objects/:id/parameters[?limit=&from=&to=]');
  console.log('  POST /api/objects/:id/parameters');
  console.log('  GET  /api/objects/:id/history');
  console.log('  DEL  /api/objects/:id/history');
  console.log('  GET  /api/objects/:id/export.csv\n');
});
