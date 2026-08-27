import type { ProbeKey } from './types';

export const PROBES: Array<{ key: ProbeKey; label: string; short: string; description: string }> = [
  { key: 'text', label: '文本对话', short: 'TEXT', description: 'Chat Completions 基础调用' },
  { key: 'vision', label: '多模态', short: 'VISION', description: '图像输入 + 文本输出' },
  { key: 'tools', label: '工具调用', short: 'TOOLS', description: 'Function / tool calling' },
  { key: 'json', label: '结构化输出', short: 'JSON', description: 'JSON mode / response_format' },
  { key: 'stream', label: '流式输出', short: 'STREAM', description: 'SSE streaming' },
  { key: 'responses', label: 'Codex / Responses', short: 'RESPONSES', description: 'OpenAI Responses API' },
  { key: 'claude', label: 'Claude Code', short: 'CLAUDE', description: 'Anthropic Messages API' },
];

export const QUICK_PROBE_KEYS: ProbeKey[] = ['text', 'stream'];
export const CHAT_PROBE_KEYS: ProbeKey[] = ['text', 'vision', 'tools', 'json', 'stream'];

export function probeKeysForMode(deepScan: boolean): ProbeKey[] {
  return deepScan ? PROBES.map((probe) => probe.key) : QUICK_PROBE_KEYS;
}
