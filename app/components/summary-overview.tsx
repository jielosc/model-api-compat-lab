import type { Summary } from './types';

type SummaryOverviewProps = {
  summary: Summary;
};

export function SummaryOverview({ summary }: SummaryOverviewProps) {
  return (
    <>
      <div className="summary-grid">
        <div className="summary-card"><span>MODELS</span><strong>{summary.total || '—'}</strong><small>目录中的模型</small></div>
        <div className="summary-card mint"><span>REACHABLE</span><strong>{summary.reachable || '—'}</strong><small>文本调用通过</small></div>
        <div className="summary-card violet"><span>VISION</span><strong>{summary.vision || '—'}</strong><small>多模态通过</small></div>
        <div className="summary-card orange"><span>CODE READY</span><strong>{summary.code || '—'}</strong><small>Responses / Claude</small></div>
      </div>

      <div className="metrics-strip">
        <div className="metric-cell"><span>AVG FIRST TOKEN</span><strong>{summary.avgFirstToken ? `${summary.avgFirstToken} ms` : '—'}</strong><small>平均首字延迟 · {summary.performanceSamples ? `${summary.performanceSamples} 个样本` : '等待流式探测'}</small></div>
        <div className="metric-cell metric-speed"><span>AVG OUTPUT SPEED</span><strong>{summary.avgTokenSpeed ? `${summary.avgTokenSpeed} t/s` : summary.avgCharSpeed ? `${summary.avgCharSpeed} 字/s` : '—'}</strong><small>{summary.avgTokenSpeed ? '基于服务返回的 completion tokens' : '未返回 token usage 时显示字符速度'}</small></div>
        <div className="metric-cell metric-latency"><span>AVG TOTAL LATENCY</span><strong>{summary.avgTotalLatency ? `${summary.avgTotalLatency} ms` : '—'}</strong><small>流式请求从发出到结束</small></div>
      </div>
    </>
  );
}
