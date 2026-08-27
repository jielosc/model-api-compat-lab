'use client';

import { useState } from 'react';
import { copyText } from './model-utils';
import type { Activity, AuthMode } from './types';

type ConfigPanelProps = {
  baseUrl: string;
  apiKey: string;
  authModeValue: AuthMode;
  manualModels: string;
  deepScan: boolean;
  maxModels: string;
  running: boolean;
  phase: string;
  progress: number;
  activities: Activity[];
  onBaseUrlChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onAuthModeChange: (value: AuthMode) => void;
  onManualModelsChange: (value: string) => void;
  onDeepScanChange: (value: boolean) => void;
  onMaxModelsChange: (value: string) => void;
  onGetModelList: () => void;
  onRunHealthCheck: () => void;
  onStopHealthCheck: () => void;
};

export function ConfigPanel({
  baseUrl,
  apiKey,
  authModeValue,
  manualModels,
  deepScan,
  maxModels,
  running,
  phase,
  progress,
  activities,
  onBaseUrlChange,
  onApiKeyChange,
  onAuthModeChange,
  onManualModelsChange,
  onDeepScanChange,
  onMaxModelsChange,
  onGetModelList,
  onRunHealthCheck,
  onStopHealthCheck,
}: ConfigPanelProps) {
  const [copied, setCopied] = useState(false);

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
      <div className="input-wrap url-wrap"><span className="input-prefix">↗</span><input id="base-url" value={baseUrl} onChange={(event) => onBaseUrlChange(event.target.value)} placeholder="https://api.example.com/v1" /></div>
      <div className="hint">支持 OpenAI-compatible、Anthropic-compatible 代理。可填到 `/v1`。刷新后会记住地址，不会记住 Key。</div>

      <label className="field-label" htmlFor="api-key">API Key</label>
      <div className="input-wrap"><span className="input-prefix key-prefix">KEY</span><input id="api-key" type="password" value={apiKey} onChange={(event) => onApiKeyChange(event.target.value)} placeholder="sk-… / 你的访问密钥" autoComplete="off" /></div>

      <div className="field-label">鉴权方案</div>
      <div className="segmented" role="radiogroup" aria-label="鉴权方案">
        {([['auto', '自动'], ['bearer', 'Bearer'], ['x-api-key', 'x-api-key'], ['none', '无 Key']] as Array<[AuthMode, string]>).map(([value, label]) => (
          <button key={value} className={authModeValue === value ? 'selected' : ''} onClick={() => onAuthModeChange(value)} type="button" role="radio" aria-checked={authModeValue === value}>{label}</button>
        ))}
      </div>

      <label className="field-label" htmlFor="manual-models">手动模型 ID <span>可选</span></label>
      <textarea id="manual-models" value={manualModels} onChange={(event) => onManualModelsChange(event.target.value)} placeholder={'服务不提供模型列表时填写，例如：\ngpt-4o, claude-3-5-sonnet'} rows={3} />

      <div className="scan-options">
        <div className="scan-mode-title"><strong>扫描模式</strong><small>先选模式，再开始测试</small></div>
        <div className="scan-mode-selector" role="radiogroup" aria-label="扫描模式">
          <button type="button" role="radio" className={!deepScan ? 'selected' : ''} aria-checked={!deepScan} onClick={() => onDeepScanChange(false)}><span className="mode-mark">01</span><span><strong>快速模式</strong><small>2 个低成本请求 · 文本 + 流式</small></span></button>
          <button type="button" role="radio" className={deepScan ? 'selected' : ''} aria-checked={deepScan} onClick={() => onDeepScanChange(true)}><span className="mode-mark">02</span><span><strong>深度模式</strong><small>最多 7 个请求 · 全部能力探测</small></span></button>
        </div>
        <div className="option-row compact-row">
          <div><strong>最多测试模型</strong><small>只限制一键体检，不限制获取列表或单模型复测</small></div>
          <select value={maxModels} onChange={(event) => onMaxModelsChange(event.target.value)} aria-label="最多测试模型数量"><option value="6">06</option><option value="12">12</option><option value="24">24</option><option value="50">50</option></select>
        </div>
      </div>

      <div className="action-stack">
        {!running && <button className="secondary-button" type="button" onClick={onGetModelList}><span className="button-icon">≡</span> 仅获取模型列表</button>}
        {running ? <button className="primary-button stop-button" type="button" onClick={onStopHealthCheck}><span className="button-icon">■</span> 停止本次探测</button> : <button className="primary-button" type="button" onClick={onRunHealthCheck}><span className="button-icon">↗</span> 开始一键体检</button>}
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
