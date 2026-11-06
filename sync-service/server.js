/* 点卯 · 云端同步参考服务（零依赖，Node 18+）
 * 用法： node server/sync-server.js            # 默认 http://127.0.0.1:8788
 *        PORT=9000 TOKEN=abc node server/sync-server.js
 * 作用：按 README 的契约接收前端 outbox 队列，落盘到 server/data/ops-YYYY-MM-DD.jsonl
 * 说明：这是最小可用实现，方便你验证链路；生产环境把它换成你自己的后端即可，前端不用改。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8788);
const HOST = process.env.HOST || '0.0.0.0';
const TOKEN = process.env.TOKEN || '';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

fs.mkdirSync(DATA_DIR, { recursive: true });

let cursor = 0;
const LOG = [];           // 最近的操作流，用于把别台设备的改动推给客户端
const LOG_MAX = 4000;

(function initCursor() {
  for (const f of fs.readdirSync(DATA_DIR).sort()) {
    if (!f.endsWith('.jsonl')) continue;
    const lines = fs.readFileSync(path.join(DATA_DIR, f), 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const rec = JSON.parse(line);
        cursor += 1;
        LOG.push({ seq: cursor, ...rec });
      } catch (e) { cursor += 1; }
    }
  }
  if (LOG.length > LOG_MAX) LOG.splice(0, LOG.length - LOG_MAX);
  if (cursor) console.log(`[sync] 已有 ${cursor} 条记录，游标从 ${cursor} 开始`);
})();

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 4 * 1024 * 1024) { reject(new Error('payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch (e) { reject(new Error('invalid json')); }
    });
    req.on('error', reject);
  });
}

/* 有的网关会剥掉 Authorization 头，所以同时支持 ?token= 查询参数 */
function authorized(req, url) {
  if (!TOKEN) return true;
  const fromHeader = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const fromQuery = (url.searchParams.get('token') || '').trim();
  return fromHeader === TOKEN || fromQuery === TOKEN;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Max-Age': '86400'
    });
    return res.end();
  }

  if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/')) {
    return json(res, 200, { ok: true, app: 'dianmao-sync', records: cursor, time: new Date().toISOString() });
  }

  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
  if (!authorized(req, url)) return json(res, 401, { ok: false, error: 'unauthorized' });

  let body;
  try { body = await readBody(req); }
  catch (e) { return json(res, 400, { ok: false, error: e.message }); }

  /* 连通性探测 */
  if (url.pathname.endsWith('/ping')) {
    return json(res, 200, { ok: true, app: 'dianmao-sync', serverTime: Date.now() });
  }

  /* 主同步入口 */
  if (url.pathname.endsWith('/sync')) {
    const ops = Array.isArray(body.ops) ? body.ops : [];
    const now = new Date();
    const file = path.join(DATA_DIR, `ops-${now.toISOString().slice(0, 10)}.jsonl`);
    const incoming = ops.map((op) => ({
      opId: op.opId,
      type: op.type,
      payload: op.payload,
      ts: op.ts,
      client: body.version || '',
      receivedAt: now.toISOString()
    }));

    const acceptedIds = new Set(ops.map((o) => o.opId));
    if (incoming.length) {
      fs.appendFileSync(file, incoming.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
      for (const rec of incoming) {
        cursor += 1;
        LOG.push({ seq: cursor, ...rec });
      }
      if (LOG.length > LOG_MAX) LOG.splice(0, LOG.length - LOG_MAX);
    }

    /* 把客户端游标之后、且不是它刚提交的改动回推过去，实现多端只读同步 */
    const since = Number(body.cursor) || 0;
    const changes = LOG
      .filter((r) => r.seq > since && !acceptedIds.has(r.opId))
      .slice(-200)
      .map((r) => ({ seq: r.seq, opId: r.opId, type: r.type, payload: r.payload, ts: r.ts }));

    console.log(`[sync] +${ops.length} 条  → ${path.basename(file)}  游标 ${cursor}  回推 ${changes.length} 条`);
    return json(res, 200, {
      ok: true,
      accepted: Array.from(acceptedIds),
      cursor,
      changes,
      serverTime: Date.now()
    });
  }

  return json(res, 404, { ok: false, error: 'not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`[sync] 点卯同步服务已启动： http://${HOST}:${PORT}`);
  console.log(`[sync] 数据目录： ${DATA_DIR}${TOKEN ? ' · 已启用 TOKEN 校验' : ' · 未设 TOKEN（仅建议内网使用）'}`);
});
