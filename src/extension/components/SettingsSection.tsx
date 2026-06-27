import React, { useState, useEffect } from 'react';
import { Sparkles, ShieldCheck, CheckCircle, AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import type { AppConfig, AIProviderType } from '../../types';
import { API_BASE } from '../constants';
import { useAIModels } from '../hooks';

export const SettingsSection = ({
  config,
  onUpdate,
}: {
  config: AppConfig | null;
  onUpdate: (config: Partial<AppConfig>) => void;
}) => {
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');

  // Fetch available models for local providers
  const {
    data: availableModels,
    isLoading: modelsLoading,
    error: modelsError,
    refetch: refetchModels,
  } = useAIModels(config?.ai.provider || '');

  // Auto-select first model if none selected and models are available
  useEffect(() => {
    if (availableModels && availableModels.length > 0 && !config?.ai.model) {
      if (config && config.ai) {
        onUpdate({ ai: { ...config.ai, model: availableModels[0] } });
      }
    }
  }, [availableModels, config?.ai.model, config, onUpdate]);

  if (!config) return null;

  const aiProviders = [
    { value: 'openai', label: 'OpenAI' },
    { value: 'anthropic', label: 'Anthropic' },
    { value: 'google', label: 'Google' },
    { value: 'ollama', label: 'Ollama (Local)' },
    { value: 'lmstudio', label: 'LM Studio (Local)' },
  ];

  const handleTestConnection = async () => {
    setTestStatus('testing');
    setTestMessage('');
    try {
      const res = await fetch(`${API_BASE}/config/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ai: config.ai }),
      });
      const data = await res.json();
      if (data.success) {
        setTestStatus('success');
        setTestMessage('Connected successfully');
      } else {
        setTestStatus('error');
        setTestMessage(data.error || 'Connection failed');
      }
    } catch {
      setTestStatus('error');
      setTestMessage('Failed to connect to API');
    }
    setTimeout(() => setTestStatus('idle'), 3000);
  };

  return (
    <div className="space-y-6">
      <div className="card space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-blue-500" />
          <h3 className="text-sm font-semibold text-(--text-primary)">AI Configuration</h3>
        </div>

        <div className="space-y-3">
          <label className="label">Provider</label>
          <select
            value={config.ai.provider}
            onChange={(e) =>
              onUpdate({ ai: { ...config.ai, provider: e.target.value as AIProviderType } })
            }
            className="input appearance-none cursor-pointer"
            aria-label="AI provider"
          >
            {aiProviders.map((provider) => (
              <option key={provider.value} value={provider.value}>
                {provider.label}
              </option>
            ))}
          </select>
        </div>

        {['openai', 'anthropic', 'google'].includes(config.ai.provider) && (
          <div className="space-y-3">
            <label className="label">API Key</label>
            <input
              type="password"
              value={config.ai.apiKey || ''}
              onChange={(e) => onUpdate({ ai: { ...config.ai, apiKey: e.target.value } })}
              placeholder={`Enter ${config.ai.provider.toUpperCase()} API key…`}
              className="input font-mono"
              aria-label="API key"
            />
          </div>
        )}

        {['ollama', 'lmstudio'].includes(config.ai.provider) && (
          <div className="space-y-3">
            <label className="label">Local Endpoint</label>
            <input
              type="text"
              value={config.ai.baseUrl || ''}
              onChange={(e) => onUpdate({ ai: { ...config.ai, baseUrl: e.target.value } })}
              placeholder={
                config.ai.provider === 'ollama' ? 'http://localhost:11434' : 'http://localhost:1234'
              }
              className="input font-mono"
              aria-label="Local endpoint URL"
            />
          </div>
        )}

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="label">Model</label>
            {['ollama', 'lmstudio'].includes(config.ai.provider) && (
              <button
                onClick={() => refetchModels()}
                disabled={modelsLoading}
                className="text-xs text-(--text-secondary) hover:text-(--text-primary) flex items-center gap-1 transition-colors"
                aria-label="Refresh model list"
              >
                <RefreshCw className={`w-3 h-3 ${modelsLoading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            )}
          </div>

          {/* Local providers: show dropdown with loaded models */}
          {['ollama', 'lmstudio'].includes(config.ai.provider) ? (
            <div className="space-y-2">
              {modelsLoading ? (
                <div className="input flex items-center gap-2 text-(--text-secondary)">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading models...
                </div>
              ) : modelsError ? (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={config.ai.model || ''}
                    onChange={(e) => onUpdate({ ai: { ...config.ai, model: e.target.value } })}
                    placeholder="Enter model name manually"
                    className="input"
                    aria-label="AI model"
                  />
                  <p className="text-xs text-rose-400">
                    Couldn&apos;t fetch models. Make sure{' '}
                    {config.ai.provider === 'ollama' ? 'Ollama' : 'LM Studio'} is running.
                  </p>
                </div>
              ) : availableModels?.length ? (
                <select
                  value={config.ai.model || ''}
                  onChange={(e) => onUpdate({ ai: { ...config.ai, model: e.target.value } })}
                  className="input appearance-none cursor-pointer"
                  aria-label="AI model"
                >
                  <option value="" disabled>
                    Select a model...
                  </option>
                  {availableModels.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={config.ai.model || ''}
                  onChange={(e) => onUpdate({ ai: { ...config.ai, model: e.target.value } })}
                  placeholder="No models found. Enter manually..."
                  className="input"
                  aria-label="AI model"
                />
              )}
            </div>
          ) : (
            /* Cloud providers: free text input */
            <input
              type="text"
              value={config.ai.model || ''}
              onChange={(e) => onUpdate({ ai: { ...config.ai, model: e.target.value } })}
              placeholder="e.g., gpt-4, claude-3, gemini-pro"
              className="input"
              aria-label="AI model"
            />
          )}
        </div>

        <button
          onClick={handleTestConnection}
          disabled={testStatus === 'testing'}
          className={`btn w-full ${
            testStatus === 'success'
              ? 'btn-primary bg-emerald-500 hover:bg-emerald-600'
              : testStatus === 'error'
                ? 'btn-secondary border-rose-500/50 text-rose-400'
                : 'btn-secondary'
          }`}
        >
          {testStatus === 'testing' ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Testing…
            </>
          ) : testStatus === 'success' ? (
            <>
              <CheckCircle className="w-4 h-4" />
              Connected
            </>
          ) : testStatus === 'error' ? (
            <>
              <AlertCircle className="w-4 h-4" />
              {testMessage}
            </>
          ) : (
            <>
              <CheckCircle className="w-4 h-4" />
              Test Connection
            </>
          )}
        </button>
      </div>

      <div className="card space-y-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-500" />
          <h3 className="text-sm font-semibold text-(--text-primary)">Preferences</h3>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-(--text-primary)">Auto-submit</p>
              <p className="text-xs text-(--text-tertiary)">Automatically submit after filling</p>
            </div>
            <button
              role="switch"
              aria-checked={config.application.autoSubmit}
              onClick={() =>
                onUpdate({
                  application: {
                    ...config.application,
                    autoSubmit: !config.application.autoSubmit,
                  },
                })
              }
              className="toggle"
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-(--text-primary)">Vault Encryption</p>
              <p className="text-xs text-(--text-tertiary)">AES-256 profile protection</p>
            </div>
            <button
              role="switch"
              aria-checked={config.application.vaultEncryption}
              onClick={() =>
                onUpdate({
                  application: {
                    ...config.application,
                    vaultEncryption: !config.application.vaultEncryption,
                  },
                })
              }
              className="toggle"
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-(--text-primary)">Use Resume for Questions</p>
              <p className="text-xs text-(--text-tertiary)">
                AI uses full resume/cover letter to answer questions
              </p>
            </div>
            <button
              role="switch"
              aria-checked={config.application.useResumeForQuestions}
              onClick={() =>
                onUpdate({
                  application: {
                    ...config.application,
                    useResumeForQuestions: !config.application.useResumeForQuestions,
                  },
                })
              }
              className="toggle"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
