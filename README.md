# 模型 API 体检台

一个在浏览器中运行的模型 API 能力与兼容性探测工具。

**在线预览：** <https://model-api-compat-lab.pages.dev/> · **源码：** <https://github.com/jielosc/model-api-compat-lab>

## 能力

- 读取 OpenAI-compatible / Anthropic-compatible API 的模型目录
- 探测文本、多模态、工具调用、JSON、流式输出
- 检查 OpenAI Responses API（Codex 兼容基础）和 Anthropic Messages API（Claude Code 兼容基础）
- 记录平均首字延迟、输出速度和完整响应耗时
- API Key 只存在当前浏览器页面内存中，不写入项目文件

## 本地运行

```bash
npm install
npm run dev
```

打开 <http://localhost:3000>。

## 说明

这是一个纯前端静态站点，探测请求从浏览器直接发往用户填写的 API。目标 API 需要允许来自站点域名的 CORS 请求。Codex / Claude Code 检查验证的是底层 API 协议，不等同于对 CLI 全部运行环境的完整验收。

## 构建

```bash
npm run build
```

构建结果位于 `dist/client`，可部署到 Cloudflare Pages 等静态托管平台。
