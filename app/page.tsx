'use client';

import { useMemo, useRef, useState } from 'react';

type ProbeKey = 'text' | 'vision' | 'tools' | 'json' | 'stream' | 'responses' | 'claude';
type ProbeStatus = 'idle' | 'running' | 'pass' | 'warn' | 'fail';
type AuthMode = 'auto' | 'bearer' | 'x-api-key' | 'none';

type ProbeResult = {
  status: ProbeStatus;
  detail: string;
  duration?: number;
  firstTokenMs?: number;
  tokensPerSecond?: number;
  charsPerSecond?: number;
  outputTokens?: number;
  endpoint?: string;
};

type RequestResult =
  | { ok: true; response: Response; body: Record<string, unknown>; url: string; firstByteMs: number; duration: number }
  | { ok: false; detail: string };

type ModelResult = {
  id: string;
  ownedBy?: string;
  family: string;
  declaredContext?: number;
  contextField?: string;
  probes: Partial<Record<ProbeKey, ProbeResult>>;
};

type Activity = {
  time: string;
  message: string;
  tone: 'neutral' | 'good' | 'bad';
};

const PROBES: Array<{ key: ProbeKey; label: string; short: string; description: string }> = [
  { key: 'text', label: '文本对话', short: 'TEXT', description: 'Chat Completions 基础调用' },
  { key: 'vision', label: '多模态', short: 'VISION', description: '图像输入 + 文本输出' },
  { key: 'tools', label: '工具调用', short: 'TOOLS', description: 'Function / tool calling' },
  { key: 'json', label: '结构化输出', short: 'JSON', description: 'JSON mode / response_format' },
  { key: 'stream', label: '流式输出', short: 'STREAM', description: 'SSE streaming' },
  { key: 'responses', label: 'Codex / Responses', short: 'RESPONSES', description: 'OpenAI Responses API' },
  { key: 'claude', label: 'Claude Code', short: 'CLAUDE', description: 'Anthropic Messages API' },
];

const PIXEL_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAE0lEQVR4nGOI2jfxPz7MMDIUAAB14aoBFS6JKwAAAABJRU5ErkJggg==';

function nowLabel() {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date());
}

function familyForModel(model: string) {
  const name = model.toLowerCase();
  if (name.includes('claude')) return 'Claude';
  if (name.includes('gpt') || name.includes('codex') || /^o[1-9]/.test(name)) return 'OpenAI';
  if (name.includes('gemini')) return 'Gemini';
  if (name.includes('qwen')) return 'Qwen';
  if (name.includes('deepseek')) return 'DeepSeek';
  if (name.includes('kimi') || name.includes('moonshot')) return 'Kimi';
  if (name.includes('mistral')) return 'Mistral';
  if (name.includes('llama')) return 'Llama';
  return 'Custom';
}

function cleanBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, '');
}

function endpointCandidates(baseUrl: string, path: string) {
  const root = cleanBaseUrl(baseUrl);
  const suffix = path.startsWith('/') ? path : `/${path}`;
  const candidates = [`${root}${suffix}`];
  if (!/\/v\d+(?:\/|$)/i.test(root)) candidates.push(`${root}/v1${suffix}`);
  return [...new Set(candidates)];
}

function authHeaders(mode: AuthMode, apiKey: string, style: 'openai' | 'anthropic' = 'openai'): Record<string, string> {
  if (mode === 'none' || !apiKey) return {};
  const useAnthropic = mode === 'x-api-key' || (mode === 'auto' && style === 'anthropic');
  return useAnthropic ? { 'x-api-key': apiKey } : { Authorization: `Bearer ${apiKey}` };
}

function parseBody(text: string) {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { text };
  }
}

function responseDetail(body: Record<string, unknown>, fallback: string) {
  const error = body.error as Record<string, unknown> | undefined;
  const message = error?.message ?? body.message ?? body.detail;
  return typeof message === 'string' ? message.slice(0, 180) : fallback;
}

function manualModelIds(value: string) {
  return value
    .split(/[\n,，]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

const CONTEXT_FIELDS = [
  'context_length',
  'context_window',
  'context_window_size',
  'max_context_length',
  'max_model_len',
  'max_input_tokens',
  'input_token_limit',
  'token_limit',
] as const;

function numericContext(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.round(value);
  if (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim())) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : undefined;
  }
  return undefined;
}

function readDeclaredContext(item: Record<string, unknown>) {
  const sources: Array<{ record: Record<string, unknown>; prefix: string }> = [{ record: item, prefix: '' }];
  for (const key of ['metadata', 'model_info', 'details', 'limits', 'capabilities', 'parameters']) {
    const nested = item[key];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) sources.push({ record: nested as Record<string, unknown>, prefix: `${key}.` });
  }
  for (const source of sources) {
    for (const field of CONTEXT_FIELDS) {
      const value = numericContext(source.record[field]);
      if (value) return { value, field: `${source.prefix}${field}` };
    }
  }
  return {};
}

function formatContext(value?: number) {
  if (!value) return '—';
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`;
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))}K`;
  return String(value);
}

async function requestJson(
  urls: string[],
  init: RequestInit,
  mode: AuthMode,
  apiKey: string,
  style: 'openai' | 'anthropic',
  signal: AbortSignal,
): Promise<RequestResult> {
  let lastFailure = '请求失败';
  for (const url of urls) {
    try {
      const requestStarted = performance.now();
      const headers = new Headers(init.headers);
      Object.entries(authHeaders(mode, apiKey, style)).forEach(([key, value]) => headers.set(key, value));
      headers.set('Accept', 'application/json');
      if (style === 'anthropic') headers.set('anthropic-version', '2023-06-01');
      const response = await fetch(url, { ...init, headers, signal });
      const firstByteMs = Math.round(performance.now() - requestStarted);
      const raw = await response.text();
      const duration = Math.round(performance.now() - requestStarted);
      const body = parseBody(raw);
      if (response.ok) return { ok: true, response, body, url, firstByteMs, duration };
      lastFailure = `${response.status} · ${responseDetail(body, response.statusText || '请求失败')}`;
      if (response.status !== 404 && response.status !== 405) break;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      lastFailure = error instanceof Error ? error.message : '网络请求失败，可能是 CORS 或地址不可达';
    }
  }
  return { ok: false, detail: lastFailure };
}

function baseJsonInit(body: Record<string, unknown>): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function probeModel(
  baseUrl: string,
  apiKey: string,
  authModeValue: AuthMode,
  model: string,
  key: ProbeKey,
  signal: AbortSignal,
): Promise<ProbeResult> {
  const started = performance.now();
  const chatUrls = endpointCandidates(baseUrl, '/chat/completions');
  let result: RequestResult;

  if (key === 'claude') {
    result = await requestJson(
      endpointCandidates(baseUrl, '/messages'),
      baseJsonInit({ model, max_tokens: 12, messages: [{ role: 'user', content: '只回复 OK。' }] }),
      authModeValue,
      apiKey,
      'anthropic',
      signal,
    );
  } else if (key === 'responses') {
    result = await requestJson(
      endpointCandidates(baseUrl, '/responses'),
      baseJsonInit({ model, input: '只回复 OK。', max_output_tokens: 12, reasoning: { effort: 'low' } }),
      authModeValue,
      apiKey,
      'openai',
      signal,
    );
  } else if (key === 'text') {
    result = await requestJson(
      chatUrls,
      baseJsonInit({ model, messages: [{ role: 'user', content: '只回复 OK。' }], max_tokens: 12, temperature: 0 }),
      authModeValue,
      apiKey,
      'openai',
      signal,
    );
  } else if (key === 'vision') {
    result = await requestJson(
      chatUrls,
      baseJsonInit({
        model,
        messages: [{ role: 'user', content: [{ type: 'text', text: '这张图片里有什么？只回复 pixel。' }, { type: 'image_url', image_url: { url: PIXEL_IMAGE } }] }],
        max_tokens: 12,
      }),
      authModeValue,
      apiKey,
      'openai',
      signal,
    );
  } else if (key === 'tools') {
    result = await requestJson(
      chatUrls,
      baseJsonInit({
        model,
        messages: [{ role: 'user', content: '查询北京天气。' }],
        max_tokens: 24,
        tools: [{ type: 'function', function: { name: 'get_weather', description: '查询天气', parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } } }],
        tool_choice: 'auto',
      }),
      authModeValue,
      apiKey,
      'openai',
      signal,
    );
  } else if (key === 'json') {
    result = await requestJson(
      chatUrls,
      baseJsonInit({
        model,
        messages: [{ role: 'user', content: '以 JSON 返回：{"ok":true}' }],
        max_tokens: 24,
        response_format: { type: 'json_object' },
      }),
      authModeValue,
      apiKey,
      'openai',
      signal,
    );
  } else {
    const headers = new Headers(authHeaders(authModeValue, apiKey, 'openai'));
    headers.set('Accept', 'text/event-stream');
    headers.set('Content-Type', 'application/json');
    let lastDetail = '流式请求失败';
    for (const url of chatUrls) {
      try {
        const response = await fetch(url, { ...baseJsonInit({ model, messages: [{ role: 'user', content: '请用一句简短的话介绍自己。' }], max_tokens: 24, stream: true, stream_options: { include_usage: true } }), headers, signal });
        const firstByteMs = Math.round(performance.now() - started);
        if (response.ok) {
          const reader = response.body?.getReader();
          let firstTokenMs: number | undefined;
          let outputTokens: number | undefined;
          let contentChars = 0;
          if (reader) {
            const decoder = new TextDecoder();
            let buffer = '';
            let finished = false;
            while (!finished) {
              const next = await reader.read();
              if (next.done) break;
              buffer += decoder.decode(next.value, { stream: true });
              const lines = buffer.split(/\r?\n/);
              buffer = lines.pop() ?? '';
              for (const line of lines) {
                if (!line.startsWith('data:')) continue;
                const data = line.slice(5).trim();
                if (data === '[DONE]') {
                  finished = true;
                  break;
                }
                const payload = parseBody(data);
                const choices = Array.isArray(payload.choices) ? payload.choices : [];
                const delta = choices[0] && typeof choices[0] === 'object' ? (choices[0] as Record<string, unknown>).delta : undefined;
                const content = delta && typeof delta === 'object' ? (delta as Record<string, unknown>).content : undefined;
                if (typeof content === 'string' && content.length > 0) {
                  firstTokenMs ??= Math.round(performance.now() - started);
                  contentChars += content.length;
                }
                const usage = payload.usage;
                if (usage && typeof usage === 'object') {
                  const completionTokens = (usage as Record<string, unknown>).completion_tokens;
                  if (typeof completionTokens === 'number') outputTokens = completionTokens;
                }
              }
            }
            await reader.cancel();
          }
          const duration = Math.round(performance.now() - started);
          const measuredFirstToken = firstTokenMs ?? firstByteMs;
          const generationSeconds = Math.max((duration - measuredFirstToken) / 1000, 0.001);
          const tokensPerSecond = outputTokens && outputTokens > 0 ? Number((outputTokens / generationSeconds).toFixed(1)) : undefined;
          const charsPerSecond = contentChars > 0 ? Number((contentChars / generationSeconds).toFixed(1)) : undefined;
          const speedLabel = tokensPerSecond ? `${tokensPerSecond} tokens/s` : charsPerSecond ? `${charsPerSecond} chars/s` : '服务未返回可计量内容';
          return { status: 'pass', detail: `首字 ${measuredFirstToken} ms · ${speedLabel}`, duration, firstTokenMs: measuredFirstToken, tokensPerSecond, charsPerSecond, outputTokens, endpoint: url };
        }
        const raw = await response.text();
        lastDetail = `${response.status} · ${responseDetail(parseBody(raw), response.statusText || '请求失败')}`;
        if (response.status !== 404 && response.status !== 405) break;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        lastDetail = error instanceof Error ? error.message : '网络请求失败';
      }
    }
    return { status: 'fail', detail: lastDetail.slice(0, 180), duration: Math.round(performance.now() - started) };
  }

  const duration = Math.round(performance.now() - started);
  if (result.ok) {
    if (key === 'tools') {
      const choices = Array.isArray(result.body?.choices) ? result.body.choices : [];
      const firstChoice = choices[0] as Record<string, unknown> | undefined;
      const message = firstChoice?.message as Record<string, unknown> | undefined;
      const toolCalls = message?.tool_calls;
      if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
        return { status: 'warn', detail: `${duration} ms · 请求被接受，但响应没有返回 tool_calls`, duration, endpoint: result.url };
      }
    }
    return { status: 'pass', detail: `${duration} ms · HTTP ${result.response?.status ?? 200}`, duration, endpoint: result.url };
  }
  const isUnsupported = Boolean(result.detail?.startsWith('400') || result.detail?.startsWith('404') || result.detail?.startsWith('405'));
  return { status: isUnsupported ? 'warn' : 'fail', detail: result.detail?.slice(0, 180) ?? '请求失败', duration };
}

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

export default function Home() {
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1');
  const [apiKey, setApiKey] = useState('');
  const [authModeValue, setAuthModeValue] = useState<AuthMode>('auto');
  const [manualModels, setManualModels] = useState('');
  const [deepScan, setDeepScan] = useState(false);
  const [maxModels, setMaxModels] = useState('12');
  const [models, setModels] = useState<ModelResult[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState('等待接入');
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const selected = models.find((model) => model.id === selectedModel) ?? models[0];
  const summary = useMemo(() => {
    const allProbes = models.flatMap((model) => Object.values(model.probes));
    const streamResults = models.map((model) => model.probes.stream).filter((probe): probe is ProbeResult => probe?.status === 'pass');
    const average = (values: number[]) => values.length ? Math.round(values.reduce((total, value) => total + value, 0) / values.length) : undefined;
    const firstTokenValues = streamResults.flatMap((probe) => typeof probe.firstTokenMs === 'number' ? [probe.firstTokenMs] : []);
    const tokenSpeedValues = streamResults.flatMap((probe) => typeof probe.tokensPerSecond === 'number' ? [probe.tokensPerSecond] : []);
    const charSpeedValues = streamResults.flatMap((probe) => typeof probe.charsPerSecond === 'number' ? [probe.charsPerSecond] : []);
    const totalLatencyValues = streamResults.flatMap((probe) => typeof probe.duration === 'number' ? [probe.duration] : []);
    return {
      total: models.length,
      reachable: models.filter((model) => model.probes.text?.status === 'pass').length,
      vision: models.filter((model) => model.probes.vision?.status === 'pass').length,
      code: models.filter((model) => model.probes.responses?.status === 'pass' || model.probes.claude?.status === 'pass').length,
      passed: allProbes.filter((probe) => probe?.status === 'pass').length,
      tested: allProbes.filter((probe) => probe?.status && probe.status !== 'running').length,
      avgFirstToken: average(firstTokenValues),
      avgTokenSpeed: average(tokenSpeedValues),
      avgCharSpeed: average(charSpeedValues),
      avgTotalLatency: average(totalLatencyValues),
      performanceSamples: streamResults.length,
    };
  }, [models]);

  function addActivity(message: string, tone: Activity['tone'] = 'neutral') {
    setActivities((current) => [{ time: nowLabel(), message, tone }, ...current].slice(0, 8));
  }

  function updateModel(id: string, key: ProbeKey, probe: ProbeResult) {
    setModels((current) => current.map((model) => model.id === id ? { ...model, probes: { ...model.probes, [key]: probe } } : model));
  }

  async function discoverModels(controller: AbortController) {
    const urls = endpointCandidates(baseUrl, '/models');
    let first = await requestJson(urls, { method: 'GET' }, authModeValue, apiKey, 'openai', controller.signal);
    if (!first.ok && authModeValue === 'auto') {
      first = await requestJson(urls, { method: 'GET' }, authModeValue, apiKey, 'anthropic', controller.signal);
    }
    if (first.ok) {
      const rawList = Array.isArray(first.body?.data) ? first.body.data : Array.isArray(first.body) ? first.body : [];
      const discovered = rawList
        .map((item) => typeof item === 'string' ? { id: item } : item && typeof item === 'object' ? item as Record<string, unknown> : {})
        .map((item) => {
          const context = readDeclaredContext(item);
          return { id: String(item.id ?? ''), ownedBy: item.owned_by ? String(item.owned_by) : undefined, declaredContext: context.value, contextField: context.field };
        })
        .filter((item) => item.id);
      if (discovered.length) return { discovered, endpoint: first.url };
    }

    const ids = manualModelIds(manualModels).map((id) => ({ id, ownedBy: undefined as string | undefined, declaredContext: undefined as number | undefined, contextField: undefined as string | undefined }));
    if (ids.length) return { discovered: ids, endpoint: '手动输入' };
    throw new Error(first.ok ? '接口返回成功，但没有找到 data[].id；可在“手动模型 ID”中填写模型。' : first.detail ?? '无法访问模型列表');
  }

  async function runHealthCheck() {
    if (running) return;
    const trimmedBase = cleanBaseUrl(baseUrl);
    if (!trimmedBase) {
      setError('请先填写 API Base URL。');
      return;
    }
    try {
      new URL(trimmedBase);
    } catch {
      setError('API Base URL 不是有效的网址。');
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setError('');
    setModels([]);
    setSelectedModel(null);
    setActivities([]);
    setPhase('读取模型目录');
    addActivity('开始连接模型 API');

    try {
      const found = await discoverModels(controller);
      const limited = found.discovered.slice(0, Math.max(1, Number(maxModels) || 12));
      const initialModels = limited.map((item) => ({ id: item.id, ownedBy: item.ownedBy, declaredContext: item.declaredContext, contextField: item.contextField, family: familyForModel(item.id), probes: {} }));
      setModels(initialModels);
      setSelectedModel(initialModels[0]?.id ?? null);
      addActivity(`发现 ${found.discovered.length} 个模型 · ${found.endpoint}`, 'good');
      if (found.discovered.length > limited.length) addActivity(`为控制请求量，本次先测试前 ${limited.length} 个模型`);

      const probeKeys: ProbeKey[] = deepScan ? PROBES.map((probe) => probe.key) : ['text', 'stream'];
      for (let index = 0; index < initialModels.length; index += 1) {
        const model = initialModels[index];
        setPhase(`测试 ${index + 1}/${initialModels.length} · ${model.id}`);
        for (const key of probeKeys) {
          updateModel(model.id, key, { status: 'running', detail: '请求中…' });
          const result = await probeModel(trimmedBase, apiKey, authModeValue, model.id, key, controller.signal);
          updateModel(model.id, key, result);
        }
        addActivity(`${model.id} · ${deepScan ? '深度探测完成' : '可调用性检查完成'}`, 'good');
      }
      setPhase('体检完成');
      addActivity('全部探测完成', 'good');
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') {
        setPhase('已停止');
        addActivity('用户中止了本次探测');
      } else {
        const message = caught instanceof Error ? caught.message : '未知错误';
        setError(message);
        setPhase('体检中断');
        addActivity(message, 'bad');
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  function stopHealthCheck() {
    abortRef.current?.abort();
  }

  const progress = models.length ? Math.round((summary.tested / (models.length * (deepScan ? PROBES.length : 2))) * 100) : 0;

  return (
    <main className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark"><span /><span /><span /></div>
          <div>
            <div className="eyebrow">MODEL API / COMPATIBILITY LAB</div>
            <div className="brand-name">模型 API 体检台</div>
          </div>
        </div>
        <div className="topbar-note"><span className="live-dot" /> 浏览器直连 · 密钥不落盘</div>
      </header>

      <section className="hero">
        <div>
          <div className="eyebrow accent">API 能力边界扫描器</div>
          <h1>先找到模型，<em>再知道它能做什么。</em></h1>
          <p>一次接入，快速盘点模型目录，并用真实请求探测文本、多模态、工具调用、流式输出，以及 Codex / Claude Code 所需的协议兼容性。</p>
        </div>
        <div className="hero-stamp">
          <span className="stamp-number">{summary.total ? String(summary.total).padStart(2, '0') : '—'}</span>
          <span className="stamp-label">MODELS<br />IN SCOPE</span>
        </div>
      </section>

      <div className="steps" aria-label="检测流程">
        <div className="step active"><span>01</span><strong>接入</strong><small>Base URL + Key</small></div>
        <div className="step-line" />
        <div className={`step ${models.length ? 'active' : ''}`}><span>02</span><strong>发现</strong><small>/models catalog</small></div>
        <div className="step-line" />
        <div className={`step ${summary.tested ? 'active' : ''}`}><span>03</span><strong>边界</strong><small>capability probes</small></div>
      </div>

      <section className="workspace">
        <aside className="config-panel panel">
          <div className="panel-heading">
            <div><span className="section-index">A / CONNECT</span><h2>接入配置</h2></div>
            <span className="lock-label">LOCAL ONLY</span>
          </div>

          <label className="field-label" htmlFor="base-url">API Base URL</label>
          <div className="input-wrap url-wrap"><span className="input-prefix">↗</span><input id="base-url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" /></div>
          <div className="hint">支持 OpenAI-compatible、Anthropic-compatible 代理。可填到 `/v1`。</div>

          <label className="field-label" htmlFor="api-key">API Key</label>
          <div className="input-wrap"><span className="input-prefix key-prefix">KEY</span><input id="api-key" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="sk-… / 你的访问密钥" autoComplete="off" /></div>

          <div className="field-label">鉴权方案</div>
          <div className="segmented" role="radiogroup" aria-label="鉴权方案">
            {([['auto', '自动'], ['bearer', 'Bearer'], ['x-api-key', 'x-api-key'], ['none', '无 Key']] as Array<[AuthMode, string]>).map(([value, label]) => (
              <button key={value} className={authModeValue === value ? 'selected' : ''} onClick={() => setAuthModeValue(value)} type="button">{label}</button>
            ))}
          </div>

          <label className="field-label" htmlFor="manual-models">手动模型 ID <span>可选</span></label>
          <textarea id="manual-models" value={manualModels} onChange={(event) => setManualModels(event.target.value)} placeholder={'服务不提供 /models 时填写，例如：\ngpt-4o, claude-3-5-sonnet'} rows={3} />

          <div className="scan-options">
            <div className="option-row">
              <div><strong>深度探测</strong><small>{deepScan ? '每个模型最多 7 个真实请求' : '每个模型 2 个低成本请求（含性能）'}</small></div>
              <button type="button" className={`switch ${deepScan ? 'on' : ''}`} aria-label="切换深度探测" aria-pressed={deepScan} onClick={() => setDeepScan((current) => !current)}><span /></button>
            </div>
            <div className="option-row compact-row">
              <div><strong>最多测试模型</strong><small>避免一次性消耗过多额度</small></div>
              <select value={maxModels} onChange={(event) => setMaxModels(event.target.value)} aria-label="最多测试模型数量"><option value="6">06</option><option value="12">12</option><option value="24">24</option><option value="50">50</option></select>
            </div>
          </div>

          {running ? <button className="primary-button stop-button" type="button" onClick={stopHealthCheck}><span className="button-icon">■</span> 停止本次探测</button> : <button className="primary-button" type="button" onClick={runHealthCheck}><span className="button-icon">↗</span> 开始一键体检</button>}
          <div className="privacy-note"><span>◌</span><p>Key 仅用于当前页面的 fetch 请求，刷新页面即清除。请确认目标 API 允许浏览器跨域访问。</p></div>

          <div className="activity-block">
            <div className="activity-title"><span>ACTIVITY</span><span>{phase}</span></div>
            {running && <div className="progress-track"><span style={{ width: `${Math.min(progress, 98)}%` }} /></div>}
            <div className="activity-list">
              {activities.length ? activities.map((activity, index) => <div className="activity-item" key={`${activity.time}-${index}`}><span className={`activity-bullet ${activity.tone}`} /><time>{activity.time}</time><p>{activity.message}</p></div>) : <div className="empty-activity">开始后，这里会显示每个阶段的实时记录。</div>}
            </div>
          </div>
        </aside>

        <section className="results-column">
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

          <div className="panel results-panel">
            <div className="panel-heading results-heading">
              <div><span className="section-index">B / INVENTORY & PROBES</span><h2>模型能力矩阵</h2></div>
              <div className="results-meta"><span>{deepScan ? 'DEEP SCAN' : 'QUICK SCAN'}</span><span className="meta-divider" /><span>{summary.passed}/{summary.tested || 0} PASS</span></div>
            </div>
            {error && <div className="error-banner"><span>!</span><p>{error}</p></div>}
            {!models.length ? <div className="empty-state"><div className="empty-orbit"><div className="orbit-dot dot-a" /><div className="orbit-dot dot-b" /><div className="orbit-dot dot-c" /><div className="orbit-core">API</div></div><h3>等待一次真实连接</h3><p>填入 Base URL 和 Key 后，体检台会先读取 `/models`，并从目录元数据中读取模型声明的 Context。</p><div className="empty-tags"><span>MODEL DISCOVERY</span><span>DECLARED CONTEXT</span><span>CAPABILITY MATRIX</span></div></div> : <div className="table-wrap"><table><thead><tr><th>MODEL / FAMILY</th>{PROBES.map((probe) => <th key={probe.key} title={probe.description}>{probe.short}</th>)}<th title="从 /models 元数据读取，不会发起额外请求">CONTEXT</th><th>STATUS</th></tr></thead><tbody>{models.map((model) => { const overall = overallForModel(model); return <tr key={model.id} className={selected?.id === model.id ? 'selected-row' : ''} onClick={() => setSelectedModel(model.id)}><td><div className="model-cell"><span className="model-orb">{model.family.slice(0, 1)}</span><div><strong>{model.id}</strong><small>{model.family}{model.ownedBy ? ` · ${model.ownedBy}` : ''}</small></div></div></td>{PROBES.map((probe) => { const result = model.probes[probe.key]; return <td key={probe.key}>{result ? <span className={`probe-pill ${result.status}`} title={result.detail}>{result.status === 'pass' ? '✓' : result.status === 'warn' ? '–' : result.status === 'fail' ? '×' : '…'}<i>{statusLabel(result.status)}</i></span> : <span className="probe-empty">·</span>}</td> })}<td><span className={model.declaredContext ? 'context-value' : 'probe-empty'} title={model.contextField ? `来源字段：${model.contextField}` : '模型目录未声明 Context'}>{formatContext(model.declaredContext)}</span></td><td><span className={`overall-badge ${overall}`}>{overall === 'pass' ? 'READY' : overall === 'warn' ? 'PARTIAL' : overall === 'fail' ? 'CHECK' : overall === 'running' ? 'RUNNING' : '—'}</span></td></tr>})}</tbody></table></div>}
            {models.length > 0 && <div className="table-footer"><span>点击模型行查看探测详情</span><span>已测试 {models.length} / 发现模型上限 {maxModels}</span></div>}
          </div>

          {selected && <div className="panel detail-panel"><div className="detail-head"><div><span className="section-index">C / READOUT</span><h2>{selected.id}</h2></div><span className={`detail-status ${overallForModel(selected)}`}>{overallForModel(selected) === 'pass' ? 'COMPATIBILITY READY' : 'NEEDS REVIEW'}</span></div><div className="detail-grid"><div className={`detail-card ${selected.declaredContext ? 'pass' : 'idle'}`}><div className="detail-card-top"><span className="detail-key">CONTEXT</span><span className="detail-status-dot" /></div><strong>声明的 Context</strong><small>{selected.declaredContext ? `${formatContext(selected.declaredContext)} tokens · 来自模型目录元数据` : '模型目录未返回常见 Context 字段'}</small>{selected.contextField && <code>{selected.contextField}</code>}</div>{PROBES.map((probe) => { const result = selected.probes[probe.key]; return <div className={`detail-card ${result?.status ?? 'idle'}`} key={probe.key}><div className="detail-card-top"><span className="detail-key">{probe.short}</span><span className="detail-status-dot" /></div><strong>{probe.label}</strong><small>{result ? result.detail : '快速模式未执行此项'}</small>{result?.endpoint && <code>{result.endpoint.replace(cleanBaseUrl(baseUrl), '…')}</code>}</div> })}</div><div className="model-performance"><span className="readout-label">PERFORMANCE · STREAM</span><div className="model-performance-values"><div><small>首字延迟</small><strong>{selected.probes.stream?.firstTokenMs ? `${selected.probes.stream.firstTokenMs} ms` : '—'}</strong></div><div><small>输出速度</small><strong>{selected.probes.stream?.tokensPerSecond ? `${selected.probes.stream.tokensPerSecond} t/s` : selected.probes.stream?.charsPerSecond ? `${selected.probes.stream.charsPerSecond} 字/s` : '—'}</strong></div><div><small>完整响应</small><strong>{selected.probes.stream?.duration ? `${selected.probes.stream.duration} ms` : '—'}</strong></div></div></div><div className="compat-note"><span className="note-symbol">i</span><p><strong>如何解读：</strong>绿色表示该协议在当前模型上真实返回成功；黄色通常是接口明确拒绝了能力（如 400 / 404），不代表 Key 无效；红色更可能是鉴权、限流、网络或服务端错误。Context 是从 `/models` 的元数据读取的声明值，不代表当前请求一定能完整使用全部窗口；手动输入模型 ID 时通常无法读取该字段。</p></div></div>}
        </section>
      </section>

      <footer><span>MODEL API COMPATIBILITY LAB</span><span>v0.1 · Client-side diagnostics · <a href="https://github.com/jielosc/model-api-compat-lab" target="_blank" rel="noreferrer">VIEW SOURCE ↗</a></span></footer>
    </main>
  );
}
