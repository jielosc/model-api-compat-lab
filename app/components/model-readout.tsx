'use client';

import { useState } from 'react';
import { PROBES, probeKeysForMode } from './probes';
import { copyText, formatContext, overallForModel, readoutStatus, statusLabel } from './model-utils';
import type { ModelResult } from './types';

type ModelReadoutProps = {
  selected: ModelResult;
  baseUrl: string;
  catalogOnly: boolean;
  deepScan: boolean;
  running: boolean;
  fetchingModels: boolean;
  onTestModel: (id: string) => void;
};

export function ModelReadout({ selected, baseUrl, catalogOnly, deepScan, running, fetchingModels, onTestModel }: ModelReadoutProps) {
  const [copied, setCopied] = useState(false);
  const expectedKeys = selected.expectedProbes ?? probeKeysForMode(deepScan);
  const overall = overallForModel(selected, catalogOnly ? undefined : expectedKeys);
  const root = (selected.testedBaseUrl ?? baseUrl).trim().replace(/\/+$/, '');
  const resultWasDeep = expectedKeys.length > 2;

  async function copyId() {
    const ok = await copyText(selected.id);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="panel detail-panel">
      <div className="detail-head">
        <div>
          <span className="section-index">C / READOUT</span>
          <h2 title={selected.id}>{selected.id}</h2>
        </div>
        <div className="detail-actions">
          <button type="button" className="ghost-button" onClick={copyId}>{copied ? '已复制 ID' : '复制 ID'}</button>
          <button type="button" className="ghost-button" onClick={() => onTestModel(selected.id)} disabled={running || fetchingModels}>
            {running ? '测试中…' : fetchingModels ? '获取列表中…' : '测试此模型'}
          </button>
          <span className={`detail-status ${overall}`}>{readoutStatus(overall, catalogOnly)}</span>
        </div>
      </div>
      <div className="detail-grid">
        <div className={`detail-card ${selected.declaredContext ? 'pass' : 'idle'}`}>
          <div className="detail-card-top"><span className="detail-key">CONTEXT</span><span className="detail-status-dot" /></div>
          <strong>声明的 Context</strong>
          <small>
            {selected.declaredContext
              ? `${formatContext(selected.declaredContext)} tokens · 来自模型目录元数据，不代表本次请求一定能用满`
              : '模型目录未返回常见 Context 字段'}
          </small>
          {selected.contextField && <code>{selected.contextField}</code>}
        </div>
        {PROBES.map((probe) => {
          const result = selected.probes[probe.key];
          return (
            <div className={`detail-card ${result?.status ?? 'idle'}`} key={probe.key}>
              <div className="detail-card-top">
                <span className="detail-key">{probe.short}</span>
                <span className="detail-status-dot" />
              </div>
              <strong>{probe.label}</strong>
              <small>
                {result
                  ? `${statusLabel(result.status)} · ${result.detail}`
                  : catalogOnly
                    ? '尚未发起能力测试'
                    : `${resultWasDeep ? '深度' : '快速'}模式未执行此项`}
              </small>
              {result?.endpoint && <code>{result.endpoint.replace(root, '…')}</code>}
            </div>
          );
        })}
      </div>
      <div className="model-performance">
        <span className="readout-label">PERFORMANCE · STREAM</span>
        <div className="model-performance-values">
          <div>
            <small>首字延迟</small>
            <strong>{selected.probes.stream?.firstTokenMs ? `${selected.probes.stream.firstTokenMs} ms` : '—'}</strong>
          </div>
          <div>
            <small>输出速度</small>
            <strong>
              {selected.probes.stream?.tokensPerSecond
                ? `${selected.probes.stream.tokensPerSecond} t/s`
                : selected.probes.stream?.charsPerSecond
                  ? `${selected.probes.stream.charsPerSecond} 字/s`
                  : '—'}
            </strong>
          </div>
          <div>
            <small>完整响应</small>
            <strong>{selected.probes.stream?.duration ? `${selected.probes.stream.duration} ms` : '—'}</strong>
          </div>
        </div>
      </div>
      <div className="compat-note">
        <span className="note-symbol">i</span>
        <p>
          <strong>如何解读：</strong>
          绿色表示该协议在当前模型上真实返回成功；黄色通常是接口明确拒绝了能力（如 400 / 404），不代表 Key 无效；红色更可能是鉴权、限流、网络或服务端错误。文本调用若因鉴权/限流/网络失败，会自动跳过后续探测以节省额度。Context 是从 `/models` 的元数据读取的声明值；手动输入模型 ID 时通常无法读取该字段。
        </p>
      </div>
    </div>
  );
}
