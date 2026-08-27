'use client';

import { useEffect, useRef, useState } from 'react';
import { copyText } from './model-utils';
import type { Activity, AuthMode, ModelResult } from './types';

type ConfigPanelProps = {
  baseUrl: string;
  apiKey: string;
  authModeValue: AuthMode;
  manualModels: string;
  modelOptions: ModelResult[];
  selectedModelIds: string[];
  deepScan: boolean;
  running: boolean;
  fetchingModels: boolean;
  ready: boolean;
  phase: string;
  progress: number;
  activities: Activity[];
  onBaseUrlChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onAuthModeChange: (value: AuthMode) => void;
  onManualModelsChange: (value: string) => void;
  onToggleModel: (id: string) => void;
  onSelectAllModels: () => void;
  onClearModels: () => void;
  onDeepScanChange: (value: boolean) => void;
  onGetModelList: () => void;
  onRunHealthCheck: () => void;
  onStopHealthCheck: () => void;
};

export function ConfigPanel({
  baseUrl,
  apiKey,
  authModeValue,
  manualModels,
  modelOptions,
  selectedModelIds,
  deepScan,
  running,
  fetchingModels,
  ready,
  phase,
  progress,
  activities,
  onBaseUrlChange,
  onApiKeyChange,
  onAuthModeChange,
  onManualModelsChange,
  onToggleModel,
  onSelectAllModels,
  onClearModels,
  onDeepScanChange,
  onGetModelList,
  onRunHealthCheck,
  onStopHealthCheck,
}: ConfigPanelProps) {
  const [copied, setCopied] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelQuery, setModelQuery] = useState('');
  const pickerRef = useRef<HTMLDivElement>(null);
  const busy = !ready || running || fetchingModels;

  useEffect(() => {
    if (!modelPickerOpen) return;
    function handlePointerDown(event: PointerEvent) {
      if (!pickerRef.current?.contains(event.target as Node)) setModelPickerOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setModelPickerOpen(false);
    }
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [modelPickerOpen]);

  const selectedSet = new Set(selectedModelIds);
  const filteredModels = modelOptions.filter((model) => {
    const needle = modelQuery.trim().toLowerCase();
    if (!needle) return true;
    return model.id.toLowerCase().includes(needle)
      || model.family.toLowerCase().includes(needle)
      || (model.ownedBy?.toLowerCase().includes(needle) ?? false);
  });
  const allModelsSelected = modelOptions.length > 0 && selectedModelIds.length === modelOptions.length;

  async function copyLog() {
    const lines = [...activities].reverse().map((activity) => `${activity.time}  ${activity.message}`).join('\n');
    const ok = await copyText(lines || '暂无活动记录');
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <aside className="config-panel panel">
      <div className="panel-heading">
        <div><span className="section-index">A / CONNECT</span><h2>接入配置</h2></div>
        <span className="lock-label">LOCAL ONLY</span>
      </div>

      <label className="field-label" htmlFor="base-url">API Base URL</label>
      <div className="input-wrap url-wrap"><span className="input-prefix">↗</span><input id="base-url" value={baseUrl} onChange={(event) => onBaseUrlChange(event.target.value)} placeholder="https://api.example.com/v1" disabled={busy} /></div>
      <div className="hint">支持 OpenAI-compatible、Anthropic-compatible 代理。可填到 `/v1`。刷新后会记住地址，不会记住 Key。</div>

      <label className="field-label" htmlFor="api-key">API Key</label>
      <div className="input-wrap"><span className="input-prefix key-prefix">KEY</span><input id="api-key" type="password" value={apiKey} onChange={(event) => onApiKeyChange(event.target.value)} placeholder="sk-… / 你的访问密钥" autoComplete="off" disabled={busy} /></div>

      <div className="field-label">鉴权方案</div>
      <div className="segmented" role="radiogroup" aria-label="鉴权方案">
        {([['auto', '自动'], ['bearer', 'Bearer'], ['x-api-key', 'x-api-key'], ['none', '无 Key']] as Array<[AuthMode, string]>).map(([value, label]) => (
          <button key={value} className={authModeValue === value ? 'selected' : ''} onClick={() => onAuthModeChange(value)} type="button" role="radio" aria-checked={authModeValue === value} disabled={busy}>{label}</button>
        ))}
      </div>

      <div className="manual-model-heading">
        <label className="field-label" htmlFor="manual-models">手动模型 ID <span>可选</span></label>
        <button className="inline-action" type="button" onClick={fetchingModels ? onStopHealthCheck : onGetModelList} disabled={!ready || running}>
          <span>{fetchingModels ? '■' : '≡'}</span> {fetchingModels ? '取消获取' : '获取列表'}
        </button>
      </div>
      <textarea id="manual-models" value={manualModels} onChange={(event) => onManualModelsChange(event.target.value)} placeholder={'服务不提供模型列表时填写，例如：\ngpt-4o, claude-3-5-sonnet'} rows={3} disabled={busy} />

      {modelOptions.length > 0 && (
        <div className="model-picker" ref={pickerRef}>
          <button
            className={`model-picker-trigger ${modelPickerOpen ? 'open' : ''}`}
            type="button"
            disabled={running || fetchingModels}
            aria-expanded={modelPickerOpen}
            aria-haspopup="dialog"
            onClick={() => setModelPickerOpen((open) => !open)}
          >
            <span className="model-picker-icon">□</span>
            <span className="model-picker-label">选择测试模型</span>
            <strong>{selectedModelIds.length}/{modelOptions.length}</strong>
            <span className="model-picker-chevron">⌄</span>
          </button>
          {modelPickerOpen && (
            <div className="model-picker-popover" role="dialog" aria-label="选择测试模型">
              <div className="model-picker-head">
                <div><strong>选择测试模型</strong><small>一键体检将按选中项发起请求</small></div>
                <button type="button" className="model-picker-close" onClick={() => setModelPickerOpen(false)} aria-label="关闭模型选择">×</button>
              </div>
              <input
                className="model-picker-search"
                value={modelQuery}
                onChange={(event) => setModelQuery(event.target.value)}
                placeholder="搜索模型 ID / 家族 / 提供方"
                aria-label="搜索模型"
              />
              <div className="model-picker-actions">
                <button type="button" onClick={onSelectAllModels} disabled={running || fetchingModels || allModelsSelected}>全选</button>
                <button type="button" onClick={onClearModels} disabled={running || fetchingModels || !selectedModelIds.length}>清空</button>
                <span>{filteredModels.length} 个可见</span>
              </div>
              <div className="model-picker-list" role="listbox" aria-multiselectable="true" aria-label="模型列表">
                {filteredModels.length ? filteredModels.map((model) => (
                  <label className="model-picker-option" key={model.id}>
                    <input type="checkbox" checked={selectedSet.has(model.id)} onChange={() => onToggleModel(model.id)} disabled={running || fetchingModels} />
                    <span className="model-picker-check" aria-hidden="true">✓</span>
                    <span className="model-picker-option-text"><strong title={model.id}>{model.id}</strong><small>{model.family}{model.ownedBy ? ` · ${model.ownedBy}` : ''}</small></span>
                  </label>
                )) : <div className="model-picker-empty">没有匹配的模型</div>}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="scan-options">
        <div className="scan-mode-title"><strong>扫描模式</strong><small>先选模式，再开始测试</small></div>
        <div className="scan-mode-selector" role="radiogroup" aria-label="扫描模式">
          <button type="button" role="radio" className={!deepScan ? 'selected' : ''} aria-checked={!deepScan} onClick={() => onDeepScanChange(false)} disabled={busy}><span className="mode-mark">01</span><span><strong>快速模式</strong><small>2 个低成本请求 · 文本 + 流式</small></span></button>
          <button type="button" role="radio" className={deepScan ? 'selected' : ''} aria-checked={deepScan} onClick={() => onDeepScanChange(true)} disabled={busy}><span className="mode-mark">02</span><span><strong>深度模式</strong><small>最多 7 个请求 · 全部能力探测</small></span></button>
        </div>
      </div>

      <div className="action-stack">
        {running ? <button className="primary-button stop-button" type="button" onClick={onStopHealthCheck}><span className="button-icon">■</span> 停止本次探测</button> : <button className="primary-button" type="button" onClick={onRunHealthCheck} disabled={!ready || fetchingModels}><span className="button-icon">↗</span> {fetchingModels ? '获取模型列表中…' : '开始一键体检'}</button>}
      </div>
      <div className="privacy-note"><span>◌</span><p>Key 仅用于当前页面的 fetch 请求，刷新页面即清除。请确认目标 API 允许浏览器跨域访问。</p></div>

      <div className="activity-block">
        <div className="activity-title">
          <span>ACTIVITY</span>
          <span>{phase}</span>
        </div>
        {running && <div className="progress-track"><span style={{ width: `${Math.min(progress, 100)}%` }} /></div>}
        <div className="activity-list">
          {activities.length ? activities.map((activity, index) => (
            <div className="activity-item" key={`${activity.time}-${index}`}>
              <span className={`activity-bullet ${activity.tone}`} />
              <time>{activity.time}</time>
              <p title={activity.message}>{activity.message}</p>
            </div>
          )) : <div className="empty-activity">开始后，这里会显示每个阶段的实时记录。</div>}
        </div>
        {activities.length > 0 && (
          <button type="button" className="ghost-button activity-copy" onClick={copyLog}>
            {copied ? '已复制日志' : '复制活动日志'}
          </button>
        )}
      </div>
    </aside>
  );
}
