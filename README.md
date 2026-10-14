# 🛡️ AIGate · AI 爬虫防火墙 / AI 引用网关

> 放行优质 AI 搜索引用，挡掉烧钱的训练爬虫。Cloudflare Workers 免费版即可跑。

[![Deploy](https://img.shields.io/badge/Cloudflare-Workers-orange)](https://workers.cloudflare.com/)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-17%20passed-green)](test.mjs)

**在线演示**：https://ai-bot-gate.fangzimo168.workers.dev/ ｜
**控制台**（UA 在线测试）：https://ai-bot-gate.fangzimo168.workers.dev/__aigate

## 为什么做

HN 242 分热帖《I posted to HN, and then my website was flooded with AI bot traffic》：
博主上 HN 热门后，近一半流量来自某家 AI 简报服务的高频轮询，
加上 ClaudeBot / GPTBot / Bytespider，服务器被拖慢。
评论区多位站长晒出被 AI 爬虫拖慢、烧出高额云账单的案例。

robots.txt 只能靠自觉，封 IP 段误伤太大——
缺一个"精细选择"的工具：**AI 搜索引用是优质流量（GEO），要放行；训练爬虫只烧钱，要挡掉。**

## 三类处置，一行配好

| 类别 | 例子 | 默认动作 | 为什么 |
|---|---|---|---|
| 🔍 AI 搜索引用 | PerplexityBot、ChatGPT-User、Claude-User | ✅ 放行 | 用户点开你网站，GEO 流量 |
| 🏭 训练/索引爬虫 | GPTBot、ClaudeBot、CCBot、Bytespider | 🟡 JS 挑战 | 只耗带宽，不带来访问 |
| 🤖 代理式抓取 | Diffbot、GrokBot | ⛔ 拦截 | 高频，多为无价值抓取 |

内置 **22 种** AI 爬虫指纹库，另有单 IP 限流（默认 30/分钟）掐死 HN 爆款式轮询。

## 5 分钟部署（免费）

**方法一：Dashboard 粘贴（推荐新手）**

1. [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages** → **Create** → **Create Worker** → **Deploy**
2. **Edit code** → 删掉默认代码 → 粘贴本仓库 `worker.js` 全文 → **Save and deploy**
3. **Settings** → **Variables** 添加：
   - `AI_GATE_MODE` = `proxy`
   - `ORIGIN_URL` = `https://你的源站`
4. **Settings** → **Domains & Routes** → **Custom Domain** 绑域名 → 完成

**方法二：Wrangler（推荐开发者）**

```bash
git clone https://github.com/95369149/ai-bot-gate.git
cd ai-bot-gate
npx wrangler login
npx wrangler deploy
```

## 配置速查

| 变量 | 默认值 | 说明 |
|---|---|---|
| `AI_GATE_MODE` | `demo` | `demo`=演示落地页；`proxy`=网关模式 |
| `ORIGIN_URL` | — | proxy 必填，源站地址 |
| `DEFAULT_SEARCH_ACTION` | `allow` | 搜索引用类默认动作 |
| `DEFAULT_INDEX_ACTION` | `challenge` | 训练爬虫类默认动作 |
| `DEFAULT_AGENT_ACTION` | `block` | 代理抓取类默认动作 |
| `ALLOW_BOTS` / `BLOCK_BOTS` | 空 | 强制放行/拦截，逗号分隔 id |
| `RATE_LIMIT_PER_MIN` | `30` | 单 IP 每分钟上限，超了 429 |

动作：`allow`=透传源站；`block`=403 拦截页；`challenge`=JS cookie 验证（2 秒，通过放行）。

## 本地测试

```bash
node test.mjs   # 17 项：识别 / 默认动作 / 覆盖配置 / 限流 / GEO / robots.txt
```

## 版本规划

- **Free v0.2**（本仓库）：指纹库 + 三类策略 + 限流 + 控制台，规则手动更新
  - 🎯 **GEO 引用可见性面板**：你的网站能被 Perplexity / ChatGPT Search / Claude / Copilot 引用吗？一目了然
  - 🤖 **robots.txt 生成器**（`/__aigate/robots.txt`）：与网关配置自动保持一致，执行层 + 声明层两手抓
  - GEO 知识：出海=Perplexity/ChatGPT/Gemini，国内=豆包/DeepSeek/Kimi——引用价值已标注进指纹库
- **Pro**（规划中）：☁️ 云端规则库自动更新 · 📊 拦截统计面板（省了多少带宽费） ·
  🖥️ 多站点统一管理 · 🔒 爬虫身份验证（反向 DNS 防冒充）

## 贡献

欢迎 PR 补充新的 AI 爬虫指纹：按 `AI_BOTS` 数组格式加一行，跑 `node test.mjs` 通过即可。
