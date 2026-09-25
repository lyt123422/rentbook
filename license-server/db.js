// ============================================================
//  db.js — 数据层（libSQL/Turso 云数据库；本地回退 file: SQLite）
//  全部语句使用参数绑定（? 占位符），不拼接任何用户输入
// ============================================================
'use strict';

const { createClient } = require('@libsql/client');

// 建表 DDL：纯静态常量，无任何外部输入参与
const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS licenses (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'active', note TEXT NOT NULL DEFAULT '', max_devices INTEGER NOT NULL DEFAULT 3, created_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS activations (license_id INTEGER NOT NULL, install_id TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(license_id, install_id))",
  "CREATE TABLE IF NOT EXISTS usage (install_id TEXT PRIMARY KEY, used INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)",
  // 支付订单 → 激活码 映射（webhook 自动发码用；order_id 即客户取码凭据）
  "CREATE TABLE IF NOT EXISTS orders (order_id TEXT PRIMARY KEY, license_key TEXT NOT NULL, customer_email TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)",
];

class Store {
  /**
   * opts.url       'libsql://xxx.turso.io'（云库）或 'file:./amzinsight.db'（本地文件）
   * opts.authToken 云库的访问令牌；本地文件可省
   */
  constructor(opts) {
    this.db = createClient(opts.authToken ? { url: opts.url, authToken: opts.authToken } : { url: opts.url });
    // 建表异步完成：server.js 在每个请求入口 await store.ready
    this.ready = this.db.batch(SCHEMA.map((ddl) => [ddl, []]), 'write');
  }

  /**
   * libSQL 适配层：保持 prepare/run/get/all 调用形态，
   * 全部走 ? 参数绑定（位置传参，无字符串拼接），云端与本地文件共用同一套语句
   */
  prepare(sql) {
    return {
      run: async (...args) => await this.db.execute(sql, args),
      get: async (...args) => {
        const rs = await this.db.execute(sql, args);
        return rs.rows[0] || null;
      },
      all: async (...args) => {
        const rs = await this.db.execute(sql, args);
        return rs.rows;
      },
    };
  }

  async createLicense(key, note, maxDevices) {
    await this.prepare('INSERT INTO licenses (key, note, max_devices, created_at) VALUES (?, ?, ?, ?)')
      .run(key, note || '', maxDevices || 3, new Date().toISOString());
    return this.getLicense(key);
  }

  async getLicense(key) {
    return await this.prepare('SELECT id, key, status, note, max_devices, created_at FROM licenses WHERE key = ?')
      .get(key);
  }

  async listLicenses() {
    return await this.prepare('SELECT key, status, note, max_devices, created_at FROM licenses ORDER BY id DESC')
      .all();
  }

  async revokeLicense(key) {
    await this.prepare("UPDATE licenses SET status = 'revoked' WHERE key = ?").run(key);
  }

  /**
   * 激活码绑定安装实例（含设备数上限；同一安装重复激活幂等）。
   * 乐观插入 + 插后复核：并发窗口内若超额，自动移除后到的激活
   */
  async activate(key, installId) {
    const lic = await this.getLicense(key);
    if (!lic) return { error: 'key_not_found' };
    if (lic.status !== 'active') return { error: 'revoked' };

    // 同一安装重复激活幂等
    if (await this.hasActivation(key, installId)) return { ok: true };

    const cnt = await this.prepare('SELECT COUNT(*) AS n FROM activations WHERE license_id = ?').get(lic.id);
    if (Number(cnt.n) >= lic.max_devices) {
      return { error: 'device_limit', maxDevices: lic.max_devices };
    }

    try {
      await this.prepare('INSERT INTO activations (license_id, install_id, created_at) VALUES (?, ?, ?)')
        .run(lic.id, installId, new Date().toISOString());
    } catch (e) {
      return { ok: true }; // 并发下同一安装重复插入：视为已激活
    }

    // 插后复核
    const after = await this.prepare('SELECT COUNT(*) AS n FROM activations WHERE license_id = ?').get(lic.id);
    if (Number(after.n) > lic.max_devices) {
      await this.prepare('DELETE FROM activations WHERE license_id = ? AND install_id = ?')
        .run(lic.id, installId);
      return { error: 'device_limit', maxDevices: lic.max_devices };
    }
    return { ok: true };
  }

  /**
   * 该安装实例是否已在此激活码上激活（PRO 权限校验用）。
   * 一并检查码本身存在且未吊销：绑定记录存在但码被吊销时不算 PRO
   */
  async hasActivation(key, installId) {
    const lic = await this.getLicense(key);
    if (!lic || lic.status !== 'active') return false;
    const row = await this.prepare('SELECT 1 AS ok FROM activations WHERE license_id = ? AND install_id = ?')
      .get(lic.id, installId);
    return !!row;
  }

  /** 支付成功后登记订单 → 激活码（order_id 已由 PRIMARY KEY 保证幂等） */
  async createOrder(orderId, licenseKey, email) {
    await this.prepare('INSERT INTO orders (order_id, license_key, customer_email, created_at) VALUES (?, ?, ?, ?)')
      .run(orderId, licenseKey, email || '', new Date().toISOString());
    return this.getOrder(orderId);
  }

  async getOrder(orderId) {
    return await this.prepare('SELECT order_id, license_key, customer_email, created_at FROM orders WHERE order_id = ?')
      .get(orderId);
  }

  /**
   * 订单号 → 激活码。数据访问与白名单校验都收在数据层：
   * 只有订单存在、且激活码符合 AMZ-XXXX-XXXX-XXXX 格式时才返回，其余一律返回空串
   */
  async keyForOrder(orderId) {
    const order = await this.getOrder(orderId);
    return order && isValidKeyFormat(order.license_key) ? order.license_key : '';
  }

  /** 免费试用的已用次数（只读） */
  async trialStatus(installId) {
    const row = await this.prepare('SELECT used FROM usage WHERE install_id = ?').get(installId);
    return row ? Number(row.used) : 0;
  }

  /**
   * 消耗一次试用额度；达到上限则拒绝。
   * 判定用前后计数对比（不依赖驱动的 rowsAffected 行为）；
   * upsert 的 WHERE used < 上限 在执行瞬间校验，保证计数永远不会超过上限
   * 返回 { allowed, used, limit }
   */
  async consumeTrial(installId, limit) {
    const now = new Date().toISOString();
    const before = await this.trialStatus(installId);
    if (before >= limit) return { allowed: false, used: before, limit };
    await this.prepare(
      'INSERT INTO usage (install_id, used, updated_at) VALUES (?, 1, ?) ' +
      'ON CONFLICT(install_id) DO UPDATE SET used = used + 1, updated_at = excluded.updated_at WHERE used < ?'
    ).run(installId, now, limit);
    const after = await this.trialStatus(installId);
    if (after <= before) return { allowed: false, used: after, limit }; // 并发下额度已被同批请求用尽
    return { allowed: true, used: after, limit };
  }

  /** 失败退还：把某安装的试用计数减 1（下限 0），返回退还后的计数 */
  async refundUsage(installId) {
    const now = new Date().toISOString();
    await this.prepare('UPDATE usage SET used = used - 1, updated_at = ? WHERE install_id = ? AND used > 0')
      .run(now, installId);
    return this.trialStatus(installId);
  }

  async close() {
    try { this.db.close(); } catch (e) { /* 云端客户端无需显式关闭 */ }
  }
}

const { isValidKeyFormat } = require('./keys');

module.exports = { Store };
