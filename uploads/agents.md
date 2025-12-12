## AITradeX – Strategy Overview (New Draft)

> 目标：把当前实现的 **Arbitrage Bot** 文案重写成一个更现代的版本，  
> 默认策略命名为 **Cross‑Arbitrage‑Bot**，并且不再把任何具体 LLM 写死在文案里。

---

### 1. Execution Engine

- **Unified Strategy Pipeline**  
  The trading engine now routes signals from **any strategy agent** through the same execution pipeline.  
  This includes:
  - Cross‑exchange arbitrage signals  
  - LLM‑driven directional trades  
  - Future rule‑based strategies

- **Arbitrage‑Aware Pricing**  
  Execution explicitly tracks the **entry price pair** (buy venue / sell venue) used for each arbitrage trade.  
  This is crucial for:
  - Calculating net spread after fees  
  - Visualizing which venue pair generated the opportunity  
  - Auditing each trade’s reasoning later

---

### 2. UI Improvements

- **Sidebar: Strategy Selector**  
  The sidebar now lists all available strategies, for example:
  - `Cross‑Arbitrage‑Bot` *(default)*  
  - `LLM Strategy Trader` *(DeepSeek / GPT / Claude / … depending on your config)*  
  - Future custom strategies

  Clicking a strategy instantly switches the active agent without restarting the app.

- **Trade History: Strategy‑aware logging**  
  The `Trades` tab now includes:
  - **Strategy** – which agent produced this trade  
  - **Reasoning** – a short explanation, e.g.  
    - `Arbitrage Entry: Buy on Exchange A, Sell on Exchange B`  
    - `LLM Strategy: Reduce BTC exposure due to elevated funding rates`

  This makes it clear **who did what** and **why**.

---

### 3. Strategies & How to Use

#### 3.1 Cross‑Arbitrage‑Bot (Default)

> 当前已经实现的 Bot 逻辑，但用新的命名和文案描述。

**What it does**

- Continuously monitors the market using **live prices from CryptoCompare** (as the neutral price feed).  
- On top of that, the engine simulates a **cross‑exchange spread** between a *buy venue* and a *sell venue*  
  （目前是模拟价差，未来将替换为真实 CEX 盘口 / OKX + 其他交易所的数据源）.
- When the **simulated spread** between the two venues exceeds a configurable threshold  
  (e.g. **0.3%** after fees), the bot generates an **instant arbitrage entry**:
  - Buy on the cheaper side  
  - Sell on the more expensive side  
  - Lock in the spread as “paper profit” in the simulation environment

**How to use**

1. In the sidebar, ensure **`Cross‑Arbitrage‑Bot`** is selected.  
2. Click **`Start Trading`**.
3. The bot will:
   - Subscribe to live prices for the configured symbols  
   - Continuously compute a synthetic *cross‑venue* spread  
   - Fire arbitrage trades whenever `spread ≥ threshold`
4. Open the **`Trades`** tab to inspect:
   - Buy & Sell legs of each arbitrage pair  
   - The venue pair used (e.g. `Simulated-OKX / Simulated-Binance`)  
   - The locked spread and net PnL for that opportunity  
   - The “Reasoning” column explaining why this entry was taken

> ⚠️ 当前版本：  
> - 所有套利交易仍运行在**模拟环境**中，用 CryptoCompare 现价 + 模拟价差。  
> - 未来对接 OKX 模拟盘 / 实盘和其他 CEX 时，这一策略可以无缝切换到真实 orderbook 数据。

---

#### 3.2 LLM Strategy Trader（多模型策略代理）

> 不再写死 GPT‑4o，而是对任何高阶 LLM 开放：DeepSeek、GPT‑5.x、Claude、Gemini 等。

**What it does**

- Uses a configurable **LLM Strategy Agent** to analyze:
  - Current market snapshot (价格、波动、技术指标)  
  - Your simulated / real portfolio (仓位、现金、历史收益)  
  - 可选的 Research Agent 输出（例如基于 Exa 抓取的新闻 & 研究摘要）
- Produces a **structured trade plan** in JSON, such as:
  - Increase / reduce certain positions
  - Rotate between assets
  - Move to cash when risk is too high

**How to switch to it**

1. Configure your LLM provider in the settings:
   - Provider type: `openai` / `deepseek` / `anthropic` / `gemini` / …  
   - Model name: e.g. `gpt-5.1`, `deepseek-r1`, `claude-3.x` （根据你实际有的权限配置）  
   - API key / base URL
2. In the sidebar, click **`LLM Strategy Trader`**.
3. Click **`Start Trading`**:
   - The engine will periodically（按设置的频率）构造一个结构化 context，  
     并调用你配置的 LLM 模型获取交易计划。
   - 所有计划都会在执行前经过本地 Risk Engine 审核，超出风控边界的部分会被削减或拒绝。
4. 在 `Trades` 和 `Conversations` 中可以看到：
   - 具体执行的订单  
   - LLM 生成的 JSON 决策  
   - 以及简短的 reasoning 文本

> 关键点：  
> - 项目层面不再强绑定任何单一模型（例如 GPT‑4o）。  
> - 你可以根据成本 / 延迟 / 能力自由切换到新的模型代号。  
> - 如果模型支持 function‑calling 或 JSON schema，系统会自动启用更严格的结构化模式；  
>   否则使用 AITradeGame 式的 “纯文本 + JSON 解析 fallback”。

---

### 4. 默认行为总结

- 新安装 / 新启动时，**默认启用的是 `Cross‑Arbitrage‑Bot`**：
  - 立刻可以在纯模拟环境中体验套利逻辑；
  - 不需要配置任何 LLM 或交易所 API Key。
- 任何与 LLM 相关的策略（`LLM Strategy Trader` 等）：
  - 都是** opt‑in **；  
  - 必须在设置中显式配置模型和密钥后，才能切换启用。
- 未来对接 OKX 模拟盘 / 实盘、Exa Research API 等能力时：
  - 只改变底层数据源和 Agent context，  
  - 不需要改变用户侧“选择策略 → Start Trading → 看 Trades”的使用方式。

---

### 5. 下一步（规划性的说明，可放在文档末尾）

- **真实 Cross‑CEX 数据源**  
  - 用 OKX + 另一家交易所的 orderbook 替代当前的“CryptoCompare + 模拟价差”；  
  - 将 `Cross‑Arbitrage‑Bot` 从纸上套利升级为接近真实盘口的研究环境（仍可先跑在 demo 盘）。
- **Exa 研究 Agent 整合**  
  - 为 LLM Strategy Trader 提供一个 `ResearchContext`，由 Exa 搜索 + 摘要生成；  
  - 在 UI 上展示“本次策略依据的外部信息源”列表，方便复盘。
- **多 Agent 协同**  
  - 允许同时运行 `Cross‑Arbitrage‑Bot` 作为低风险收益来源，  
    再由 LLM Strategy Trader 管理剩余资金的方向性交易，  
    在 Trade History 中分清来源与贡献。

> 这一版文案既与当前实现保持一致（默认模拟跨套利 + CryptoCompare 价格），又为后续接入 OKX / Exa 和新一代 LLM 留好了位置，同时避免把 GPT‑4o 这种已经显得“过时”的模型写死在任何用户-facing 文档里。
`````0