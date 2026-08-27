import type { AuthMode, ModelResult, ProbeKey, ProbeReason, ProbeResult, ProbeStatus, ThemeMode } from './types';

export function formatContext(value?: number) {
  if (!value) return '—';
  if (value >= 1_000_000) {
    const n = value / 1_000_000;
    return `${Number.isInteger(n) ? n : Number(n.toFixed(1))}M`;
  }
  if (value >= 1_000) {
    const n = value / 1_000;
    return `${Number.isInteger(n) ? n : Number(n.toFixed(1))}K`;
  }
  return String(value);
}

const FAMILY_MATCHERS: Array<[string, RegExp]> = [
  ['Claude', /claude|anthropic/i],
  ['OpenAI', /gpt|codex|chatgpt|openai|^o[1-9]\b/i],
  ['Gemini', /gemini/i],
  ['Gemma', /gemma/i],
  ['Grok', /grok/i],
  ['Qwen', /qwen|qwq|qvq/i],
  ['DeepSeek', /deepseek/i],
  ['Kimi', /kimi|moonshot/i],
  ['Mistral', /mistral|mixtral|codestral|pixtral|ministral/i],
  ['Llama', /llama|meta-llama/i],
  ['GLM', /glm|chatglm|zhipu/i],
  ['Doubao', /doubao|seed-/i],
  ['Hunyuan', /hunyuan/i],
  ['Yi', /(^|[^a-z])yi[-_]/i],
  ['Command', /command-?r|cohere/i],
  ['Nova', /nova-/i],
  ['Phi', /(^|[^a-z])phi[-_]/i],
  ['MiniMax', /minimax|abab/i],
  ['Baichuan', /baichuan/i],
  ['InternLM', /internlm/i],
  ['Spark', /spark|xinghuo/i],
  ['Ernie', /ernie|yiyan/i],
  ['Step', /step[-_]/i],
];

export function familyForModel(model: string) {
  for (const [family, pattern] of FAMILY_MATCHERS) {
    if (pattern.test(model)) return family;
  }
  return 'Custom';
}

export function overallForModel(model: ModelResult, expectedKeys?: ProbeKey[]): ProbeStatus {
  const keys = expectedKeys?.length ? expectedKeys : Object.keys(model.probes) as ProbeKey[];
  if (!keys.length) return 'idle';
  const results = keys.map((key) => model.probes[key]);
  const values = results.filter((probe): probe is ProbeResult => {
    if (!probe) return false;
    return probe.status !== 'skipped' && probe.status !== 'idle';
  });
  const incomplete = results.some((probe) => {
    if (!probe) return true;
    return probe.status === 'idle' || probe.status === 'skipped';
  });
  if (values.some((probe) => probe?.status === 'running')) return 'running';
  if (values.some((probe) => probe?.status === 'fail')) return 'fail';
  if (values.some((probe) => probe?.status === 'warn')) return 'warn';
  if (expectedKeys?.length && incomplete) return 'warn';
  if (!values.length) return 'idle';
  if (values.every((probe) => probe?.status === 'pass')) return 'pass';
  return 'running';
}

export function statusLabel(status: ProbeStatus) {
  if (status === 'pass') return '通过';
  if (status === 'warn') return '不支持';
  if (status === 'fail') return '失败';
  if (status === 'running') return '测试中';
  if (status === 'skipped') return '已跳过';
  return '未测';
}

export function overallBadge(overall: ProbeStatus, catalogOnly?: boolean) {
  if (overall === 'pass') return 'READY';
  if (overall === 'warn') return 'PARTIAL';
  if (overall === 'fail') return 'CHECK';
  if (overall === 'running') return 'RUNNING';
  if (catalogOnly) return 'LIST';
  return '—';
}

export function readoutStatus(overall: ProbeStatus, catalogOnly?: boolean) {
  if (overall === 'pass') return 'COMPATIBILITY READY';
  if (overall === 'warn') return 'PARTIAL SUPPORT';
  if (overall === 'fail') return 'NEEDS REVIEW';
  if (overall === 'running') return 'TESTING';
  if (catalogOnly) return 'CATALOG ONLY';
  return 'NOT TESTED';
}

export function classifyProbeFailure(detail: string): { status: Extract<ProbeStatus, 'warn' | 'fail'>; reason: ProbeReason } {
  const text = detail.toLowerCase();
  if (/\b(401|403)\b|invalid api key|incorrect api key|unauthorized|authentication|permission denied|鉴权/.test(text)) {
    return { status: 'fail', reason: 'auth' };
  }
  if (/\b429\b|rate limit|too many requests|quota|限流/.test(text)) {
    return { status: 'fail', reason: 'rate_limit' };
  }
  if (/cors|failed to fetch|networkerror|load failed|not allowed|unreachable|network request|timed? out|timeout|网络请求失败|跨域|请求超时/.test(text)) {
    return { status: 'fail', reason: 'network' };
  }
  if (/^(400|404|405)\b|not found|unknown model|does not support|unsupported|invalid.*request/.test(text)) {
    return { status: 'warn', reason: 'unsupported' };
  }
  return { status: 'fail', reason: 'error' };
}

export function shouldSkipProbe(textResult: ProbeResult | undefined, key: ProbeKey) {
  if (!textResult || key === 'text' || textResult.status === 'pass' || textResult.status === 'warn') return false;
  return textResult.reason === 'auth' || textResult.reason === 'network' || textResult.reason === 'rate_limit';
}

export function skippedResult(textResult: ProbeResult): ProbeResult {
  const why = textResult.reason === 'auth'
    ? '鉴权失败，已跳过后续探测'
    : textResult.reason === 'rate_limit'
      ? '触发限流，已跳过后续探测'
      : textResult.reason === 'network'
        ? '网络/CORS 失败，已跳过后续探测'
        : '文本调用失败，已跳过同协议探测';
  return { status: 'skipped', detail: why, reason: 'skipped' };
}

export const SETTINGS_KEY = 'model-api-compat-lab.settings';

export type PersistedSettings = {
  baseUrl: string;
  authModeValue: AuthMode;
  manualModels: string;
  deepScan: boolean;
  themeMode: ThemeMode;
};

export function loadSettings(): Partial<PersistedSettings> {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveSettings(settings: PersistedSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* private mode / quota */
  }
}

export function downloadText(filename: string, content: string, type = 'application/json') {
  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}
