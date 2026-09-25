// ============================================================
//  pages.js — 落地页内容（编译期内嵌的静态 HTML 常量）
//  服务端直接回传这些常量，运行时不做任何文件读取
// ============================================================
'use strict';

const INDEX_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AmzInsight — 亚马逊差评分析</title>
  <style>
    * { box-sizing:border-box; margin:0; padding:0; }
    body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;
           color:#212529; background:#f8f9fa; }
    .hero { background:linear-gradient(135deg,#FF6B35,#F7931E); color:#fff; padding:72px 24px; text-align:center; }
    .hero h1 { font-size:30px; }
    .hero p  { opacity:.92; margin-top:10px; font-size:15px; }
    .cta { display:inline-block; margin-top:22px; background:#fff; color:#FF6B35; font-weight:700;
           padding:12px 28px; border-radius:24px; text-decoration:none; }
    main { max-width:680px; margin:0 auto; padding:40px 20px 64px; text-align:center; }
    .links { display:flex; gap:12px; justify-content:center; margin-top:8px; }
    .links a { display:block; flex:1; max-width:240px; background:#fff; border:1px solid #e9ecef;
               border-radius:12px; padding:18px; text-decoration:none; color:#212529; font-size:14px; }
    .links a:hover { border-color:#FF6B35; }
    .links .icon { font-size:24px; }
    .links .sub { color:#6c757d; font-size:12px; margin-top:4px; }
    footer { text-align:center; color:#adb5bd; font-size:12px; padding:24px; }
    footer a { color:#6c757d; }
  </style>
</head>
<body>
  <div class="hero">
    <h1>🔍 AmzInsight</h1>
    <p>亚马逊差评一键 AI 分析：产品缺陷 Top5 + 改进建议<br>给跨境卖家的产品改进报告</p>
    <a class="cta" href="upgrade.html">升级 PRO — $9.90 终身买断</a>
  </div>
  <main>
    <div class="links">
      <a href="upgrade.html"><div class="icon">🚀</div>购买与激活<strong><div class="sub">国际卡 / PayPal</div></strong></a>
      <a href="privacy.html"><div class="icon">🔒</div>隐私政策<strong><div class="sub">我们只收集最少的数据</div></strong></a>
    </div>
  </main>
  <footer>© 2026 AmzInsight · <a href="privacy.html">Privacy</a></footer>
</body>
</html>`;

const UPGRADE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AmzInsight — 升级 PRO</title>
  <style>
    * { box-sizing:border-box; margin:0; padding:0; }
    body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;
           color:#212529; background:#f8f9fa; line-height:1.7; }
    .hero { background:linear-gradient(135deg,#FF6B35,#F7931E); color:#fff; padding:56px 24px; text-align:center; }
    .hero h1 { font-size:28px; }
    .hero p  { opacity:.9; margin-top:8px; font-size:14px; }
    main { max-width:860px; margin:0 auto; padding:40px 20px 64px; }
    .plans { display:flex; gap:16px; flex-wrap:wrap; }
    .plan { flex:1; min-width:280px; background:#fff; border:1px solid #e9ecef;
            border-radius:16px; padding:28px; position:relative; }
    .plan.pro { border:2px solid #FF6B35; }
    .plan .tag { position:absolute; top:-12px; left:24px; background:#FF6B35; color:#fff;
                 font-size:11px; font-weight:700; padding:3px 10px; border-radius:20px; }
    .plan h2 { font-size:16px; color:#6c757d; }
    .plan .price { font-size:34px; font-weight:800; margin:10px 0 2px; }
    .plan .price span { font-size:14px; color:#6c757d; font-weight:500; }
    .plan ul { list-style:none; margin:18px 0 22px; }
    .plan li { font-size:13px; padding:5px 0 5px 24px; position:relative; }
    .plan li::before { content:'✓'; position:absolute; left:0; color:#198754; font-weight:700; }
    .plan li.no { color:#adb5bd; }
    .plan li.no::before { content:'—'; color:#ced4da; }
    .btn { display:block; width:100%; padding:12px; border-radius:10px; font-size:14px;
           font-weight:700; text-align:center; cursor:pointer; text-decoration:none;
           border:none; }
    .btn-ghost { background:#f1f3f5; color:#6c757d; }
    .btn-buy { background:linear-gradient(135deg,#FF6B35,#F7931E); color:#fff; }
    .btn-buy:hover { opacity:.92; }
    .payhint { text-align:center; font-size:12px; color:#6c757d; margin-top:8px; }
    .steps { background:#fff; border:1px solid #e9ecef; border-radius:16px; padding:28px; margin-top:24px; }
    .steps h2 { font-size:16px; margin-bottom:14px; }
    .steps ol { padding-left:20px; }
    .steps li { margin-bottom:8px; font-size:14px; }
    .steps code { background:#f1f3f5; padding:2px 8px; border-radius:6px; font-size:13px; }
    .faq { background:#fff; border:1px solid #e9ecef; border-radius:16px; padding:28px; margin-top:16px; }
    .faq h2 { font-size:16px; margin-bottom:12px; }
    .faq p { font-size:13px; color:#495057; margin-bottom:10px; }
    .faq strong { color:#212529; }
    .note { margin-top:20px; text-align:center; color:#6c757d; font-size:13px; }
    footer { text-align:center; color:#adb5bd; font-size:12px; padding:24px; }
    footer a { color:#6c757d; }
  </style>
</head>
<body>
  <div class="hero">
    <h1>🚀 升级 AmzInsight PRO</h1>
    <p>把差评变成产品改进清单，一次买断，终身使用</p>
  </div>
  <main>
    <div class="plans">
      <div class="plan">
        <h2>FREE</h2>
        <div class="price">$0</div>
        <ul>
          <li>3 次免费分析</li>
          <li>每次最多抓取 7 页差评</li>
          <li>中文 / 英文分析报告</li>
          <li>CSV 导出</li>
          <li class="no">无限次分析</li>
          <li class="no">后续新功能</li>
        </ul>
        <button class="btn btn-ghost" disabled>当前方案</button>
      </div>
      <div class="plan pro">
        <span class="tag">推荐</span>
        <h2>PRO · 终身买断</h2>
        <div class="price">$9.90 <span>一次付费，永久使用</span></div>
        <ul>
          <li>无限次差评分析</li>
          <li>每次最多抓取 7 页差评</li>
          <li>中文 / 英文分析报告</li>
          <li>CSV 导出</li>
          <li>可绑定 3 台设备</li>
          <li>终身功能更新</li>
        </ul>
        <a class="btn btn-buy" href="https://www.creem.io/payment/prod_29ximkvQmmxNqPoZ1opETG" id="buyLink">立即购买（国际卡 / PayPal）</a>
        <div class="payhint">付款后自动获得激活码</div>
      </div>
    </div>
    <div class="steps">
      <h2>购买后如何激活（1 分钟）</h2>
      <ol>
        <li>付款成功后会得到一个<strong>激活码</strong>（形如 <code>AMZ-XXXX-XXXX-XXXX</code>）。</li>
        <li>点击浏览器右上角的 AmzInsight 图标 → 底部「⚙ API Key」打开设置。</li>
        <li>在「🎟 激活码」一栏粘贴激活码，点「激活」，图标处变成 <strong>PRO</strong> 即成功。</li>
      </ol>
    </div>
    <div class="faq">
      <h2>常见问题</h2>
      <p><strong>激活码能在几台电脑用？</strong>默认 3 台。换电脑时把旧机器上的激活码「停用」即可腾出名额。</p>
      <p><strong>后续更新还要付费吗？</strong>不用，买断包含终身功能更新，插件自动升级。</p>
      <p><strong>可以退款吗？</strong>激活后 7 天内、分析次数未超过 10 次的，联系客服原路退款。</p>
      <p><strong>需要科学上网吗？</strong>分析请求发往 Google Gemini，网络需能访问 Google 服务；差评抓取本身不受影响。</p>
    </div>
    <p class="note">其他问题：通过插件底部的「💬 Feedback」联系我们，48 小时内回复。</p>
  </main>
  <footer>
    © 2026 AmzInsight · <a href="privacy.html">隐私政策</a>
  </footer>
</body>
</html>`;

const PRIVACY_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AmzInsight 隐私政策 | Privacy Policy</title>
  <style>
    * { box-sizing:border-box; margin:0; padding:0; }
    body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;
           color:#212529; background:#f8f9fa; line-height:1.8; }
    .hero { background:linear-gradient(135deg,#FF6B35,#F7931E); color:#fff; padding:48px 24px; text-align:center; }
    .hero h1 { font-size:26px; }
    .hero p { opacity:.9; margin-top:6px; font-size:14px; }
    main { max-width:760px; margin:0 auto; padding:32px 20px 64px; }
    section { background:#fff; border:1px solid #e9ecef; border-radius:12px; padding:24px; margin-bottom:16px; }
    h2 { font-size:17px; margin-bottom:12px; color:#FF6B35; }
    ul { padding-left:20px; }
    li { margin-bottom:6px; }
    .muted { color:#6c757d; font-size:13px; }
    footer { text-align:center; color:#adb5bd; font-size:12px; padding:24px; }
  </style>
</head>
<body>
  <div class="hero">
    <h1>🔒 AmzInsight 隐私政策</h1>
    <p>Privacy Policy · 最后更新：2026-09-21</p>
  </div>
  <main>
    <section>
      <h2>一句话版本</h2>
      <p>我们只收集让插件正常工作所必需的最少数据：评论内容仅用于你主动发起的分析，不用于任何其他目的，我们不出售你的数据。</p>
    </section>
    <section>
      <h2>1. 我们收集哪些信息</h2>
      <ul>
        <li><strong>你正在查看的亚马逊评论内容</strong>：仅当你点击"分析"按钮时，当前页面的 1~3 星评论会被抓取并用于分析。</li>
        <li><strong>匿名安装标识（install ID）</strong>：一个随机生成的 UUID，用于统计免费试用次数，不包含任何个人信息。</li>
        <li><strong>使用计数</strong>：你使用分析功能的次数（试用额度管理）。</li>
        <li><strong>激活码</strong>（如果你购买了 PRO）：仅用于验证授权，绑定安装实例。</li>
        <li><strong>你自己的 Gemini API Key</strong>：保存在你的浏览器本地（chrome.storage），不上传到我们的服务器。</li>
      </ul>
    </section>
    <section>
      <h2>2. 数据如何被处理</h2>
      <ul>
        <li>评论内容由你的浏览器直接发送给 <strong>Google Gemini API</strong>（使用你自己的 API Key）完成分析，分析结果返回给你的浏览器展示。</li>
        <li>额度校验请求（安装 ID + 计数）发送到我们的授权服务器，<strong>不包含评论内容</strong>。</li>
        <li>除上述两者外，数据不发送给任何第三方。</li>
      </ul>
      <p class="muted">评论数据会受 Google 隐私政策约束（policies.google.com/privacy）。</p>
    </section>
    <section>
      <h2>3. 数据存储与保留</h2>
      <ul>
        <li>你的 API Key、设置、激活码：保存在你的浏览器本地，卸载插件即删除。</li>
        <li>授权服务器仅保存：安装 UUID、使用计数、激活码绑定关系。不保存评论文本。</li>
      </ul>
    </section>
    <section>
      <h2>4. 你的权利</h2>
      <ul>
        <li>卸载插件即可删除所有本地数据。</li>
        <li>如需删除服务器端的使用记录，发邮件给我们并附上你的安装 ID 即可。</li>
      </ul>
    </section>
    <section>
      <h2>5. 联系我们</h2>
      <p>隐私相关问题请联系：<strong>lyt502277@gmail.com</strong></p>
    </section>
    <section>
      <h2>English Summary</h2>
      <p class="muted">AmzInsight collects only what is necessary: Amazon review text (sent to Google Gemini using YOUR OWN API key, only when you click Analyze), a random install ID, usage counts, and your license key if you upgrade. We do not sell your data. Uninstalling the extension removes all local data. Contact: lyt502277@gmail.com</p>
    </section>
  </main>
  <footer>© 2026 AmzInsight</footer>
</body>
</html>`;

const THANKS_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AmzInsight — 购买成功</title>
  <style>
    * { box-sizing:border-box; margin:0; padding:0; }
    body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;
           color:#212529; background:#f8f9fa; line-height:1.7; }
    .hero { background:linear-gradient(135deg,#FF6B35,#F7931E); color:#fff; padding:48px 24px; text-align:center; }
    .hero h1 { font-size:26px; }
    .hero p  { opacity:.9; margin-top:8px; font-size:14px; }
    main { max-width:680px; margin:0 auto; padding:32px 20px 64px; }
    .card { background:#fff; border:1px solid #e9ecef; border-radius:16px; padding:28px; margin-bottom:16px; }
    .card h2 { font-size:16px; margin-bottom:12px; }
    .keybox { display:flex; gap:8px; margin:14px 0 4px; }
    .keybox code { flex:1; background:#f1f3f5; border:1px dashed #ced4da; border-radius:10px;
                   padding:14px; font-size:18px; font-weight:700; letter-spacing:2px; text-align:center; }
    .copybtn { border:none; border-radius:10px; padding:0 18px; font-size:14px; font-weight:700;
               cursor:pointer; background:linear-gradient(135deg,#FF6B35,#F7931E); color:#fff; }
    .hint { color:#6c757d; font-size:12px; }
    .steps ol { padding-left:20px; }
    .steps li { margin-bottom:8px; font-size:14px; }
    .steps code { background:#f1f3f5; padding:2px 8px; border-radius:6px; font-size:13px; }
    input.orderid { width:100%; padding:12px; border:1px solid #ced4da; border-radius:10px;
                    font-size:15px; margin:10px 0; }
    .fetchbtn { width:100%; padding:12px; border:none; border-radius:10px; font-size:14px;
                font-weight:700; cursor:pointer; background:linear-gradient(135deg,#FF6B35,#F7931E); color:#fff; }
    .err { color:#c92a2a; font-size:13px; margin-top:8px; display:none; }
    footer { text-align:center; color:#adb5bd; font-size:12px; padding:24px; }
  </style>
</head>
<body>
  <div class="hero">
    <h1>🎉 感谢购买 AmzInsight PRO</h1>
    <p>支付已完成，下面是你的专属激活码</p>
  </div>
  <main>
    <div class="card">
      <h2>你的激活码</h2>
      <div class="keybox">
        <code id="keyText">获取中…</code>
        <button class="copybtn" id="copyBtn" style="display:none">复制</button>
      </div>
      <p class="hint" id="keyHint">正在等待支付系统确认（最长约 1 分钟），页面会自动刷新</p>
      <p class="err" id="keyErr"></p>
    </div>
    <div class="card steps">
      <h2>激活步骤（1 分钟）</h2>
      <ol>
        <li>复制上方激活码（形如 <code>AMZ-XXXX-XXXX-XXXX</code>）。</li>
        <li>点击浏览器右上角 AmzInsight 图标 → 底部「⚙ API Key」打开设置。</li>
        <li>在「🎟 激活码」一栏粘贴激活码，点「激活」，图标变成 <strong>PRO</strong> 即成功。</li>
      </ol>
    </div>
    <div class="card" id="manualCard" style="display:none">
      <h2>手动取码</h2>
      <p style="font-size:13px;color:#495057">找不到订单号？它在你收到的 Creem 收据邮件里，以 <code>ord_</code> 开头。粘贴到下面查询：</p>
      <input class="orderid" id="orderIdInput" placeholder="ord_xxxxxxxxxxxx" />
      <button class="fetchbtn" id="fetchBtn">查询激活码</button>
      <p class="err" id="manualErr"></p>
    </div>
  </main>
  <footer>© 2026 AmzInsight</footer>
  <script>
    (function () {
      var KEY_RE = /^[A-Za-z0-9_-]{6,64}$/;
      var keyText = document.getElementById('keyText');
      var keyHint = document.getElementById('keyHint');
      var keyErr = document.getElementById('keyErr');
      var copyBtn = document.getElementById('copyBtn');
      var orderId = '';
      var params = new URLSearchParams(location.search);
      if (params.get('order_id')) orderId = params.get('order_id');
      else if (params.get('orderId')) orderId = params.get('orderId');
      else if (params.get('order')) orderId = params.get('order');

      function showKey(key) {
        keyText.textContent = key;
        copyBtn.style.display = '';
        keyHint.textContent = '请妥善保存激活码，本页关闭后可凭订单号随时回来查询';
        keyErr.style.display = 'none';
        copyBtn.onclick = function () {
          if (navigator.clipboard) navigator.clipboard.writeText(key);
          copyBtn.textContent = '已复制';
        };
      }

      function fail(msg) {
        keyText.textContent = '—';
        keyHint.textContent = '';
        keyErr.textContent = msg;
        keyErr.style.display = '';
        document.getElementById('manualCard').style.display = '';
      }

      function fetchKey(id, done) {
        if (!KEY_RE.test(id)) { done(null); return; }
        fetch('/v1/keys/' + encodeURIComponent(id))
          .then(function (r) { return r.status === 200 ? r.json() : null; })
          .then(function (d) { done(d && d.key ? d.key : null); })
          .catch(function () { done(null); });
      }

      if (orderId) {
        var tries = 0;
        var timer = setInterval(function () {
          tries += 1;
          fetchKey(orderId, function (key) {
            if (key) { clearInterval(timer); showKey(key); }
            else if (tries >= 20) { clearInterval(timer); fail('等待超时：订单可能尚未同步。请稍后刷新重试，或凭收据邮件中的订单号手动查询。'); }
          });
        }, 3000);
        fetchKey(orderId, function (key) { if (key) showKey(key); });
      } else {
        fail('链接中未包含订单号：请查看 Creem 收据邮件中的订单号（ord_ 开头），在下方手动查询。');
      }

      document.getElementById('fetchBtn').onclick = function () {
        var manualErr = document.getElementById('manualErr');
        var id = document.getElementById('orderIdInput').value.trim();
        manualErr.style.display = 'none';
        if (!KEY_RE.test(id)) {
          manualErr.textContent = '订单号格式不对：应以 ord_ 开头，只含字母数字。';
          manualErr.style.display = '';
          return;
        }
        fetchKey(id, function (key) {
          if (key) showKey(key);
          else { manualErr.textContent = '没有查到该订单，付款后系统同步最长需要 1 分钟，请稍后再试。'; manualErr.style.display = ''; }
        });
      };
    })();
  </script>
</body>
</html>`;

module.exports = { INDEX_HTML, UPGRADE_HTML, PRIVACY_HTML, THANKS_HTML };
