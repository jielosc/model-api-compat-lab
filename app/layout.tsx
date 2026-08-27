import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '模型 API 体检台 · Model API Compatibility Lab',
  description: '发现模型并探测文本、多模态、工具调用、流式输出以及 Codex / Claude Code 协议兼容性。',
  icons: { icon: '/favicon.svg' },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
