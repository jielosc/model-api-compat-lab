'use client';

import type { ThemeMode } from './types';

type ThemeToggleProps = {
  value: ThemeMode;
  onChange: (value: ThemeMode) => void;
};

export function ThemeToggle({ value, onChange }: ThemeToggleProps) {
  const options: Array<[ThemeMode, string, string]> = [
    ['system', '系统', '跟随系统外观'],
    ['light', '浅色', '使用浅色模式'],
    ['dark', '深色', '使用深色模式'],
  ];

  return (
    <div className="theme-toggle" role="radiogroup" aria-label="页面主题">
      {options.map(([mode, label, title]) => (
        <button key={mode} type="button" role="radio" className={value === mode ? 'selected' : ''} aria-label={title} aria-checked={value === mode} onClick={() => onChange(mode)}>
          {label}
        </button>
      ))}
    </div>
  );
}
