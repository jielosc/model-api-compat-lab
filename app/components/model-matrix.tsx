'use client';

import { useMemo, useState } from 'react';
import { PROBES, probeKeysForMode } from './probes';
import { formatContext, overallBadge, overallForModel, statusLabel } from './model-utils';
import type { ModelResult, ProbeKey, Summary } from './types';

type ModelMatrixProps = {
  models: ModelResult[];
  selectedId: string | null;
  deepScan: boolean;
  catalogOnly: boolean;
  catalogTotal: number;
  summary: Summary;
  error: string;
  running: boolean;
  onSelect: (id: string) => void;
  onExportJson: () => void;
  onCopyMarkdown: () => void;
};

function probeMark(status: string) {
  if (status === 'pass') return '✓';
  if (status === 'warn') return '–';
  if (status === 'fail') return '×';
  if (status === 'skipped') return '↷';
  return '…';
}

export function ModelMatrix({
  models,
  selectedId,
  deepScan,
  catalogOnly,
  catalogTotal,
  summary,
  error,
  running,
  onSelect,
  onExportJson,
  onCopyMarkdown,
}: ModelMatrixProps) {
  const [query, setQuery] = useState('');
  const activeKeyList = useMemo(() => probeKeysForMode(deepScan), [deepScan]);
  const activeKeys = useMemo(() => new Set<ProbeKey>(activeKeyList), [activeKeyList]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return models;
    return models.filter((model) =>
      model.id.toLowerCase().includes(needle)
      || model.family.toLowerCase().includes(needle)
      || (model.ownedBy?.toLowerCase().includes(needle) ?? false),
    );
  }, [models, query]);

  return (
    <div className="panel results-panel">
      <div className="panel-heading results-heading">
        <div><span className="section-index">B / INVENTORY & PROBES</span><h2>模型能力矩阵</h2></div>
        <div className="results-meta">
          <span>{catalogOnly ? 'MODEL LIST ONLY' : deepScan ? 'DEEP SCAN' : 'QUICK SCAN'}</span>
          <span className="meta-divider" />
          <span>{catalogOnly ? `${catalogTotal} MODELS` : `${summary.passed}/${summary.tested || 0} PASS`}</span>
        </div>
      </div>
      {error && <div className="error-banner"><span>!</span><p>{error}</p></div>}
      {!models.length ? (
        <div className="empty-state">
          <div className="empty-orbit"><div className="orbit-dot dot-a" /><div className="orbit-dot dot-b" /><div className="orbit-dot dot-c" /><div className="orbit-core">API</div></div>
          <h3>等待一次真实连接</h3>
          <p>先获取模型列表即可查看目录与声明的 Context；选择扫描模式后，再按模型发起能力测试。</p>
          <div className="empty-tags"><span>MODEL DISCOVERY</span><span>DECLARED CONTEXT</span><span>CAPABILITY MATRIX</span></div>
        </div>
      ) : (
        <>
          <div className="results-toolbar">
            <label className="filter-wrap">
              <span>筛选</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="模型 ID / 家族 / 提供方"
                aria-label="筛选模型"
              />
            </label>
            <div className="results-actions">
              <button type="button" className="ghost-button" onClick={onCopyMarkdown} disabled={running}>复制 Markdown</button>
              <button type="button" className="ghost-button" onClick={onExportJson} disabled={running}>导出 JSON</button>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>MODEL / FAMILY</th>
                  {PROBES.map((probe) => (
                    <th
                      key={probe.key}
                      title={catalogOnly || activeKeys.has(probe.key) ? probe.description : `${probe.description}（当前模式未测）`}
                      className={!catalogOnly && !activeKeys.has(probe.key) ? 'probe-col-inactive' : undefined}
                    >
                      {probe.short}
                    </th>
                  ))}
                  <th title="从 /models 元数据读取，不会发起额外请求">CONTEXT</th>
                  <th>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((model) => {
                  const overall = overallForModel(model, catalogOnly ? undefined : activeKeyList);
                  return (
                    <tr
                      key={model.id}
                      className={selectedId === model.id ? 'selected-row' : ''}
                      onClick={() => onSelect(model.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onSelect(model.id);
                        }
                      }}
                      tabIndex={0}
                      aria-selected={selectedId === model.id}
                    >
                      <td>
                        <div className="model-cell">
                          <span className="model-orb">{model.family.slice(0, 1)}</span>
                          <div>
                            <strong title={model.id}>{model.id}</strong>
                            <small>{model.family}{model.ownedBy ? ` · ${model.ownedBy}` : ''}</small>
                          </div>
                        </div>
                      </td>
                      {PROBES.map((probe) => {
                        const result = model.probes[probe.key];
                        const inactive = !catalogOnly && !activeKeys.has(probe.key) && !result;
                        return (
                          <td key={probe.key} className={inactive ? 'probe-col-inactive' : undefined}>
                            {result ? (
                              <span className={`probe-pill ${result.status}`} title={result.detail}>
                                {probeMark(result.status)}
                                <i>{statusLabel(result.status)}</i>
                              </span>
                            ) : (
                              <span className="probe-empty" title={inactive ? '当前模式未执行此项' : '未测'}>·</span>
                            )}
                          </td>
                        );
                      })}
                      <td>
                        <span
                          className={model.declaredContext ? 'context-value' : 'probe-empty'}
                          title={model.contextField ? `来源字段：${model.contextField}` : '模型目录未声明 Context'}
                        >
                          {formatContext(model.declaredContext)}
                        </span>
                      </td>
                      <td>
                        <span className={`overall-badge ${overall}`}>{overallBadge(overall, catalogOnly)}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {query.trim() && !filtered.length && <div className="filter-empty">没有匹配 “{query.trim()}” 的模型。</div>}
          <div className="table-footer">
            <span>{summary.tested ? '点击模型行查看探测详情，可在右侧单独复测' : '点击模型行查看 Context 与目录信息'}</span>
            <span>
              已显示 {filtered.length} / 发现 {catalogTotal || models.length} 个模型
            </span>
          </div>
        </>
      )}
    </div>
  );
}
