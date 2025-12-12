import React, { useState, useEffect } from 'react';
import { X, Save, AlertTriangle } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  okxConfig: {
    apiKey: string;
    secret: string;
    passphrase: string;
    isSimulation: boolean;
  };
  setOkxConfig: (config: any) => void;
}

export default function SettingsModal({ isOpen, onClose, okxConfig, setOkxConfig }: SettingsModalProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [systemSettings, setSystemSettings] = useState({
    trading_frequency_minutes: 60,
    trading_fee_rate: 0.001
  });

  useEffect(() => {
    if (isOpen) {
      fetchSettings();
    }
  }, [isOpen]);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data = await res.json();
        setSystemSettings({
          trading_frequency_minutes: data.trading_frequency_minutes || 60,
          trading_fee_rate: data.trading_fee_rate || 0.001
        });
      }
    } catch (e) {
      console.error("Failed to fetch settings", e);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Save System Settings to Backend
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(systemSettings)
      });

      if (!res.ok) throw new Error("Failed to save system settings");

      // Save OKX Config to LocalStorage (since it's client-side state in App.tsx)
      // Note: In a real app, sensitive keys shouldn't be in localStorage, 
      // but following existing pattern of client-side state for now.
      // The parent App.tsx should handle the persistence if needed, 
      // but here we trigger the update.
      
      // Show success feedback
      alert("设置已保存 / Settings Saved Successfully");
      onClose();
    } catch (e) {
      console.error(e);
      alert("保存失败 / Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal show">
      <div className="modal-content">
        <div className="modal-header">
          <h3>系统设置 / System Settings</h3>
          <button className="btn-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        
        <div className="modal-body">
          {loading ? (
            <div className="p-4 text-center">Loading settings...</div>
          ) : (
            <>
              <div className="form-group">
                <label>交易频率（分钟）/ Trading Frequency (min)</label>
                <input 
                  type="number" 
                  min="1" 
                  max="1440" 
                  className="form-input" 
                  value={systemSettings.trading_frequency_minutes}
                  onChange={(e) => setSystemSettings({...systemSettings, trading_frequency_minutes: parseInt(e.target.value) || 1})}
                />
                <small className="form-help">
                  设置AI交易决策的时间间隔（1-1440分钟）
                  <br />
                  <span className="text-warning" style={{ color: '#e6a23c', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px' }}>
                    <AlertTriangle size={12} />
                    套利策略 (Arbitrage) 将自动以 5秒 频率运行，不受此设置限制
                  </span>
                </small>
              </div>

              <div className="form-group">
                <label>交易费率 / Trading Fee Rate</label>
                <input 
                  type="number" 
                  min="0" 
                  max="0.01" 
                  step="0.0001" 
                  className="form-input" 
                  value={systemSettings.trading_fee_rate}
                  onChange={(e) => setSystemSettings({...systemSettings, trading_fee_rate: parseFloat(e.target.value) || 0})}
                />
                <small className="form-help">每笔交易的手续费费率（0-0.01，例如0.001表示0.1%）</small>
              </div>
              
              <div className="divider" style={{ margin: '20px 0', borderTop: '1px solid #eee' }}></div>
              <h4>OKX 模拟盘配置 / OKX Config</h4>
              
              <div className="form-group">
                <label>API Key</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={okxConfig.apiKey}
                  onChange={(e) => setOkxConfig({...okxConfig, apiKey: e.target.value})}
                  placeholder="输入 OKX API Key" 
                />
              </div>
              <div className="form-group">
                <label>Secret Key</label>
                <input 
                  type="password" 
                  className="form-input" 
                  value={okxConfig.secret}
                  onChange={(e) => setOkxConfig({...okxConfig, secret: e.target.value})}
                  placeholder="输入 OKX Secret Key" 
                />
              </div>
              <div className="form-group">
                <label>Passphrase</label>
                <input 
                  type="password" 
                  className="form-input" 
                  value={okxConfig.passphrase}
                  onChange={(e) => setOkxConfig({...okxConfig, passphrase: e.target.value})}
                  placeholder="输入 OKX Passphrase" 
                />
              </div>
              <div className="form-group" style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
                <input 
                  type="checkbox" 
                  id="simMode"
                  checked={okxConfig.isSimulation}
                  onChange={(e) => setOkxConfig({...okxConfig, isSimulation: e.target.checked})}
                />
                <label htmlFor="simMode" style={{marginBottom: 0}}>启用模拟盘模式 (Simulation)</label>
              </div>
              
              {!okxConfig.isSimulation && (
                <div className="alert alert-danger" style={{ 
                  marginTop: '15px', 
                  padding: '10px', 
                  backgroundColor: '#fef0f0', 
                  color: '#f56c6c', 
                  border: '1px solid #fde2e2',
                  borderRadius: '4px',
                  fontSize: '12px'
                }}>
                  <strong>⚠️ 实盘模式风险提示 (Real Trading Warning)</strong>
                  <p style={{ margin: '5px 0 0' }}>
                    您正在配置真实交易环境。请注意：
                    <ul style={{ paddingLeft: '20px', margin: '5px 0' }}>
                      <li>CCXT 库可能存在安全风险，请确保 API Key 仅开启交易权限，关闭提现权限。</li>
                      <li>建议在隔离的运行环境中使用实盘模式。</li>
                      <li>实盘交易资金风险自负。</li>
                    </ul>
                  </p>
                </div>
              )}
            </>
          )}
        </div>
        
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose} disabled={saving}>取消</button>
          <button className="btn-primary" onClick={handleSave} disabled={saving || loading}>
            {saving ? '保存中...' : '保存设置'}
          </button>
        </div>
      </div>
    </div>
  );
}
