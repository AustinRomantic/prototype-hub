import path from 'node:path';
import AdmZip from 'adm-zip';

export type PrototypeFile = { name: string; data: Buffer };
export type ArchiveLimits = { maxFiles: number; maxExtractedBytes: number };

export function normalizeArchiveEntry(rawName: string) {
  const portable = rawName.replaceAll('\\', '/');
  if (!portable || portable.includes('\0') || portable.startsWith('/') || /^[A-Za-z]:/.test(portable)) throw new Error(`非法文件路径: ${rawName}`);
  const segments = portable.split('/');
  if (segments.some(segment => segment === '..' || segment === '')) throw new Error(`非法文件路径: ${rawName}`);
  const normalized = path.posix.normalize(portable).replace(/^\.\//, '');
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.startsWith('.git/')) throw new Error(`非法文件路径: ${rawName}`);
  if (/\.(php|sh|exe|bin|cgi|pl)$/i.test(normalized)) throw new Error(`禁止的可执行文件: ${rawName}`);
  return normalized;
}

function isSymlink(entry: AdmZip.IZipEntry) {
  const unixMode = (entry.header.attr >>> 16) & 0xffff;
  return (unixMode & 0o170000) === 0o120000;
}

export function isZip(source: Buffer) {
  const signature = source.subarray(0, 4).toString('hex');
  return signature === '504b0304' || signature === '504b0506' || signature === '504b0708';
}

export function unpackPrototype(source: Buffer, entryPath: string, limits: ArchiveLimits): PrototypeFile[] {
  const normalizedEntry = normalizeArchiveEntry(entryPath);
  if (!isZip(source)) {
    const sample = source.subarray(0, Math.min(source.length, 8192)).toString('utf8');
    if (!/<(?:!doctype\s+html|html|head|body)\b/i.test(sample)) throw new Error('文件不是有效的 HTML 或 ZIP 原型');
    if (source.byteLength > limits.maxExtractedBytes) throw new Error(`文件大小超过 ${limits.maxExtractedBytes} bytes`);
    return [{ name: normalizedEntry, data: source }];
  }

  const entries = new AdmZip(source).getEntries().filter(entry => !entry.isDirectory);
  if (entries.length > limits.maxFiles) throw new Error(`文件数量超过 ${limits.maxFiles} 限制`);
  let extractedBytes = 0;
  const files = entries.map(entry => {
    if (isSymlink(entry)) throw new Error(`禁止的符号链接: ${entry.entryName}`);
    const name = normalizeArchiveEntry(entry.entryName);
    extractedBytes += Number(entry.header.size);
    if (extractedBytes > limits.maxExtractedBytes) throw new Error(`解压后大小超过 ${limits.maxExtractedBytes} bytes`);
    const data = entry.getData();
    if (data.byteLength !== Number(entry.header.size)) throw new Error(`ZIP 文件大小校验失败: ${entry.entryName}`);
    return { name, data };
  });
  if (!files.some(file => file.name === normalizedEntry)) throw new Error(`入口文件不存在: ${normalizedEntry}`);
  return files;
}

export function extractHtmlText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}
