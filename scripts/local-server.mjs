#!/usr/bin/env node

import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = resolve(SCRIPT_DIR, '../dist/client');
const HOST = '127.0.0.1';
const PORT = Number.parseInt(process.env.MODEL_API_LAB_PORT || '4173', 10);
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const PROXY_PATH = '/__model_api_proxy';
const LOCAL_MARKER = '<script>window.__MODEL_API_LOCAL_PROXY__=true;</script>';

const MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.rsc', 'text/x-component; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
  ['.woff2', 'font/woff2'],
]);

const FORWARDED_REQUEST_HEADERS = [
  'accept',
  'anthropic-version',
  'authorization',
  'content-type',
  'x-api-key',
];

const FORWARDED_RESPONSE_HEADERS = [
  'content-type',
  'retry-after',
  'x-request-id',
];

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(body);
}

function acceptedHost(request) {
  const host = request.headers.host?.toLowerCase();
  return host === `${HOST}:${PORT}` || host === `localhost:${PORT}` ? host : undefined;
}

async function readRequestBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('REQUEST_BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

async function proxyRequest(request, response, requestUrl, host) {
  const expectedOrigin = `http://${host}`;
  const origin = request.headers.origin;
  if (request.headers['x-model-api-local'] !== '1' || (origin && origin !== expectedOrigin)) {
    sendJson(response, 403, { error: { message: '本地助手拒绝了非同源请求' } });
    return;
  }

  const targetValue = requestUrl.searchParams.get('url');
  let target;
  try {
    target = new URL(targetValue || '');
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) throw new Error('invalid');
  } catch {
    sendJson(response, 400, { error: { message: '目标 API URL 无效' } });
    return;
  }

  let body;
  try {
    body = await readRequestBody(request);
  } catch (error) {
    if (error instanceof Error && error.message === 'REQUEST_BODY_TOO_LARGE') {
      sendJson(response, 413, { error: { message: '请求体超过本地助手的 4 MB 限制' } });
      return;
    }
    throw error;
  }

  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers[name];
    if (typeof value === 'string') headers.set(name, value);
  }

  let upstream;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : body,
      redirect: 'follow',
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    const detail = error instanceof Error && error.name === 'TimeoutError'
      ? '本地助手连接目标 API 超时（60 秒）'
      : '本地助手无法连接目标 API，请检查地址、DNS 或 TLS';
    sendJson(response, 502, { error: { message: detail } });
    return;
  }

  const responseHeaders = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders[name] = value;
  }
  response.writeHead(upstream.status, responseHeaders);
  if (!upstream.body || request.method === 'HEAD') {
    response.end();
    return;
  }
  Readable.fromWeb(upstream.body).pipe(response);
}

async function serveStatic(request, response, requestUrl) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendJson(response, 405, { error: { message: 'Method Not Allowed' } });
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(requestUrl.pathname);
  } catch {
    sendJson(response, 400, { error: { message: 'Bad Request' } });
    return;
  }
  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  let filePath = resolve(SITE_ROOT, `.${requestedPath}`);
  if (filePath !== SITE_ROOT && !filePath.startsWith(`${SITE_ROOT}${sep}`)) {
    sendJson(response, 403, { error: { message: 'Forbidden' } });
    return;
  }

  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = resolve(filePath, 'index.html');
  } catch {
    filePath = resolve(SITE_ROOT, '404.html');
  }

  const type = MIME_TYPES.get(extname(filePath).toLowerCase()) || 'application/octet-stream';
  const headers = {
    'Content-Type': type,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cache-Control': filePath.endsWith('.html') ? 'no-store' : 'public, max-age=3600',
  };
  response.writeHead(filePath.endsWith('404.html') ? 404 : 200, headers);
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  if (filePath.endsWith('.html')) {
    const html = await readFile(filePath, 'utf8');
    response.end(html.replace('</head>', `${LOCAL_MARKER}</head>`));
    return;
  }
  createReadStream(filePath).pipe(response);
}

const server = createServer(async (request, response) => {
  const host = acceptedHost(request);
  if (!host) {
    sendJson(response, 403, { error: { message: '本地助手拒绝了未知 Host' } });
    return;
  }
  try {
    const requestUrl = new URL(request.url || '/', `http://${host}`);
    if (requestUrl.pathname === PROXY_PATH) await proxyRequest(request, response, requestUrl, host);
    else await serveStatic(request, response, requestUrl);
  } catch {
    if (!response.headersSent) sendJson(response, 500, { error: { message: '本地助手发生内部错误' } });
    else response.destroy();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n模型 API 体检台（本地助手模式）`);
  console.log(`打开：http://${HOST}:${PORT}`);
  console.log('按 Ctrl+C 停止。API Key 和请求不会经过公共代理。\n');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
