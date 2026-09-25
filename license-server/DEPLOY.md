# 部署 RentBook 授权服务器（约 20 分钟）

## 架构

```
浏览器 RentBook ──激活(一次性)──▶ 本服务器 ──▶ Supabase Postgres（免费）
                       ▲
            Creem webhook（付款自动发码 / 退款自动吊销）
```

## 1. Supabase 建库（免费，3 分钟）

1. supabase.com → Dashboard → **New project**（组织随便用现有的）：
   Name = `rentbook`，Database Password = **自己生成一个强密码并记下来**，Region = East US（面向美国用户）。
2. 等待置备完成（约 2 分钟）。
3. 项目页顶部 **Connect** 按钮 → **Transaction pooler**（端口 6543）→ 复制连接串，
   把其中的 `[YOUR-PASSWORD]` 换成刚才的密码：
   ```
   postgresql://postgres.<项目REF>:<密码>@aws-0-<区域>.pooler.supabase.com:6543/postgres
   ```
   → 这就是 `DATABASE_URL`。

> 必须用 6543 的 Transaction pooler 串：直连 5432 在免费档是 IPv6-only，Render 免费实例连不上。
> 数据表（licenses/activations/usage/orders）由服务器首次启动自动建，无需手动执行 SQL。

## 2. Render 部署（5 分钟）

1. Render → New → **Blueprint**，选择本 GitHub 仓库（识别 `license-server/render.yaml`）；
   或 New → Web Service 手动配置：Root Directory = `license-server`，Build = `npm install`，Start = `node server.js`。
2. 环境变量：`ADMIN_TOKEN`、`CREEM_WEBHOOK_SECRET` 由 Render 自动生成（部署后在控制台复制）；
   把 Supabase 的连接串填进 `DATABASE_URL`。
3. Deploy，完成后记下地址：`https://<app>.onrender.com`。

**验证**：`curl https://<app>.onrender.com/health` → `{"ok":true,...}`

> 不配 DATABASE_URL 也能跑（本地 node:sqlite 文件回退），但 Render 免费档重新部署会丢数据，**正式收款务必配 Supabase**。

## 3. Creem 配置（5 分钟）

> ⚠️ 2026-09 起 Creem 2.0 控制台入口是 www.creem.io/dashboard（旧 dashboard.creem.io 已废弃）。
> Webhook 签名密钥由 Creem 生成（Webhook 详情页点「显示」），需同步写入本服务的 Supabase 表：
> INSERT INTO app_config (key, value) VALUES (`creem_webhook_secret`, `<whsec_...>`);
> （服务器每次请求都会读它，改完即时生效，无需重启。）

1. Creem 后台 → Products → 新建 **RentBook Pro**：$24，one-time。
2. Webhooks → 新建，URL = `https://<app>.onrender.com/v1/webhook/creem`，
   Secret = Render 控制台里的 `CREEM_WEBHOOK_SECRET` 值。
3. 先用 Test mode 走一遍测试支付，确认 webhook 自动发码（发码记录看 Render Logs）。
4. 复制 Checkout 链接 → 这就是 `LICENSE.buyUrl`。

## 4. 回填应用常量（2 分钟）

编辑仓库根目录 `index.html`：

```js
const LICENSE = {
  server: "https://<app>.onrender.com",   // 第 2 步的地址
  buyUrl: "https://www.creem.io/checkout/<你的商品链接>",  // 第 3 步的链接
  maxFreeUnits: 3,
};
```

commit + push → GitHub Pages 自动重新部署（约 1 分钟）。

## 5. 铸造首批激活码

```bash
curl -X POST https://<app>.onrender.com/v1/admin/keys \
  -H "x-admin-token: <ADMIN_TOKEN>" -H "Content-Type: application/json" \
  -d '{"count":5,"maxDevices":3,"note":"first batch"}'
```

激活码格式 `AMZ-XXXX-XXXX-XXXX`（字符集已去除易混淆字符）。每码默认 3 台设备。

## 日常运营备忘

- 退款：Creem 退款触发 webhook 自动吊销；也可手动 `POST /v1/admin/revoke`
- 查码：`GET /v1/admin/keys`（带 `x-admin-token`）
- 客户丢了激活码：Creem 订单号 → `GET /v1/keys/<order_id>` 可自助找回
- 免费档 Render 服务 15 分钟无流量会休眠，首次激活/校验多等几秒属正常
- 数据库表在 Supabase 项目 Table Editor 里可见；激活/订单数据都在那里，别手动删表
