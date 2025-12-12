import React, { useState, useEffect } from 'react';
import { X, Save, AlertTriangle, CheckCircle } from 'lucide-react';

interface ModelSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  modelId: number;
  modelName: string;
}

export default function ModelSettingsModal({ isOpen, onClose, modelId, modelName }: ModelSettingsModalProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState({
    okx: {
      apiKey: '',
      secret: '',
      passphrase: '',
      isSimulation: true,
      enabled: false
    },
    arbitrage: {
      min_net_spread_pct: 0.05,
      max_capital_ratio: 0.1,
      taker_fee: 0.001
    }
  });

  useEffect(() => {
    if (isOpen && modelId !== null && modelId !== undefined) {
      console.log("Fetching config for model:", modelId);
      fetchModelConfig();
    }
  }, [isOpen, modelId]);

  const fetchModelConfig = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/models?t=${Date.now()}`); 
      
      if (res.ok) {
        const models = await res.json();
        const model = models.find((m: any) => m.id === modelId);
        if (model) {
          try {
            let parsedConfig = {};
            if (model.config) {
                parsedConfig = typeof model.config === 'string' ? JSON.parse(model.config) : model.config;
            }
            
            // Merge with defaults
            setConfig(prev => ({
              ...prev,
              okx: { ...prev.okx, ...(parsedConfig as any).okx },
              arbitrage: { ...prev.arbitrage, ...(parsedConfig as any).arbitrage }
            }));
          } catch (e) {
            console.error("Failed to parse config", e);
          }
        }
      }
    } catch (e) {
      console.error("Failed to fetch model settings", e);
    } finally {
      setLoading(false);
    }
  };

  const handleResetCapital = async () => {
    if (!confirm("Are you sure you want to reset the initial capital to the current account value? This will reset your ROI calculation.")) return;
    
    try {
        const res = await fetch(`/api/models/${modelId}/reset_capital`, { method: 'POST' });
        if (res.ok) {
            alert("Initial capital reset successfully!");
        } else {
            alert("Failed to reset capital");
        }
    } catch (e) {
        console.error(e);
        alert("Error resetting capital");
    }
  };

  const handleClearHistory = async () => {
    if (!confirm("Are you sure you want to clear all trade history and reset the chart? This cannot be undone.")) return;
    
    try {
        const res = await fetch(`/api/models/${modelId}/clear_history`, { method: 'POST' });
        if (res.ok) {
            alert("Trade history cleared successfully!");
        } else {
            alert("Failed to clear history");
        }
    } catch (e) {
        console.error(e);
        alert("Error clearing history");
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/models/${modelId}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config })
      });

      if (!res.ok) throw new Error("Failed to save settings");

      alert("策略配置已保存 / Strategy Config Saved");
      onClose();
    } catch (e) {
      console.error(e);
      alert("保存失败 / Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal show">
      <div className="modal-content">
        <div className="modal-header">
          <h3>策略配置 / Strategy Settings: {modelName}</h3>
          <button className="btn-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        
        <div className="modal-body">
          {loading ? (
            <div className="p-4 text-center">Loading...</div>
          ) : (
            <>
              <div className="alert alert-info" style={{marginBottom: '20px', fontSize: '13px'}}>
                在此为该策略单独配置交易所连接。配置后，该策略将使用独立的 API Key 进行交易。
                <br/>
                Configure exchange connection specifically for this strategy.
              </div>

              <h4>OKX Configuration</h4>
              
              <div className="form-group" style={{display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px'}}>
                <input 
                  type="checkbox" 
                  id="okxEnabled"
                  checked={config.okx.enabled}
                  onChange={(e) => setConfig({...config, okx: {...config.okx, enabled: e.target.checked}})}
                />
                <label htmlFor="okxEnabled" style={{marginBottom: 0, fontWeight: 'bold'}}>
                  启用 OKX 连接 / Enable OKX Connection
                </label>
              </div>

              {config.okx.enabled && (
                <div style={{padding: '15px', background: '#f8f9fa', borderRadius: '8px', border: '1px solid #eee'}}>
                  <div className="form-group">
                    <label>API Key</label>
                    <input 
                      type="text" 
                      className="form-input" 
                      value={config.okx.apiKey}
                      onChange={(e) => setConfig({...config, okx: {...config.okx, apiKey: e.target.value}})}
                      placeholder="Enter OKX API Key" 
                    />
                  </div>
                  <div className="form-group">
                    <label>Secret Key</label>
                    <input 
                      type="password" 
                      className="form-input" 
                      value={config.okx.secret}
                      onChange={(e) => setConfig({...config, okx: {...config.okx, secret: e.target.value}})}
                      placeholder="Enter OKX Secret Key" 
                    />
                  </div>
                  <div className="form-group">
                    <label>Passphrase</label>
                    <input 
                      type="password" 
                      className="form-input" 
                      value={config.okx.passphrase}
                      onChange={(e) => setConfig({...config, okx: {...config.okx, passphrase: e.target.value}})}
                      placeholder="Enter OKX Passphrase" 
                    />
                  </div>
                  <div className="form-group" style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
                    <input 
                      type="checkbox" 
                      id="simMode"
                      checked={config.okx.isSimulation}
                      onChange={(e) => setConfig({...config, okx: {...config.okx, isSimulation: e.target.checked}})}
                    />
                    <label htmlFor="simMode" style={{marginBottom: 0}}>
                      模拟盘模式 (Simulation Mode)
                    </label>
                  </div>

                  {!config.okx.isSimulation && (
                    <div className="text-danger" style={{fontSize: '12px', marginTop: '10px'}}>
                      <AlertTriangle size={12} style={{display: 'inline', marginRight: '4px'}}/>
                      Warning: Real Trading Enabled. Ensure API keys have restricted permissions.
                    </div>
                  )}
                </div>
              )}

              <h4 style={{marginTop: '20px'}}>Arbitrage Strategy Parameters</h4>
              <div style={{padding: '15px', background: '#f8f9fa', borderRadius: '8px', border: '1px solid #eee'}}>
                <div className="form-group">
                    <label>Min Net Spread % (Min Profit)</label>
                    <input 
                      type="number" 
                      step="0.01"
                      className="form-input" 
                      value={config.arbitrage?.min_net_spread_pct || 0.05}
                      onChange={(e) => setConfig({...config, arbitrage: {...config.arbitrage, min_net_spread_pct: parseFloat(e.target.value)}})}
                    />
                    <small className="text-muted">Minimum profit margin after fees (Default: 0.05%)</small>
                </div>
                <div className="form-group">
                    <label>Max Capital Ratio per Trade</label>
                    <input 
                      type="number" 
                      step="0.1"
                      max="1.0"
                      className="form-input" 
                      value={config.arbitrage?.max_capital_ratio || 0.1}
                      onChange={(e) => setConfig({...config, arbitrage: {...config.arbitrage, max_capital_ratio: parseFloat(e.target.value)}})}
                    />
                    <small className="text-muted">Percentage of available cash to use per trade (0.1 = 10%)</small>
                </div>
                <div className="form-group">
                    <label>Taker Fee Rate %</label>
                    <input 
                      type="number" 
                      step="0.001"
                      className="form-input" 
                      value={(config.arbitrage?.taker_fee || 0.001) * 100}
                      onChange={(e) => setConfig({...config, arbitrage: {...config.arbitrage, taker_fee: parseFloat(e.target.value) / 100}})}
                    />
                    <small className="text-muted">Exchange fee rate (Default: 0.1%)</small>
                </div>
              </div>

              <h4 style={{marginTop: '20px', color: '#f53f3f'}}>Reset Actions</h4>
              <div style={{padding: '15px', background: '#fff5f5', borderRadius: '8px', border: '1px solid #ffcfcf'}}>
                  <div style={{display: 'flex', gap: '10px', flexDirection: 'column'}}>
                      <button className="btn-secondary" onClick={handleResetCapital} style={{fontSize: '12px', width: '100%', borderColor: '#ffcfcf', color: '#d32029'}}>
                          Reset ROI Baseline (Sync Initial Capital)
                      </button>
                      <div className="text-muted" style={{fontSize: '10px'}}>
                          Use this if your ROI is incorrect (e.g. -95%) after connecting OKX.
                      </div>
                      
                      <button className="btn-secondary" onClick={handleClearHistory} style={{fontSize: '12px', width: '100%', borderColor: '#ffcfcf', color: '#d32029', marginTop: '10px'}}>
                          Clear Trade History & Reset Chart
                      </button>
                      <div className="text-muted" style={{fontSize: '10px'}}>
                          Deletes all trade logs and resets the performance chart.
                      </div>
                  </div>
              </div>
            </>
          )}
        </div>
        
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose} disabled={saving}>取消</button>
          <button className="btn-primary" onClick={handleSave} disabled={saving || loading}>
            {saving ? '保存中...' : '保存配置'}
          </button>
        </div>
      </div>
    </div>
  );
}
