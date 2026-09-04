import AdmZip from 'adm-zip';
import { describe, expect, it } from 'vitest';
import { extractHtmlText, normalizeArchiveEntry, unpackPrototype } from './archive.js';

const limits = { maxFiles: 5, maxExtractedBytes: 1024 * 1024 };

describe('archive validation', () => {
  it('accepts a standalone HTML file', () => {
    const files = unpackPrototype(Buffer.from('<!doctype html><html><body>Hello</body></html>'), 'index.html', limits);
    expect(files[0]?.name).toBe('index.html');
  });

  it('accepts a ZIP with an entry file', () => {
    const zip = new AdmZip();
    zip.addFile('index.html', Buffer.from('<html>Prototype</html>'));
    zip.addFile('assets/app.js', Buffer.from('console.log(1)'));
    expect(unpackPrototype(zip.toBuffer(), 'index.html', limits)).toHaveLength(2);
  });

  it('rejects a ZIP without the requested entry file', () => {
    const zip = new AdmZip();
    zip.addFile('other.html', Buffer.from('<html></html>'));
    expect(() => unpackPrototype(zip.toBuffer(), 'index.html', limits)).toThrow('入口文件不存在');
  });

  it.each(['../secret', '/absolute', 'C:\\secret', 'a//b', 'run.sh'])('rejects unsafe entry %s', entry => {
    expect(() => normalizeArchiveEntry(entry)).toThrow();
  });
});

it('extracts visible text without scripts and styles', () => {
  expect(extractHtmlText('<style>.x{}</style><h1>Hello &amp; 世界</h1><script>bad()</script>')).toBe('Hello & 世界');
});
