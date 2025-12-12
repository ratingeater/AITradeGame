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
      // We fetch the model details which includes the config
      // Note: The backend get_model returns the config string, we need to parse it
      // But wait, the current get_model API returns the whole model object.
      // Let's assume the backend returns 'config' field as a JSON string or dict.
      // Based on my python code: `db.get_model` returns a dict. `config` is a text column.
      // So it will be a string.
      
      // Actually, I didn't update get_model to parse JSON. It returns raw DB row.
      // So it will be a string.
      
      const res = await fetch(`/api/models?t=${Date.now()}`); 
      
      if (res.ok) {
        const models = await res.json();
        console.log("Fetched models:", models);
        const model = models.find((m: any) => m.id === modelId);
        console.log("Found model:", model);
        if (model) {
          try {
            let parsedConfig = {};
            if (model.config) {
                parsedConfig = typeof model.config === 'string' ? JSON.parse(model.config) : model.config;
            }
            console.log("Parsed config:", parsedConfig);
            
            if (parsedConfig && (parsedConfig as any).okx) {
              console.log("Setting OKX config:", (parsedConfig as any).okx);
              setConfig(prev => ({
                ...prev,
                okx: { ...prev.okx, ...(parsedConfig as any).okx }
              }));
            }
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
