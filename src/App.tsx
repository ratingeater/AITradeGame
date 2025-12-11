import { useState, useEffect, useRef } from 'react';
import { 
  Github, 
  ArrowUpCircle, 
  RefreshCw, 
  Settings, 
  Cloud, 
  Plus, 
  TrendingUp, 
  Wallet, 
  Banknote, 
  TrendingDown, 
  X, 
  DownloadCloud, 
  Cpu, 
  Gem, 
  BookOpen,
  ArrowDown,
  Play,
  Pause,
  Zap,
  Brain
} from 'lucide-react';
import { MarketDataService, MarketData } from './services/marketData';
import { Portfolio } from './services/aiTrader';
import { Strategy, Signal } from './services/strategies/types';
import { ArbitrageStrategy } from './services/strategies/ArbitrageStrategy';
import { LLMStrategy } from './services/strategies/LLMStrategy';

// Default Configuration
const DEFAULT_API_URL = "https://api.deepseek.com/v3.2_speciale_expires_on_20251215";
const DEFAULT_MODEL = "deepseek-reasoner";

function App() {
  const [activeTab, setActiveTab] = useState('positions');
  const [showApiProviderModal, setShowApiProviderModal] = useState(false);
  const [showAddModelModal, setShowAddModelModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);

  // App State
  const [apiKey, setApiKey] = useState('');
  const [isTrading, setIsTrading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [marketData, setMarketData] = useState<Record<string, MarketData>>({});
  const [portfolio, setPortfolio] = useState<Portfolio>({
    total_value: 100000,
    cash: 100000,
    positions: []
  });
  const [trades, setTrades] = useState<any[]>([]);
  
  // Strategies
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [activeStrategyId, setActiveStrategyId] = useState<string>('arbitrage_bot');

  const marketService = useRef(new MarketDataService());
  
  // Initialize Strategies
  useEffect(() => {
    const arbStrategy = new ArbitrageStrategy();
    setStrategies([arbStrategy]);
  }, []);

  // Update strategies when API key changes
  useEffect(() => {
    if (apiKey) {
      const llmStrategy = new LLMStrategy(apiKey, DEFAULT_API_URL, DEFAULT_MODEL);
      setStrategies(prev => {
        const filtered = prev.filter(s => s.id !== 'llm_trader');
        return [...filtered, llmStrategy];
      });
    }
  }, [apiKey]);

  const addLog = (msg: string) => {
    setLogs(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev]);
  };

  const handleSaveProvider = (key: string, url: string) => {
    setApiKey(key);
    addLog("API Provider configured - AI Trader enabled");
    setShowApiProviderModal(false);
  };

  useEffect(() => {
    // Check for env var
    try {
      // @ts-ignore
      const envKey = import.meta.env.VITE_DEEPSEEK_API_KEY || (typeof process !== 'undefined' && process.env?.DEEPSEEK_API_KEY);
      if (envKey && !apiKey) {
        handleSaveProvider(envKey, DEFAULT_API_URL);
        addLog("Auto-configured API Key from environment");
      }
    } catch (e) {
      console.log("Env var check failed", e);
    }

    // Initial market data fetch
    const fetchInitialData = async () => {
      try {
        const coins = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE'];
        const data = await marketService.current.getMarketState(coins);
        setMarketData(data);
      } catch (e) {
        console.error("Failed to fetch initial market data", e);
      }
    };
    fetchInitialData();
  }, []);

  const runTradingCycle = async () => {
    try {
      // Always fetch market data first
      addLog("Fetching market data...");
      const coins = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE'];
      const data = await marketService.current.getMarketState(coins);
      setMarketData(data);

      const activeStrategy = strategies.find(s => s.id === activeStrategyId);
      if (!activeStrategy) {
        addLog("Error: No active strategy selected");
        setIsTrading(false);
        return;
      }

      addLog(`Running Strategy: ${activeStrategy.name}...`);
      
      const signals = await activeStrategy.generateSignals({
        marketState: data,
        portfolio,
        accountInfo: { 
          initial_capital: 100000, 
          total_return: ((portfolio.total_value - 100000) / 100000) * 100 
        }
      });

      if (signals.length === 0) {
        addLog("No trading signals generated.");
      } else {
        addLog(`Generated ${signals.length} signals: ${signals.map(s => `${s.action} ${s.symbol}`).join(', ')}`);
      }
      
      // Execute trades
      let newCash = portfolio.cash;
      const newPositions = [...portfolio.positions];

      for (const signal of signals) {
        if (signal.action === 'buy') {
          const executionPrice = signal.price || data[signal.symbol].price;
          const cost = signal.quantity * executionPrice;
          if (newCash >= cost) {
            newCash -= cost;
            newPositions.push({
              coin: signal.symbol,
              side: 'long',
              quantity: signal.quantity,
              avg_price: executionPrice,
              leverage: signal.leverage
            });
            setTrades(prev => [{
              time: new Date().toLocaleTimeString(),
              coin: signal.symbol,
              type: 'BUY',
              quantity: signal.quantity,
              price: executionPrice,
              pnl: 0,
              strategy: activeStrategy.name,
              reason: signal.reasoning
            }, ...prev]);
            addLog(`Executed BUY ${signal.symbol} (${signal.reasoning})`);
          }
        } else if (signal.action === 'close') {
          const posIndex = newPositions.findIndex(p => p.coin === signal.symbol);
          if (posIndex !== -1) {
            const pos = newPositions[posIndex];
            const executionPrice = signal.price || data[signal.symbol].price;
            const value = pos.quantity * executionPrice;
            const pnl = value - (pos.quantity * pos.avg_price);
            newCash += value;
            newPositions.splice(posIndex, 1);
            setTrades(prev => [{
              time: new Date().toLocaleTimeString(),
              coin: signal.symbol,
              type: 'SELL',
              quantity: pos.quantity,
              price: executionPrice,
              pnl: pnl,
              strategy: activeStrategy.name,
              reason: signal.reasoning
            }, ...prev]);
            addLog(`Executed SELL ${signal.symbol} (PnL: ${pnl.toFixed(2)})`);
          }
        }
      }

      // Update portfolio value
      let positionsValue = 0;
      newPositions.forEach(p => {
        positionsValue += p.quantity * (data[p.coin]?.price || p.avg_price);
      });

      setPortfolio({
        total_value: newCash + positionsValue,
        cash: newCash,
        positions: newPositions
      });

    } catch (e) {
      addLog(`Error: ${e}`);
      console.error(e);
      setIsTrading(false);
    }
  };

  useEffect(() => {
    let interval: any;
    if (isTrading) {
      runTradingCycle(); // Run immediately
      interval = setInterval(runTradingCycle, 60000); // Then every minute
    }
    return () => clearInterval(interval);
  }, [isTrading]);


  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="header-content">
          <div className="header-left">
            <h1 className="app-title">AITradeGame</h1>
            <div className="header-status">
              <span className={`status-dot ${isTrading ? 'active' : ''}`}></span>
              <span className="status-text">{isTrading ? '运行中' : '已停止'}</span>
            </div>
            <a href="https://github.com/chadyi/AITradeGame" target="_blank" className="header-link" title="访问项目GitHub">
              <Github size={16} />
              <span className="header-link-text">GitHub</span>
            </a>
          </div>
          <div className="header-right">
            <button 
              className={`btn-primary ${isTrading ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'}`}
              onClick={() => setIsTrading(!isTrading)}
              style={{ marginRight: 10 }}
            >
              {isTrading ? <Pause size={16} /> : <Play size={16} />}
              {isTrading ? ' 停止交易' : ' 开始交易'}
            </button>
            
            <div className="update-indicator" id="updateIndicator" style={{ display: 'none' }}>
              <button className="btn-icon update-btn" onClick={() => setShowUpdateModal(true)} title="检查更新">
                <ArrowUpCircle size={20} />
              </button>
            </div>
            <button className="btn-icon" title="刷新" onClick={runTradingCycle}>
              <RefreshCw size={20} />
            </button>
            <button className="btn-secondary" onClick={() => setShowSettingsModal(true)}>
              <Settings size={16} />
              设置
            </button>
            <button className="btn-secondary" onClick={() => setShowApiProviderModal(true)}>
              <Cloud size={16} />
              API提供方
            </button>
          </div>
        </div>
      </header>

      <div className="app-body">
        {/* Sidebar */}
        <aside className="app-sidebar">
          <div className="sidebar-section">
            <div className="section-header">
              <span>交易策略</span>
            </div>
            <div id="modelList" className="model-list">
                {strategies.map(strategy => (
                  <div 
                    key={strategy.id}
                    className={`model-item ${activeStrategyId === strategy.id ? 'active' : ''}`}
                    onClick={() => setActiveStrategyId(strategy.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="model-name" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {strategy.id === 'arbitrage_bot' ? <Zap size={16} className="text-warning" /> : <Brain size={16} className="text-primary" />}
                      {strategy.name}
                    </div>
                    <div className="model-info" style={{ fontSize: '11px', opacity: 0.8, marginTop: '4px' }}>
                      {strategy.description.substring(0, 40)}...
                    </div>
                  </div>
                ))}
                
                {strategies.length === 1 && (
                  <div className="empty-state" style={{ fontSize: '12px', padding: '10px' }}>
                    配置API Key以启用AI Trader
                  </div>
                )}
            </div>
          </div>
          <div className="sidebar-section">
            <div className="section-header">
              <span>市场行情</span>
              <TrendingUp size={14} style={{marginLeft: 'auto'}} />
            </div>
            <div id="marketPrices" className="market-prices">
                {Object.keys(marketData).length === 0 ? (
                  <div className="empty-state" style={{padding: '10px'}}>等待数据...</div>
                ) : (
                  Object.entries(marketData).map(([coin, data]) => (
                    <div className="price-item" key={coin}>
                        <span className="price-symbol">{coin}</span>
                        <div style={{textAlign: 'right'}}>
                            <div className="price-value">${data.price.toFixed(2)}</div>
                            <div className={`price-change ${data.change_24h >= 0 ? 'text-success' : 'text-danger'}`}>
                              {data.change_24h > 0 ? '+' : ''}{data.change_24h.toFixed(2)}%
                            </div>
                        </div>
                    </div>
                  ))
                )}
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <main className="app-main">
          {/* Stats Cards */}
          <div className="stats-grid" id="statsGrid">
            <div className="stat-card">
              <div className="stat-header">
                <span className="stat-label">账户总值</span>
                <Wallet className="text-primary" size={20} />
              </div>
              <div className="stat-value">${portfolio.total_value.toFixed(2)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-header">
                <span className="stat-label">可用现金</span>
                <Banknote className="text-success" size={20} />
              </div>
              <div className="stat-value">${portfolio.cash.toFixed(2)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-header">
                <span className="stat-label">总收益率</span>
                <TrendingUp className="text-info" size={20} />
              </div>
              <div className="stat-value">
                {((portfolio.total_value - 100000) / 100000 * 100).toFixed(2)}%
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-header">
                <span className="stat-label">持仓数量</span>
                <TrendingDown className="text-warning" size={20} />
              </div>
              <div className="stat-value">{portfolio.positions.length}</div>
            </div>
          </div>

          {/* Chart */}
          <div className="content-card">
            <div className="card-header">
              <h3 className="card-title">账户价值走势</h3>
            </div>
            <div className="card-body">
              <div id="accountChart" style={{ width: '100%', height: '300px', background: '#f7f8fa', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#86909c' }}>
                  {/* Simple Chart Placeholder - In real app use Recharts/Chart.js */}
                  <div style={{textAlign: 'center'}}>
                    <p>Chart Visualization Placeholder</p>
                    <p>Current Value: ${portfolio.total_value.toFixed(2)}</p>
                  </div>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="content-card">
            <div className="card-tabs">
              <button 
                className={`tab-btn ${activeTab === 'positions' ? 'active' : ''}`} 
                onClick={() => setActiveTab('positions')}
              >
                持仓
              </button>
              <button 
                className={`tab-btn ${activeTab === 'trades' ? 'active' : ''}`} 
                onClick={() => setActiveTab('trades')}
              >
                交易记录
              </button>
              <button 
                className={`tab-btn ${activeTab === 'conversations' ? 'active' : ''}`} 
                onClick={() => setActiveTab('conversations')}
              >
                系统日志
              </button>
            </div>

            <div className={`tab-content ${activeTab === 'positions' ? 'active' : ''}`}>
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>币种</th>
                      <th>方向</th>
                      <th>数量</th>
                      <th>开仓价</th>
                      <th>当前价</th>
                      <th>杠杆</th>
                      <th>盈亏</th>
                    </tr>
                  </thead>
                  <tbody>
                    {portfolio.positions.length === 0 ? (
                      <tr><td colSpan={7} className="empty-state">暂无持仓</td></tr>
                    ) : (
                      portfolio.positions.map((pos, idx) => {
                        const currentPrice = marketData[pos.coin]?.price || pos.avg_price;
                        const pnl = (currentPrice - pos.avg_price) * pos.quantity * (pos.side === 'long' ? 1 : -1);
                        return (
                          <tr key={idx}>
                            <td>{pos.coin}</td>
                            <td><span className={`badge ${pos.side === 'long' ? 'badge-success' : 'badge-danger'}`}>{pos.side.toUpperCase()}</span></td>
                            <td>{pos.quantity.toFixed(4)}</td>
                            <td>${pos.avg_price.toFixed(2)}</td>
                            <td>${currentPrice.toFixed(2)}</td>
                            <td>{pos.leverage}x</td>
                            <td className={pnl >= 0 ? 'text-success' : 'text-danger'}>${pnl.toFixed(2)}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className={`tab-content ${activeTab === 'trades' ? 'active' : ''}`}>
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>时间</th>
                      <th>策略</th>
                      <th>币种</th>
                      <th>操作</th>
                      <th>数量</th>
                      <th>价格</th>
                      <th>盈亏</th>
                      <th>说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.length === 0 ? (
                      <tr><td colSpan={8} className="empty-state">暂无交易记录</td></tr>
                    ) : (
                      trades.map((trade, idx) => (
                        <tr key={idx}>
                          <td>{trade.time}</td>
                          <td><span className="badge badge-secondary">{trade.strategy || 'Unknown'}</span></td>
                          <td>{trade.coin}</td>
                          <td><span className={`badge ${trade.type === 'BUY' ? 'badge-success' : 'badge-danger'}`}>{trade.type}</span></td>
                          <td>{trade.quantity.toFixed(4)}</td>
                          <td>${trade.price.toFixed(2)}</td>
                          <td className={trade.pnl >= 0 ? 'text-success' : 'text-danger'}>${trade.pnl.toFixed(2)}</td>
                          <td style={{maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}} title={trade.reason}>{trade.reason}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className={`tab-content ${activeTab === 'conversations' ? 'active' : ''}`}>
              <div className="conversations-list" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                {logs.length === 0 ? (
                  <div className="empty-state">暂无日志</div>
                ) : (
                  logs.map((log, idx) => (
                    <div key={idx} className="log-entry" style={{ padding: '8px', borderBottom: '1px solid #eee', fontFamily: 'monospace', fontSize: '12px' }}>
                      {log}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* API Provider Modal */}
      {showApiProviderModal && (
        <div className="modal show">
          <div className="modal-content">
            <div className="modal-header">
              <h3>API提供方管理</h3>
              <button className="btn-close" onClick={() => setShowApiProviderModal(false)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>API名称</label>
                <input type="text" defaultValue="DeepSeek" className="form-input" disabled />
              </div>
              <div className="form-group">
                <label>API地址</label>
                <input 
                  type="text" 
                  defaultValue={DEFAULT_API_URL} 
                  className="form-input" 
                  id="apiUrlInput"
                />
              </div>
              <div className="form-group">
                <label>API密钥</label>
                <input 
                  type="password" 
                  placeholder="sk-..." 
                  className="form-input" 
                  id="apiKeyInput"
                  defaultValue={apiKey}
                />
              </div>
              <div className="form-group">
                <label>可用模型</label>
                <div className="model-input-group">
                  <input type="text" defaultValue={DEFAULT_MODEL} className="form-input" disabled />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowApiProviderModal(false)}>取消</button>
              <button 
                className="btn-primary"
                onClick={() => {
                  const key = (document.getElementById('apiKeyInput') as HTMLInputElement).value;
                  const url = (document.getElementById('apiUrlInput') as HTMLInputElement).value;
                  if (key) {
                    handleSaveProvider(key, url);
                  } else {
                    alert("请输入API密钥");
                  }
                }}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Model Modal */}
      {showAddModelModal && (
        <div className="modal show">
          <div className="modal-content">
            <div className="modal-header">
              <h3>添加交易模型</h3>
              <button className="btn-close" onClick={() => setShowAddModelModal(false)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>选择API提供方</label>
                <select className="form-input">
                  <option value="">请先添加API提供方</option>
                </select>
              </div>
              <div className="form-group">
                <label>模型</label>
                <select className="form-input">
                  <option value="">请选择API提供方</option>
                </select>
              </div>
              <div className="form-group">
                <label>模型显示名称</label>
                <input type="text" placeholder="例如: GPT-4交易员" className="form-input" />
                <small className="form-help">用于显示的友好名称</small>
              </div>
              <div className="form-group">
                <label>初始资金</label>
                <input type="number" defaultValue="100000" className="form-input" />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowAddModelModal(false)}>取消</button>
              <button className="btn-primary">确认添加</button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettingsModal && (
        <div className="modal show">
          <div className="modal-content">
            <div className="modal-header">
              <h3>系统设置</h3>
              <button className="btn-close" onClick={() => setShowSettingsModal(false)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>交易频率（分钟）</label>
                <input type="number" min="1" max="1440" className="form-input" placeholder="60" />
                <small className="form-help">设置AI交易决策的时间间隔（1-1440分钟）</small>
              </div>
              <div className="form-group">
                <label>交易费率</label>
                <input type="number" min="0" max="0.01" step="0.0001" className="form-input" placeholder="0.001" />
                <small className="form-help">每笔交易的手续费费率（0-0.01，例如0.001表示0.1%）</small>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowSettingsModal(false)}>取消</button>
              <button className="btn-primary">保存设置</button>
            </div>
          </div>
        </div>
      )}

      {/* Update Modal */}
      {showUpdateModal && (
        <div className="modal show">
          <div className="modal-content">
            <div className="modal-header">
              <h3>
                <DownloadCloud className="text-info" size={20} style={{marginRight: '8px', display: 'inline'}} />
                发现新版本
              </h3>
              <button className="btn-close" onClick={() => setShowUpdateModal(false)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <div className="update-info">
                <div className="update-version">
                  <div className="current-version">
                    <Cpu size={16} />
                    <span>当前版本：</span>
                    <strong>v1.0.0</strong>
                  </div>
                  <div className="arrow-down">
                    <ArrowDown size={20} />
                  </div>
                  <div className="latest-version">
                    <Gem size={16} />
                    <span>最新版本：</span>
                    <strong className="text-success">v1.1.0</strong>
                  </div>
                </div>
                <div className="update-notes">
                  <div className="notes-header">
                    <BookOpen size={16} />
                    <span>更新说明</span>
                  </div>
                  <div className="notes-content">
                    <p>新功能和改进将在此处显示...</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowUpdateModal(false)}>稍后提醒</button>
              <a href="#" className="btn-primary" target="_blank">
                <Github size={16} />
                前往GitHub
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;