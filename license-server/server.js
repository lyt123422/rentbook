// ============================================================
//  server.js — RentBook 授权服务（激活码 + 设备数限制 + Creem 自动发码）
//  依赖：postgres（云库）+ node:sqlite（本地文件回退）
//
//  db.js 数据层支持 Postgres（Supabase）与本地 SQLite 文件双模式：
//  配置 DATABASE_URL 走云库（容器重启数据不丢），
//  否则用 DB_PATH 本地文件（适合本机开发；要求 Node >= 23.4）
//
//  环境变量：
//    PORT         监听端口，默认 8787；设为 0 表示随机端口（测试用）
//    DB_PATH      SQLite 文件路径，默认 ./amzinsight.db（仅本地文件模式）
//    DATABASE_URL Postgres 连接串（Supabase Transaction Pooler，6543 端口）
//    ADMIN_TOKEN  管理接口口令（必填，长随机串）
//    TRIAL_LIMIT  免费试用次数，默认 3
//    RATE_LIMIT   每 IP 每分钟请求数上限，默认 60
//    CREEM_WEBHOOK_SECRET  Creem 收款回调验签密钥（可选；
//                          配置后 /v1/webhook/creem 与 /v1/keys/:order_id 生效，
//                          实现海外支付 → 自动发激活码）
//
//  安全说明：API 响应统一 application/json + nosniff 且不回显请求字段；
//  落地页为编译期内嵌常量（pages.js），运行时零文件读取；
//  数据层全部使用参数绑定语句。
// ============================================================
'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const { Store } = require('./db');
const { generateKey, isValidKeyFormat } = require('./keys');
const { INDEX_HTML, UPGRADE_HTML, PRIVACY_HTML, THANKS_HTML } = require('./pages');

// ── 配置 ──────────────────────────────────────────────────
const PORT        = parseInt(process.env.PORT || '8787', 10);
const DB_PATH     = process.env.DB_PATH || './amzinsight.db';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const TRIAL_LIMIT = Math.max(0, parseInt(process.env.TRIAL_LIMIT || '3', 10));
const RATE_LIMIT  = Math.max(1, parseInt(process.env.RATE_LIMIT || '60', 10));
// Creem webhook 验签密钥：优先读数据库 app_config（可在不重启的情况下更新），回退到环境变量
const CREEM_WEBHOOK_SECRET = process.env.CREEM_WEBHOOK_SECRET || '';
let CREEM_SECRET_OVERRIDE = '';
// Postgres 云数据库：配置了 DATABASE_URL 就走云库（数据持久不随容器重启丢失），
// 否则退回 node:sqlite 本地文件
const DATABASE_URL = process.env.DATABASE_URL || '';

if (!ADMIN_TOKEN) {
  console.error('[启动失败] 必须设置 ADMIN_TOKEN 环境变量（管理接口口令，请用长随机串）');
  process.exit(1);
}

const store = new Store(
  DATABASE_URL
    ? { url: DATABASE_URL }
    : { file: DB_PATH.replace(/\\/g, '/') }
);

// ── 简易固定窗口限流（单进程内存版，够用；多实例部署需换 Redis）──
const rateBuckets = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const windowStart = now - (now % 60000);
  const b = rateBuckets.get(ip);
  if (!b || b.windowStart !== windowStart) {
    rateBuckets.set(ip, { windowStart, count: 1 });
    return false;
  }
  b.count += 1;
  return b.count > RATE_LIMIT;
}
// 定期清理，防止 Map 无限增长
setInterval(() => {
  const cutoff = Date.now() - 120000;
  for (const [ip, b] of rateBuckets) {
    if (b.windowStart < cutoff) rateBuckets.delete(ip);
  }
}, 120000).unref();

// ── 工具函数 ──────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 响应统一出口：固定 application/json + nosniff + CORS，杜绝内容嗅探
function sendJson(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-admin-token',
  });
  res.write(JSON.stringify(obj));
  res.end();
}

function readJsonBody(req) {
  return readRawBody(req).then((raw) => {
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch (e) {
      throw new Error('bad_json');
    }
  });
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 65536) { // 请求体上限 64KB，足够且防滥用
        reject(new Error('body_too_large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

/** Creem webhook 验签：creem-signature = HMAC-SHA256(rawBody, secret) 的 hex */
function creemSignatureOk(raw, given) {
  const secret = CREEM_SECRET_OVERRIDE || CREEM_WEBHOOK_SECRET;
  if (!secret || typeof given !== 'string') return false;
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const a = Buffer.from(expected.toLowerCase());
  const b = Buffer.from(String(given).trim().toLowerCase());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Creem webhook 的发货逻辑：验签已在路由层完成，这里只做解析与入库。
 * checkout.completed → 生成激活码并登记订单；refund.created → 吊销对应激活码。
 * 异常只记日志：Creem 对失败投递按 30s/1m/5m/1h 重试，配合订单号幂等不会重复发码
 */
async function fulfillCreemOrder(raw) {
  // 捕获原始报文（Creem 2.0 迁移后格式待实证，先落库供核对；限制 8KB 防滥用）
  try {
    await store.prepare(
      "INSERT INTO app_config (key, value) VALUES ('last_webhook_raw', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value"
    ).run(String(raw).slice(0, 8192));
  } catch (e) { /* 捕获失败不影响主流程 */ }

  let evt;
  try { evt = JSON.parse(raw); } catch (e) { return; }
  // 兼容两种事件名字段（1.0: eventType；2.0: meta.event_name）
  const eventType = evt.eventType || (evt.meta && evt.meta.event_name) || '';
  const obj = evt.object || evt.data || {};
  // 订单号解析：1.0 形态 obj.order.id 优先；2.0 形态 data.id / attributes.order_id 兜底
  const orderId = (obj.order && typeof obj.order.id === 'string' ? obj.order.id : '') ||
    (typeof obj.id === 'string' && obj.id) ||
    (obj.attributes && typeof obj.attributes.order_id !== 'undefined' ? String(obj.attributes.order_id) : '');
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(orderId)) return;

  if (/checkout\.completed/i.test(eventType)) {
    if (await store.getOrder(orderId)) return; // 同一订单重复投递，直接跳过
    const email = (obj.customer && obj.customer.email) || (obj.attributes && obj.attributes.customer_email) || '';
    const clean = (s) => String(s).replace(/[^ -~]/g, ' ').slice(0, 200); // 入库前只保留可打印 ASCII
    // 优先采用 Creem 原生许可证（商品启用了 license key 交付，客户邮箱收到的是它）
    const payloadKey =
      (obj.license_key && typeof obj.license_key === 'object' && obj.license_key.key) ||
      (obj.attributes && obj.attributes.license_key && typeof obj.attributes.license_key === 'object' ? obj.attributes.license_key.key : null) ||
      (evt.data && evt.data.attributes && evt.data.attributes.license_key && evt.data.attributes.license_key.key) || null;
    const key = payloadKey || generateKey();
    await store.createLicense(key, clean('creem ' + orderId + ' ' + email), 3);
    await store.createOrder(orderId, key, clean(email));
  } else if (/refund/i.test(eventType)) {
    const order = await store.getOrder(orderId);
    if (order) await store.revokeLicense(order.license_key);
  }
}

function adminOk(req) {
  const given = String(req.headers['x-admin-token'] || '');
  const a = Buffer.from(given);
  const b = Buffer.from(ADMIN_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** installId / licenseKey 的合法性检查，不合法直接 400。
 *  key 格式兼容两种来源：AMZ-XXXX-XXXX-XXXX（手动铸码）与
 *  Lemon Squeezy 自动发码（UUID 风格，长短不一）——统一放宽为字母数字连字符 10~100 位 */
function validIdentifiers(body, { requireLicense = false } = {}) {
  const GENERIC_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9-]{9,99}$/;
  if (!UUID_RE.test(body.installId || '')) return false;
  if (requireLicense && !(isValidKeyFormat(body.licenseKey) || GENERIC_KEY_RE.test(body.licenseKey))) return false;
  if (body.licenseKey != null && body.licenseKey !== '' && !(isValidKeyFormat(body.licenseKey) || GENERIC_KEY_RE.test(body.licenseKey))) return false;
  return true;
}

/**
 * licenseKey 有效、未吊销、且该 installId 确实在此码上激活过 → 视为 PRO。
 * 只看码本身有效是不够的：激活码会泄露/被分享，不校验绑定关系的话
 * maxDevices（默认 3 台）就只在 /v1/activate 那一刻生效。
 */
async function isProLicense(licenseKey, installId) {
  if (!licenseKey || !installId) return false;
  return store.hasActivation(licenseKey, installId);
}

// ── 落地页（字面量逐一比对 → 返回内嵌常量，运行时零文件读取）──
function servePage(res, pathname) {
  let html = null;
  if (pathname === '/') html = INDEX_HTML;
  else if (pathname === '/index.html') html = INDEX_HTML;
  else if (pathname === '/upgrade.html') html = UPGRADE_HTML;
  else if (pathname === '/privacy.html') html = PRIVACY_HTML;
  else if (pathname === '/thanks.html') html = THANKS_HTML;

  if (html === null) return false;
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-cache',
  });
  res.end(html);
  return true;
}

// ── 路由（所有响应只含服务端生成的值，不回显请求字段）──
async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const path = url.pathname;
  const method = req.method;

  // 等数据层建表完成（首次启动时执行）
  await store.ready;
try { const v = await store.getConfig('creem_webhook_secret'); if (v) { CREEM_SECRET_OVERRIDE = v; console.log('[creem] 签名密钥已从数据库加载'); } } catch (e) { /* 配置缺失用环境变量 */ }

  // 浏览器跨域预检
  if (method === 'OPTIONS') {
    return sendJson(res, 204, {});
  }

  // 落地页：/ /upgrade.html /privacy.html
  if (method === 'GET' && servePage(res, path)) {
    return;
  }

  if (method === 'GET' && path === '/health') {
    return sendJson(res, 200, { ok: true, service: 'amz-insight-server', time: new Date().toISOString() });
  }

  // ── 插件侧接口 ──
  if (method === 'POST' && (path === '/v1/status' || path === '/v1/consume')) {
    const body = await readJsonBody(req);
    if (!validIdentifiers(body)) {
      return sendJson(res, 400, { error: 'invalid_params', detail: 'installId 必须是 UUID，licenseKey 须符合 AMZ-XXXX-XXXX-XXXX 格式' });
    }

    const installId = body.installId;
    const licenseKey = body.licenseKey || '';

    if (await isProLicense(licenseKey, installId)) {
      if (path === '/v1/consume') return sendJson(res, 200, { mode: 'pro', allowed: true });
      return sendJson(res, 200, { mode: 'pro' });
    }

    if (path === '/v1/status') {
      return sendJson(res, 200, { mode: 'trial', used: await store.trialStatus(installId), limit: TRIAL_LIMIT });
    }

    const result = await store.consumeTrial(installId, TRIAL_LIMIT);
    return sendJson(res, 200, { mode: 'trial', allowed: result.allowed, used: result.used, limit: result.limit });
  }

  if (method === 'POST' && path === '/v1/refund') {
    // 分析失败时退还一次试用额度；只有扣减过正数额度才生效，幂等且不会减到负数
    const body = await readJsonBody(req);
    if (!validIdentifiers(body)) {
      return sendJson(res, 400, { error: 'invalid_params', detail: 'installId 必须是 UUID' });
    }
    const used = await store.refundUsage(body.installId);
    return sendJson(res, 200, { ok: true, used });
  }

  if (method === 'POST' && path === '/v1/activate') {
    const body = await readJsonBody(req);
    if (!validIdentifiers(body, { requireLicense: true })) {
      return sendJson(res, 400, { error: 'invalid_params', detail: '需要合法的 licenseKey 与 installId' });
    }
    const result = await store.activate(body.licenseKey, body.installId);
    if (result.error === 'key_not_found') return sendJson(res, 404, { error: 'key_not_found', detail: '激活码不存在' });
    if (result.error === 'revoked')       return sendJson(res, 410, { error: 'revoked', detail: '激活码已被吊销' });
    if (result.error === 'device_limit')  return sendJson(res, 409, { error: 'device_limit', detail: '设备数已达上限', maxDevices: result.maxDevices });
    return sendJson(res, 200, { ok: true, mode: 'pro' });
  }

  if (method === 'GET' && path.startsWith('/v1/keys/')) {
    const orderId = path.slice('/v1/keys/'.length);
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(orderId)) {
      return sendJson(res, 400, { error: 'invalid_order_id' });
    }
    const licenseKey = await store.keyForOrder(orderId);
    if (!licenseKey) {
      return sendJson(res, 404, { error: 'not_found', detail: '订单尚未处理或不存在，请稍后刷新' });
    }
    return sendJson(res, 200, { key: licenseKey });
  }

  // ── Creem 自动发码 webhook ──
  if (method === 'POST' && path === '/v1/webhook/creem') {
    if (!(CREEM_SECRET_OVERRIDE || CREEM_WEBHOOK_SECRET)) return sendJson(res, 503, { error: 'webhook_not_configured' });
    const raw = await readRawBody(req);
    if (!creemSignatureOk(raw, req.headers['creem-signature'])) {
      return sendJson(res, 401, { error: 'invalid_signature' });
    }
    // 验签通过即确认收到（响应体只有常量），发码在响应之后执行：
    // 处理若失败，Creem 按 30s/1m/5m/1h 重投，配合订单号幂等兜底
    sendJson(res, 200, { received: true });
    setImmediate(() => {
      fulfillCreemOrder(raw).catch((e) => console.error('[creem webhook]', e.message));
    });
    return;
  }

  // ── 管理接口（需 x-admin-token）──
  if (path.startsWith('/v1/admin/')) {
    if (!adminOk(req)) return sendJson(res, 401, { error: 'unauthorized' });

    if (method === 'POST' && path === '/v1/admin/keys') {
      const body = await readJsonBody(req);
      const count = Math.max(1, Math.min(100, parseInt(body.count, 10) || 1));
      const maxDevices = Math.max(1, Math.min(50, parseInt(body.maxDevices, 10) || 3));
      const note = typeof body.note === 'string' ? body.note.slice(0, 200) : '';
      const keys = [];
      for (let i = 0; i < count; i++) {
        const key = generateKey();
        await store.createLicense(key, note, maxDevices);
        keys.push(key);
      }
      return sendJson(res, 200, { keys, count: keys.length, maxDevices });
    }

    if (method === 'GET' && path === '/v1/admin/keys') {
      return sendJson(res, 200, { licenses: await store.listLicenses() });
    }

    if (method === 'POST' && path === '/v1/admin/revoke') {
      const body = await readJsonBody(req);
      if (!isValidKeyFormat(body.licenseKey)) return sendJson(res, 400, { error: 'invalid_params' });
      const lic = await store.getLicense(body.licenseKey);
      if (!lic) return sendJson(res, 404, { error: 'key_not_found' });
      await store.revokeLicense(body.licenseKey);
      return sendJson(res, 200, { ok: true });
    }
  }

  return sendJson(res, 404, { error: 'not_found' });
}

// ── HTTP 服务 ─────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const ip = req.socket.remoteAddress || 'unknown';
  Promise.resolve()
    .then(() => {
      if (isRateLimited(ip)) return sendJson(res, 429, { error: 'rate_limited', detail: '请求太频繁，请稍后再试' });
      return handle(req, res);
    })
    .catch((err) => {
      if (err.message === 'bad_json')       return sendJson(res, 400, { error: 'bad_json' });
      if (err.message === 'body_too_large') return sendJson(res, 413, { error: 'body_too_large' });
      console.error('[500]', req.method, req.url, err);
      if (!res.headersSent) return sendJson(res, 500, { error: 'internal_error' });
    });
});

// ── 启动（被 require 时不自动监听，便于测试进程内复用）──
if (require.main === module) {
  server.listen(PORT, () => {
    const port = server.address().port;
    console.log(`LISTENING ${port}`);
    console.log(`授权服务已启动: http://localhost:${port}  (trial=${TRIAL_LIMIT}, admin 接口已开启)`);
  });
}

module.exports = { server, store };
