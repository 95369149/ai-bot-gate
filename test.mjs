// 本地逻辑测试：截取 worker.js 的纯逻辑段（"// 页面模板"之前）直接执行验证
import { readFileSync } from "fs";

const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const cut = src.indexOf("// ------------------------------------------------------------------\n// 页面模板");
if (cut < 0) throw new Error("找不到页面模板分隔线");
const logic = src.slice(0, cut);

const fn = new Function(
  logic +
    `
const results = [];
const env = {}; // 默认环境

// 1. 识别测试
const cases = [
  ["Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)", "gptbot", "challenge"],
  ["Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)", "claudebot", "challenge"],
  ["Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/bot)", "perplexitybot", "allow"],
  ["Mozilla/5.0; compatible; ChatGPT-User/1.0; +https://openai.com/bot)", "chatgpt-user", "allow"],
  ["Mozilla/5.0 (compatible; Bytespider/1.0; https://zhanzhang.toutiao.com/)", "bytespider", "challenge"],
  ["Mozilla/5.0 (compatible; CCBot/2.0; https://commoncrawl.org/faq/)", "ccbot", "challenge"],
  ["Mozilla/5.0 (compatible; Diffbot/2.0)", "diffbot", "block"],
  ["Mozilla/5.0 AppleWebKit/537.36 Chrome/120 Safari/537.36", null, null],
  ["curl/8.0", null, null],
];
for (const [ua, expectId, expectAction] of cases) {
  const bot = detectBot(ua);
  const gotId = bot ? bot.id : null;
  const action = bot ? decide(bot, env) : "pass-through";
  const ok = gotId === expectId && (expectAction === null || action === expectAction);
  results.push({ ua: ua.slice(0, 42), gotId, action, ok });
}

// 2. 覆盖配置测试
const env2 = { ALLOW_BOTS: "gptbot", BLOCK_BOTS: "perplexitybot", DEFAULT_INDEX_ACTION: "block" };
const t2a = decide(detectBot("x GPTBot/1.0 y"), env2);
const t2b = decide(detectBot("x PerplexityBot/1.0 y"), env2);
const t2c = decide(detectBot("x CCBot/1.0 y"), env2);
results.push({ case: "ALLOW_BOTS 覆盖", action: t2a, ok: t2a === "allow" });
results.push({ case: "BLOCK_BOTS 覆盖", action: t2b, ok: t2b === "block" });
results.push({ case: "DEFAULT_INDEX_ACTION=block", action: t2c, ok: t2c === "block" });

// 3. 指纹库完整性
results.push({ case: "指纹库数量", count: AI_BOTS.length, ok: AI_BOTS.length >= 20 });

// 4. 限流测试
rateMap.clear();
const envR = { RATE_LIMIT_PER_MIN: "3" };
const r1 = checkRateLimit("1.2.3.4", envR);
const r2 = checkRateLimit("1.2.3.4", envR);
const r3 = checkRateLimit("1.2.3.4", envR);
const r4 = checkRateLimit("1.2.3.4", envR); // 第4次应被限
results.push({ case: "限流 3/min", ok: r1 && r2 && r3 && !r4 });

return results;
`
)();

let fail = 0;
for (const r of fn) {
  console.log(r.ok ? "PASS" : "FAIL", JSON.stringify(r));
  if (!r.ok) fail++;
}
if (fail === 0) console.log("\n全部通过 ✅");
else console.log("\n" + fail + " 项失败 ❌");
process.exit(fail === 0 ? 0 : 1);
