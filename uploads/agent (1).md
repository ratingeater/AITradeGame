## 0. 这一轮要补什么？

上一轮我们已经把 **架构 / 数据结构 / 策略框架** 讲完了，这一轮你要的是：

- 不再纠结代码细节，而是：
  - **Agent 粒度的设计**（有哪些角色、各自负责什么）
  - **Prompt 流（Prompt Flow）**——每一步谁说什么、输入输出什么
  - **信息如何映射进 LLM 的 context**（特别是行情、持仓、OKX 状态、Exa 爬回来的网页）
- 设计时要 **参考 AITradeGame 和 crypto_invest_with_ai 的做法**，不要用已经淘汰的老模式
- 考虑：  
  - 有些模型支持 function calling / tools / MCP  
  - 有些只支持纯文本 + JSON / web_search_options（比如 crypto_invest_with_ai 里就是用 `chat.completions.create(..., web_search_options={})` 来启用搜索0  
- 规划 **OKX 模拟盘（demo）和实盘** 接入（REST + Python SDK），包括 `x-simulated-trading` 和 Python SDK `flag` 的用法1  
- 规划 **Exa Search API / 爬虫** 的接入（/search, /contents, search_and_contents, OpenAI tool 调用方式等）2  

下面我就按“**Agent → Prompt Flow → Context 对接 → OKX&Exa 对接**”来系统展开。

---

## 1. 多 Agent 角色设计（逻辑层面）

在上一次的 AITradeX 架构基础上，我们把“系统组件”翻译成“**Agent 角色**”，然后为每个 Agent 设计：

- 输入（Input）
- 输出（Output）
- 是否调用 LLM
- 是否使用工具（function calling / MCP / Exa / OKX）

### 1.1 Agent 总览

建议的核心 Agent 列表：

1. **Market Agent（行情与交易所 Agent）**
   - 职责：
     - 汇总来自 Binance / OKX / 其他 CEX 的行情。
     - 对接 OKX 市场数据（GET /Tickers, /Candlesticks 等）3  
     - 把结果压缩成结构化快照和低维特征（技术指标）。
   - 输出：`MarketSnapshot`（JSON，可直接传给其他 Agent 或 LLM）。

2. **Account & Portfolio Agent（账户与组合 Agent）**
   - 职责：
     - 读取数据库中的模拟组合（AITradeGame 原有 `portfolios` / `trades` 表）。
     - 如果启用了 OKX，只读或交易：
       - 调 OKX REST / Python SDK 获取余额、持仓、委托等4  
     - 聚合成统一的组合视图。
   - 输出：`PortfolioSnapshot` + `AccountInfo`（可用于 prompt）。

3. **Research Agent（研究 / 资讯 Agent）——基于 Exa + 模型 WebSearch**
   - 职责：
     - 利用 Exa `/search` + `/contents` 或 `search_and_contents` 查新闻 / 研报 / GitHub / PDF 等5  
     - 根据交易标的 / 时间范围自动构造查询条件（category, startPublishedDate, includeDomains 等）6  
     - 生成结构化的“研究摘要” + 引用列表。
   - 输出：`ResearchContext`（压缩后的 Markdown + citations + 标签）。

4. **Strategy Agent（策略决策 Agent）**
   - 职责：
     - 接收 `MarketSnapshot` + `PortfolioSnapshot` + `AccountInfo` + `ResearchContext`。
     - 根据策略类型产出：
       - **交易指令型**（LLMJsonStrategy）：JSON 形式的买卖/平仓信号。
       - **投顾分析型**（LLMAdvisoryStrategy）：综合分析 + 建议（对应 crypto_invest_with_ai 的 SmartRecommendationEngine）7  
       - **套利型**（ArbitrageStrategy）：可以是纯规则，也可以 LLM 只负责解释。
   - 输出：  
     - `TradePlan`（结构化 JSON，后续交由 Risk & Execution Agent 处理）  
     - 或 `AdvisoryNote`（文本 + 结构化辅助字段）。

5. **Risk Agent（风险控制 Agent）**
   - 职责：
     - 基于 `TradePlan` + `AccountInfo` + 预先配置的风控规则（最大仓位 / 单笔风险 / 杠杆上限 / OKX 账户模式限制等）8  
     - 对计划进行审查、打分、压缩（减少仓位）、拒绝不合理订单。
   - 可选：使用 LLM 做“风险解释”和“策略改写”（让 LLM 作为“风控顾问”而不是硬编码规则的替代）。

6. **Execution Agent（执行 Agent）**
   - 职责：
     - 对接模拟撮合（AITradeGame 原 `TradingEngine`）和 OKX 下单接口。
     - 在 demo 环境下通过：
       - OKX 原生 demo 盘 + `x-simulated-trading: 1` 头部 9  
       - 或 python-okx 的 `flag=1` 参数切换 demo / live10  
     - 在实盘模式中，严格执行风险限制，只接受来自 Risk Agent 已批准的计划。

7. **Explainability Agent（解读 / 报告 Agent）**
   - 职责：
     - 将已经执行的交易、风险调整、研究摘要，合成用户可读的日报 / 周报 / 策略复盘。
     - LLM 输出，**不参与实际交易决策**。

> 总体思路：  
> **只有 Strategy / Risk / Explainability Agent 使用 LLM；其他 Agent 尽量 deterministic。**  
> 这样可以减少 LLM 误操作的可能，把 LLM 控制在“可控环节”。

---

## 2. Prompt Flow 总体规划（跨 Agent 的链路）

为了避免 prompt 变成一团乱麻，我们把整个流程拆成几个阶段：

1. **数据准备阶段（无 LLM）**  
   - Market Agent → `MarketSnapshot`  
   - Account & Portfolio Agent → `PortfolioSnapshot` & `AccountInfo`  
   - 可选：调用 OKX market / account API 填充真实数据。

2. **研究阶段（Research Agent，LLM + Exa）**
   - 先调用 Exa `/search`（或 python SDK 的 `search_and_contents`）拿网页内容11  
   - 再把结果丢给 LLM 做 summarization / structuring。

3. **策略决策阶段（Strategy Agent）**
   - 输入：  
     - 精简版 `MarketSnapshot`  
     - 精简版 `PortfolioSnapshot`  
     - `AccountInfo`  
     - `ResearchContext`  
   - 输出：`TradePlan` 或 `AdvisoryNote`。

4. **风控审查（Risk Agent）**
   - 输入：`TradePlan` + `AccountInfo` + 风控参数。  
   - 输出：`ApprovedTradePlan` / 否决原因。

5. **执行（Execution Agent）**
   - 输入：`ApprovedTradePlan`。  
   - 输出：订单执行结果 + 更新后的组合记录。

6. **报告解释（Explainability Agent）**
   - 输入：执行结果 / 分析结果 / 历史上下文。  
   - 输出：人类可读的报告。

在技术实现上，你可以根据 provider 能力，将 2–4 步合并到同一模型的多个轮次对话，或拆成多个模型/多次调用。

---

## 3. Prompt 设计原则（结合原有项目 & 新特性）

### 3.1 避免“过时”模式：多能力探测 + 多级回退

**现状参考：**

- crypto_invest_with_ai 的 SmartAnalysisEngine 使用 `OpenAI` 新版 client：  

  ```python
  response = self.client.chat.completions.create(
      model=self.ai_config.model_name,
      messages=[...],
      web_search_options = {},  # 启用网络搜索工具
      stream=False,
      max_tokens=3000,
  )
  ```  

  这是基于 `gpt-4o-search-preview` 等模型的官方 `web_search_options` 参数，属于比较新的用法12。

- Exa 官方更推荐：用 **tool calling + Responses API** 来接入 Exa 搜索，与 OpenAI 最新建议一致13。

**因此 Prompt/调用层要做的不是“选一个”，而是：**

1. **为每种 provider 定义能力 bitmap：**

   ```json
   {
     "supports_tools": true/false,
     "supports_mcp": true/false,
     "supports_web_search_options": true/false,
     "supports_json_response_format": true/false
   }
   ```

2. **统一 LLMBackend 抽象：**
   - 当 `supports_tools=true` 时：优先用 `tools`（function calling）把 Exa / OKX / 内部数据暴露为工具；  
   - 当 `supports_web_search_options=true` 时：可以像 SmartAnalysisEngine 一样给 `web_search_options={}`，让模型自己用内置搜索14；  
   - 否则：采用“**外部数据 + 文本 RAG**”模式（先拿 Exa / OKX 数据，再拼进 prompt）。

3. **统一 JSON 输出：**
   - 对于支持 `response_format={"type":"json_schema"}` 的模型，用 schema 强约束输出。
   - 对于不支持的模型，沿用 AITradeGame 的“**JSON + 容错解析**”模式：  
     - Prompt 中明确要求只输出 JSON；  
     - 解析失败时用 regex 提取 JSON 片段并回退（AITradeGame 已实现类似逻辑）。

> 总结就是：  
> **不是强行全用老的 `ChatCompletion` 写死，而是建立一个“能力分层 +多重 fallback”的 LLM 调用层。**

### 3.2 系统提示（System Prompt）分层

推荐使用三层 prompt 概念：

- **System Prompt（角色 + 行为硬约束）**  
- **Developer Prompt / Context（框架提供的说明、数据结构）**  
- **User Prompt（本次请求的具体任务）**

对于每个 Agent（特别是 Strategy/Risk/Research）：

1. System Prompt 定义角色、原则和禁止事项。
2. Developer Prompt 描述输入结构（JSON 字段）和输出 schema。
3. User Prompt 则是一行或几行自然语言，“今天你要给我出 XXX 策略”。

下面开始具体到每个 Agent 的 Prompt 流。

---

## 4. Strategy Agent 的 Prompt 设计与 Context 映射

### 4.1 输入上下文结构（建议 JSON）

我们先定义一个逻辑上的 `StrategyContext`（之前在代码层也有类似抽象，这里更多是“给 LLM 看的数据结构”）：

```json
{
  "env": {
    "mode": "simulation | paper_okx | live_okx",
    "exchange": "OKX",
    "base_currency": "USDT",
    "time_utc": "2025-11-23T12:34:56Z"
  },
  "market": {
    "symbols": ["BTC/USDT", "ETH/USDT", "SOL/USDT"],
    "snapshots": {
      "BTC/USDT": {
        "price": 64321.5,
        "change_24h_pct": 2.3,
        "volume_24h": 123456789,
        "sma_7": 63000.1,
        "sma_14": 62000.5,
        "rsi_14": 62.3
      }
      // ...
    }
  },
  "portfolio": {
    "cash": 10000.0,
    "positions": [
      {
        "symbol": "ETH/USDT",
        "size": 1.5,
        "avg_price": 3500.0,
        "unrealized_pnl": 200.0
      }
    ],
    "total_value": 15000.0,
    "total_pnl": 500.0,
    "max_drawdown": 0.12
  },
  "account_info": {
    "initial_capital": 10000.0,
    "current_equity": 15000.0,
    "return_pct": 50.0
  },
  "research": {
    "summary_md": "### 市场概况 ...",
    "tags": ["btc_halving", "eth_etf", "macro"],
    "sources": [
      {"title": "...", "url": "..."},
      {"title": "...", "url": "..."}
    ]
  },
  "risk_config": {
    "max_single_position_pct": 0.2,
    "max_leverage": 3,
    "max_daily_loss_pct": 0.05
  }
}
```

**技术上**，这些字段来自：

- `market`：Market Agent + OKX `/Tickers`、`/Candlesticks` 等。15  
- `portfolio` / `account_info`：AITradeGame 的 DB + OKX account API（可选）。16  
- `research`：Research Agent 基于 Exa 搜索返回的 summary。17  

### 4.2 交易指令型（LLMJsonStrategy）Prompt 流

#### 4.2.1 System Prompt 示例（逻辑）

> 你是一名专业的加密货币量化交易员，负责在严格风控约束下，给出**结构化 JSON 交易计划**。  
> - 你只能使用输入中 `market.symbols` 提到的交易对。  
> - 你只能在 `risk_config` 允许的风险范围内分配仓位。  
> - 如果信息不足或风险过高，必须选择不交易，并说明理由。  
> - 严禁随意发明数据、严禁使用未在输入中出现的交易对。  
> - 你必须严格按照指定的 JSON 格式输出，不要输出任何额外文本。

#### 4.2.2 Developer Prompt（结构 & 输出 Schema）

例如：

- 先给出简化后的 `StrategyContext` JSON（对行情/历史要做截断，防止太长）。
- 然后再附上“输出格式要求”：

```text
下面是本轮决策所需的全部数据（JSON），请仔细阅读：

[STRATEGY_CONTEXT_JSON_BEGIN]
{...}
[STRATEGY_CONTEXT_JSON_END]

你需要给出本轮交易计划，输出为一个 JSON 对象，格式为：

{
  "version": "v1",
  "rationale": "用简洁中文解释整体思路",
  "orders": [
    {
      "symbol": "BTC/USDT",
      "action": "buy | sell | close | hold",
      "reason": "简洁中文说明",
      "confidence": 0.0-1.0,
      "target_position_pct": 0.15,
      "max_leverage": 1,
      "max_loss_pct": 0.02
    }
  ]
}

要求：
- `orders` 可以为空数组，表示本轮不交易。
- `target_position_pct` 是该标的占总资金的目标比例。
- 请确保所有订单组合后不违反 risk_config 限制。
- 不要输出任何解释性文本，只输出 JSON。
```

#### 4.2.3 User Prompt

User Prompt 可以非常短：

> “根据当前市场和组合情况，生成接下来 1 个周期（约 3 分钟）的交易计划。”

或者你可以让周期信息放进 `env`。

### 4.3 投顾型（LLMAdvisoryStrategy）Prompt 流

这里参考 crypto_invest_with_ai 的 SmartAnalysisEngine，它当前的 System Prompt 是：

> “你是一位拥有10年经验的专业加密货币投资顾问和技术分析师。”18  

我们可以在此基础上扩展：

#### 4.3.1 System Prompt

> 你是一位拥有 10 年经验的专业加密货币投资顾问和技术分析师，目标是：
> - 帮用户理解组合状态和市场环境；
> - 提供稳健、可落地的交易建议和风险提示；
> - 不直接替用户执行交易。
> 
> 原则：
> - 优先考虑风险控制和仓位管理；
> - 明确区分事实（来自输入数据）和推断（你的观点）；
> - 避免过度频繁交易和无意义调仓。

#### 4.3.2 Developer Prompt：结构化分析 + Markdown

输出结构可以与 SmartAnalysisEngine 的 `SmartAnalysisResult` 对应19：

```text
输入数据如下：

[PORTFOLIO_CONTEXT_BEGIN]
{ ... }  # 包含 portfolio + market + research 等
[PORTFOLIO_CONTEXT_END]

请按照以下结构输出 Markdown 文本（不要输出 JSON）：

# 市场概览
- 总体趋势：
- 关键驱动因素：
- 风险因素：

# 当前组合分析
- 总体收益与回撤：
- 持仓结构（按品种和风险维度）：
- 过度集中或重复暴露风险：

# 交易建议
- 短期调整建议（1-3 天）：
- 中期配置建议（1-4 周）：
- 不建议操作的理由：

# 风险管理
- 最大可接受回撤建议：
- 止损 / 止盈建议：
- 建议减少的风险敞口：

# 关键价格区间
- 对每个核心交易对，给出支撑位 / 压力位的区间和逻辑说明。

请用简洁中文输出，避免长段废话。
```

程序端再把这个 Markdown 存入 `analysis_reports` 表，用于展示。

---

## 5. Research Agent + Exa 的 Prompt & 流程

### 5.1 Exa API 的定位

Exa 是“**为 AI 做的搜索引擎**”，核心 API 有：

- `/search`：根据 query + type（neural/fast/auto/deep）智能搜索网页，可指定 category（news/github/pdf/研究论文等），支持 includeDomains/excludeDomains、时间范围等20  
- `/contents`：根据搜索结果获取网页全文；  
- `search_and_contents`（Python SDK）：一条指令直接拿搜索 + 内容 + highlights21  
- 可以返回 `context: true` 一串已经拼好的、适合直接塞给 LLM 的文本 context22  
- 还提供 `/answer`、`/research` 做更高阶的结构化回答23  

### 5.2 Research Agent 的外部流程（无 tools / MCP）

在模型不支持 tools 或 MCP 的情况下，Research Agent 完全由后端 orchestrator + Exa API 实现：

1. **构造查询：**
   - 输入：`symbols` + `time_horizon`（比如 24h, 7d, 30d）+ category 偏好。
   - 对于 BTC/USDT：
     - Query: `"BTC price news last 24h leverage liquidation"`  
     - type: `"deep"` 用于全面搜索。  
     - category: `"news"`。  
     - `numResults`: 10。  
     - `startPublishedDate` / `endPublishedDate`：指定时间窗口24  

   - 调 `POST https://api.exa.ai/search`，请求体类似：

     ```json
     {
       "query": "BTC price news last 24 hours leverage",
       "type": "deep",
       "numResults": 10,
       "category": "news",
       "startPublishedDate": "2025-11-21T00:00:00.000Z",
       "endPublishedDate": "2025-11-23T00:00:00.000Z",
       "contents": {
         "text": true,
         "highlights": {
           "numSentences": 1,
           "highlightsPerUrl": 2
         },
         "summary": {
           "query": "描述与 BTC 价格波动最相关的因素"
         }
       }
     }
     ```25  

2. **生成 LLM 研究摘要：**
   - 将 Exa 返回的 `results` + `context`（统一文本）压缩，放进一个 summarization 模型（可以是同一个模型，也可以是更小的模型）：  

     - System Prompt：  
       > “你是研究助理，负责阅读一组加密货币新闻和分析网页，提取与 BTC/USDT 中短期价格波动最相关的信息，并用结构化 Markdown 输出。严禁臆造来源。”

   - Developer Prompt：提供来自 Exa 的 `context` 文本 + 主要链接列表。

   - 输出：`ResearchContext.summary_md` + 短期 / 中期驱动要点 + 数据来源列表。

3. **存储 & 传递：**
   - `ResearchContext` 存入 DB，Strategy / Risk Agent 在下一轮调用时从数据库直接读取。

### 5.3 使用 Tools / function calling 集成 Exa（支持时）

当使用 OpenAI / Anthropic 等支持 tools 的模型时，可以参考 Exa 官方的 **OpenAI Tool Calling 集成**26：

1. 定义 `exa_search` 工具：

   ```json
   {
     "type": "function",
     "function": {
       "name": "exa_search",
       "description": "Perform a search query on the web, and retrieve the world's most relevant information.",
       "parameters": {
         "type": "object",
         "properties": {
           "query": {"type": "string", "description": "The search query to perform."}
         },
         "required": ["query"]
       }
     }
   }
   ```

2. System Prompt 告诉模型：你有一个高级搜索工具，必要时请调用它，返回信息后再回答。

3. 后端实现 `exa_search(query)` → `exa.search_and_contents(...)`（Python SDK），并把结果以 `role: "tool"` 的消息插入对话历史中，然后再次调用 LLM 让它基于搜索结果回答27。

在我们的设计中，**Research Agent 可以是：**

- 纯 pipeline：先 Exa，再 LLM。
- 也可以是“单 LLM + tools”的对话式 agent。

> 和前面“能力位图”的思路兼容：  
> - supports_tools = true → 用 tools 方式；  
> - 否则 → 用 pipeline 方式。

### 5.4 MCP 结合 Exa（未来方向）

Exa 文档中也提到 **Exa MCP**（Model Context Protocol）集成28，这本质上是：

- 在支持 MCP 的模型/客户端（比如某些 IDE / Agent 框架）中，以 MCP 定义一个 Exa 资源；
- 模型通过 MCP 调用 Exa，而你的后端只需要暴露 MCP server。

在你当前项目中，可以先不强依赖 MCP，而是将 Exa 的使用封装在后端。未来如果使用支持 MCP 的 runtime，可以把现有的 Exa 调用“外包”成 MCP 服务；对 Agent 流程的逻辑影响很小。

---

## 6. OKX 模拟盘 & 实盘对接逻辑（Execution / Account Agent 视角）

### 6.1 OKX API 基础事实（简要）

根据官方 OKX API 文档29：

- REST 私有请求需要 HTTP 头部：
  - `OK-ACCESS-KEY`：API Key  
  - `OK-ACCESS-SIGN`：签名（基于 timestamp + method + requestPath + body，用 SecretKey HMAC 再 Base64 编码）  
  - `OK-ACCESS-TIMESTAMP`：UTC 时间字符串  
  - `OK-ACCESS-PASSPHRASE`：创建 API key 时设置的 passphrase  
- 模拟盘（Demo trading）和实盘的区分：
  - 模拟盘需要用“模拟盘 API Key” + 头部 `x-simulated-trading: 1`；  
  - 实盘需要真实账户的 API Key + 头部 `x-simulated-trading: 0`30。  
- 提供 Demo trading 服务文档，包括如何使用 demo 环境测试交易31。  
- Python SDK（`python-okx`）可以通过参数 `flag` 控制 live/demo：`flag=0` 实盘，`flag=1` demo32。  
- 账户和交易相关的丰富 REST / WebSocket 接口（余额、持仓、订单、tickers、candlesticks 等）33。

### 6.2 接入策略：始终先 Demo，再 Live

在 Agent 设计中：

1. **AccountConfig** 结构增加字段：

   ```json
   {
     "mode": "simulation | okx_demo | okx_live",
     "api_key": "...",
     "secret_key": "...",
     "passphrase": "...",
     "permissions": ["read", "trade"],
     "region_domain": "www.okx.com | eea.okx.com | us.okx.com"
   }
   ```

2. Market Agent 与 Account Agent：
   - 在 `mode="simulation"` 下，只用 Binance/CoinGecko + 本地 DB；  
   - 在 `mode="okx_demo"` / `"okx_live"` 下：
     - 行情可以用 OKX `/Tickers`、`/Candlesticks`，或仍然用 Binance 做价格参考；  
     - 账户信息通过 `GET /api/v5/account/balance` / `positions` 等拉取34。

3. Execution Agent：
   - 模拟模式：**完全不触碰 OKX**，只更新本地 DB。  
   - okx_demo：
     - 使用 demo API key + header `x-simulated-trading: 1` 发真实下单请求35；  
     - 或在 python-okx SDK 中设置 `flag=1`。36  
   - okx_live：
     - 需要用户明确授权（前端“我理解风险并同意启用实盘”）；  
     - 使用 trade 权限的 API key + `x-simulated-trading: 0`；  
     - 每个订单必须通过 Risk Agent 的审核。

4. 常见错误 & 防御：
   - `50101 APIKey does not match the current environment`：环境与 key 不匹配，需要检查 demo vs live37。  
   - `50102 Timestamp request expired`：本地时间与服务器差距 > 30s，需要调用 `Get system time` 对时38。  
   - `51010 Request unsupported under current account mode`：当前账户模式（仅现货 / 融资 / 合约等）不支持请求39。  

### 6.3 Execution Agent Prompt 流（如果用 LLM 参与解释）

Execution Agent 的下单逻辑最好是完全程序化，不让 LLM 直接触摸“下单”按钮。不过可以让 LLM 解释“为什么这样下单”。

比如，在每次下单完成后，将订单信息 + 策略来源交给 Explainability Agent：

- System Prompt：
  > “你是一名交易记录解读员。请根据给出的订单与策略背景，用简洁中文向用户解释‘为什么会有这笔交易’。严禁臆造订单。”

- 上下文：
  - `ApprovedTradePlan` 中该订单的 reason 字段；
  - MarketSnapshot 中当时的价格；
  - ResearchContext 中相关的研究要点；
  - 实际 OKX 下单 [成功/失败] 状态 + 错误码。

这样用户在 UI 中看到每笔交易，都能看到“策略理由 + 风控审查 + 实际执行结果”的链路。

---

## 7. 多 Provider 能力探测与 Prompt Flow 分支

结合前面所有设计，这里明确一个“**LLM 能力 → Prompt/工具使用方式**”矩阵：

### 7.1 能力探测（初始化时做）

- OpenAI 新模型（如 `gpt-4o`, `gpt-4o-search-preview`）：  
  - `supports_tools = true`（function calling）  
  - `supports_web_search_options = true`40  
  - `supports_json_response_format = true`  
  - `supports_mcp = 视 runtime 而定`

- DeepSeek / 自部署模型（比如通过 OpenRouter/代理）：
  - 通常 `supports_tools=false`，但有的代理会模拟；  
  - `supports_web_search_options` 未必有；  
  - 可以依赖 JSON 输出约定+正则解析。

- 其它（Anthropic、Gemini 等）：
  - 可以通过 LiteLLM/OpenRouter 等中间层统一接口41。

### 7.2 Prompt Flow 决策树示意

以 Strategy Agent 为例：

1. 如果 `supports_tools` 且你希望 LLM 直接调用数据 / Exa：

   - 把 Market Agent / Account Agent / Exa 封装成 tools：
     - `get_market_snapshot(symbols)`  
     - `get_portfolio_state(model_id)`  
     - `exa_search(query)`  
   - System Prompt 告诉模型：**“你有工具可以随时取最新数据，但你必须在下单前至少调用一次 get_market_snapshot 和 get_portfolio_state。”**  
   - LLM 整个决策流程可以在单次对话里完成。

2. 如果不支持 tools，但支持 `web_search_options`：

   - 类似 crypto_invest_with_ai 的 SmartAnalysisEngine：  
     - 直接在 `chat.completions.create(..., web_search_options={})` 中启用内置搜索42；  
     - 但 Exa 的价值仍在于“可控性和多源汇总”，可在 Research Agent 中使用。

3. 如果既不支持 tools，也没有 web_search：

   - 使用纯 pipeline:
     - 后端调用 Market Agent / Account Agent / Exa API；
     - 把处理后的 JSON/Markdown 放入 prompt；
     - LLM 只负责从这些静态上下文中做推理与决策。

> 整个项目级别上，只需要维护一套“Agent 语义流”，在不同能力层“**选择不同的实现分支**”，而不是为每个 provider 写一套完全不同的业务逻辑。

---

## 8. 最后总结：这一轮我们补齐了什么

这一轮我们从“非技术（代码）”的视角，把 AITradeX 的 **Agent 架构、Prompt Flow 和 Context 对接逻辑** 做了系统规划，核心补充点有：

1. 明确了 7 个核心 Agent：
   - Market / Account / Research / Strategy / Risk / Execution / Explainability。
2. 给出 Strategy / Research / Advisory / Execution Explanation 等关键 Agent 的  
   - System Prompt 原则  
   - Developer Prompt 结构（输入 JSON + 输出 Schema）  
   - User Prompt 角色。
3. 详细规划了 **Exa 集成路径**：
   - /search + /contents + context 字段的用法，以及 `search_and_contents` Python SDK；  
   - 无 tools 情况下的 pipeline 模式；  
   - 有 tools 时参照 Exa 官方的 OpenAI Tool Calling 方案实现 `exa_search` 工具43。
4. 详细规划了 **OKX 模拟盘 / 实盘对接**：
   - 使用 `x-simulated-trading: 1/0`、demo API key vs live API key 的环境切换44；  
   - 依赖 python-okx 的 `flag` 参数做 demo / live 选择45；  
   - 结合官方文档中对 REST 认证头、系统时间同步、错误代码等的约束46。
5. 按“能力位图”规划了 **多 provider Prompt Flow 分支**，避免盲目使用早期、已经不推荐的调用模式，而是：
   - 优先使用 tools + Responses API（有能力时）；
   - 其次使用 provider 原生 web_search_options；
   - 最后使用后端 orchestrator + Exa 的固定 pipeline。

如果你愿意，下一步我们可以：

- 把这套 Agent 流程转换成「具体的 YAML/JSON 配置」+「几段关键 Prompt 模板」，  
- 再映射回 AITradeGame/crypto_invest_with_ai 的具体函数与 API 调用点，形成一个“可实施”的落地手册。

`````47