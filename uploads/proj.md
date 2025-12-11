# 新一代 AI 加密交易系统设计论文  
**——基于 AITradeGame、crypto_invest_with_ai 与跨交易所套利机器人的架构融合方案**

---

## 摘要

本文以三个开源项目为研究对象：以本地 LLM 模拟交易为核心的 **AITradeGame**，以真实交易所账户分析与智能投顾为核心的 **crypto_invest_with_ai**，以及以跨中心化交易所价差为核心的 **跨交易所套利机器人（arbitrage‑bot）**。在深入分析三者架构与设计哲学的基础上，提出一个统一的下一代系统：**AITradeX（暂名）**。  

AITradeX 以 AITradeGame 的交易引擎和多模型管理为基础，引入 crypto_invest_with_ai 的分层架构、异步任务与实时 WebSocket 通信，将跨交易所套利逻辑作为一个独立的策略模块统一到同一策略框架之中。本文不仅给出系统级的架构设计，还给出“如何从当前 AITradeGame 仓库一步步演化到新架构”的**完整修改方案**，包括目录重构、数据库扩展、策略框架抽象、LLM 调用统一、套利模块嵌入、Web API 与前端改造方案等。

---

## 1 引言

### 1.1 背景

近年来，LLM + Crypto 交易相关的开源项目呈爆炸式增长，但主流项目往往在某一维度上极强而在其他维度上偏弱：

- 有的项目专注于**纯模拟环境**，方便快速迭代策略和对比不同 AI 模型（典型代表：AITradeGame）。
- 有的项目从真实账户出发，强调**投资组合分析和辅助决策**，但刻意避免自动实盘交易，以降低合规和风险压力（典型代表：crypto_invest_with_ai）。
- 还有项目聚焦于**低风险、结构化收益**的方向，比如跨交易所套利机器人（利用不同 CEX 之间的价格差）。

这三类项目互补性极强，却往往被孤立使用。本质原因是：

1. **数据模型不统一**：一个强调“模型-组合-交易记录”，另一个强调“交易所账户-订单-快照”，套利机器人又关注“交易所-币对-价差-通道”。
2. **执行模式不同**：有的项目是“周期拉取 + 同步 LLM 调用”，有的是“异步分析任务 + WebSocket 推送”，套利机器人则要求“准实时扫描 + 低延迟交易”。
3. **风险假设完全不同**：模拟交易几乎没有实质金融风险；投顾工具只读 API；套利机器人往往需要具有实际交易权限的 API 密钥。

如果能在统一架构中同时容纳这三种能力，我们将得到一个极具研究价值和实用价值的平台：  
既能让研究者在统一环境下比较不同 LLM 策略，也能对接真实账户做智能投顾，进一步可以在严格隔离和风险控制下引入跨交易所套利模块。

### 1.2 三个项目的互补性概览

用一个简短的表格概括三者的特征（仅放关键词，避免长句）：

| 项目                  | 核心定位           | 交易对象   | AI 用途          | 技术特征             |
|-----------------------|--------------------|------------|-------------------|----------------------|
| AITradeGame           | 本地 AI 模拟交易   | 虚拟组合   | 直接给出交易指令 | Flask API, SQLite, LLM JSON 决策 |
| crypto_invest_with_ai | AI 投顾 + 组合分析 | 真实账户   | 生成分析与建议   | 多层架构, SocketIO, OKX 读写 |
| arbitrage‑bot         | 跨 CEX 套利        | 实盘/模拟  | 可无 AI 或轻量 AI | 多交易所连接, 价差扫描 |

AITradeGame 代码最完整、结构相对干净，因此本文选择它作为基准仓库，在其基础上引入另外两个项目的优势。

---

## 2 现有项目架构分析

本节不是简单罗列，而是从“设计意图”和“可复用资产”的角度理解三者。

### 2.1 AITradeGame：单资产池、多模型、LLM 驱动的模拟器

#### 2.1.1 核心模块

从仓库关键文件可以提炼出以下核心：

- `app.py`  
  - Flask 应用入口，暴露 REST API；  
  - 通过 `Database` 管理 SQLite；  
  - 通过 `MarketDataFetcher` 获取 Binance / CoinGecko 数据；  
  - 维护 `trading_engines: Dict[int, TradingEngine]`，每个模型一个交易引擎；  
  - 具有后台线程 `trading_loop()`，每隔固定时间（默认 3 分钟）对所有模型执行一次交易循环。

- `ai_trader.py`  
  - 定义 `AITrader` 类，封装 **LLM 决策调用**。  
  - 关键点：
    - 构造极详细的 prompt：市场行情 + 技术指标（SMA7/14、RSI）+ 账户信息 + 持仓 + 风险约束 + 指令集；
    - 要求模型返回**特定 JSON 结构**（币种 -> 指令、数量、杠杆、止盈止损、信心度、理由）；
    - 支持多种 provider（OpenAI、DeepSeek、Claude、Gemini 等），通过 `provider_type` 路由到不同 `_call_*_api`；
    - `_parse_response` 对 LLM 容错，自动从 ```json``` 或 ``` 包裹中提取 JSON 子串，解析失败时返回空 dict。

- `trading_engine.py`  
  - 负责一个“模型 + 组合”的完整交易闭环：
    1. 调用 `MarketDataFetcher` 获取行情与技术指标；
    2. 通过 DB 读取当前组合（仓位、资金、历史盈亏）；
    3. 组装账户信息（初始资金、当前总资产、收益率）；
    4. 调用 `AITrader.make_decision()` 得到 JSON 决策；
    5. 将 prompt 概要 + LLM 决策存入 `conversations` 表；
    6. 执行 `_execute_buy/_execute_sell/_execute_close`，根据决策更新数据库；
    7. 记录新的 account value 轨迹。
  - 计费逻辑明确：交易金额 × 费率（默认 0.1%），区分开仓和平仓，保证模拟环境与真实交易成本接近。

- `market_data.py`  
  - 公共数据层，使用 Binance 24 小时 ticker 批量获取价格和涨跌幅；  
  - 当 Binance 异常时降级到 CoinGecko；  
  - 提供简单技术指标计算（SMA 与 RSI）。

- `database.py`  
  - 封装 SQLite；  
  - 重点表结构：
    - `providers`：AI 服务商；  
    - `models`：策略/模型实体（绑定 provider 与具体 model_name）；  
    - `portfolios`：每个模型的持仓；  
    - `trades`：所有成交记录，包括 `fee` 字段；  
    - `conversations`：LLM 对话记录；  
    - `account_values`：资金曲线；  
    - `settings`：全局配置（交易频率、费率等）。

#### 2.1.2 AITradeGame 的优势与不足

**优势：**

- 从 LLM 到交易闭环非常清晰：“行情 → prompt → JSON 决策 → 执行 → 记录”。  
- 多模型、多 provider，天然适合“模型对战”和策略对比。  
- 完全本地运行，SQLite 存储，隐私友好。  
- 数据层简单可控（只依赖公开行情），便于移植和单元测试。

**不足：**

- **同步、单线程思维**明显：`trading_loop` 串行遍历所有模型并 sleep，难以对不同策略配置不同频率，也难以扩展到实时套利。  
- 对真实交易所账户完全无感，缺乏“读只账户”的分析与监控能力。  
- UI 层基于 Flask + 模板，尚未利用 WebSocket 对实时性更强的场景（如套利机会推送）。

### 2.2 crypto_invest_with_ai：真实账户 + 智能投顾 + 异步分析任务

#### 2.2.1 分层结构

根据 README 中的目录结构与关键代码可见，该项目采用了更典型的“六边形”/分层架构：

- `src/ai/analysis/`  
  - `smart_analysis_engine.py`：封装与 OpenAI/DeepSeek 的交互，输出 `SmartAnalysisResult` 数据类；
  - `technical_analysis.py`：传统技术指标计算；
  - `analysis_task_manager.py`：管理异步分析任务、缓存与状态查询。

- `src/ai/recommendation/recommendation_engine.py`  
  - 将技术分析结果、市场行情与组合数据整合，调用 `SmartAnalysisEngine` 生成**中文的长文本分析**和结构化推荐；
  - 使用 `analysis_task_manager` 实现**异步分析任务**，前端只需要轮询或通过 WebSocket 查询任务进度。

- `src/data/fetchers/`  
  - `market_data_fetcher.py`：基于交易所（默认 OKX）的行情接口，封装获取多币对 ticker、OHLCV 的逻辑；
  - `private_data_fetcher.py`：使用用户提供的只读 API key 获取真实账户余额、持仓、委托等。

- `src/trading/portfolio/portfolio_manager.py`  
  - 负责组合快照与历史数据管理，用于图表展示与分析。

- `src/web/app.py`  
  - Flask + SocketIO 的 Web 应用：
    - IP 白名单检查（通过 `config_manager.get_ip_whitelist()` 和装饰器实现）；
    - 建立 WebSocket 连接池与后台数据广播线程（实时推送行情/组合/分析结果）；
    - 处理前端发来的“请求智能分析”事件，触发异步分析任务。

- `config/config_manager.py`  
  - 集中管理 `config.json` 和 `secrets.json`：包括交易所信息（OKX）、AI 模型名称、分析间隔、监控的币对列表、IP 白名单等。

#### 2.2.2 设计哲学

crypto_invest_with_ai 的核心理念有两条：

1. **只读、辅助决策、不做自动交易**：  
   - 只需要带 “read” 权限的 API key；
   - 在文档中大段强调“AI 只是参考，不替代人类决策，不做自动下单”。  

2. **异步 AI 分析**：  
   - AI 分析耗时与网络不稳定，需要任务管理器与缓存；
   - Web 前端通过 WebSocket 与轮询获取最新分析结果，而不是阻塞式 REST 调用。

这两点为我们提供了非常重要的“可复用范式”：  
> **LLM 调用是慢的、贵的、不可靠的，因此应该作为“异步任务 + 可缓存的分析服务”，而非简单的同步函数调用。**

### 2.3 Arbitrage‑bot：跨中心化交易所套利逻辑（抽象分析）

由于该仓库当前在本环境中无法完全访问，我们只能从项目简介“Arbitrage trade bot based on cross CEX price gap (跨交易所套利自动交易机器人)”以及常见套利机器人的设计来抽象其逻辑。

典型跨 CEX 套利机器人包含以下组成部分：

- **交易所连接层**：使用 ccxt 或官方 SDK 连接多个交易所（如 Binance、OKX、Bybit 等），管理 API key、时间同步与限频。  
- **行情聚合层**：对同一交易对（如 BTC/USDT）在不同交易所的 orderbook/ticker 进行聚合计算，得到实时价差。  
- **机会检测器**：  
  - 根据价差、手续费、滑点模型计算“净价差”；  
  - 当净价差超过阈值时，生成套利机会对象：`(venue_buy, venue_sell, size, expected_pnl)`。  
- **执行协调器**：  
  - 将套利机会转为具体的两笔（或更多笔）订单；  
  - 控制并发、失败回滚与超时；  
  - 管理不同交易所的余额、转账与资金分配。  

这一逻辑与 AITradeGame、crypto_invest_with_ai 的“单交易所 + 单组合视角”完全不同，但可以自然抽象为一个新的策略类型：**ArbitrageStrategy**。

---

## 3 目标系统：AITradeX（基于 AITradeGame 的下一代融合版本）

### 3.1 设计目标

1. **单一代码基**：以 AITradeGame 仓库为主线，避免复制粘贴多个项目形成“代码丛林”。  
2. **统一策略框架**：  
   - LLM 直接下单（AITradeGame）  
   - LLM 智能投顾（crypto_invest_with_ai）  
   - 传统规则套利（arbitrage‑bot）  
   都包装在统一的 `Strategy` 抽象之下。  
3. **同时支持模拟与只读实盘**：  
   - 默认是纯模拟（无交易所 API）；  
   - 可选开启只读账户分析（不发单，只读 OKX/其他交易所）；  
   - 套利模块优先实现“纸上套利”（paper arbitrage）：只模拟，不发单。  
4. **异步 + 任务化的 LLM 调用**：  
   - 重写 AITradeGame 的 `trading_loop` 为任务调度器；  
   - 引入类似 `analysis_task_manager` 的组件，统一管理 LLM 调用任务。  
5. **前后端一体的实时观察能力**：  
   - 保留 AITradeGame 的 ECharts 组合视图；  
   - 引入 WebSocket 与异步推送，显示套利机会、AI 分析进度等。  

### 3.2 核心原则

- **强约束的可扩展性**：通过抽象层（策略、交易所、数据源），既能支持未来扩展，又不会让架构泛化到失控。  
- **LLM 是“分析器”，不是“唯一真理”**：对于交易执行、风险控制采用**确定性逻辑**（如仓位上限、单笔风控），LLM 的输出必须通过规则过滤。  
- **分离“数据事实”和“执行意愿”**：  
  - 数据事实：行情、持仓、账单、价差 —— 一定由确定性代码与交易所 API 给出；  
  - 执行意愿：买、卖、保持、如何分配资金 —— 可交由 LLM 或策略模块决定。  

---

## 4 总体架构设计

### 4.1 分层架构

自上而下，AITradeX 划分为四层：

1. **Presentation 层（Web/UI）**  
   - Flask + SocketIO + 模板 / 前端框架；  
   - 提供仪表盘、策略配置页面、套利监控页面、LLM 对话查看页面。

2. **Application 层（服务与调度）**  
   - REST API（类似现有 `app.py` 中的 `/api/models`、`/api/providers` 等）；  
   - WebSocket 事件（借鉴 crypto_invest_with_ai 的 `request_data` 与智能分析事件）；  
   - 任务调度器（统一管理交易循环、LLM 分析任务、套利扫描任务）。

3. **Domain 层（业务核心）**  
   - **策略框架**：`StrategyBase`、`LLMJsonStrategy`、`LLMAdvisoryStrategy`、`ArbitrageStrategy`；  
   - **交易引擎**：`TradingEngine` 升级为对策略与交易所抽象的协调者；  
   - **风控模块**：风险约束检查、仓位限制、手续费与保证金模型。

4. **Infrastructure 层（基础设施）**  
   - SQLite（继承原 `Database` 并扩展）；  
   - 市场数据与交易所连接（`MarketDataService` + `ExchangeConnector` 抽象）；  
   - 配置中心（融合 `settings` 表与 `config_manager`）。

### 4.2 数据流概述

以一个 LLM 驱动的模拟策略为例，数据流如下：

1. 定时任务触发 `TradingEngine.execute_cycle(model_id)`；  
2. `TradingEngine` 通过 `MarketDataService` 获取目标币种行情与技术指标；  
3. 从 DB 读取 `Portfolio` 和历史盈亏，构造 `StrategyContext`；  
4. 将 `StrategyContext` 交给 `LLMJsonStrategy.generate_signals()`；  
5. 该方法异步调用 `LLMService`（封装 AITradeGame 原 `AITrader`）并写入 `conversations`；  
6. `TradingEngine` 将返回的信号通过风控模块过滤，生成具体订单/持仓变更；  
7. 更新 DB、刷新 account value 记录；  
8. 向前端推送新的组合状态与交易记录。

对于套利策略，类似，只是 `StrategyContext` 是多交易所多行情的矩阵，`ArbitrageStrategy` 输出的是“套利机会”与模拟交易结果。

---

## 5 统一数据模型与数据库设计

我们以 AITradeGame 的 SQLite 结构为基础扩展，并用概念实体来统一三个项目。

### 5.1 核心实体

- **Provider**：AI 服务商（OpenAI、DeepSeek 等），保留现有 `providers` 表。  
- **Model**：逻辑上的“策略模型”——既包括一个具体 LLM，也可以是一个纯算法套利策略。  
- **Strategy**：描述策略类型与配置（如 `llm_json`, `llm_advisory`, `cex_arbitrage`）。  
- **Exchange**：交易所实体，封装 ccxt 名称、API URL、只读/交易权限标记。  
- **Account**：真实或模拟账户，关联 `exchange` 与资金信息。  
- **Portfolio / Position / Trade / Conversation / AccountValue**：保留 AITradeGame 现有表结构，并稍作扩展以支持账户维度与多交易所。  
- **AnalysisReport**：存储 crypto_invest_with_ai 风格的 AI 分析结果。  
- **ArbitrageOpportunity**：套利机会记录，用于回测与监控。  
- **Task**：异步任务（LLM 分析、套利扫描）状态记录（可选实现，取决于是否需要重启后恢复任务）。

### 5.2 数据库扩展方案（基于 AITradeGame）

以伪 SQL 展示新增/修改表（这里只展示核心字段，实际可细化）：

```sql
-- 1. 新增 exchanges 表
CREATE TABLE IF NOT EXISTS exchanges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,              -- 'binance', 'okx' 等
    label TEXT,                      -- 前端展示名
    api_base_url TEXT,
    type TEXT DEFAULT 'cex',         -- 'cex', 'dex', 'simulated'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. 新增 accounts 表（真实或模拟）
CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    exchange_id INTEGER NOT NULL,
    name TEXT NOT NULL,              -- 'simulated_default', 'okx_readonly'
    api_key TEXT,
    api_secret TEXT,
    api_passphrase TEXT,
    read_only INTEGER DEFAULT 1,     -- 1 = 只读
    extra_config TEXT,               -- JSON，存储 ip 白名单等
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (exchange_id) REFERENCES exchanges(id)
);

-- 3. models 表扩展（增加 strategy_type 与 account 维度）
ALTER TABLE models ADD COLUMN strategy_type TEXT DEFAULT 'llm_json';
ALTER TABLE models ADD COLUMN account_id INTEGER;
-- account_id 可以为空（纯模拟）

-- 4. portfolios 表扩展 account_id，兼容多账户
ALTER TABLE portfolios ADD COLUMN account_id INTEGER;

-- 5. 新增 analysis_reports（对应 crypto_invest_with_ai 的分析结果）
CREATE TABLE IF NOT EXISTS analysis_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model_id INTEGER,
    account_id INTEGER,
    symbol TEXT,
    report_type TEXT,        -- 'portfolio', 'custom', ...
    content_md TEXT,         -- 原始 Markdown 或 HTML
    ai_confidence REAL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. 新增 arbitrage_opportunities
CREATE TABLE IF NOT EXISTS arbitrage_opportunities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,            -- 'BTC/USDT'
    buy_exchange_id INTEGER,
    sell_exchange_id INTEGER,
    buy_price REAL,
    sell_price REAL,
    spread REAL,                     -- 毛价差 %
    net_spread REAL,                 -- 扣除手续费后的净价差 %
    est_pnl REAL,
    volume REAL,
    detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

同时，将 `settings` 表扩展为包含：

- `trading_frequency_minutes`（保留）；  
- `trading_fee_rate`（保留）；  
- `analysis_interval_seconds`（来自 crypto_invest_with_ai 的 `analysis_interval`）；  
- `arbitrage_scan_interval_seconds`；  
- `ip_whitelist`（JSON 字符串）；  
- `default_exchange_id`（用于公共行情）。

---

## 6 策略层融合设计

### 6.1 统一 Strategy 抽象

在 AITradeGame 现有 `TradingEngine` 的基础上引入一个清晰的策略接口：

```python
# core/strategy/base.py
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Dict, Any, List

@dataclass
class StrategyContext:
    model_id: int
    account_id: int | None
    market_state: Dict[str, Any]      # 行情+指标
    portfolio: Dict[str, Any]         # 仓位+资金+PnL
    account_info: Dict[str, Any]      # 初始资金、收益率等
    settings: Dict[str, Any]          # 费率、风控配置等
    extra: Dict[str, Any] = None      # 其他数据（如多交易所行情）

@dataclass
class Signal:
    symbol: str
    action: str        # 'buy', 'sell', 'close', 'hold', 'ignore'
    quantity: float
    leverage: int
    meta: Dict[str, Any]

class StrategyBase(ABC):
    def __init__(self, model_id: int, config: Dict[str, Any]):
        self.model_id = model_id
        self.config = config

    @abstractmethod
    def generate_signals(self, ctx: StrategyContext) -> List[Signal]:
        """核心方法：从上下文生成交易/推荐信号"""
        ...
```

在此基础上，`TradingEngine` 不再直接依赖 `AITrader`，而是依赖一个 `StrategyBase` 实例。

### 6.2 LLMJsonStrategy：封装 AITradeGame 原有逻辑

该策略对应 AITradeGame 现有的“LLM 直接输出 JSON 决策”的模式：

```python
# core/strategy/llm_json_strategy.py
from .base import StrategyBase, StrategyContext, Signal
from core.llm.ai_trader import AITrader  # 将原 ai_trader.py 抽到 core.llm

class LLMJsonStrategy(StrategyBase):
    def __init__(self, model_id: int, trader: AITrader, config: dict):
        super().__init__(model_id, config)
        self.trader = trader

    def generate_signals(self, ctx: StrategyContext) -> list[Signal]:
        raw_decisions = self.trader.make_decision(
            ctx.market_state, ctx.portfolio, ctx.account_info
        )
        signals: list[Signal] = []
        for coin, decision in raw_decisions.items():
            # 兼容旧的字段名
            signal = decision.get("signal", "").lower()
            qty = float(decision.get("quantity", 0) or 0)
            lev = int(decision.get("leverage", 1) or 1)
            signals.append(Signal(
                symbol=coin,
                action=self._map_signal(signal),
                quantity=qty,
                leverage=lev,
                meta=decision,
            ))
        return signals

    def _map_signal(self, signal: str) -> str:
        return {
            "buy_to_enter": "buy",
            "sell_to_enter": "sell",
            "close_position": "close",
            "hold": "hold",
        }.get(signal, "ignore")
```

这样，**原有 AITradeGame 的所有功能在新架构下保持不变**，只是多了一层 `Signal` 抽象，方便后续接入不同策略。

### 6.3 LLMAdvisoryStrategy：引入 crypto_invest_with_ai 的智能投顾引擎

LLM 投顾策略不直接下单，而是生成“结构化建议 + 富文本分析”。其核心是将 `SmartRecommendationEngine` 封装为策略。

关键思路：

1. `StrategyContext.portfolio` 与 `account_info` 刚好可以满足 crypto_invest_with_ai 的 `portfolio_data`；  
2. `StrategyContext.extra['symbols']` 可以提供要分析的交易对列表；  
3. `SmartRecommendationEngine.generate_comprehensive_analysis` 返回的 `SmartRecommendationResult` 中包含：
   - 综合市场分析（`market_analysis`）；  
   - 组合评估（`portfolio_review`）；  
   - 交易信号与风险评估；  
   - 针对每个 symbol 的推荐列表 `individual_recommendations`。  

我们将其映射到统一的 `Signal` 结构，但**加一个标记，默认不执行，只展示**：

```python
# core/strategy/llm_advisory_strategy.py
from .base import StrategyBase, StrategyContext, Signal
from src.ai.recommendation.recommendation_engine import SmartRecommendationEngine

class LLMAdvisoryStrategy(StrategyBase):
    def __init__(self, model_id: int, engine: SmartRecommendationEngine, config: dict):
        super().__init__(model_id, config)
        self.engine = engine

    def generate_signals(self, ctx: StrategyContext) -> list[Signal]:
        symbols = self._get_symbols(ctx)
        result = self.engine.generate_comprehensive_analysis(
            portfolio_data=ctx.portfolio,
            symbols=symbols
        )

        signals: list[Signal] = []
        for rec in result.individual_recommendations:
            # rec.action: 'BUY'/'SELL'/'HOLD'
            action = rec.action.lower()
            qty = self._estimate_size(rec, ctx)  # 可选：基于组合规模估算
            signals.append(Signal(
                symbol=rec.symbol,
                action={"buy": "buy", "sell": "sell", "hold": "hold"}.get(action, "hold"),
                quantity=qty,
                leverage=1,
                meta={
                    "source": "advisory",
                    "confidence": rec.confidence,
                    "reasoning": rec.reasoning,
                    "price_target": rec.price_target,
                    "stop_loss": rec.stop_loss,
                }
            ))

        # 将完整分析结果保存为 analysis_report
        # （通过 Database.add_analysis_report 实现）
        return signals

    def _get_symbols(self, ctx: StrategyContext) -> list[str]:
        if ctx.extra and "symbols" in ctx.extra:
            return ctx.extra["symbols"]
        return list(ctx.market_state.keys())

    def _estimate_size(self, rec, ctx: StrategyContext) -> float:
        # 默认不执行，返回 0，前端只展示建议
        return 0.0
```

**关键设计点：**

- `quantity` 默认为 0，意味着 TradingEngine 在执行时可以识别“仅分析，不执行”的信号；  
- 将文本分析与 HTML 内容存入 `analysis_reports` 表，供前端展示；  
- 如未来允许“半自动执行”，可以在设置中明确开启，并通过 `_estimate_size` 转化为仓位调整。

### 6.4 ArbitrageStrategy：抽象跨 CEX 套利逻辑

套利策略与 LLM 完全可以解耦，因此我们将其设计为纯规则型策略，LLM 只用于可选的风险解释或参数调优。

核心结构：

```python
# core/strategy/arbitrage_strategy.py
from .base import StrategyBase, StrategyContext, Signal
from typing import List, Dict, Any

class ArbitrageStrategy(StrategyBase):
    def __init__(self, model_id: int, market_router, config: dict):
        """
        market_router: 提供 get_orderbooks(exchanges, symbol) 等接口的组件
        config: 包含最小净价差阈值、最大资金占比等
        """
        super().__init__(model_id, config)
        self.market_router = market_router

    def generate_signals(self, ctx: StrategyContext) -> List[Signal]:
        symbols: List[str] = ctx.extra.get("symbols") if ctx.extra else []
        exchanges: List[str] = ctx.extra.get("exchanges") if ctx.extra else []
        if not symbols or not exchanges:
            return []

        opps: List[Dict[str, Any]] = []
        for symbol in symbols:
            orderbooks = self.market_router.get_orderbooks(exchanges, symbol)
            # 计算不同交易所间最佳买一/卖一
            best_bid = max(orderbooks, key=lambda ob: ob["bid_price"])
            best_ask = min(orderbooks, key=lambda ob: ob["ask_price"])
            spread = (best_bid["bid_price"] - best_ask["ask_price"]) / best_ask["ask_price"] * 100

            net_spread = spread - self._total_fee(best_bid, best_ask)
            if net_spread >= self.config.get("min_net_spread_pct", 0.5):
                size = self._calc_size(best_ask, ctx)
                opps.append({
                    "symbol": symbol,
                    "buy_exchange": best_ask["exchange"],
                    "sell_exchange": best_bid["exchange"],
                    "buy_price": best_ask["ask_price"],
                    "sell_price": best_bid["bid_price"],
                    "spread": spread,
                    "net_spread": net_spread,
                    "size": size
                })

        signals: List[Signal] = []
        for op in opps:
            signals.append(Signal(
                symbol=op["symbol"],
                action="buy",  # 对组合视角而言，可视为对冲中“建套利组合”
                quantity=op["size"],
                leverage=1,
                meta={"type": "arbitrage", **op}
            ))
        return signals

    def _total_fee(self, bid, ask) -> float:
        maker_fee = self.config.get("maker_fee", 0.001)
        taker_fee = self.config.get("taker_fee", 0.001)
        # 简化：多次撮合时可按 2 * taker 估算
        return (maker_fee + taker_fee) * 100

    def _calc_size(self, best_ask, ctx: StrategyContext) -> float:
        # 根据组合现金和配置决定最大成交量
        cash = ctx.portfolio.get("cash", 0)
        max_ratio = self.config.get("max_capital_ratio", 0.1)
        max_capital = cash * max_ratio
        if best_ask["ask_price"] <= 0:
            return 0.0
        return max_capital / best_ask["ask_price"]
```

初期我们可以将 ArbitrageStrategy 的执行模式设计为 **纸上套利**：

- TradingEngine 不实际向交易所下单，只记录一对“模拟买入/卖出”交易，更新组合；  
- 将机会与模拟结果写入 `arbitrage_opportunities` 表与 `trades` 表；  
- 前端提供“如果实盘执行，将获得的理论收益”视图。

如果未来需要实盘执行，可以在执行层（见下一节）引入 `LiveExecutionEngine`，但必须增加强制性开关与风险提示。

### 6.5 策略组合与模型对战

有了统一的 `Signal` 抽象，可以很自然地支持以下高级玩法：

- **多策略叠加**：同一模型可以配置多个策略实例（例如 LLMJsonStrategy + ArbitrageStrategy），TradingEngine 对来自不同策略的信号进行整合、冲突消解（如只执行净多头或风险较低的一侧）。  
- **模型对战**：不同模型共享同一市场数据与初始资金，通过排行榜（原 AITradeGame 即有）比较表现；其中一个模型可以是纯套利，另一个是 LLM 模拟，第三个是混合策略。  
- **策略图（Strategy Graph）**：未来可以把投顾策略的建议作为 LLMJsonStrategy 的提示词输入之一，形成“分析-执行”的两段式 LLM pipeline。

---

## 7 市场数据与执行层统一设计

### 7.1 MarketDataService：统一 AITradeGame 与 crypto_invest_with_ai 的数据获取方式

原 AITradeGame 的 `MarketDataFetcher` 和 crypto_invest_with_ai 的 `MarketDataFetcher` 功能相似但接口不同。我们可以定义一个统一的服务接口：

```python
# core/market/market_data_service.py
from typing import Dict, List

class MarketDataService:
    def __init__(self, default_exchange: str = "binance"):
        self.default_exchange = default_exchange
        # 内部可以使用 ccxt 或现有 fetcher 实现

    def get_spot_snapshot(self, symbols: List[str]) -> Dict[str, dict]:
        """返回 {symbol: {price, change_24h, volume, ...}}"""
        ...

    def get_ohlcv(self, symbol: str, timeframe: str = "1d", limit: int = 30):
        """统一返回 K 线数据结构"""
        ...

    def get_multi_exchange_orderbooks(self, exchanges: List[str], symbol: str):
        """为套利模块提供多交易所 orderbook 摘要"""
        ...
```

在模拟模式下，可以直接复用原 AITradeGame 的 Binance + CoinGecko 实现；在只读实盘模式下，可以利用 crypto_invest_with_ai 中已封装的 `MarketDataFetcher(exchange_name)`。

### 7.2 ExchangeConnector 抽象

为了支持未来的实盘或纸上模拟，我们定义：

```python
# core/exchange/base_connector.py
from abc import ABC, abstractmethod
from typing import Dict, Any

class ExchangeConnector(ABC):
    def __init__(self, name: str, config: Dict[str, Any]):
        self.name = name
        self.config = config

    @abstractmethod
    def get_balances(self) -> Dict[str, float]:
        ...

    @abstractmethod
    def get_open_orders(self):
        ...

    @abstractmethod
    def place_order(self, symbol: str, side: str, amount: float, price: float | None):
        """仅在非只读模式且用户明确授权下生效"""
        ...
```

初期我们实现两个版本：

- `SimulatedExchangeConnector`：完全基于数据库，模拟委托与成交；  
- `ReadOnlyOkxConnector`：只实现 `get_balances` 与 `get_open_orders`，将功能映射到 crypto_invest_with_ai 的 `PrivateDataFetcher`。  

套利模块可以在模拟阶段使用 `SimulatedExchangeConnector`，确保不会误触实盘。

### 7.3 TradingEngine 的执行重写

原 `TradingEngine` 的 `_execute_buy/_execute_sell/_execute_close` 可保留为“组合层执行逻辑”，在其上再加一个“账户/交易所执行层”的薄抽象：

- 组合层负责：
  - 更新 `portfolios` 与 `trades`；  
  - 计算保证金与交易费；  
  - 更新 account value。  

- 执行层负责（可选）：
  - 将组合层的“预期交易”转化为真实交易所订单（在不违反只读限制的前提下）。  

这种分层使得我们可以**完全保留现有 AITradeGame 的模拟行为**，同时为未来的实盘扩展预留接口。

---

## 8 Web 层与交互设计

### 8.1 REST API 的统一与扩展

在 AITradeGame 现有 `app.py` 的基础上，我们建议做如下扩展：

1. **新增策略与账户管理接口**  
   - `GET /api/strategies`：列出所有可用策略类型及其参数模板；  
   - `POST /api/models`：在原有字段基础上新增 `strategy_type` 与 `account_id`；  
   - `GET/POST /api/accounts`：管理虚拟或真实账户配置。  

2. **新增套利与分析接口**  
   - `GET /api/arbitrage/opportunities`：返回最近检测到的套利机会（从 `arbitrage_opportunities` 读）；  
   - `POST /api/models/{model_id}/analysis`：触发一次投顾型 LLM 分析（调用 `LLMAdvisoryStrategy`）。

### 8.2 WebSocket 事件与数据广播

借鉴 crypto_invest_with_ai 的 SocketIO 设计，在当前 AITradeGame 前端基础上引入以下事件：

- `request_data`：与原有类似，区分 `portfolio`、`trades`、`arbitrage` 等类型；  
- `analysis_progress`：推送 LLM 投顾任务进度与结果；  
- `arbitrage_updates`：持续推送最新的套利机会列表。

与之配套，在服务端引入一个统一的广播线程/协程：

- 周期性从 DB 或内存中读取最新的组合、分析报告、套利机会；  
- 向所有连接的客户端广播，保证前端仪表盘实时更新。

---

## 9 任务调度与异步执行

### 9.1 从单一 trading_loop 到任务调度器

原 AITradeGame 的 `trading_loop` 逻辑大致为：

1. 每次循环遍历所有 `trading_engines`；  
2. 顺序执行 `execute_trading_cycle`；  
3. 睡眠 N 分钟。

在新架构中，我们希望：

- 不同策略可以有不同频率（例如套利策略 10 秒一次，LLM 投顾策略 1 小时一次）；  
- LLM 调用不阻塞其他任务；  
- 可以随时新增/暂停任务。

一个自然的演化方案是引入轻量级的任务调度器，例如基于 `threading` + 自行管理的优先队列，或使用 `APScheduler`。概念上可以抽象为：

```python
# core/scheduler/scheduler.py
from dataclasses import dataclass
from typing import Callable, Dict
import time
import threading

@dataclass
class ScheduledTask:
    name: str
    interval: int
    last_run: float
    func: Callable[[], None]

class Scheduler:
    def __init__(self):
        self.tasks: Dict[str, ScheduledTask] = {}
        self._running = False

    def add_task(self, name: str, interval: int, func: Callable[[], None]):
        self.tasks[name] = ScheduledTask(
            name=name, interval=interval, last_run=0, func=func
        )

    def start(self):
        self._running = True
        threading.Thread(target=self._loop, daemon=True).start()

    def _loop(self):
        while self._running:
            now = time.time()
            for task in list(self.tasks.values()):
                if now - task.last_run >= task.interval:
                    task.last_run = now
                    threading.Thread(target=task.func, daemon=True).start()
            time.sleep(1)
```

然后在 `app.py` 启动时：

- 为每个 `LLMJsonStrategy` 模型注册一个任务（间隔从 `settings.trading_frequency_minutes` 读取）；  
- 为套利策略注册一个高频任务；  
- 为 LLM 投顾策略注册一个低频任务；  
- 为“清理缓存”等运维操作注册后台任务。

### 9.2 LLM 调用任务化

在 crypto_invest_with_ai 中，`analysis_task_manager` 已经提供了异步任务 + 状态查询机制。我们可以移植其思想：

- 所有 LLM 调用（包括 `AITrader.make_decision` 和 `SmartAnalysisEngine._get_ai_analysis`）都可以包装为“任务”，由任务管理器管理队列和状态；  
- 对于交易周期，如果 LLM 调用未及时返回，可以选择：
  - 跳过当前周期，等待下一个周期再尝试；  
  - 或使用前一次成功的决策作为 fallback。  

这避免了单个 provider 出现网络问题时卡死整个系统。

---

## 10 基于 AITradeGame 仓库的具体改造步骤

下面给出一个几乎可以照着做的改造路线，从当前 AITradeGame 到 AITradeX。

### 10.1 重构目录结构

当前 AITradeGame 的根目录大致包含 `app.py`, `ai_trader.py`, `trading_engine.py`, `market_data.py`, `database.py`, `templates`, `static` 等。建议重构为：

```text
AITradeGame/
├── core/
│   ├── strategy/
│   │   ├── base.py
│   │   ├── llm_json_strategy.py
│   │   ├── llm_advisory_strategy.py   # 来自 crypto_invest_with_ai
│   │   └── arbitrage_strategy.py      # 新增
│   ├── llm/
│   │   └── ai_trader.py               # 从 ai_trader.py 挪至此处
│   ├── market/
│   │   └── market_data_service.py     # 包装原 market_data.py
│   ├── exchange/
│   │   ├── base_connector.py
│   │   ├── simulated_connector.py
│   │   └── okx_readonly_connector.py  # 复用 crypto_invest_with_ai
│   ├── engine/
│   │   └── trading_engine.py          # 重写以调用 StrategyBase
│   └── scheduler/
│       └── scheduler.py
├── infra/
│   ├── database.py                    # 原 database.py
│   └── config/
│       ├── settings_adapter.py        # 结合 settings 表与 config.json
│       └── config_manager.py (可选)   # 引入 crypto_invest_with_ai 版本
├── web/
│   ├── app.py                         # 原 app.py，精简 + SocketIO
│   ├── templates/
│   └── static/
└── ...
```

这样既不破坏已有文件，又为未来扩展留出明确位置。

### 10.2 修改 TradingEngine

将 `trading_engine.py` 中的构造函数与 `execute_trading_cycle` 重写为依赖 `StrategyBase`：

```python
# core/engine/trading_engine.py
from core.strategy.base import StrategyBase, StrategyContext
from infra.database import Database
from core.market.market_data_service import MarketDataService

class TradingEngine:
    def __init__(self, model_id: int, db: Database,
                 strategy: StrategyBase, market_service: MarketDataService,
                 trade_fee_rate: float):
        self.model_id = model_id
        self.db = db
        self.strategy = strategy
        self.market_service = market_service
        self.trade_fee_rate = trade_fee_rate
        self.coins = ["BTC", "ETH", "SOL", "BNB", "XRP", "DOGE"]

    def execute_cycle(self) -> dict:
        # 1. 获取行情
        market_state = self._get_market_state()
        current_prices = {c: market_state[c]["price"] for c in market_state}

        # 2. 获取组合与账户信息
        portfolio = self.db.get_portfolio(self.model_id, current_prices)
        account_info = self._build_account_info(portfolio)

        # 3. 构造策略上下文
        ctx = StrategyContext(
            model_id=self.model_id,
            account_id=None,  # 后续扩展
            market_state=market_state,
            portfolio=portfolio,
            account_info=account_info,
            settings={"trade_fee_rate": self.trade_fee_rate},
            extra={}
        )

        # 4. 调用策略生成信号
        signals = self.strategy.generate_signals(ctx)

        # 5. 执行信号（重用原 _execute_buy/_execute_sell/_execute_close）
        exec_results = self._execute_signals(signals, market_state, portfolio)

        # 6. 更新资金曲线与返回结果（保留原逻辑）
        ...
```

### 10.3 在 app.py 中引入 StrategyFactory

修改原 `add_model` 与 `execute_trading` 相关逻辑，使其根据 `strategy_type` 构造不同策略实例：

```python
# web/app.py 中
from core.strategy.llm_json_strategy import LLMJsonStrategy
from core.strategy.llm_advisory_strategy import LLMAdvisoryStrategy
from core.strategy.arbitrage_strategy import ArbitrageStrategy
from core.llm.ai_trader import AITrader
from core.engine.trading_engine import TradingEngine
from core.market.market_data_service import MarketDataService

market_service = MarketDataService()
trading_engines = {}

def create_strategy(model, provider, db):
    stype = model.get("strategy_type", "llm_json")

    if stype == "llm_json":
        ai_trader = AITrader(
            provider_type=provider["provider_type"],
            api_key=provider["api_key"],
            api_url=provider["api_url"],
            model_name=model["model_name"],
        )
        return LLMJsonStrategy(model_id=model["id"], trader=ai_trader, config={})

    elif stype == "llm_advisory":
        from src.ai.recommendation.recommendation_engine import SmartRecommendationEngine
        engine = SmartRecommendationEngine()
        return LLMAdvisoryStrategy(model_id=model["id"], engine=engine, config={})

    elif stype == "cex_arbitrage":
        market_router = ...  # 基于 MarketDataService + ExchangeConnector 实现
        return ArbitrageStrategy(model_id=model["id"], market_router=market_router,
                                 config={"min_net_spread_pct": 0.5})

    else:
        raise ValueError(f"Unknown strategy type: {stype}")
```

在 `add_model`、`execute_trading`、`init_trading_engines` 中都调用 `create_strategy` 构造对应策略，再创建 `TradingEngine`。

### 10.4 引入 config_manager 与 IP 白名单

从 crypto_invest_with_ai 抽取 `config_manager.py` 到 `infra/config/config_manager.py`，对其做最小改动以：

- 兼容旧有 `settings` 表；  
- 通过 `get_ip_whitelist()` 为 `web/app.py` 提供白名单数组。

在 Flask 应用中加入：

```python
from infra.config.config_manager import config_manager
ALLOWED_IPS = config_manager.get_ip_whitelist()

def check_ip_whitelist(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        ip = request.environ.get('HTTP_X_FORWARDED_FOR', request.remote_addr)
        if ip not in ALLOWED_IPS:
            return jsonify({"error": "IP not allowed"}), 403
        return f(*args, **kwargs)
    return wrapper
```

对于需要保护的 API（例如读取真实账户分析报告），添加该装饰器。

### 10.5 集成 crypto_invest_with_ai 的 AI 分析与推荐模块

在新仓库中添加子目录 `src/ai/`，可先以 git subtree 或手动复制的方式引入以下文件：

- `src/ai/analysis/smart_analysis_engine.py`  
- `src/ai/analysis/technical_analysis.py`  
- `src/ai/analysis/analysis_task_manager.py`  
- `src/ai/recommendation/recommendation_engine.py`  
- `src/utils/markdown_utils.py` 等依赖工具。  

然后在 `LLMAdvisoryStrategy` 中调用这些模块，如前文所述。

需要注意：

- 将原项目中对 `config_manager` 的引用统一改为 `infra.config.config_manager`；  
- 将原项目中对 Web 端路径的依赖（例如静态目录）调整为适应 AITradeGame 的结构。

### 10.6 套利模块实现与集成

1. 在 `core/market/` 中实现 `MarketDataService.get_multi_exchange_orderbooks()`，内部可以使用 ccxt 或现有 CEX fetcher；  
2. 实现 `market_router`，负责：
   - 根据配置列出参与套利的交易所列表；  
   - 对每个 symbol 调用 `get_multi_exchange_orderbooks`；  
   - 将结果组装为 ArbitrageStrategy 所需的数据结构。  
3. 在前端新增“套利监控”页面：  
   - 展示最近的 `arbitrage_opportunities`；  
   - 用简单的表格显示“买入交易所 / 卖出交易所 / 价差 / 预期收益”。  

初期仅实现纸上套利，避免涉及真实订单下单。

### 10.7 WebSocket 与前端改造

在 `web/app.py` 中引入 SocketIO（类似 crypto_invest_with_ai），增加以下事件处理：

- `@socketio.on('request_arbitrage')`：客户端请求开始接收套利数据；  
- `@socketio.on('request_analysis')`：请求触发一次投顾型 LLM 分析；  
- 后台线程 `data_broadcast_worker` 周期性从 DB 中读取组合、分析报告、套利机会，并通过 `socketio.emit()` 推送到客户端。

前端可以先以最小改动实现：在现有模板中加入一个简单 JS 客户端，连接 SocketIO 并在控制台打印收到的数据——之后再逐步演进至完整 UI。

### 10.8 数据迁移与兼容策略

为了平滑升级：

- 对原有 `AITradeGame.db` 做 schema 迁移时，保留所有旧字段，仅添加新列与新表；  
- 对于旧版本中已有的 `models`，默认 `strategy_type = 'llm_json'`，`account_id = NULL`，行为完全不变；  
- 所有新功能（投顾、套利、真实账户）都通过新增模型与配置开启，不影响旧模型。

### 10.9 测试与验证路径

建议按照从低风险到高复杂度的顺序进行验证：

1. 单模型、纯模拟、LLMJsonStrategy —— 确保原 AITradeGame 功能完全正常。  
2. 在相同市场数据下，添加一个 LLMAdvisoryStrategy 模型，观察其分析报告是否写入 `analysis_reports`，前端展示是否正常。  
3. 在纸上模式下启用 ArbitrageStrategy，验证套利机会计算的合理性（即便不下单）。  
4. 最后才接入只读 OKX 账户，验证 `ReadOnlyOkxConnector` 能正确读取余额与订单，并供 LLMAdvisoryStrategy 使用。

---

## 11 潜在扩展与研究方向

在统一架构搭建完成后，可以在此基础上进行更深层的研究：

1. **策略组合优化**  
   - 将多策略的信号视为多专家决策，应用组合优化方法（如加权投票、贝叶斯合并）生成最终订单。  

2. **因果可解释性**  
   - 利用 LLM 输出的“reasoning”字段，结合技术指标与历史数据，分析在盈利/亏损案例中 LLM 的推理模式是否存在系统偏差。  

3. **LLM + 套利策略协同**  
   - 让 LLM 不直接参与高频决策，而是用来调参：例如根据市场宏观环境自动调整套利阈值、最大资金占用比例等。  

4. **风险控制与监管友好性研究**  
   - 探索在监管友好的前提下，将该平台用于教育与实验用途，例如完全使用模拟账户和延迟数据进行教学。

---

## 12 结论

本文从三个风格迥异但互补的开源项目出发，提出了一个统一的下一代 AI 加密交易系统架构设计：以 AITradeGame 为基底，嫁接 crypto_invest_with_ai 的异步投顾与分层架构，引入跨 CEX 套利机器人作为新的策略类型。  

我们没有简单堆叠代码，而是从**数据模型、策略抽象、任务调度、市场数据与执行层分离**等维度进行系统性重构，使得：

- 任何“策略”都可以在统一的 `StrategyBase` 抽象下运行；  
- LLM 调用被视为慢而不稳定的“分析任务”，而非简单函数；  
- 套利与投机、模拟与实盘、LLM 与传统算法可以在同一系统内以可控方式共存。  

如果按本文的改造步骤推进，一个实际的 GitHub 仓库可以在保留原有用户体验的前提下，演化成兼具模拟、投顾与套利能力的 **AITradeX 平台**。接下来，可以在此平台之上开展更深入的学术研究与实证实验，包括模型对比、策略叠加、风险管理与用户交互设计等，为“LLM + 金融交易”的实践提供一个高质量的开源基座。