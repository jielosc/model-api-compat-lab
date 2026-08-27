export type ProbeKey = 'text' | 'vision' | 'tools' | 'json' | 'stream' | 'responses' | 'claude';
export type ProbeStatus = 'idle' | 'running' | 'pass' | 'warn' | 'fail';
export type AuthMode = 'auto' | 'bearer' | 'x-api-key' | 'none';
export type ThemeMode = 'system' | 'light' | 'dark';

export type ProbeResult = {
  status: ProbeStatus;
  detail: string;
  duration?: number;
  firstTokenMs?: number;
  tokensPerSecond?: number;
  charsPerSecond?: number;
  outputTokens?: number;
  endpoint?: string;
};

export type ModelResult = {
  id: string;
  ownedBy?: string;
  family: string;
  declaredContext?: number;
  contextField?: string;
  probes: Partial<Record<ProbeKey, ProbeResult>>;
};

export type Activity = {
  time: string;
  message: string;
  tone: 'neutral' | 'good' | 'bad';
};

export type Summary = {
  total: number;
  reachable: number;
  vision: number;
  code: number;
  passed: number;
  tested: number;
  avgFirstToken?: number;
  avgTokenSpeed?: number;
  avgCharSpeed?: number;
  avgTotalLatency?: number;
  performanceSamples: number;
};
