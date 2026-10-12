# GeoPulse Scanner（中文说明）

**客户在 AI 搜索里问到你卖的东西时，你的品牌有没有被推荐？你的网站有没有被引用？**

GeoPulse Scanner 用客户会问的问题去问 OpenAI 和 Perplexity（联网搜索），然后逐条告诉你：每个回答有没有把你的品牌列为可选对象、有没有引用你自己网站的页面。每条判断都附带原回答全文和来源，你可以自己核对。

开源（MIT），自带 API key，一次完整检测在你自己的账户上约花 0.35 美元。

[English](README.md) · [检测方法](docs/how-it-works.md)

![样例报告（虚构品牌）](docs/images/report-desktop-top.png)

<sub>样例数据全部虚构，没有调用任何 API。[看一条回答的判断依据](docs/images/report-desktop-answers.png) · [50 秒演示视频（MP4）](docs/demo/geopulse-scanner-demo.mp4)</sub>

---

### 两种用法

| | **自己运行**（本仓库） | **[GeoPulse 云服务](https://smrtgeo.com/open-source?utm_source=github&utm_medium=referral&utm_campaign=oss-launch&utm_content=readme-cloud)** |
|---|---|---|
| 准备 | Node.js + 自己的 OpenAI / Perplexity key | 填邮箱登录，不用 key、不用安装 |
| 一次检测：10 题 × 2 引擎 × 2 次 | ✓ 完整检测，本地 HTML / JSON / CSV 报告 | ✓ 同一套协议 |
| 推荐、引用证据和原回答 | ✓ | ✓ |
| 保存历史、前后对比 | —（文件自己保存） | ✓ |
| 竞品跟踪、报告导出、内容草稿 | 每次检测可填竞品 | ✓ |
| 运行与维护 | 你自己 | 我们 |

自己运行永远免费且完整，出报告不依赖云服务。

## 快速开始

需要 Node.js 20 以上。

```bash
git clone https://github.com/<org>/geopulse-scanner.git
cd geopulse-scanner
npm install
```

**先看样例报告（不需要 key，不发任何请求）：**

```bash
npm run demo
```

打开 `reports/demo/report.html`。

**正式检测：**

```bash
cp .env.example .env        # 填 OPENAI_API_KEY 和 PERPLEXITY_API_KEY
npm run init                # 生成 scan.json，填你的品牌、市场和 10 个问题
npm run scan -- --config scan.json
```

发出任何请求之前，会先显示调用次数和偏高的费用估算，确认后才开始；`--max-usd`（默认 1.50）达到后不再发新请求。

## 问题怎么写

- `provider_discovery`（推荐类）：买家在找东西或找人（“哪些品牌……”“哪里能买……”“谁能帮我……”）。看的是：**你有没有被列为可选对象。**
- `research_citation`（知识类）：用户想弄懂一件事（“怎么……”“……是什么意思”“……安全吗”）。看的是：**有没有引用你网站上的页面。**

最多 10 题，建议 6 + 4。按客户的口吻写，不要带你的品牌名。

## 数据去哪里

- 每个问题从你的电脑**直接**发给 OpenAI 和 Perplexity，不经过 GeoPulse，没有任何统计上报。
- 请求里只有问题本身和简短的中立指令，**不含你的品牌、网站和竞品**，避免把答案往你身上引。

## 局限（请务必看）

- 这是**固定问题经由 API 的检测快照**，不是 ChatGPT / Perplexity 消费端 App 里的排名，也不代表所有用户看到的结果。
- 每次回答会有差异，所以每题每个引擎问两次；只有问题、引擎、模型和指令完全一致的两次检测才可比较。
- 判断规则偏保守，每条判断都显示依据的原文，重要的请自己核对。
- 不承诺改网站后这些数字一定上升。

## 许可

MIT © 2026 MORROW PRISM PTE. LTD.
