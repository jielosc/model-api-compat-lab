'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ConfigPanel } from './components/config-panel';
import { ModelMatrix } from './components/model-matrix';
import { ModelReadout } from './components/model-readout';
import { PROBES, probeKeysForMode } from './components/probes';
import { SummaryOverview } from './components/summary-overview';
import { ThemeToggle } from './components/theme-toggle';
import type { Activity, AuthMode, ModelResult, ProbeKey, ProbeResult, ThemeMode } from './components/types';
import {
  classifyProbeFailure,
  copyText,
  downloadText,
  familyForModel,
  formatContext,
  loadSettings,
  saveSettings,
  shouldSkipProbe,
  skippedResult,
  statusLabel,
} from './components/model-utils';

type RequestResult =
  | { ok: true; response: Response; body: Record<string, unknown>; url: string; firstByteMs: number; duration: number }
  | { ok: false; detail: string };

type DiscoveredModel = {
  id: string;
  ownedBy?: string;
  declaredContext?: number;
  contextField?: string;
};

type ProgressScope = {
  ids: string[];
  keys: ProbeKey[];
};

const PIXEL_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAPElEQVR4nGOIKUilKWIYRhbIaKhQEY1aMGoB/Szo/7CfIBq1YNSCUQtGLaC1BWSjUQtGLaCJBTRCQ98CAGjOucqTgmxxAAAAAElFTkSuQmCC';

function nowLabel() {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date());
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      window.clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

function networkFailureMessage(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (!message || /failed to fetch|networkerror|load failed/i.test(message)) {
    return '网络请求失败，可能是 CORS 未放行或地址不可达。请确认目标 API 允许来自本站的跨域请求。';
  }
  return message;
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

function failedProbe(detail: string, duration: number, extra: Partial<ProbeResult> = {}): ProbeResult {
  const classified = classifyProbeFailure(detail);
  return { status: classified.status, reason: classified.reason, detail: detail.slice(0, 180), duration, ...extra };
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

function hasChatCompletion(body: Record<string, unknown>) {
  return Array.isArray(body.choices) && body.choices.length > 0;
}

function hasResponsesOutput(body: Record<string, unknown>) {
  return (Array.isArray(body.output) && body.output.length > 0) || (typeof body.output_text === 'string' && body.output_text.length > 0);
}

function hasClaudeContent(body: Record<string, unknown>) {
  return (Array.isArray(body.content) && body.content.length > 0) || (typeof body.content === 'string' && body.content.length > 0);
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
    let retried = false;
    while (true) {
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
        if (response.status === 429 && !retried) {
          retried = true;
          await sleep(1200, signal);
          continue;
        }
        if (response.status !== 404 && response.status !== 405) break;
        break;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        lastFailure = networkFailureMessage(error);
        break;
      }
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
        // Do not require stream_options here: many OpenAI-compatible gateways
        // support SSE but reject this optional usage-reporting parameter.
        const response = await fetch(url, { ...baseJsonInit({ model, messages: [{ role: 'user', content: '请用一句简短的话介绍自己。' }], max_tokens: 24, stream: true }), headers, signal });
        if (response.ok) {
          const reader = response.body?.getReader();
          if (!reader) {
            lastDetail = `${response.status} · 请求成功，但响应没有可读取的 SSE 内容`;
            continue;
          }
          let firstTokenElapsedMs: number | undefined;
          let outputTokens: number | undefined;
          let contentChars = 0;
          let sawSseData = false;
          let finished = false;
          const processLine = (line: string) => {
            if (!line.startsWith('data:')) return;
            const data = line.slice(5).trim();
            if (data === '[DONE]') {
              finished = true;
              return;
            }
            sawSseData = true;
            const payload = parseBody(data);
            const choices = Array.isArray(payload.choices) ? payload.choices : [];
            const delta = choices[0] && typeof choices[0] === 'object' ? (choices[0] as Record<string, unknown>).delta : undefined;
            const content = delta && typeof delta === 'object' ? (delta as Record<string, unknown>).content : undefined;
            if (typeof content === 'string' && content.length > 0) {
              firstTokenElapsedMs ??= performance.now() - started;
              contentChars += content.length;
            }
            const usage = payload.usage;
            if (usage && typeof usage === 'object') {
              const completionTokens = (usage as Record<string, unknown>).completion_tokens;
              if (typeof completionTokens === 'number') outputTokens = completionTokens;
            }
          };
          const decoder = new TextDecoder();
          let buffer = '';
          while (!finished) {
            const next = await reader.read();
            if (next.done) {
              buffer += decoder.decode();
              break;
            }
            buffer += decoder.decode(next.value, { stream: true });
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() ?? '';
            for (const line of lines) {
              processLine(line);
              if (finished) break;
            }
          }
          if (!finished && buffer.trim()) processLine(buffer);
          await reader.cancel();

          if (!sawSseData || contentChars === 0 || typeof firstTokenElapsedMs !== 'number') {
            return { status: 'warn', reason: 'partial', detail: `${Math.round(performance.now() - started)} ms · 请求成功，但没有收到可计量的文本流`, duration: Math.round(performance.now() - started), endpoint: url };
          }
          const duration = Math.round(performance.now() - started);
          const measuredFirstToken = Math.round(firstTokenElapsedMs);
          const generationMs = performance.now() - started - firstTokenElapsedMs;
          const hasReliableSpeedSample = generationMs >= 10;
          const generationSeconds = generationMs / 1000;
          const tokensPerSecond = hasReliableSpeedSample && outputTokens && outputTokens > 0 ? Number((outputTokens / generationSeconds).toFixed(1)) : undefined;
          const charsPerSecond = hasReliableSpeedSample ? Number((contentChars / generationSeconds).toFixed(1)) : undefined;
          const speedLabel = tokensPerSecond ? `${tokensPerSecond} tokens/s` : charsPerSecond ? `${charsPerSecond} chars/s` : '响应过短，暂无法稳定计算速度';
          return { status: 'pass', detail: `首字 ${measuredFirstToken} ms · ${speedLabel}`, duration, firstTokenMs: measuredFirstToken, tokensPerSecond, charsPerSecond, outputTokens, endpoint: url };
        }
        const raw = await response.text();
        lastDetail = `${response.status} · ${responseDetail(parseBody(raw), response.statusText || '请求失败')}`;
        if (response.status !== 404 && response.status !== 405) break;
      } catch (error) {
        if (isAbortError(error)) throw error;
        lastDetail = networkFailureMessage(error);
      }
    }
    return failedProbe(lastDetail, Math.round(performance.now() - started));
  }

  const duration = Math.round(performance.now() - started);
  if (result.ok) {
    if ((key === 'text' || key === 'vision' || key === 'json') && !hasChatCompletion(result.body)) {
      return { status: 'warn', reason: 'partial', detail: `${duration} ms · HTTP 成功，但响应结构中没有可识别的 choices`, duration, endpoint: result.url };
    }
    if (key === 'responses' && !hasResponsesOutput(result.body)) {
      return { status: 'warn', reason: 'partial', detail: `${duration} ms · HTTP 成功，但响应结构中没有可识别的 output`, duration, endpoint: result.url };
    }
    if (key === 'claude' && !hasClaudeContent(result.body)) {
      return { status: 'warn', reason: 'partial', detail: `${duration} ms · HTTP 成功，但响应结构中没有可识别的 content`, duration, endpoint: result.url };
    }
    if (key === 'tools') {
      const choices = Array.isArray(result.body?.choices) ? result.body.choices : [];
      const firstChoice = choices[0] as Record<string, unknown> | undefined;
      const message = firstChoice?.message as Record<string, unknown> | undefined;
      const toolCalls = message?.tool_calls;
      if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
        return { status: 'warn', reason: 'partial', detail: `${duration} ms · 请求被接受，但响应没有返回 tool_calls`, duration, endpoint: result.url };
      }
    }
    return { status: 'pass', detail: `${duration} ms · HTTP ${result.response?.status ?? 200}`, duration, endpoint: result.url };
  }
  return failedProbe(result.detail ?? '请求失败', duration);
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
  const [hydrated, setHydrated] = useState(false);
  const [progressScope, setProgressScope] = useState<ProgressScope | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const saved = loadSettings();
    if (typeof saved.baseUrl === 'string' && saved.baseUrl) setBaseUrl(saved.baseUrl);
    if (saved.authModeValue === 'auto' || saved.authModeValue === 'bearer' || saved.authModeValue === 'x-api-key' || saved.authModeValue === 'none') setAuthModeValue(saved.authModeValue);
    if (typeof saved.manualModels === 'string') setManualModels(saved.manualModels);
    if (typeof saved.deepScan === 'boolean') setDeepScan(saved.deepScan);
    if (typeof saved.maxModels === 'string' && saved.maxModels) setMaxModels(saved.maxModels);
    if (saved.themeMode === 'system' || saved.themeMode === 'light' || saved.themeMode === 'dark') setThemeMode(saved.themeMode);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveSettings({ baseUrl, authModeValue, manualModels, deepScan, maxModels, themeMode });
  }, [hydrated, baseUrl, authModeValue, manualModels, deepScan, maxModels, themeMode]);

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
      tested: allProbes.filter((probe) => probe?.status && probe.status !== 'running' && probe.status !== 'skipped').length,
      avgFirstToken: average(firstTokenValues),
      avgTokenSpeed: average(tokenSpeedValues),
      avgCharSpeed: average(charSpeedValues),
      avgTotalLatency: average(totalLatencyValues),
      performanceSamples: streamResults.length,
    };
  }, [models]);

  function addActivity(message: string, tone: Activity['tone'] = 'neutral') {
    setActivities((current) => [{ time: nowLabel(), message, tone }, ...current].slice(0, 12));
  }

  function updateModel(id: string, key: ProbeKey, probe: ProbeResult) {
    setModels((current) => current.map((model) => model.id === id ? { ...model, probes: { ...model.probes, [key]: probe } } : model));
  }

  async function probeOneModel(modelId: string, keys: ProbeKey[], trimmedBase: string, signal: AbortSignal) {
    let textResult: ProbeResult | undefined;
    for (const key of keys) {
      if (textResult && shouldSkipProbe(textResult, key)) {
        updateModel(modelId, key, skippedResult(textResult));
        continue;
      }
      updateModel(modelId, key, { status: 'running', detail: '请求中…' });
      let result: ProbeResult;
      try {
        result = await probeModel(trimmedBase, apiKey, authModeValue, modelId, key, signal);
      } catch (caught) {
        if (isAbortError(caught)) {
          updateModel(modelId, key, { status: 'skipped', reason: 'skipped', detail: '用户停止了本次探测' });
        }
        throw caught;
      }
      if (key === 'text') textResult = result;
      updateModel(modelId, key, result);
    }
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
    setProgressScope(null);
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
    setProgressScope(null);
    setActivities([]);
    setPhase('读取模型目录');
    addActivity('开始连接模型 API');

    try {
      const found = await discoverModels(controller);
      const probeKeys = probeKeysForMode(deepScan);
      const { initialModels, limited } = applyModelCatalog(found, true);
      setProgressScope({ ids: initialModels.map((model) => model.id), keys: probeKeys });
      addActivity(`发现 ${found.discovered.length} 个模型 · ${found.endpoint}`, 'good');
      if (found.discovered.length > limited.length) addActivity(`为控制请求量，本次先测试前 ${limited.length} 个模型`);

      for (let index = 0; index < initialModels.length; index += 1) {
        const model = initialModels[index];
        setPhase(`测试 ${index + 1}/${initialModels.length} · ${model.id}`);
        await probeOneModel(model.id, probeKeys, trimmedBase, controller.signal);
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

  async function testModel(id: string) {
    if (running) return;
    if (!models.some((model) => model.id === id)) return;
    const trimmedBase = validateBaseUrl();
    if (!trimmedBase) return;

    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setError('');
    setCatalogOnly(false);
    setSelectedModel(id);
    const probeKeys = probeKeysForMode(deepScan);
    setModels((current) => current.map((model) => model.id === id ? { ...model, probes: {} } : model));
    setProgressScope({ ids: [id], keys: probeKeys });
    setPhase(`测试 ${id}`);
    addActivity(`开始单独测试 ${id}`);

    try {
      await probeOneModel(id, probeKeys, trimmedBase, controller.signal);
      setPhase('单模型测试完成');
      addActivity(`${id} · 单独探测完成`, 'good');
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') {
        setPhase('已停止');
        addActivity('用户中止了单模型测试');
      } else {
        const message = caught instanceof Error ? caught.message : '未知错误';
        setError(message);
        setPhase('测试中断');
        addActivity(message, 'bad');
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  function reportPayload() {
    return {
      generatedAt: new Date().toISOString(),
      baseUrl: cleanBaseUrl(baseUrl),
      mode: catalogOnly ? 'catalog' : deepScan ? 'deep' : 'quick',
      catalogTotal,
      summary,
      models: models.map((model) => ({
        id: model.id,
        family: model.family,
        ownedBy: model.ownedBy,
        declaredContext: model.declaredContext,
        contextField: model.contextField,
        probes: model.probes,
      })),
    };
  }

  function exportJson() {
    if (!models.length) return;
    downloadText(`model-api-report-${Date.now()}.json`, JSON.stringify(reportPayload(), null, 2));
    addActivity('已导出 JSON 报告', 'good');
  }

  async function copyMarkdown() {
    if (!models.length) return;
    const payload = reportPayload();
    const lines = [
      '# 模型 API 体检报告',
      '',
      `- Base URL: \`${payload.baseUrl}\``,
      `- 模式: ${payload.mode}`,
      `- 时间: ${payload.generatedAt}`,
      `- 模型: ${payload.models.length} / 目录 ${payload.catalogTotal || payload.models.length}`,
      '',
    ];
    for (const model of payload.models) {
      lines.push(`## ${model.id}`);
      lines.push(`- 家族: ${model.family}${model.ownedBy ? ` · ${model.ownedBy}` : ''}`);
      lines.push(`- Context: ${formatContext(model.declaredContext)}${model.contextField ? ` (${model.contextField})` : ''}`);
      for (const probe of PROBES) {
        const result = model.probes[probe.key];
        lines.push(`- ${probe.short}: ${result ? `${statusLabel(result.status)} · ${result.detail}` : '未测'}`);
      }
      lines.push('');
    }
    const ok = await copyText(lines.join('\n'));
    addActivity(ok ? '已复制 Markdown 报告' : '复制失败，请检查剪贴板权限', ok ? 'good' : 'bad');
  }

  const progressTotal = progressScope ? progressScope.ids.length * progressScope.keys.length : 0;
  const progressCompleted = progressScope
    ? progressScope.ids.reduce((count, id) => {
      const model = models.find((item) => item.id === id);
      return count + (model ? progressScope.keys.filter((key) => {
        const status = model.probes[key]?.status;
        return Boolean(status) && status !== 'running';
      }).length : 0);
    }, 0)
    : 0;
  const progress = progressTotal ? Math.min(100, Math.round((progressCompleted / progressTotal) * 100)) : 0;

  return (
    <main className="app-shell" aria-busy={running}>
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
          <ModelMatrix models={models} selectedId={selected?.id ?? null} deepScan={deepScan} catalogOnly={catalogOnly} catalogTotal={catalogTotal} maxModels={maxModels} summary={summary} error={error} running={running} onSelect={setSelectedModel} onExportJson={exportJson} onCopyMarkdown={copyMarkdown} />
          {selected && <ModelReadout selected={selected} baseUrl={baseUrl} catalogOnly={catalogOnly} deepScan={deepScan} running={running} onTestModel={testModel} />}
        </section>
      </section>

      <footer><span>MODEL API COMPATIBILITY LAB</span><span>v0.2 · Client-side diagnostics · <a href="https://github.com/jielosc/model-api-compat-lab" target="_blank" rel="noreferrer">VIEW SOURCE ↗</a></span></footer>
    </main>
  );
}
