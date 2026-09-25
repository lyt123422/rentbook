// ============================================================
//  db.js — 数据层（双后端：Postgres/Supabase 云库 或 node:sqlite 本地文件）
//  - 构造参数 { url: 'postgresql://...' } → Postgres（生产：Supabase Transaction Pooler）
//  - 构造参数 { file: './x.db' }         → node:sqlite 本地文件（Node ≥ 23.4 免 flag）
//  全部语句使用参数绑定（? 占位 → PG 下自动转 $n），不拼接任何用户输入
// ============================================================
'use strict';

// 建表 DDL：纯静态常量，无任何外部输入参与。
// licenses.id 在 SQLite 用 AUTOINCREMENT、在 PG 用 SERIAL，其余一致
const TABLES = [
  "CREATE TABLE IF NOT EXISTS licenses (id {PK}, key TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'active', note TEXT NOT NULL DEFAULT '', max_devices INTEGER NOT NULL DEFAULT 3, created_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS activations (license_id INTEGER NOT NULL, install_id TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(license_id, install_id))",
  "CREATE TABLE IF NOT EXISTS usage (install_id TEXT PRIMARY KEY, used INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)",
  // 支付订单 → 激活码 映射（webhook 自动发码用；order_id 即客户取码凭据）
  "CREATE TABLE IF NOT EXISTS orders (order_id TEXT PRIMARY KEY, license_key TEXT NOT NULL, customer_email TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)",
  // 运行时配置（webhook 密钥等）——避免依赖 Render 环境变量编辑
  "CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
];
const SQLITE_SCHEMA = TABLES.map((t) => t.replace('{PK}', 'INTEGER PRIMARY KEY AUTOINCREMENT'));
const PG_SCHEMA = TABLES.map((t) => t.replace('{PK}', 'SERIAL PRIMARY KEY'));

class Store {
  /**
   * opts.url  'postgresql://...'（云库）
   * opts.file './x.db'（本地文件）
   * 建表异步完成：server.js 在每个请求入口 await store.ready
   */
  constructor(opts) {
    if (opts && opts.url && /^postgres/i.test(opts.url)) {
      this.#initPostgres(opts.url);
    } else if (opts && opts.file) {
      this.#initSqlite(opts.file);
    } else {
      throw new Error('Store 需要 { url }（Postgres）或 { file }（SQLite）之一');
    }
  }

  #initPostgres(url) {
    const postgres = require('postgres'); // 惰性加载：纯本地 sqlite 开发无需安装依赖
    // Supabase Transaction Pooler（6543 端口）不支持预编译语句：prepare: false 必须保留
    this.sql = postgres(url, { prepare: false, max: 5, idle_timeout: 20, connect_timeout: 10 });
    this.ready = (async () => {
      for (const ddl of PG_SCHEMA) await this.sql.unsafe(ddl);
    })();
  }

  #initSqlite(file) {
    const { DatabaseSync } = require('node:sqlite');
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.ready = (async () => {
      for (const ddl of SQLITE_SCHEMA) this.db.exec(ddl);
    })();
  }

  /**
   * 适配层：保持 prepare/run/get/all 调用形态（? 占位）。
   * SQLite 走 node:sqlite 原生占位；PG 把 ? 顺序转换为 $n
   */
  prepare(sqlText) {
    if (this.sql) {
      let i = 0;
      const q = sqlText.replace(/\?/g, () => `$${++i}`);
      return {
        run: async (...args) => { await this.sql.unsafe(q, args); return { changes: 0 }; },
        get: async (...args) => (await this.sql.unsafe(q, args))[0] || null,
        all: async (...args) => await this.sql.unsafe(q, args),
      };
    }
    return {
      run: async (...args) => this.db.prepare(sqlText).run(...args),
      get: async (...args) => this.db.prepare(sqlText).get(...args) || null,
      all: async (...args) => this.db.prepare(sqlText).all(...args),
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
      return { ok: true }; // 并发下同一安装重复插入（PG 23505）：视为已激活
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
    if (this.sql) { try { await this.sql.end({ timeout: 1 }); } catch (e) { /* 忽略 */ } }
    else { try { this.db.close(); } catch (e) { /* 忽略 */ } }
  }

  /** 读运行时配置（app_config 表；两个后端通用） */
  async getConfig(key) {
    const row = await this.prepare('SELECT value FROM app_config WHERE key = ?').get(key);
    return row ? row.value : null;
  }
}

const { isValidKeyFormat } = require('./keys');

module.exports = { Store };
