import { PROBES } from './probes';
import { formatContext } from './model-utils';
import type { ModelResult } from './types';

type ModelReadoutProps = {
  selected: ModelResult;
  baseUrl: string;
  catalogOnly: boolean;
};

export function ModelReadout({ selected, baseUrl, catalogOnly }: ModelReadoutProps) {
  const probeValues = Object.values(selected.probes);
  const overall = !probeValues.length ? 'idle' : probeValues.some((probe) => probe?.status === 'fail') ? 'fail' : probeValues.some((probe) => probe?.status === 'warn') ? 'warn' : probeValues.every((probe) => probe?.status === 'pass') ? 'pass' : 'running';
  return (
    <div className="panel detail-panel">
      <div className="detail-head"><div><span className="section-index">C / READOUT</span><h2>{selected.id}</h2></div><span className={`detail-status ${overall}`}>{overall === 'pass' ? 'COMPATIBILITY READY' : 'NEEDS REVIEW'}</span></div>
      <div className="detail-grid">
        <div className={`detail-card ${selected.declaredContext ? 'pass' : 'idle'}`}><div className="detail-card-top"><span className="detail-key">CONTEXT</span><span className="detail-status-dot" /></div><strong>声明的 Context</strong><small>{selected.declaredContext ? `${formatContext(selected.declaredContext)} tokens · 来自模型目录元数据` : '模型目录未返回常见 Context 字段'}</small>{selected.contextField && <code>{selected.contextField}</code>}</div>
        {PROBES.map((probe) => { const result = selected.probes[probe.key]; return <div className={`detail-card ${result?.status ?? 'idle'}`} key={probe.key}><div className="detail-card-top"><span className="detail-key">{probe.short}</span><span className="detail-status-dot" /></div><strong>{probe.label}</strong><small>{result ? result.detail : catalogOnly ? '尚未发起能力测试' : '快速模式未执行此项'}</small>{result?.endpoint && <code>{result.endpoint.replace(baseUrl.trim().replace(/\/+$/, ''), '…')}</code>}</div>; })}
      </div>
      <div className="model-performance"><span className="readout-label">PERFORMANCE · STREAM</span><div className="model-performance-values"><div><small>首字延迟</small><strong>{selected.probes.stream?.firstTokenMs ? `${selected.probes.stream.firstTokenMs} ms` : '—'}</strong></div><div><small>输出速度</small><strong>{selected.probes.stream?.tokensPerSecond ? `${selected.probes.stream.tokensPerSecond} t/s` : selected.probes.stream?.charsPerSecond ? `${selected.probes.stream.charsPerSecond} 字/s` : '—'}</strong></div><div><small>完整响应</small><strong>{selected.probes.stream?.duration ? `${selected.probes.stream.duration} ms` : '—'}</strong></div></div></div>
      <div className="compat-note"><span className="note-symbol">i</span><p><strong>如何解读：</strong>绿色表示该协议在当前模型上真实返回成功；黄色通常是接口明确拒绝了能力（如 400 / 404），不代表 Key 无效；红色更可能是鉴权、限流、网络或服务端错误。Context 是从 `/models` 的元数据读取的声明值，不代表当前请求一定能完整使用全部窗口；手动输入模型 ID 时通常无法读取该字段。</p></div>
    </div>
  );
}
