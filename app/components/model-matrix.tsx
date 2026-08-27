import { PROBES } from './probes';
import { formatContext } from './model-utils';
import type { ModelResult, ProbeStatus, Summary } from './types';

type ModelMatrixProps = {
  models: ModelResult[];
  selectedId: string | null;
  deepScan: boolean;
  catalogOnly: boolean;
  catalogTotal: number;
  maxModels: string;
  summary: Summary;
  error: string;
  onSelect: (id: string) => void;
};

function statusLabel(status: ProbeStatus) {
  if (status === 'pass') return '通过';
  if (status === 'warn') return '不支持';
  if (status === 'fail') return '失败';
  if (status === 'running') return '测试中';
  return '未测';
}

function overallForModel(model: ModelResult) {
  const values = Object.values(model.probes);
  if (!values.length) return 'idle';
  if (values.some((probe) => probe?.status === 'fail')) return 'fail';
  if (values.some((probe) => probe?.status === 'warn')) return 'warn';
  if (values.every((probe) => probe?.status === 'pass')) return 'pass';
  return 'running';
}

export function ModelMatrix({ models, selectedId, deepScan, catalogOnly, catalogTotal, maxModels, summary, error, onSelect }: ModelMatrixProps) {
  return (
    <div className="panel results-panel">
      <div className="panel-heading results-heading">
        <div><span className="section-index">B / INVENTORY & PROBES</span><h2>模型能力矩阵</h2></div>
        <div className="results-meta"><span>{catalogOnly ? 'MODEL LIST ONLY' : deepScan ? 'DEEP SCAN' : 'QUICK SCAN'}</span><span className="meta-divider" /><span>{catalogOnly ? `${catalogTotal} MODELS` : `${summary.passed}/${summary.tested || 0} PASS`}</span></div>
      </div>
      {error && <div className="error-banner"><span>!</span><p>{error}</p></div>}
      {!models.length ? <div className="empty-state"><div className="empty-orbit"><div className="orbit-dot dot-a" /><div className="orbit-dot dot-b" /><div className="orbit-dot dot-c" /><div className="orbit-core">API</div></div><h3>等待一次真实连接</h3><p>先获取模型列表即可查看目录与声明的 Context；选择扫描模式后，再按模型发起能力测试。</p><div className="empty-tags"><span>MODEL DISCOVERY</span><span>DECLARED CONTEXT</span><span>CAPABILITY MATRIX</span></div></div> : <div className="table-wrap"><table><thead><tr><th>MODEL / FAMILY</th>{PROBES.map((probe) => <th key={probe.key} title={probe.description}>{probe.short}</th>)}<th title="从 /models 元数据读取，不会发起额外请求">CONTEXT</th><th>STATUS</th></tr></thead><tbody>{models.map((model) => { const overall = overallForModel(model); return <tr key={model.id} className={selectedId === model.id ? 'selected-row' : ''} onClick={() => onSelect(model.id)}><td><div className="model-cell"><span className="model-orb">{model.family.slice(0, 1)}</span><div><strong>{model.id}</strong><small>{model.family}{model.ownedBy ? ` · ${model.ownedBy}` : ''}</small></div></div></td>{PROBES.map((probe) => { const result = model.probes[probe.key]; return <td key={probe.key}>{result ? <span className={`probe-pill ${result.status}`} title={result.detail}>{result.status === 'pass' ? '✓' : result.status === 'warn' ? '–' : result.status === 'fail' ? '×' : '…'}<i>{statusLabel(result.status)}</i></span> : <span className="probe-empty">·</span>}</td> })}<td><span className={model.declaredContext ? 'context-value' : 'probe-empty'} title={model.contextField ? `来源字段：${model.contextField}` : '模型目录未声明 Context'}>{formatContext(model.declaredContext)}</span></td><td><span className={`overall-badge ${overall}`}>{overall === 'pass' ? 'READY' : overall === 'warn' ? 'PARTIAL' : overall === 'fail' ? 'CHECK' : overall === 'running' ? 'RUNNING' : '—'}</span></td></tr>})}</tbody></table></div>}
      {models.length > 0 && <div className="table-footer"><span>{summary.tested ? '点击模型行查看探测详情' : '点击模型行查看 Context 与目录信息'}</span><span>已显示 {models.length} / 发现 {catalogTotal || models.length} 个模型{!catalogOnly && catalogTotal > models.length ? ` · 本次测试上限 ${maxModels}` : ''}</span></div>}
    </div>
  );
}
