// ============================================================
//  test/smoke.test.js — 授权服务端到端冒烟测试（进程内启动，无子进程）
//  运行：npm test
// ============================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');

const ADMIN_TOKEN = 'test-admin-token-0123456789';
// 测试用 webhook 密钥：运行时随机生成，源码中不出现任何真实凭据
const WEBHOOK_SECRET = crypto.randomBytes(24).toString('hex');
const KEY_RE = /^AMZ(-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}){3}$/;

let base = '';
let dbPath = '';
let mod;

test.before(async () => {
  dbPath = path.join(os.tmpdir(), `amzinsight-test-${process.pid}-${Date.now()}.db`);
  process.env.DB_PATH = dbPath;
  process.env.ADMIN_TOKEN = ADMIN_TOKEN;
  process.env.TRIAL_LIMIT = '3';
  process.env.RATE_LIMIT = '10000';
  process.env.CREEM_WEBHOOK_SECRET = WEBHOOK_SECRET;

  mod = require('../server.js');
  await new Promise((resolve) => mod.server.listen(0, resolve));
  base = `http://127.0.0.1:${mod.server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => mod.server.close(resolve));
  await mod.store.close();
  try { fs.unlinkSync(dbPath); } catch (e) { /* 忽略 */ }
});

async function post(pathname, body, headers = {}) {
  const resp = await fetch(base + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: resp.status, data: await resp.json().catch(() => ({})) };
}

async function adminPost(pathname, body) {
  return post(pathname, body, { 'x-admin-token': ADMIN_TOKEN });
}

const uuid = () => crypto.randomUUID();

// ── 基础 ──
test('健康检查', async () => {
  const resp = await fetch(base + '/health');
  assert.equal(resp.status, 200);
  const data = await resp.json();
  assert.equal(data.ok, true);
});

test('管理接口拒绝无口令/错口令', async () => {
  const noToken = await post('/v1/admin/keys', { count: 1 });
  assert.equal(noToken.status, 401);
  const wrong = await post('/v1/admin/keys', { count: 1 }, { 'x-admin-token': 'wrong' });
  assert.equal(wrong.status, 401);
});

test('生成激活码：数量正确且格式合法', async () => {
  const r = await adminPost('/v1/admin/keys', { count: 5, note: 'smoke', maxDevices: 3 });
  assert.equal(r.status, 200);
  assert.equal(r.data.keys.length, 5);
  for (const k of r.data.keys) assert.match(k, KEY_RE);
});

test('参数校验：非法 installId / 非法激活码格式返回 400', async () => {
  const badInstall = await post('/v1/consume', { installId: 'not-a-uuid' });
  assert.equal(badInstall.status, 400);
  // 1111/2222 等含被排除字符（0/1/I/O），格式校验应拒绝
  const badKey = await post('/v1/activate', { licenseKey: 'AMZ-1111-2222-3333', installId: uuid() });
  assert.equal(badKey.status, 400);
});

test('免费试用：3 次后拒绝，status 与 consume 一致', async () => {
  const install = uuid();
  for (let i = 1; i <= 3; i++) {
    const r = await post('/v1/consume', { installId: install });
    assert.equal(r.status, 200);
    assert.equal(r.data.mode, 'trial');
    assert.equal(r.data.allowed, true);
    assert.equal(r.data.used, i);
  }
  const denied = await post('/v1/consume', { installId: install });
  assert.equal(denied.data.allowed, false);
  assert.equal(denied.data.used, 3);

  const status = await post('/v1/status', { installId: install });
  assert.equal(status.data.mode, 'trial');
  assert.equal(status.data.used, 3);
  assert.equal(status.data.limit, 3);
});

test('不同安装实例额度互相独立', async () => {
  const a = uuid();
  const b = uuid();
  await post('/v1/consume', { installId: a });
  await post('/v1/consume', { installId: a });
  const rb = await post('/v1/consume', { installId: b });
  assert.equal(rb.data.used, 1);
});

test('refund：AI 失败退还试用额度，幂等且不减到负数', async () => {
  const install = uuid();
  await post('/v1/consume', { installId: install });
  await post('/v1/consume', { installId: install });

  const r = await post('/v1/refund', { installId: install });
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
  assert.equal(r.data.used, 1);

  // 连续退超过消耗数：下限为 0，不出现负数
  for (let i = 0; i < 3; i++) await post('/v1/refund', { installId: install });
  const status = await post('/v1/status', { installId: install });
  assert.equal(status.data.used, 0);

  // 退还后额度恢复可用
  const c = await post('/v1/consume', { installId: install });
  assert.equal(c.data.allowed, true);
  assert.equal(c.data.used, 1);

  // 非法参数
  assert.equal((await post('/v1/refund', { installId: 'not-a-uuid' })).status, 400);
});

// ── 激活码生命周期 ──
test('激活码生命周期：激活→PRO无限→设备上限→吊销→回落试用', async () => {
  const gen = await adminPost('/v1/admin/keys', { count: 1, note: 'lifecycle', maxDevices: 2 });
  const key = gen.data.keys[0];

  // 不存在的码
  const ghost = await post('/v1/activate', { licenseKey: 'AMZ-2222-3333-4444', installId: uuid() });
  assert.equal(ghost.status, 404);

  // 激活 → PRO 无限
  const installP = uuid();
  const act = await post('/v1/activate', { licenseKey: key, installId: installP });
  assert.equal(act.status, 200);
  assert.equal(act.data.mode, 'pro');
  for (let i = 0; i < 5; i++) {
    const c = await post('/v1/consume', { installId: installP, licenseKey: key });
    assert.equal(c.data.mode, 'pro');
    assert.equal(c.data.allowed, true);
  }

  // 同一安装重复激活幂等
  const reactivate = await post('/v1/activate', { licenseKey: key, installId: installP });
  assert.equal(reactivate.status, 200);

  // 绑到第 2 台设备成功，第 3 台被拒（maxDevices=2）
  const dev2 = await post('/v1/activate', { licenseKey: key, installId: uuid() });
  assert.equal(dev2.status, 200);
  const dev3 = await post('/v1/activate', { licenseKey: key, installId: uuid() });
  assert.equal(dev3.status, 409);
  assert.equal(dev3.data.error, 'device_limit');

  // 吊销后：激活 410，consume 回落为该安装的试用额度
  const revoke = await adminPost('/v1/admin/revoke', { licenseKey: key });
  assert.equal(revoke.status, 200);
  const actAfter = await post('/v1/activate', { licenseKey: key, installId: uuid() });
  assert.equal(actAfter.status, 410);
  const consumeAfter = await post('/v1/consume', { installId: installP, licenseKey: key });
  assert.equal(consumeAfter.data.mode, 'trial');
});

test('PRO 权限校验：未在该码上激活的 installId，拿到码也不算 PRO', async () => {
  const gen = await adminPost('/v1/admin/keys', { count: 1, note: 'binding', maxDevices: 3 });
  const key = gen.data.keys[0];
  const stranger = uuid();

  // 从未在这台 installId 上激活过：带着别人的激活码也不应获得 PRO（回落试用）
  const consume = await post('/v1/consume', { installId: stranger, licenseKey: key });
  assert.equal(consume.data.mode, 'trial');
  const status = await post('/v1/status', { installId: stranger, licenseKey: key });
  assert.equal(status.data.mode, 'trial');

  // 自己激活之后，该 installId 才认 PRO
  const act = await post('/v1/activate', { licenseKey: key, installId: stranger });
  assert.equal(act.status, 200);
  const consume2 = await post('/v1/consume', { installId: stranger, licenseKey: key });
  assert.equal(consume2.data.mode, 'pro');
});

test('吊销不存在的码返回 404；列表接口返回记录', async () => {
  const revoke = await adminPost('/v1/admin/revoke', { licenseKey: 'AMZ-2222-3333-4444' });
  assert.equal(revoke.status, 404);

  const list = await fetch(base + '/v1/admin/keys', { headers: { 'x-admin-token': ADMIN_TOKEN } });
  assert.equal(list.status, 200);
  const data = await list.json();
  assert.ok(Array.isArray(data.licenses) && data.licenses.length >= 6);
});

test('未知路由 404；坏 JSON 400', async () => {
  const nf = await fetch(base + '/nope');
  assert.equal(nf.status, 404);
  const bad = await fetch(base + '/v1/consume', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{oops',
  });
  assert.equal(bad.status, 400);
});

test('落地页静态托管：首页/升级页/隐私页可访问，路径穿越被拒', async () => {
  for (const p of ['/', '/upgrade.html', '/privacy.html']) {
    const resp = await fetch(base + p);
    assert.equal(resp.status, 200, `${p} 应返回 200`);
    const html = await resp.text();
    assert.ok(html.includes('<html'), `${p} 应返回 HTML 内容`);
  }
  // 白名单之外的任何文件都不存在静态服务
  const missing = await fetch(base + '/server.js');
  assert.equal(missing.status, 404);
});

// ── Creem webhook 自动发码 ──
function sign(payload) {
  return crypto.createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex');
}

async function postWebhook(eventObj, sig) {
  const payload = JSON.stringify(eventObj);
  const resp = await fetch(base + '/v1/webhook/creem', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'creem-signature': sig ?? sign(payload) },
    body: payload,
  });
  return { status: resp.status, data: await resp.json().catch(() => ({})) };
}

function checkoutEvent(orderId, email) {
  return {
    id: 'evt_' + orderId,
    eventType: 'checkout.completed',
    created_at: Date.now(),
    object: {
      id: 'ch_' + orderId,
      order: { id: orderId, status: 'paid', amount: 4900, currency: 'USD' },
      customer: { id: 'cust_test', email },
      status: 'completed',
      metadata: {},
    },
  };
}

/** 发码在 setImmediate 中异步执行，轮询取码接口直到出码（或超时失败） */
async function waitForKey(orderId, tries = 20) {
  for (let i = 0; i < tries; i++) {
    const resp = await fetch(base + '/v1/keys/' + orderId);
    if (resp.status === 200) return (await resp.json()).key;
    await new Promise((r) => setTimeout(r, 25));
  }
  return null;
}

test('webhook：验签失败返回 401，不发货', async () => {
  const evt = checkoutEvent('ord_sig_fail_000001', 'a@b.c');
  const r = await postWebhook(evt, 'deadbeef'.repeat(8));
  assert.equal(r.status, 401);
  const key = await waitForKey('ord_sig_fail_000001', 2);
  assert.equal(key, null);
});

test('webhook：checkout.completed 自动发码，凭订单号取码，重复投递幂等', async () => {
  const orderId = 'ord_test_000001';
  const r = await postWebhook(checkoutEvent(orderId, 'buyer@example.com'));
  assert.equal(r.status, 200);
  assert.equal(r.data.received, true);

  const key = await waitForKey(orderId);
  assert.ok(key, '应在 webhook 后能取到激活码');
  assert.match(key, KEY_RE);

  // 重复投递同一订单：仍返回成功，且码不变
  const dup = await postWebhook(checkoutEvent(orderId, 'buyer@example.com'));
  assert.equal(dup.status, 200);
  const key2 = await waitForKey(orderId);
  assert.equal(key2, key);

  // 发出的码可以正常激活为 PRO
  const act = await post('/v1/activate', { licenseKey: key, installId: uuid() });
  assert.equal(act.status, 200);
  assert.equal(act.data.mode, 'pro');
});

test('webhook：refund.created 吊销对应激活码', async () => {
  const orderId = 'ord_refund_00001';
  await postWebhook(checkoutEvent(orderId, 'buyer2@example.com'));
  const key = await waitForKey(orderId);
  assert.ok(key);

  const refund = {
    id: 'evt_refund_' + orderId,
    eventType: 'refund.created',
    created_at: Date.now(),
    object: {
      id: 'ref_' + orderId,
      status: 'succeeded',
      order: { id: orderId, status: 'paid' },
      customer: { email: 'buyer2@example.com' },
    },
  };
  const r = await postWebhook(refund);
  assert.equal(r.status, 200);

  // 吊销是异步的，轮询等激活接口返回 410
  let status = 0;
  for (let i = 0; i < 20 && status !== 410; i++) {
    const act = await post('/v1/activate', { licenseKey: key, installId: uuid() });
    status = act.status;
    if (status !== 410) await new Promise((r2) => setTimeout(r2, 25));
  }
  assert.equal(status, 410, '退款后激活码应被吊销');
});

test('取码接口：非法订单号 400，未知订单 404，thanks.html 可访问', async () => {
  const bad = await fetch(base + '/v1/keys/..%2F..%2Fetc');
  assert.equal(bad.status, 400);
  const short = await fetch(base + '/v1/keys/ab');
  assert.equal(short.status, 400);
  const nf = await fetch(base + '/v1/keys/ord_never_seen_99');
  assert.equal(nf.status, 404);

  const page = await fetch(base + '/thanks.html');
  assert.equal(page.status, 200);
  assert.ok((await page.text()).includes('<html'));
});
