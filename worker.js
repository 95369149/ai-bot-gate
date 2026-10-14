/**
 * AI 爬虫防火墙 / AI 引用网关 (AIGate)
 * ============================================================
 * 一个 Cloudflare Worker，帮小网站做"选择性" AI 爬虫管理：
 *   放行优质引用（AI 搜索）→ 挡掉烧钱的训练爬虫 → 可疑的先挑战
 *
 * 两种模式（由环境变量 AI_GATE_MODE 控制）：
 *   demo  - 演示模式：展示产品落地页 + UA 在线测试工具（默认）
 *   proxy - 代理模式：挂到你的域名前面，按规则放行/拦截/挑战
 *
 * 环境变量：
 *   AI_GATE_MODE            demo | proxy（默认 demo）
 *   ORIGIN_URL              proxy 模式下的源站地址，如 https://origin.example.com
 *   DEFAULT_SEARCH_ACTION   search 类默认动作 allow|block|challenge（默认 allow）
 *   DEFAULT_INDEX_ACTION    index 类默认动作（默认 challenge）
 *   DEFAULT_AGENT_ACTION    agent 类默认动作（默认 block）
 *   ALLOW_BOTS              强制放行的 bot id，逗号分隔，如 "gptbot,claudebot"
 *   BLOCK_BOTS              强制拦截的 bot id，逗号分隔
 *   RATE_LIMIT_PER_MIN      单个 IP 每分钟允许的 AI 爬虫请求数（默认 30）
 *
 * 免费版 Cloudflare Workers 即可跑（每天 10 万请求免费额度）。
 */

// ------------------------------------------------------------------
// AI 爬虫指纹库：id / 名称 / 运营方 / UA 正则 / 类别 / 一句话说明
// 类别：search=AI搜索引用（带来GEO流量，建议放行）
//      index=训练/索引爬虫（只耗带宽无直接收益，建议挑战或拦截）
//      agent=代理式抓取（高频，多为恶意/无价值，建议拦截）
// ------------------------------------------------------------------
const AI_BOTS = [
  // ---- search: AI 搜索引用（优质流量，建议放行）----
  { id: "perplexitybot", name: "PerplexityBot", vendor: "Perplexity", re: /PerplexityBot/i, cat: "search", note: "Perplexity AI 搜索引用，带来真实用户点击", geo: "出海核心：Perplexity 回答直接带来源链接" },
  { id: "oai-searchbot", name: "OAI-SearchBot", vendor: "OpenAI", re: /OAI-SearchBot/i, cat: "search", note: "ChatGPT 搜索引用", geo: "出海核心：ChatGPT Search 引用来源" },
  { id: "chatgpt-user", name: "ChatGPT-User", vendor: "OpenAI", re: /ChatGPT-User/i, cat: "search", note: "用户在 ChatGPT 里点开你网站，用户触发的", geo: "出海核心：真实用户从 AI 回答点进来" },
  { id: "claude-user", name: "Claude-User", vendor: "Anthropic", re: /Claude-User/i, cat: "search", note: "用户在 Claude 里点开你网站，用户触发的", geo: "出海：Claude 用户触发访问" },
  { id: "claude-web", name: "Claude-Web", vendor: "Anthropic", re: /Claude-Web/i, cat: "search", note: "Claude 联网搜索引用", geo: "出海：Claude 联网搜索引用" },
  { id: "bingbot-ai", name: "BingBot（AI 模式）", vendor: "Microsoft", re: /Bingbot.*Copilot|Copilot.*Bingbot/i, cat: "search", note: "Copilot 引用", geo: "出海/御刃：Copilot 与必应 AI 回答引用" },

  // ---- index: 训练/索引爬虫（耗带宽，建议挑战或拦截）----
  { id: "gptbot", name: "GPTBot", vendor: "OpenAI", re: /GPTBot/i, cat: "index", note: "OpenAI 训练数据爬虫，不带来流量" },
  { id: "claudebot", name: "ClaudeBot", vendor: "Anthropic", re: /ClaudeBot/i, cat: "index", note: "Anthropic 训练数据爬虫" },
  { id: "ccbot", name: "CCBot", vendor: "Common Crawl", re: /CCBot/i, cat: "index", note: "Common Crawl，多家 AI 公司训练数据来源" },
  { id: "google-extended", name: "Google-Extended", vendor: "Google", re: /Google-Extended/i, cat: "index", note: "Google AI 训练专用，拦它不影响谷歌搜索收录" },
  { id: "bytespider", name: "Bytespider", vendor: "字节跳动", re: /Bytespider/i, cat: "index", note: "字节 AI 训练爬虫，出了名的高频" },
  { id: "applebot-extended", name: "Applebot-Extended", vendor: "Apple", re: /Applebot-Extended/i, cat: "index", note: "Apple AI 训练，拦它不影响苹果搜索收录" },
  { id: "meta-webindexer", name: "meta-webindexer", vendor: "Meta", re: /meta-webindexer/i, cat: "index", note: "Meta AI 训练" },
  { id: "cohere-ai", name: "cohere-ai", vendor: "Cohere", re: /cohere-ai/i, cat: "index", note: "Cohere 训练爬虫" },
  { id: "amazonbot", name: "Amazonbot", vendor: "Amazon", re: /Amazonbot/i, cat: "index", note: "Amazon AI 训练" },
  { id: "facebookbot", name: "facebookbot", vendor: "Meta", re: /facebookbot/i, cat: "index", note: "Meta 内容抓取" },

  // ---- agent: 代理式/高频抓取（建议拦截）----
  { id: "diffbot", name: "Diffbot", vendor: "Diffbot", re: /Diffbot/i, cat: "agent", note: "商业 AI 抓取服务，高频" },
  { id: "youbot", name: "YouBot", vendor: "You.com", re: /YouBot/i, cat: "agent", note: "You.com AI 搜索抓取" },
  { id: "grokbot", name: "GrokBot", vendor: "xAI", re: /GrokBot|grok-bot/i, cat: "agent", note: "xAI Grok 抓取" },
  { id: "mistralai-user", name: "MistralAI-User", vendor: "Mistral", re: /MistralAI-User/i, cat: "agent", note: "Mistral 用户触发抓取" },
  { id: "omgilibot", name: "omgilibot", vendor: "Omgili", re: /omgilibot/i, cat: "agent", note: "高频论坛/内容抓取" },
  { id: "dataforseo", name: "DataForSeoBot", vendor: "DataForSEO", re: /DataForSeoBot/i, cat: "agent", note: "SEO 数据服务商抓取" },
];

const CAT_LABEL = { search: "AI搜索引用", index: "训练/索引爬虫", agent: "代理式抓取" };
const CAT_ACTION_DEFAULT = { search: "allow", index: "challenge", agent: "block" };

// ------------------------------------------------------------------
// GEO 目标引擎映射（来自 GEO 挖矿实战：出海=Perplexity/ChatGPT/Gemini，国内=豆包/DeepSeek/Kimi）
// bots: 对应指纹 id 列表（空 = 该引擎爬虫 UA 未公开，按默认策略处理）
// ------------------------------------------------------------------
const GEO_TARGETS = [
  { engine: "Perplexity", market: "出海", bots: ["perplexitybot"], note: "回答直接带来源链接，GEO 主战场" },
  { engine: "ChatGPT Search", market: "出海", bots: ["oai-searchbot", "chatgpt-user"], note: "搜索引用来源，真实用户点击" },
  { engine: "Claude", market: "出海", bots: ["claude-web", "claude-user"], note: "联网搜索引用，相对弱但存在" },
  { engine: "Copilot / 必应 AI", market: "出海/御刃", bots: ["bingbot-ai"], note: "必应 AI 回答引用来源" },
  { engine: "Gemini", market: "出海", bots: [], note: "联网抓取 UA 未公开，未知 UA 默认放行即不影响" },
  { engine: "豆包 / DeepSeek / Kimi", market: "国内", bots: [], note: "国内 AI 搜索爬虫 UA 未公开，未知 UA 默认放行即不影响" },
];

// 内存限流（单实例尽力而为，生产建议换 KV/Durable Object）
const rateMap = new Map();

function cfg(env, key, fallback) {
  const v = env[key];
  return v === undefined || v === null || v === "" ? fallback : v;
}
function csvSet(env, key) {
  return new Set(
    cfg(env, key, "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
  );
}

function detectBot(ua) {
  if (!ua) return null;
  for (const b of AI_BOTS) {
    if (b.re.test(ua)) return b;
  }
  return null;
}

function decide(bot, env) {
  const allowSet = csvSet(env, "ALLOW_BOTS");
  const blockSet = csvSet(env, "BLOCK_BOTS");
  if (allowSet.has(bot.id)) return "allow";
  if (blockSet.has(bot.id)) return "block";
  const override = cfg(env, `DEFAULT_${bot.cat.toUpperCase()}_ACTION`, null);
  if (override && ["allow", "block", "challenge"].includes(override)) return override;
  return CAT_ACTION_DEFAULT[bot.cat] || "challenge";
}

function checkRateLimit(ip, env) {
  const limit = parseInt(cfg(env, "RATE_LIMIT_PER_MIN", "30"), 10) || 30;
  const now = Date.now();
  const rec = rateMap.get(ip) || { count: 0, reset: now + 60000 };
  if (now > rec.reset) { rec.count = 0; rec.reset = now + 60000; }
  rec.count += 1;
  rateMap.set(ip, rec);
  return rec.count <= limit;
}

function geoRows(env) {
  return GEO_TARGETS.map((t) => {
    if (t.bots.length === 0) {
      return `<tr><td><b>${t.engine}</b><br><span class="dim">${t.market}</span></td>
<td class="dim">${t.note}</td><td><span class="pill" style="background:#64748b">未知UA默认放行</span></td></tr>`;
    }
    const states = t.bots.map((id) => {
      const bot = AI_BOTS.find((b) => b.id === id);
      return { bot, action: decide(bot, env) };
    });
    const blocked = states.filter((s) => s.action === "block");
    const challenged = states.filter((s) => s.action === "challenge");
    let pill, bg;
    if (blocked.length === states.length) { pill = "⛔ 已拦截（AI 引用不到你）"; bg = "#ef4444"; }
    else if (blocked.length > 0 || challenged.length > 0) { pill = "🟡 部分受限"; bg = "#f59e0b"; }
    else { pill = "✅ 可引用"; bg = "#22c55e"; }
    const detail = states.map((s) => `${s.bot.name}=${s.action}`).join("，");
    return `<tr><td><b>${t.engine}</b><br><span class="dim">${t.market} · ${t.note}</span></td>
<td class="dim">${detail}</td><td><span class="pill" style="background:${bg}">${pill}</span></td></tr>`;
  }).join("");
}

function robotsTxt(env) {
  const lines = [
    "# 由 AIGate 生成，与网关配置保持一致",
    "# 网关是执行层（真拦截），robots.txt 是声明层（靠自觉）——两层都要",
    "",
  ];
  for (const b of AI_BOTS) {
    if (decide(b, env) === "block") {
      lines.push(`User-agent: ${b.name}`);
      lines.push("Disallow: /");
      lines.push("");
    }
  }
  lines.push("User-agent: *");
  lines.push("Disallow:");
  lines.push("");
  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

// ------------------------------------------------------------------
// 页面模板
// ------------------------------------------------------------------
function blockPage(bot) {
  return new Response(
    `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>请求被拦截 · AIGate</title>
<style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{max-width:520px;background:#1e293b;border:1px solid #334155;border-radius:16px;padding:40px;text-align:center}
h1{font-size:22px;margin:0 0 12px}.tag{display:inline-block;background:#ef4444;color:#fff;border-radius:999px;padding:4px 14px;font-size:13px;margin-bottom:16px}
p{color:#94a3b8;font-size:14px;line-height:1.8}a{color:#38bdf8}</style></head><body>
<div class="card"><div class="tag">AI 爬虫拦截</div>
<h1>检测到 AI 训练爬虫</h1>
<p><b style="color:#e2e8f0">${bot.name}</b>（${bot.vendor}）被站长设置为拦截。<br>
这类爬虫只消耗服务器带宽，不带来真实访问。<br>
如需合作或有误判，请联系站长。</p>
<p style="margin-top:24px;font-size:12px">Powered by <b>AIGate</b> · AI 引用网关</p></div></body></html>`,
    { status: 403, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

function challengePage(url) {
  const redir = encodeURIComponent(url.pathname + url.search);
  return new Response(
    `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>安全验证 · AIGate</title>
<style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{background:#1e293b;border:1px solid #334155;border-radius:16px;padding:40px;text-align:center}
.spin{width:36px;height:36px;border:3px solid #334155;border-top-color:#38bdf8;border-radius:50%;margin:0 auto 16px;animation:s 1s linear infinite}
@keyframes s{to{transform:rotate(360deg)}}</style></head><body>
<div class="card"><div class="spin"></div><h3>正在验证你不是恶意爬虫…</h3>
<p style="color:#94a3b8;font-size:13px">真人用户请稍候 2 秒，AI 训练爬虫请绕道</p></div>
<script>
setTimeout(function(){
  document.cookie="aigate_pass=1;max-age=86400;path=/;SameSite=Lax";
  location.href=decodeURIComponent("${redir}");
},1800);
</script></body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

function botTableRows() {
  return AI_BOTS.map((b) => {
    const d = CAT_ACTION_DEFAULT[b.cat];
    const badge = d === "allow" ? "#22c55e" : d === "block" ? "#ef4444" : "#f59e0b";
    const label = d === "allow" ? "放行" : d === "block" ? "拦截" : "挑战";
    return `<tr><td><b>${b.name}</b><br><span class="dim">${b.vendor}</span></td>
<td>${CAT_LABEL[b.cat]}</td><td>${b.note}</td>
<td><span class="pill" style="background:${badge}">${label}</span></td></tr>`;
  }).join("");
}

function dashboardPage(env) {
  return new Response(
    `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AIGate · AI 引用网关控制台</title>
<style>*{box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:32px 16px}
.wrap{max-width:960px;margin:0 auto}h1{font-size:26px}h2{font-size:18px;margin-top:36px;color:#38bdf8}
.dim{color:#94a3b8;font-size:12px}.pill{color:#fff;border-radius:999px;padding:3px 12px;font-size:12px}
table{width:100%;border-collapse:collapse;margin-top:12px;font-size:14px}
th,td{text-align:left;padding:10px 8px;border-bottom:1px solid #1e293b;vertical-align:top}
th{color:#94a3b8;font-weight:600;font-size:12px}
.card{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:20px;margin-top:12px}
input,select{background:#0f172a;border:1px solid #334155;color:#e2e8f0;border-radius:8px;padding:10px 12px;font-size:14px;width:100%}
button{background:#38bdf8;color:#0f172a;border:0;border-radius:8px;padding:10px 20px;font-size:14px;font-weight:700;cursor:pointer;margin-top:12px}
.result{margin-top:12px;font-size:14px;line-height:1.8}
code{background:#0f172a;padding:2px 8px;border-radius:6px;font-size:13px}</style></head><body>
<div class="wrap">
<h1>🛡️ AIGate · AI 引用网关</h1>
<p class="dim">模式：<b>${cfg(env, "AI_GATE_MODE", "demo")}</b> · 已收录 ${AI_BOTS.length} 种 AI 爬虫指纹 ·
限流 ${cfg(env, "RATE_LIMIT_PER_MIN", "30")}/分钟/IP</p>

<h2>🧪 UA 在线测试</h2>
<div class="card">
<p class="dim">粘贴一条 User-Agent，看网关会怎么判：</p>
<input id="ua" placeholder="例如：Mozilla/5.0 … ClaudeBot/1.0 …">
<button onclick="test()">开始判定</button>
<div class="result" id="r"></div></div>

<h2>🎯 GEO 引用可见性</h2>
<p class="dim">GEO 时代两件事：<b>被 AI 引用</b>（GEO）+ <b>不被爬虫拖垮</b>。下表看你的网站现在能被哪些 AI 引用：</p>
<table><tr><th>AI 引擎</th><th>对应爬虫与当前动作</th><th>引用状态</th></tr>${geoRows(env)}</table>

<h2>📋 AI 爬虫指纹库（默认策略）</h2>
<table><tr><th>爬虫</th><th>类别</th><th>说明</th><th>默认动作</th></tr>${botTableRows()}</table>

<h2>⚙️ 当前生效配置</h2>
<div class="card"><p class="dim">通过 Worker 环境变量修改：</p>
<p><code>DEFAULT_SEARCH_ACTION=${cfg(env, "DEFAULT_SEARCH_ACTION", "allow")}</code>（AI搜索引用，默认放行）<br>
<code>DEFAULT_INDEX_ACTION=${cfg(env, "DEFAULT_INDEX_ACTION", "challenge")}</code>（训练爬虫，默认挑战）<br>
<code>DEFAULT_AGENT_ACTION=${cfg(env, "DEFAULT_AGENT_ACTION", "block")}</code>（代理抓取，默认拦截）<br>
<code>ALLOW_BOTS=${cfg(env, "ALLOW_BOTS", "") || "(空)"}</code> ·
<code>BLOCK_BOTS=${cfg(env, "BLOCK_BOTS", "") || "(空)"}</code></p></div>

<p class="dim" style="margin-top:32px">AIGate v0.1 · 免费版 Cloudflare Workers 即可运行</p>
</div>
<script>
async function test(){
  const ua=document.getElementById('ua').value.trim();
  if(!ua){document.getElementById('r').innerHTML='请先粘贴 UA';return;}
  const res=await fetch('/__aigate/api/test?ua='+encodeURIComponent(ua));
  const j=await res.json();
  document.getElementById('r').innerHTML=j.html;
}
</script></body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

function landingPage() {
  return new Response(
    `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AIGate · AI 爬虫防火墙 — 放行优质引用，挡掉烧钱爬虫</title>
<style>*{box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;margin:0}
.hero{max-width:860px;margin:0 auto;padding:80px 20px 40px;text-align:center}
.hero h1{font-size:40px;line-height:1.3;margin:0 0 16px}
.hero h1 .g{background:linear-gradient(90deg,#38bdf8,#a78bfa);-webkit-background-clip:text;background-clip:text;color:transparent}
.sub{color:#94a3b8;font-size:17px;line-height:1.9;max-width:640px;margin:0 auto}
.cta{margin-top:32px}.btn{display:inline-block;background:#38bdf8;color:#0f172a;font-weight:700;border-radius:10px;padding:14px 32px;font-size:16px;text-decoration:none;margin:6px}
.btn.ghost{background:transparent;color:#38bdf8;border:1px solid #38bdf8}
.sec{max-width:860px;margin:0 auto;padding:40px 20px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;margin-top:20px}
.card{background:#1e293b;border:1px solid #334155;border-radius:14px;padding:24px}
.card h3{margin:0 0 10px;font-size:17px}.card p{color:#94a3b8;font-size:14px;line-height:1.8;margin:0}
h2{font-size:24px}.num{font-size:28px}
table{width:100%;border-collapse:collapse;margin-top:16px;font-size:14px}
td,th{padding:10px;border-bottom:1px solid #1e293b;text-align:left}
.footer{text-align:center;color:#64748b;font-size:13px;padding:40px 20px}</style></head><body>
<div class="hero">
<div style="font-size:52px">🛡️</div>
<h1>你的网站被 AI 爬虫<br><span class="g">淹没了吗？</span></h1>
<p class="sub">上 HN 十分钟，服务器就被 AI 爬虫拖慢——一半流量来自某家"AI 简报"服务每分钟几十次的轮询，
还有 ClaudeBot、GPTBot、Bytespider 在疯狂烧你的带宽。<br><br>
robots.txt 只能靠自觉，封 IP 段误伤太大。<br>
<b style="color:#e2e8f0">AIGate 帮你做选择题：放行能带来引用的 AI 搜索，挡掉只烧钱的训练爬虫。</b></p>
<div class="cta"><a class="btn" href="/__aigate">打开控制台试试</a>
<a class="btn ghost" href="#deploy">一键部署教程</a></div></div>

<div class="sec"><h2>GEO 时代，你要同时做好两件事</h2>
<p style="color:#94a3b8;font-size:15px;line-height:1.9">
<b style="color:#e2e8f0">第一，被 AI 引用。</b>Perplexity、ChatGPT Search、Claude 联网搜索——这些引擎的回答直接带来源链接，
是新一代流量入口。AIGate 默认放行这类"AI 搜索引用"，还在控制台里给你一张 <b style="color:#e2e8f0">GEO 引用可见性表</b>，
一眼看清你的网站现在能被哪些 AI 引用。<br><br>
<b style="color:#e2e8f0">第二，不被爬虫拖垮。</b>GPTBot、ClaudeBot、CCBot、Bytespider——训练爬虫只烧带宽不带来访问，
默认走 JS 挑战或直接拦截。网关是执行层（真拦截），再送你一份自动生成的
<a href="/__aigate/robots.txt" style="color:#38bdf8">robots.txt</a> 做声明层，两层都要。</p></div>

<div class="sec"><h2>它怎么工作</h2><div class="grid">
<div class="card"><div class="num">🔍</div><h3>识别</h3><p>内置 ${AI_BOTS.length} 种 AI 爬虫指纹库：GPTBot、ClaudeBot、PerplexityBot、Bytespider……按 UA 精准识别，不靠猜。</p></div>
<div class="card"><div class="num">🎯</div><h3>分类处置</h3><p>AI 搜索引用（Perplexity/ChatGPT 用户点击）→ 放行，这是你的 GEO 流量；训练爬虫 → 挑战或拦截；恶意高频抓取 → 直接 403。</p></div>
<div class="card"><div class="num">⏱️</div><h3>限流</h3><p>单个 IP 的 AI 爬虫请求超过阈值自动限流，HN 爆款那天的"每分钟几十次轮询"直接掐死。</p></div>
</div></div>

<div class="sec" id="deploy"><h2>一键部署（5 分钟，免费）</h2>
<table>
<tr><td><b>1</b></td><td>复制 <code>worker.js</code>，到 Cloudflare Dashboard → Workers → Create 新建 Worker，粘贴保存</td></tr>
<tr><td><b>2</b></td><td>Settings → Variables 加环境变量：<code>AI_GATE_MODE=proxy</code>，<code>ORIGIN_URL=https://你的源站</code></td></tr>
<tr><td><b>3</b></td><td>Workers → Triggers → Add Custom Domain，绑你的域名，大功告成</td></tr>
</table>
<p style="color:#94a3b8;font-size:14px">详细图文教程见项目 README。免费版每天 10 万请求额度，个人小站完全够用。</p></div>

<div class="footer">AIGate v0.1 · 为独立站长而造 · Cloudflare Workers 免费版即可运行</div>
</body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

// ------------------------------------------------------------------
// 主入口
// ------------------------------------------------------------------
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const ua = request.headers.get("User-Agent") || "";
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";

    // 控制台与 API
    if (url.pathname === "/__aigate" || url.pathname === "/__aigate/") {
      return dashboardPage(env);
    }
    if (url.pathname === "/__aigate/robots.txt") {
      return robotsTxt(env);
    }
    if (url.pathname === "/__aigate/api/test") {
      const testUa = url.searchParams.get("ua") || "";
      const bot = detectBot(testUa);
      if (!bot) {
        return Response.json({ html: `❓ 未识别为已知 AI 爬虫 → <b>直接放行</b>（当作普通访客）` });
      }
      const action = decide(bot, env);
      const word = action === "allow" ? "✅ 放行" : action === "block" ? "⛔ 拦截" : "🟡 挑战验证";
      return Response.json({
        html: `识别为 <b>${bot.name}</b>（${bot.vendor} · ${CAT_LABEL[bot.cat]}）<br>${bot.note}<br>判定动作：<b>${word}</b>`,
      });
    }

    // demo 模式：落地页
    if (cfg(env, "AI_GATE_MODE", "demo") !== "proxy") {
      return landingPage();
    }

    // ---- proxy 模式 ----
    const bot = detectBot(ua);
    if (!bot) {
      return fetch(new Request(cfg(env, "ORIGIN_URL", "") + url.pathname + url.search, request));
    }

    console.log(`[AIGate] ${bot.name} from ${ip} UA=${ua.slice(0, 80)}`);

    if (!checkRateLimit(`ai:${ip}`, env)) {
      return new Response("请求过于频繁，请稍后再试", { status: 429 });
    }

    const action = decide(bot, env);
    const originBase = cfg(env, "ORIGIN_URL", "");
    if (!originBase) {
      return new Response("AIGate: proxy 模式需要设置 ORIGIN_URL 环境变量", { status: 500 });
    }
    const originReq = new Request(originBase + url.pathname + url.search, request);

    if (action === "allow") return fetch(originReq);
    if (action === "block") return blockPage(bot);
    // challenge
    const cookie = request.headers.get("Cookie") || "";
    if (cookie.includes("aigate_pass=1")) return fetch(originReq);
    return challengePage(url);
  },
};
