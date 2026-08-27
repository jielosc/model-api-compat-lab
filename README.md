# 模型 API 体检台

一个在浏览器中运行的模型 API 能力与兼容性探测工具。除真实能力探测外，还会从 `/models` 返回的元数据中读取模型声明的 Context（不发起额外请求）。

**在线预览：** <https://model-api-compat-lab.pages.dev/> · **源码：** <https://github.com/jielosc/model-api-compat-lab>

## 能力

- 读取 OpenAI-compatible / Anthropic-compatible API 的模型目录，并兼容常见的 `data`、`models`、`results`、`items` 返回格式
- 支持只获取模型列表，不发起能力测试请求
- 提供快速模式与深度模式，默认快速模式更省额度
- 探测文本、多模态、工具调用、JSON、流式输出
- 检查 OpenAI Responses API（Codex 兼容基础）和 Anthropic Messages API（Claude Code 兼容基础）
- 记录平均首字延迟、输出速度和完整响应耗时
- 支持系统默认、浅色、深色主题切换；Base URL、鉴权方案、扫描偏好会留在本机，API Key 不会
- 可筛选模型、单独复测、导出 JSON / 复制 Markdown 报告
- 文本调用若因鉴权、限流或网络失败，会跳过后续探测以节省额度
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
