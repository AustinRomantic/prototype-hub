import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { config } from '@prototype-hub/config';
import type { VersionMaterial } from '@prototype-hub/db';
import { getObject, putObject } from '@prototype-hub/storage';

const execFileAsync = promisify(execFile);
const OFFICE_EXTENSIONS = new Set(['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx']);

async function bodyBuffer(body: unknown) {
  if (!body || typeof body !== 'object' || !('transformToByteArray' in body) || typeof body.transformToByteArray !== 'function') throw new Error('对象存储返回空内容');
  return Buffer.from(await body.transformToByteArray());
}

export function renderMarkdown(markdown: string) {
  const rendered = marked.parse(markdown, { async: false }) as string;
  const safe = sanitizeHtml(rendered, {
    allowedTags: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a'],
    allowedAttributes: { a: ['href', 'title'] },
    allowedSchemes: ['http', 'https', 'mailto']
  });
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{max-width:900px;margin:0 auto;padding:32px;color:#20293a;font:15px/1.75 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif}table{border-collapse:collapse;width:100%}th,td{border:1px solid #dfe3eb;padding:8px 10px;text-align:left}pre,code{background:#f3f4f8;border-radius:5px}pre{padding:14px;overflow:auto}code{padding:2px 4px}blockquote{margin:16px 0;padding:8px 16px;border-left:3px solid #6157e8;color:#667085;background:#f8f7ff}</style></head><body>${safe}</body></html>`;
}

async function withTempDirectory<T>(callback: (directory: string) => Promise<T>) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'prototype-material-'));
  try { return await callback(directory); }
  finally { await fs.rm(directory, { recursive: true, force: true }); }
}

async function extractPdfText(buffer: Buffer) {
  return withTempDirectory(async directory => {
    const input = path.join(directory, 'preview.pdf');
    await fs.writeFile(input, buffer);
    try {
      const { stdout } = await execFileAsync('pdftotext', [input, '-'], { timeout: config.MATERIAL_CONVERT_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 });
      return stdout.replace(/\s+/g, ' ').trim().slice(0, 2_000_000);
    } catch { return ''; }
  });
}

async function convertOfficeToPdf(source: Buffer, extension: string) {
  return withTempDirectory(async directory => {
    const input = path.join(directory, `source${extension}`);
    const profile = path.join(directory, 'profile');
    await fs.writeFile(input, source);
    await execFileAsync('soffice', [
      '--headless', '--nologo', '--nodefault', '--norestore', '--nolockcheck',
      `-env:UserInstallation=file://${profile}`,
      '--convert-to', 'pdf', '--outdir', directory, input
    ], { timeout: config.MATERIAL_CONVERT_TIMEOUT_MS, maxBuffer: 1024 * 1024 });
    const output = path.join(directory, 'source.pdf');
    const pdf = await fs.readFile(output).catch(() => { throw new Error('LibreOffice 未生成预览 PDF'); });
    if (!pdf.subarray(0, 4).equals(Buffer.from('%PDF'))) throw new Error('生成的预览 PDF 无效');
    if (pdf.byteLength > config.EXTRACTED_MAX_BYTES) throw new Error('生成的预览文件过大');
    return { pdf, extractedText: await extractPdfText(pdf) };
  });
}

export async function processMaterial(material: VersionMaterial) {
  const source = await bodyBuffer((await getObject(material.sourceKey)).Body);
  const extension = material.extension.toLowerCase();
  if (material.previewKind === 'IMAGE') return { previewKey: material.sourceKey, extractedText: '' };
  if (extension === '.txt') return { previewKey: material.sourceKey, extractedText: source.toString('utf8').replace(/\s+/g, ' ').trim().slice(0, 2_000_000) };
  if (extension === '.md') {
    const previewKey = `${path.posix.dirname(material.sourceKey)}/preview.html`;
    const markdown = source.toString('utf8');
    await putObject(previewKey, renderMarkdown(markdown), 'text/html; charset=utf-8');
    return { previewKey, extractedText: markdown.replace(/[#*_>`~\[\]()!-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2_000_000) };
  }
  if (extension === '.pdf') return { previewKey: material.sourceKey, extractedText: await extractPdfText(source) };
  if (OFFICE_EXTENSIONS.has(extension)) {
    const { pdf, extractedText } = await convertOfficeToPdf(source, extension);
    const previewKey = `${path.posix.dirname(material.sourceKey)}/preview.pdf`;
    await putObject(previewKey, pdf, 'application/pdf');
    return { previewKey, extractedText };
  }
  throw new Error('不支持该材料预览格式');
}
