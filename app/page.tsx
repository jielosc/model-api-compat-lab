'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ConfigPanel } from './components/config-panel';
import { ModelMatrix } from './components/model-matrix';
import { ModelReadout } from './components/model-readout';
import { PROBES } from './components/probes';
import { SummaryOverview } from './components/summary-overview';
import { ThemeToggle } from './components/theme-toggle';
import type { Activity, AuthMode, ModelResult, ProbeKey, ProbeResult, ThemeMode } from './components/types';

type RequestResult =
  | { ok: true; response: Response; body: Record<string, unknown>; url: string; firstByteMs: number; duration: number }
  | { ok: false; detail: string };

type DiscoveredModel = {
  id: string;
  ownedBy?: string;
  declaredContext?: number;
  contextField?: string;
};


const PIXEL_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAPElEQVR4nGOIKUilKWIYRhbIaKhQEY1aMGoB/Szo/7CfIBq1YNSCUQtGLaC1BWSjUQtGLaCJBTRCQ98CAGjOucqTgmxxAAAAAElFTkSuQmCC';

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

function modelEndpointCandidates(baseUrl: string) {
  const root = cleanBaseUrl(baseUrl);
  const candidates = endpointCandidates(root, '/models');
  if (/\/api$/i.test(root)) {
    candidates.push(`${root}/tags`);
  } else if (!/\/v\d+(?:\/|$)/i.test(root)) {
    candidates.push(`${root}/api/v1/models`, `${root}/api/tags`);
  }
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
  'contextLength',
  'context_window',
  'contextWindow',
  'context_window_size',
  'max_context_length',
  'maxContextLength',
  'max_model_len',
  'maxModelLen',
  'max_input_tokens',
  'maxInputTokens',
  'input_token_limit',
  'inputTokenLimit',
  'token_limit',
  'num_ctx',
  'numCtx',
] as const;

function numericContext(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.round(value);
  if (typeof value === 'string') {
    const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*([km])?(?:\s*tokens?)?$/i);
    if (!match) return undefined;
    const multiplier = match[2]?.toLowerCase() === 'm' ? 1_000_000 : match[2] ? 1_000 : 1;
    const parsed = Number(match[1]) * multiplier;
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : undefined;
  }
  return undefined;
}

function readDeclaredContext(item: Record<string, unknown>) {
  const sources: Array<{ record: Record<string, unknown>; prefix: string }> = [{ record: item, prefix: '' }];
  for (const key of ['metadata', 'model_info', 'details', 'limits', 'capabilities', 'parameters', 'config', 'options']) {
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

const MODEL_LIST_KEYS = ['data', 'models', 'results', 'items', 'model_list', 'modelList', 'available_models', 'availableModels', 'model_ids', 'modelIds'];

function modelItems(payload: unknown, depth = 0): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object' || depth > 2) return [];
  const record = payload as Record<string, unknown>;
  for (const key of MODEL_LIST_KEYS) {
    const candidate = record[key];
    if (Array.isArray(candidate)) return candidate;
    const nested = modelItems(candidate, depth + 1);
    if (nested.length) return nested;
  }
  const entries = Object.entries(record).filter(([key, value]) => !['error', 'message', 'detail', 'object'].includes(key) && value && typeof value === 'object' && !Array.isArray(value));
  if (entries.length) return entries.map(([key, value]) => ({ id: key, ...(value as Record<string, unknown>) }));
  return [];
}

function modelId(item: unknown) {
  if (typeof item === 'string') return item.trim();
  if (!item || typeof item !== 'object' || Array.isArray(item)) return '';
  const record = item as Record<string, unknown>;
  for (const key of ['id', 'model', 'model_id', 'modelId', 'name', 'model_name', 'modelName', 'slug']) {
    if (typeof record[key] === 'string' && record[key].trim()) return record[key].trim();
  }
  return '';
}

function extractModels(body: unknown): DiscoveredModel[] {
  const unique = new Map<string, DiscoveredModel>();
  for (const rawItem of modelItems(body)) {
    const id = modelId(rawItem);
    if (!id) continue;
    const item = rawItem && typeof rawItem === 'object' && !Array.isArray(rawItem) ? rawItem as Record<string, unknown> : {};
    const context = readDeclaredContext(item);
    if (!unique.has(id)) unique.set(id, {
      id,
      ownedBy: typeof item.owned_by === 'string' ? item.owned_by : typeof item.ownedBy === 'string' ? item.ownedBy : typeof item.provider === 'string' ? item.provider : undefined,
      declaredContext: context.value,
      contextField: context.field,
    });
  }
  return [...unique.values()];
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

export default function Home() {
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1');
  const [apiKey, setApiKey] = useState('');
  const [authModeValue, setAuthModeValue] = useState<AuthMode>('auto');
  const [manualModels, setManualModels] = useState('');
  const [deepScan, setDeepScan] = useState(false);
  const [maxModels, setMaxModels] = useState('12');
  const [models, setModels] = useState<ModelResult[]>([]);
  const [catalogTotal, setCatalogTotal] = useState(0);
  const [catalogOnly, setCatalogOnly] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState('等待接入');
  const [error, setError] = useState('');
  const [themeMode, setThemeMode] = useState<ThemeMode>('system');
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (themeMode === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', themeMode);
  }, [themeMode]);

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

  async function discoverModels(controller: AbortController): Promise<{ discovered: DiscoveredModel[]; endpoint: string }> {
    const urls = modelEndpointCandidates(baseUrl);
    const styles: Array<'openai' | 'anthropic'> = authModeValue === 'auto' ? ['openai', 'anthropic'] : ['openai'];
    let lastFailure = '无法识别模型列表';
    for (const style of styles) {
      for (const url of urls) {
        const result = await requestJson([url], { method: 'GET' }, authModeValue, apiKey, style, controller.signal);
        if (!result.ok) {
          lastFailure = result.detail;
          continue;
        }
        const discovered = extractModels(result.body);
        if (discovered.length) return { discovered, endpoint: result.url };
        lastFailure = `接口返回成功，但 ${url} 的响应中没有识别到模型条目`;
      }
    }

    const ids = manualModelIds(manualModels).map((id) => ({ id, ownedBy: undefined as string | undefined, declaredContext: undefined as number | undefined, contextField: undefined as string | undefined }));
    if (ids.length) return { discovered: ids, endpoint: '手动输入' };
    throw new Error(`${lastFailure}。已尝试 /models、/v1/models 及常见兼容路径；也可在“手动模型 ID”中填写模型。`);
  }

  function validateBaseUrl() {
    const trimmedBase = cleanBaseUrl(baseUrl);
    if (!trimmedBase) {
      setError('请先填写 API Base URL。');
      return undefined;
    }
    try {
      new URL(trimmedBase);
    } catch {
      setError('API Base URL 不是有效的网址。');
      return undefined;
    }
    return trimmedBase;
  }

  function applyModelCatalog(found: { discovered: DiscoveredModel[]; endpoint: string }, limitToMaxModels: boolean) {
    const limited = limitToMaxModels ? found.discovered.slice(0, Math.max(1, Number(maxModels) || 12)) : found.discovered;
    const initialModels = limited.map((item) => ({ id: item.id, ownedBy: item.ownedBy, declaredContext: item.declaredContext, contextField: item.contextField, family: familyForModel(item.id), probes: {} }));
    setCatalogTotal(found.discovered.length);
    setModels(initialModels);
    setSelectedModel(initialModels[0]?.id ?? null);
    return { initialModels, limited };
  }

  async function getModelList() {
    if (running) return;
    const trimmedBase = validateBaseUrl();
    if (!trimmedBase) return;

    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setError('');
    setModels([]);
    setCatalogTotal(0);
    setCatalogOnly(true);
    setSelectedModel(null);
    setActivities([]);
    setPhase('读取模型目录');
    addActivity('开始读取模型列表');

    try {
      const found = await discoverModels(controller);
      const { initialModels } = applyModelCatalog(found, false);
      addActivity(`获取到 ${found.discovered.length} 个模型 · ${found.endpoint}`, 'good');
      if (initialModels.length) setPhase('模型列表已获取');
      addActivity('模型列表获取完成，尚未发起能力测试', 'good');
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') {
        setPhase('已停止');
        addActivity('用户中止了模型列表获取');
      } else {
        const message = caught instanceof Error ? caught.message : '未知错误';
        setError(message);
        setPhase('获取中断');
        addActivity(message, 'bad');
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  async function runHealthCheck() {
    if (running) return;
    const trimmedBase = validateBaseUrl();
    if (!trimmedBase) return;

    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setError('');
    setModels([]);
    setCatalogTotal(0);
    setCatalogOnly(false);
    setSelectedModel(null);
    setActivities([]);
    setPhase('读取模型目录');
    addActivity('开始连接模型 API');

    try {
      const found = await discoverModels(controller);
      const { initialModels, limited } = applyModelCatalog(found, true);
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
        <div className="topbar-tools"><ThemeToggle value={themeMode} onChange={setThemeMode} /><div className="topbar-note"><span className="live-dot" /> 浏览器直连 · 密钥不落盘</div></div>
      </header>

      <section className="hero">
        <div>
          <div className="eyebrow accent">API 能力边界扫描器</div>
          <h1>先找到模型，<em>再知道它能做什么。</em></h1>
          <p>一次接入，先获取模型目录；再用快速或深度模式，探测文本、多模态、工具调用、流式输出，以及 Codex / Claude Code 所需的协议兼容性。</p>
        </div>
        <div className="hero-stamp"><span className="stamp-number">{summary.total ? String(summary.total).padStart(2, '0') : '—'}</span><span className="stamp-label">MODELS<br />IN SCOPE</span></div>
      </section>

      <div className="steps" aria-label="检测流程">
        <div className="step active"><span>01</span><strong>接入</strong><small>Base URL + Key</small></div><div className="step-line" />
        <div className={`step ${models.length ? 'active' : ''}`}><span>02</span><strong>发现</strong><small>/models catalog</small></div><div className="step-line" />
        <div className={`step ${summary.tested ? 'active' : ''}`}><span>03</span><strong>边界</strong><small>capability probes</small></div>
      </div>

      <section className="workspace">
        <ConfigPanel baseUrl={baseUrl} apiKey={apiKey} authModeValue={authModeValue} manualModels={manualModels} deepScan={deepScan} maxModels={maxModels} running={running} phase={phase} progress={progress} activities={activities} onBaseUrlChange={setBaseUrl} onApiKeyChange={setApiKey} onAuthModeChange={setAuthModeValue} onManualModelsChange={setManualModels} onDeepScanChange={setDeepScan} onMaxModelsChange={setMaxModels} onGetModelList={getModelList} onRunHealthCheck={runHealthCheck} onStopHealthCheck={stopHealthCheck} />
        <section className="results-column">
          <SummaryOverview summary={summary} />
          <ModelMatrix models={models} selectedId={selected?.id ?? null} deepScan={deepScan} catalogOnly={catalogOnly} catalogTotal={catalogTotal} maxModels={maxModels} summary={summary} error={error} onSelect={setSelectedModel} />
          {selected && <ModelReadout selected={selected} baseUrl={baseUrl} catalogOnly={catalogOnly} />}
        </section>
      </section>

      <footer><span>MODEL API COMPATIBILITY LAB</span><span>v0.1 · Client-side diagnostics · <a href="https://github.com/jielosc/model-api-compat-lab" target="_blank" rel="noreferrer">VIEW SOURCE ↗</a></span></footer>
    </main>
  );
}
