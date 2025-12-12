import { useState, useEffect, useRef } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
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
  Brain,
  Trash
} from 'lucide-react';
import { MarketDataService, MarketData } from './services/marketData';
import { Portfolio } from './services/aiTrader';
import { Strategy, Signal } from './services/strategies/types';
import { ArbitrageStrategy } from './services/strategies/ArbitrageStrategy';
import { LLMStrategy } from './services/strategies/LLMStrategy';
import SettingsModal from './components/SettingsModal';
import ModelSettingsModal from './components/ModelSettingsModal';
import LoginModal from './components/LoginModal';

// Default Configuration
const DEFAULT_API_URL = "https://api.deepseek.com/v3.2_speciale_expires_on_20251215";
const DEFAULT_MODEL = "deepseek-reasoner";

function App() {
  const [token, setToken] = useState(() => localStorage.getItem('authToken') || '');

  useEffect(() => {
    if (token) {
      localStorage.setItem('authToken', token);
      
      const originalFetch = window.fetch;
      window.fetch = async (input, init) => {
        const headers = new Headers(init?.headers || {});
        headers.set('Authorization', `Bearer ${token}`);
        
        const newInit = { ...init, headers };
        const response = await originalFetch(input, newInit);
        
        if (response.status === 401) {
          setToken('');
          localStorage.removeItem('authToken');
        }
        return response;
      };
      
      return () => {
        window.fetch = originalFetch;
      };
    }
  }, [token]);

  const [activeTab, setActiveTab] = useState('positions');
  const [showApiProviderModal, setShowApiProviderModal] = useState(false);
  const [showAddModelModal, setShowAddModelModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [settingsModel, setSettingsModel] = useState<{id: number, name: string} | null>(null);
  const [showLeaderboardModal, setShowLeaderboardModal] = useState(false);
  const [leaderboardData, setLeaderboardData] = useState<any[]>([]);

  // App State
  const [apiKey, setApiKey] = useState('');
  const [okxConfig, setOkxConfig] = useState(() => {
    const saved = localStorage.getItem('okxConfig');
    return saved ? JSON.parse(saved) : {
      apiKey: '',
      secret: '',
      passphrase: '',
      isSimulation: true
    };
  });

  useEffect(() => {
    localStorage.setItem('okxConfig', JSON.stringify(okxConfig));
  }, [okxConfig]);

  const [isTrading, setIsTrading] = useState(() => {
    const saved = localStorage.getItem('isTrading');
    return saved ? JSON.parse(saved) : false;
  });
  
  useEffect(() => {
    localStorage.setItem('isTrading', JSON.stringify(isTrading));
  }, [isTrading]);

  const [logs, setLogs] = useState<string[]>([]);
  const [marketData, setMarketData] = useState<Record<string, MarketData>>({});
  const [portfolio, setPortfolio] = useState<Portfolio>({
    total_value: 100000,
    cash: 100000,
    positions: []
  });
  const [portfolioHistory, setPortfolioHistory] = useState<{time: string, value: number}[]>([
    { time: new Date().toLocaleTimeString(), value: 100000 }
  ]);
  const [trades, setTrades] = useState<any[]>([]);
  const [localTrades, setLocalTrades] = useState<any[]>(() => {
    const saved = localStorage.getItem('localTrades');
    return saved ? JSON.parse(saved) : [];
  });
  
  useEffect(() => {
    localStorage.setItem('localTrades', JSON.stringify(localTrades));
  }, [localTrades]);

  const [localPortfolio, setLocalPortfolio] = useState<Portfolio>(() => {
    const saved = localStorage.getItem('localPortfolio');
    return saved ? JSON.parse(saved) : {
      total_value: 100000,
      cash: 100000,
      positions: []
    };
  });

  useEffect(() => {
    localStorage.setItem('localPortfolio', JSON.stringify(localPortfolio));
  }, [localPortfolio]);

  const [localPortfolioHistory, setLocalPortfolioHistory] = useState<{time: string, value: number}[]>(() => {
    const saved = localStorage.getItem('localPortfolioHistory');
    return saved ? JSON.parse(saved) : [
      { time: new Date().toLocaleTimeString(), value: 100000 }
    ];
  });

  useEffect(() => {
    localStorage.setItem('localPortfolioHistory', JSON.stringify(localPortfolioHistory));
  }, [localPortfolioHistory]);

  const [localLogs, setLocalLogs] = useState<string[]>(() => {
    const saved = localStorage.getItem('localLogs');
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    localStorage.setItem('localLogs', JSON.stringify(localLogs));
  }, [localLogs]);
  
  // Strategies
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [activeStrategyId, setActiveStrategyId] = useState<string>('arbitrage_bot');
  const [backendStatus, setBackendStatus] = useState<{status: string, active_engines: string[]} | null>(null);

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const res = await fetch('/api/status');
        if (res.ok) {
          const data = await res.json();
          setBackendStatus(data);
        } else {
          console.warn("Backend Status Check Failed:", res.status);
          setBackendStatus(null);
        }
      } catch (e) {
        console.error("Backend Status Check Error:", e);
        setBackendStatus(null);
      }
    };
    
    checkStatus();
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  // Backend State
  const [backendModels, setBackendModels] = useState<any[]>([]);
  const [providers, setProviders] = useState<any[]>([]);
  const [backendConnected, setBackendConnected] = useState(false);
  const [lastDataFetchSuccess, setLastDataFetchSuccess] = useState(false);
  const [isBackendRunning, setIsBackendRunning] = useState(false);
  const [newModelConfig, setNewModelConfig] = useState({
    name: '',
    provider_id: '',
    model_name: '',
    initial_capital: 100000,
    strategy_type: 'llm_json'
  });

  const [newProvider, setNewProvider] = useState({
    name: 'DeepSeek',
    api_url: 'https://api.deepseek.com',
    api_key: ''
  });

  const marketService = useRef(new MarketDataService());
  
  // Refs for stale closure fix
  const portfolioRef = useRef(portfolio);
  const activeStrategyIdRef = useRef(activeStrategyId);
  const okxConfigRef = useRef(okxConfig);
  const strategiesRef = useRef(strategies);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    portfolioRef.current = portfolio;
  }, [portfolio]);

  useEffect(() => {
    activeStrategyIdRef.current = activeStrategyId;
  }, [activeStrategyId]);

  useEffect(() => {
    okxConfigRef.current = okxConfig;
  }, [okxConfig]);

  useEffect(() => {
    strategiesRef.current = strategies;
  }, [strategies]);
  
  // Initialize Strategies
  useEffect(() => {
    const arbStrategy = new ArbitrageStrategy();
    setStrategies([arbStrategy]);
  }, []);

  // Handle strategy switching for trades display
  useEffect(() => {
    if (!activeStrategyId.startsWith('backend-')) {
      setTrades(localTrades);
      setPortfolio(localPortfolio);
      setPortfolioHistory(localPortfolioHistory);
      setLogs(localLogs);
    } else {
      setTrades([]);
      setLogs([]);
      // Optional: Clear portfolio/history temporarily to show loading state, 
      // but keeping previous data until fetch might be smoother.
      // We'll let the polling overwrite it.
    }
  }, [activeStrategyId]);

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

  const handleRunBackend = async () => {
    if (isBackendRunning) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      return;
    }

    if (!activeStrategyId.startsWith('backend-')) return;
    const modelId = activeStrategyId.replace('backend-', '');
    
    setIsBackendRunning(true);
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      addLog("Requesting backend execution...");
      const res = await fetch(`/api/models/${modelId}/execute`, { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          okx_config: okxConfigRef.current
        }),
        signal: controller.signal
      });
      if (res.ok) {
        const result = await res.json();
        if (result.success) {
           addLog("Backend execution successful");
           if (result.executions && result.executions.length > 0) {
             addLog(`Executed ${result.executions.length} trades`);
           } else {
             addLog("No trades executed in this cycle");
           }
        } else {
           addLog(`Backend execution failed: ${result.error}`);
           alert(`Execution Failed: ${result.error}`);
        }
      } else {
        addLog("Backend request failed");
        alert("Backend request failed");
      }
    } catch (e: any) {
      if (e.name === 'AbortError') {
        addLog("Execution cancelled by user");
      } else {
        addLog(`Error: ${e}`);
        alert(`Error: ${e}`);
      }
    } finally {
      setIsBackendRunning(false);
      abortControllerRef.current = null;
    }
  };

  const handleToggleBackend = async () => {
    if (!backendStatus) return;
    
    const action = backendStatus.auto_trading ? 'stop' : 'start';
    try {
      const res = await fetch(`/api/control/${action}`, { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          okx_config: okxConfigRef.current
        })
      });
      if (res.ok) {
        const data = await res.json();
        setBackendStatus(prev => prev ? ({ ...prev, auto_trading: data.auto_trading }) : null);
        addLog(`Backend auto-trading ${action}ed`);
      } else {
        alert(`Failed to ${action} backend trading`);
      }
    } catch (e) {
      console.error(e);
      alert(`Error: ${e}`);
    }
  };

  const handleDeleteModel = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this model?")) return;
    try {
      const res = await fetch(`/api/models/${id}`, { method: 'DELETE' });
      if (res.ok) {
        // Refresh models
        const modelsRes = await fetch(`/api/models?t=${Date.now()}`);
        if (modelsRes.ok) setBackendModels(await modelsRes.json());
        if (activeStrategyId === `backend-${id}`) {
            setActiveStrategyId('arbitrage_bot');
        }
        console.log("Model deleted");
      } else {
          alert("Failed to delete model");
      }
    } catch (e) {
      console.error(e);
      alert("Error deleting model");
    }
  };

  const handleToggleModelActive = async (e: React.MouseEvent, id: number, currentStatus: boolean) => {
    e.stopPropagation();

    // If enabling a model, and global auto-trading is OFF, turn it ON
    if (!currentStatus && backendStatus && !backendStatus.auto_trading) {
        try {
            console.log("Auto-starting global trading loop...");
            await fetch('/api/control/start', { method: 'POST' });
            // Update local status immediately to reflect change
            setBackendStatus(prev => prev ? {...prev, auto_trading: true} : prev);
            addLog("Global Auto-Trading started automatically");
        } catch (err) {
            console.error("Failed to auto-start global trading", err);
        }
    }

    let closePositions = false;
    if (currentStatus) { // Turning OFF
        // Ask user if they want to close positions
        if (confirm("Do you want to close all open positions for this strategy before stopping?")) {
            closePositions = true;
        }
    }

    try {
      const res = await fetch(`/api/models/${id}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            is_active: !currentStatus,
            close_positions: closePositions
        })
      });
      if (res.ok) {
        // Refresh models to update UI
        const modelsRes = await fetch(`/api/models?t=${Date.now()}`);
        if (modelsRes.ok) setBackendModels(await modelsRes.json());
        if (closePositions) addLog(`Model ${id} stopped and positions closed.`);
      }
    } catch (e) {
      console.error("Failed to toggle model", e);
    }
  };

  const addLog = (msg: string) => {
    const logMsg = `[${new Date().toLocaleTimeString()}] ${msg}`;
    setLogs(prev => [logMsg, ...prev]);
    if (!activeStrategyIdRef.current.startsWith('backend-')) {
      setLocalLogs(prev => [logMsg, ...prev]);
    }
  };

  const handleAddProvider = async () => {
    try {
      if (!newProvider.name || !newProvider.api_key) {
        alert("Please fill in Name and API Key");
        return;
      }

      const response = await fetch('/api/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newProvider)
      });
      
      if (response.ok) {
        addLog(`Provider added: ${newProvider.name}`);
        setShowApiProviderModal(false);
        // Refresh providers
        const providersRes = await fetch('/api/providers');
        if (providersRes.ok) setProviders(await providersRes.json());
        // Reset form
        setNewProvider({ name: 'DeepSeek', api_url: 'https://api.deepseek.com', api_key: '' });
      } else {
        const err = await response.json();
        alert(`Error: ${err.error}`);
      }
    } catch (e) {
      console.error(e);
      alert("Failed to add provider");
    }
  };

  const handleDeleteProvider = async (id: number) => {
    if (!confirm("Are you sure you want to delete this provider?")) return;
    try {
      const res = await fetch(`/api/providers/${id}`, { method: 'DELETE' });
      if (res.ok) {
        const providersRes = await fetch('/api/providers');
        if (providersRes.ok) setProviders(await providersRes.json());
        addLog("Provider deleted");
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
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

    // Fetch Backend Data
    const fetchBackendData = async () => {
      try {
        const [modelsRes, providersRes] = await Promise.all([
          fetch(`/api/models?t=${Date.now()}`),
          fetch('/api/providers')
        ]);
        if (modelsRes.ok) setBackendModels(await modelsRes.json());
        if (providersRes.ok) {
          setProviders(await providersRes.json());
          setBackendConnected(true);
        } else {
          setBackendConnected(false);
        }
      } catch (e) {
        console.error("Backend fetch failed", e);
        setBackendConnected(false);
      }
    };
    fetchBackendData();
  }, []);

  // Refresh providers when modal opens
  useEffect(() => {
    if (showAddModelModal || showApiProviderModal) {
      fetch('/api/providers')
        .then(res => {
          if (!res.ok) throw new Error('Network response was not ok');
          return res.json();
        })
        .then(data => {
          setProviders(data);
          setBackendConnected(true);
        })
        .catch(e => {
          console.error("Failed to refresh providers", e);
          setBackendConnected(false);
          // Don't alert here to avoid spamming, just log
        });
    }
  }, [showAddModelModal, showApiProviderModal]);

  const handleAddModel = async () => {
    try {
      const response = await fetch('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newModelConfig)
      });
      
      if (response.ok) {
        const result = await response.json();
        addLog(`Model added: ${result.message}`);
        setShowAddModelModal(false);
        // Refresh models
        const modelsRes = await fetch(`/api/models?t=${Date.now()}`);
        if (modelsRes.ok) setBackendModels(await modelsRes.json());
      } else {
        const err = await response.json();
        alert(`Error: ${err.error}`);
      }
    } catch (e) {
      console.error(e);
      if (e instanceof TypeError && e.message.includes('Failed to fetch')) {
         addLog("❌ Connection Failed: Backend not running?");
         addLog("👉 Run: python3 web/app.py");
         alert("Failed to connect to backend. Please ensure the Python server is running on port 5001.");
      } else {
         alert("Failed to add model");
      }
    }
  };

  // Polling for backend models
  useEffect(() => {
    let interval: any;
    
    const fetchModelData = async () => {
      if (activeStrategyId.startsWith('backend-')) {
        const modelId = activeStrategyId.replace('backend-', '');
        try {
          const res = await fetch(`/api/models/${modelId}/portfolio`);
          if (res.ok) {
            setLastDataFetchSuccess(true);
            const data = await res.json();
            setPortfolio(data.portfolio);
            
            if (data.portfolio.sync_error) {
                addLog(`[Error] OKX Sync Failed: ${data.portfolio.sync_error}`);
            } else if (data.portfolio.okx_synced) {
                // Optional: Log success occasionally or just rely on UI indicator
            }

            // Reverse to show oldest to newest
            setPortfolioHistory(data.account_value_history.reverse().map((h: any) => {
              const timeStr = h.timestamp.replace(' ', 'T');
              const dateObj = new Date(timeStr.endsWith('Z') ? timeStr : timeStr + 'Z');
              return {
                time: dateObj.toLocaleTimeString(),
                value: h.total_value
              };
            }));
            
            // Fetch trades
            const tradesRes = await fetch(`/api/models/${modelId}/trades`);
            if (tradesRes.ok) {
              const tradesData = await tradesRes.json();
              setTrades(tradesData.map((t: any) => ({
                time: new Date(t.timestamp).toLocaleTimeString(),
                coin: t.coin,
                type: t.signal ? t.signal.toUpperCase() : (t.side === 'long' ? 'BUY' : 'SELL'),
                quantity: t.quantity,
                price: t.price,
                pnl: t.pnl,
                strategy: 'Backend',
                reason: t.signal
              })));
            }

            // Fetch logs (conversations)
            const logsRes = await fetch(`/api/models/${modelId}/conversations?limit=50`);
            if (logsRes.ok) {
              const logsData = await logsRes.json();
              console.log("Logs data:", logsData); // Debug
              const formattedLogs = logsData.map((c: any) => {
                 try {
                     const timeStr = c.timestamp || c.created_at || new Date().toISOString();
                     const isoStr = timeStr.replace(' ', 'T');
                     const dateObj = new Date(isoStr.endsWith('Z') ? isoStr : isoStr + 'Z');
                     const timeDisplay = isNaN(dateObj.getTime()) ? timeStr : dateObj.toLocaleTimeString();

                     // Try to parse as JSON first
                     let content = c.ai_response;
                     try {
                        const parsed = JSON.parse(content);
                        if (parsed.error) return `[${timeDisplay}] ❌ Error: ${parsed.error}`;
                        if (parsed.message) return `[${timeDisplay}] ${parsed.message}`;
                        if (Array.isArray(parsed)) {
                            if (parsed.length > 0) return `[${timeDisplay}] Signals: ${parsed.map((s:any) => `${s.action} ${s.symbol}`).join(', ')}`;
                            return `[${timeDisplay}] No signals generated.`;
                        }
                        content = JSON.stringify(parsed);
                     } catch (e) {}
                     
                     return `[${timeDisplay}] ${content}`;
                 } catch (e) {
                     return `[Error] Error parsing log`;
                 }
              });
              setLogs(formattedLogs);
            }
          }
        } catch (e) {
          console.error("Failed to fetch model data", e);
        }
      }
    };

    if (activeStrategyId.startsWith('backend-')) {
      fetchModelData();
      interval = setInterval(fetchModelData, 5000); // Poll every 5s
    }

    return () => clearInterval(interval);
  }, [activeStrategyId]);

  const runTradingCycle = async () => {
    // Use refs to avoid stale closures
    const currentActiveStrategyId = activeStrategyIdRef.current;
    const currentPortfolio = portfolioRef.current;
    const currentStrategies = strategiesRef.current;
    const currentOkxConfig = okxConfigRef.current;

    // Skip if backend model is active
    if (currentActiveStrategyId.startsWith('backend-')) return;

    try {
      // Always fetch market data first
      addLog("Fetching market data...");
      const coins = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE'];
      const data = await marketService.current.getMarketState(coins);
      setMarketData(data);

      const activeStrategy = currentStrategies.find(s => s.id === currentActiveStrategyId);
      if (!activeStrategy) {
        addLog("Error: No active strategy selected");
        setIsTrading(false);
        return;
      }

      addLog(`Running Strategy: ${activeStrategy.name}...`);
      
      const signals = await activeStrategy.generateSignals({
        marketState: data,
        portfolio: currentPortfolio,
        accountInfo: { 
          initial_capital: 100000, 
          total_return: ((currentPortfolio.total_value - 100000) / 100000) * 100 
        }
      });

      if (signals.length === 0) {
        addLog("No trading signals generated.");
      } else {
        addLog(`Generated ${signals.length} signals: ${signals.map(s => `${s.action} ${s.symbol}`).join(', ')}`);
      }
      
      // Execute trades
      let newCash = currentPortfolio.cash;
      const newPositions = [...currentPortfolio.positions];

      // OKX Execution Logic
      const useOkx = currentOkxConfig.apiKey && currentOkxConfig.secret && currentOkxConfig.passphrase;

      for (const signal of signals) {
        if (useOkx) {
             try {
                 addLog(`[OKX] Sending ${signal.action.toUpperCase()} ${signal.symbol}...`);
                 const response = await fetch('/api/okx/trade', {
                     method: 'POST',
                     headers: {'Content-Type': 'application/json'},
                     body: JSON.stringify({
                         api_key: currentOkxConfig.apiKey,
                         secret: currentOkxConfig.secret,
                         passphrase: currentOkxConfig.passphrase,
                         is_simulation: currentOkxConfig.isSimulation,
                         symbol: signal.symbol,
                         side: signal.action,
                         amount: signal.quantity
                     })
                 });
                 const res = await response.json();
                 if (res.success) {
                     addLog(`[OKX] Order Executed: ${res.order_id} @ ${res.price}`);
                 } else {
                     addLog(`[OKX Error] ${res.error}`);
                 }
             } catch (e) {
                 addLog(`[OKX Warning] Backend not reachable, continuing local simulation.`);
             }
        }

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
            const newTrade = {
              time: new Date().toLocaleTimeString(),
              coin: signal.symbol,
              type: 'BUY',
              quantity: signal.quantity,
              price: executionPrice,
              pnl: 0,
              strategy: activeStrategy.name,
              reason: signal.reasoning
            };
            setTrades(prev => [newTrade, ...prev]);
            setLocalTrades(prev => [newTrade, ...prev]);
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
            const newTrade = {
              time: new Date().toLocaleTimeString(),
              coin: signal.symbol,
              type: 'SELL',
              quantity: pos.quantity,
              price: executionPrice,
              pnl: pnl,
              strategy: activeStrategy.name,
              reason: signal.reasoning
            };
            setTrades(prev => [newTrade, ...prev]);
            setLocalTrades(prev => [newTrade, ...prev]);
            addLog(`Executed SELL ${signal.symbol} (PnL: ${pnl.toFixed(2)})`);
          }
        }
      }

      // Update portfolio value
      let positionsValue = 0;
      newPositions.forEach(p => {
        positionsValue += p.quantity * (data[p.coin]?.price || p.avg_price);
      });

      const totalValue = newCash + positionsValue;
      const updatedPortfolio = {
        total_value: totalValue,
        cash: newCash,
        positions: newPositions
      };
      setPortfolio(updatedPortfolio);
      setLocalPortfolio(updatedPortfolio);
      
      setPortfolioHistory(prev => {
        const newHistory = [...prev, { time: new Date().toLocaleTimeString(), value: totalValue }];
        if (newHistory.length > 50) newHistory.shift(); // Keep last 50 data points
        setLocalPortfolioHistory(newHistory);
        return newHistory;
      });

    } catch (e) {
      addLog(`Error: ${e}`);
      console.error(e);
      // Don't stop trading on error, just log it
      // setIsTrading(false); 
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


  if (!token) {
    return <LoginModal onLogin={setToken} />;
  }

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="header-content">
          <div className="header-left">
            <h1 className="app-title">AITradeGame</h1>
            <div className="header-status">
              <span className={`status-dot ${isTrading ? 'active' : ''}`}></span>
              <span className="status-text">{isTrading ? 'Local: On' : 'Local: Off'}</span>
            </div>
            <div className="header-status" style={{ marginLeft: '12px', borderLeft: '1px solid #eee', paddingLeft: '12px' }}>
              <span className={`status-dot ${backendStatus ? 'active' : ''}`} style={{ backgroundColor: backendStatus ? '#10b981' : '#ef4444' }}></span>
              <span className="status-text" title={!backendStatus ? "Run 'python3 web/app.py' in terminal" : "Connected"}>Backend: {backendStatus ? 'Online' : 'Offline'}</span>
            </div>
            <a href="https://github.com/chadyi/AITradeGame" target="_blank" className="header-link" title="访问项目GitHub">
              <Github size={16} />
              <span className="header-link-text">GitHub</span>
            </a>
          </div>
          <div className="header-right">
            {activeStrategyId.startsWith('backend-') ? (
              <>
                <button 
                  className={`btn-primary ${backendStatus?.auto_trading ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'}`}
                  onClick={handleToggleBackend}
                  style={{ marginRight: 10 }}
                  disabled={!backendStatus}
                  title={!backendStatus ? "Backend Offline" : (backendStatus.auto_trading ? "Stop Global Auto-Trading" : "Start Global Auto-Trading")}
                >
                  {backendStatus?.auto_trading ? <Pause size={16} /> : <Play size={16} />}
                  {backendStatus?.auto_trading ? ' 停止全局自动' : ' 开启全局自动'}
                </button>
                <button 
                  className={`btn-primary ${isBackendRunning ? 'bg-gray-500 hover:bg-gray-600' : 'bg-blue-500 hover:bg-blue-600'}`}
                  onClick={handleRunBackend}
                  style={{ marginRight: 10 }}
                  disabled={(!backendStatus && !lastDataFetchSuccess)}
                  title={(!backendStatus && !lastDataFetchSuccess) ? "Backend Offline" : (isBackendRunning ? "Click to Cancel" : "Run Immediate Cycle")}
                >
                  {isBackendRunning ? <X size={16} /> : <Zap size={16} />} 
                  {isBackendRunning ? ' 取消运行' : ' 立即运行'}
                </button>
              </>
            ) : (
              <button 
                className={`btn-primary ${isTrading ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'}`}
                onClick={() => setIsTrading(!isTrading)}
                style={{ marginRight: 10 }}
              >
                {isTrading ? <Pause size={16} /> : <Play size={16} />}
                {isTrading ? ' 停止交易' : ' 开始交易'}
              </button>
            )}
            
            <div className="update-indicator" id="updateIndicator" style={{ display: 'none' }}>
              <button className="btn-icon update-btn" onClick={() => setShowUpdateModal(true)} title="检查更新">
                <ArrowUpCircle size={20} />
              </button>
            </div>
            <button className="btn-icon" title="刷新" onClick={runTradingCycle}>
              <RefreshCw size={20} />
            </button>
            <button className="btn-secondary" onClick={() => {
              setShowLeaderboardModal(true);
              fetch('/api/leaderboard').then(res => res.json()).then(setLeaderboardData);
            }}>
              <TrendingUp size={16} />
              排行榜
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
                {/* Local Strategies */}
                {strategies.map(strategy => (
                  <div 
                    key={strategy.id}
                    className={`model-item ${activeStrategyId === strategy.id ? 'active' : ''}`}
                    onClick={() => setActiveStrategyId(strategy.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="model-name" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {strategy.id === 'arbitrage_bot' ? <Zap size={16} className="text-warning" /> : <Brain size={16} className="text-primary" />}
                      {strategy.name} (Local)
                    </div>
                    <div className="model-info" style={{ fontSize: '11px', opacity: 0.8, marginTop: '4px' }}>
                      {strategy.description.substring(0, 40)}...
                    </div>
                  </div>
                ))}

                {/* Backend Models */}
                {backendModels.map(model => (
                  <div 
                    key={`backend-${model.id}`}
                    className={`model-item ${activeStrategyId === `backend-${model.id}` ? 'active' : ''}`}
                    onClick={() => setActiveStrategyId(`backend-${model.id}`)}
                    style={{ cursor: 'pointer', borderLeft: `3px solid ${model.is_active ? '#10b981' : '#9ca3af'}` }}
                  >
                    <div className="model-name" style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                      <Cloud size={16} className={model.is_active ? "text-success" : "text-muted"} />
                      <span style={{flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: model.is_active ? 'inherit' : '#999'}}>
                        {model.name}
                      </span>
                      
                      <button 
                        className={`btn-icon ${model.is_active ? 'text-success' : 'text-muted'}`}
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            console.log("Toggle clicked for", model.id);
                            handleToggleModelActive(e, model.id, !!model.is_active);
                        }}
                        title={
                            backendStatus && !backendStatus.auto_trading 
                            ? "Global Auto-Trading is OFF (Enable it top-right)" 
                            : (model.is_active ? "Pause Strategy" : "Resume Strategy")
                        }
                        style={{padding: '4px', zIndex: 10, position: 'relative'}}
                      >
                        {model.is_active ? <Pause size={14} /> : <Play size={14} />}
                      </button>

                      <button 
                        className="btn-icon text-primary" 
                        onClick={(e) => {
                            e.stopPropagation();
                            setSettingsModel({id: model.id, name: model.name});
                        }}
                        title="策略配置 / Strategy Settings"
                        style={{padding: '2px', opacity: 0.8}}
                      >
                        <Settings size={14} />
                      </button>

                      <button 
                        className="btn-icon text-danger model-delete-btn" 
                        onClick={(e) => handleDeleteModel(e, model.id)}
                        title="删除模型"
                        style={{padding: '2px', opacity: 0.6}}
                      >
                        <Trash size={14} />
                      </button>
                    </div>
                    <div className="model-info" style={{ fontSize: '11px', opacity: 0.8, marginTop: '4px' }}>
                      {model.strategy_type} | ${model.initial_capital}
                    </div>
                  </div>
                ))}
                
                <div className="add-model-btn" style={{padding: '10px', textAlign: 'center'}}>
                   <button className="btn-secondary" style={{width: '100%'}} onClick={() => setShowAddModelModal(true)}>
                      <Plus size={14} /> 添加模型
                   </button>
                </div>
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
                <div style={{display: 'flex', alignItems: 'center', gap: '5px'}}>
                    {(portfolio as any).okx_synced && (
                        <span className="badge badge-success" style={{fontSize: '10px', padding: '2px 6px'}}>OKX</span>
                    )}
                    {(portfolio as any).sync_error && (
                        <span className="badge badge-danger" title={(portfolio as any).sync_error} style={{fontSize: '10px', padding: '2px 6px'}}>Error</span>
                    )}
                    <Wallet className="text-primary" size={20} />
                </div>
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
              <div id="accountChart" style={{ width: '100%', height: '300px', background: '#fff' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={portfolioHistory}
                    margin={{
                      top: 10,
                      right: 30,
                      left: 0,
                      bottom: 0,
                    }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="time" />
                    <YAxis domain={['auto', 'auto']} />
                    <Tooltip />
                    <Area type="monotone" dataKey="value" stroke="#8884d8" fill="#8884d8" fillOpacity={0.3} />
                  </AreaChart>
                </ResponsiveContainer>
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

      {/* Leaderboard Modal */}
      {showLeaderboardModal && (
        <div className="modal show">
          <div className="modal-content" style={{maxWidth: '600px'}}>
            <div className="modal-header">
              <h3>策略排行榜</h3>
              <button className="btn-close" onClick={() => setShowLeaderboardModal(false)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>排名</th>
                    <th>模型名称</th>
                    <th>策略类型</th>
                    <th>总资产</th>
                    <th>收益率</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboardData.map((item, idx) => (
                    <tr key={item.model_id}>
                      <td>
                        {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : idx + 1}
                      </td>
                      <td>{item.model_name}</td>
                      <td><span className="badge badge-secondary">{item.strategy_type}</span></td>
                      <td>${item.account_value.toFixed(2)}</td>
                      <td className={item.returns >= 0 ? 'text-success' : 'text-danger'}>
                        {item.returns > 0 ? '+' : ''}{item.returns.toFixed(2)}%
                      </td>
                    </tr>
                  ))}
                  {leaderboardData.length === 0 && (
                    <tr><td colSpan={5} className="empty-state">暂无数据</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

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
              {/* Connection Status Check */}
              <div style={{marginBottom: '15px', padding: '10px', background: '#f8f9fa', borderRadius: '4px', fontSize: '12px'}}>
                 状态检查: {backendConnected ? <span className="text-success">后端连接正常</span> : <span className="text-danger">后端连接失败 (请运行 python web/app.py)</span>}
              </div>

              {/* List Existing Providers */}
              {providers.length > 0 && (
                <div className="mb-4" style={{marginBottom: '20px'}}>
                  <h4 style={{fontSize: '14px', marginBottom: '10px'}}>已配置的提供方</h4>
                  <div className="list-group" style={{border: '1px solid #eee', borderRadius: '4px'}}>
                    {providers.map(p => (
                      <div key={p.id} style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid #eee'}}>
                        <div>
                          <div style={{fontWeight: 500}}>{p.name}</div>
                          <div style={{fontSize: '11px', color: '#666'}}>{p.api_url}</div>
                        </div>
                        <div style={{display: 'flex', gap: '10px', alignItems: 'center'}}>
                            <span className="badge badge-success">已连接</span>
                            <button className="btn-icon text-danger" onClick={() => handleDeleteProvider(p.id)} title="删除"><Trash size={14}/></button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <h4 style={{fontSize: '14px', marginBottom: '10px', marginTop: '20px'}}>添加新提供方</h4>
              <div className="form-group">
                <label>API名称</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={newProvider.name}
                  onChange={(e) => setNewProvider({...newProvider, name: e.target.value})}
                  placeholder="DeepSeek, OpenAI..."
                />
              </div>
              <div className="form-group">
                <label>API地址</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={newProvider.api_url}
                  onChange={(e) => setNewProvider({...newProvider, api_url: e.target.value})}
                  placeholder="https://api.deepseek.com"
                />
              </div>
              <div className="form-group">
                <label>API密钥</label>
                <input 
                  type="password" 
                  className="form-input" 
                  value={newProvider.api_key}
                  onChange={(e) => setNewProvider({...newProvider, api_key: e.target.value})}
                  placeholder="sk-..."
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowApiProviderModal(false)}>取消</button>
              <button 
                className="btn-primary"
                onClick={handleAddProvider}
              >
                添加并保存
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
                <label>策略类型</label>
                <select 
                  className="form-input"
                  value={newModelConfig.strategy_type}
                  onChange={(e) => setNewModelConfig({...newModelConfig, strategy_type: e.target.value})}
                >
                  <option value="llm_json">AI Trader (DeepSeek/OpenAI)</option>
                  <option value="arbitrage">Arbitrage Bot (无需API Key)</option>
                </select>
              </div>

              {newModelConfig.strategy_type === 'llm_json' && (
                <>
                  <div className="form-group">
                    <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                      <label>选择API提供方</label>
                      <button 
                        className="btn-link" 
                        style={{fontSize: '12px', padding: 0, border: 'none', background: 'none', color: '#3b82f6', cursor: 'pointer'}}
                        onClick={() => {
                          setShowAddModelModal(false);
                          setShowApiProviderModal(true);
                        }}
                      >
                        + 管理提供方
                      </button>
                    </div>
                    <select 
                      className="form-input"
                      value={newModelConfig.provider_id}
                      onChange={(e) => setNewModelConfig({...newModelConfig, provider_id: e.target.value})}
                    >
                      <option value="">请选择...</option>
                      {providers.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    {providers.length === 0 && (
                      <small className="text-danger" style={{display: 'block', marginTop: '4px'}}>
                        暂无可用API提供方，请先添加。
                      </small>
                    )}
                  </div>
                  <div className="form-group">
                    <label>模型名称</label>
                    <input 
                      type="text" 
                      className="form-input" 
                      placeholder="gpt-4, deepseek-chat..."
                      value={newModelConfig.model_name}
                      onChange={(e) => setNewModelConfig({...newModelConfig, model_name: e.target.value})}
                    />
                  </div>
                </>
              )}

              <div className="form-group">
                <label>模型显示名称</label>
                <input 
                  type="text" 
                  placeholder="例如: Alpha Strategy" 
                  className="form-input" 
                  value={newModelConfig.name}
                  onChange={(e) => setNewModelConfig({...newModelConfig, name: e.target.value})}
                />
              </div>
              <div className="form-group">
                <label>初始资金</label>
                <input 
                  type="number" 
                  defaultValue="100000" 
                  className="form-input" 
                  value={newModelConfig.initial_capital}
                  onChange={(e) => setNewModelConfig({...newModelConfig, initial_capital: parseFloat(e.target.value)})}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowAddModelModal(false)}>取消</button>
              <button 
                className="btn-primary" 
                onClick={handleAddModel}
                disabled={!backendStatus}
                title={!backendStatus ? "Backend is offline" : ""}
              >
                {backendStatus ? "确认添加" : "后端未连接"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      <SettingsModal 
        isOpen={showSettingsModal} 
        onClose={() => setShowSettingsModal(false)}
        okxConfig={okxConfig}
        setOkxConfig={setOkxConfig}
      />

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
      {/* Model Settings Modal */}
      {settingsModel && (
        <ModelSettingsModal 
          isOpen={true}
          onClose={() => setSettingsModel(null)}
          modelId={settingsModel.id}
          modelName={settingsModel.name}
        />
      )}
    </div>
  );
}

export default App;