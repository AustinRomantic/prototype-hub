import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './material.js';

describe('material preview generation', () => {
  it('renders common markdown structures', () => {
    const html = renderMarkdown('# 标题\n\n- 后端\n- 前端');
    expect(html).toContain('<h1>标题</h1>');
    expect(html).toContain('<li>后端</li>');
  });
  it('removes dangerous markdown HTML and URLs', () => {
    const html = renderMarkdown('<script>alert(1)</script><p onclick="bad()">安全</p>[x](javascript:alert(1))');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('安全');
  });
});
