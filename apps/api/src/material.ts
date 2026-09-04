import path from 'node:path';
import type { MaterialPreviewKind } from '@prototype-hub/db';

type MaterialDefinition = {
  previewKind: MaterialPreviewKind;
  contentType: string;
  mimeTypes: string[];
  signatures: string[];
  office?: boolean;
  text?: boolean;
};

const ZIP_SIGNATURES = ['504b0304', '504b0506', '504b0708'];
const OLE_SIGNATURE = 'd0cf11e0a1b11ae1';
const LEGACY_MACRO_STREAMS = new Set(['vba', 'macros', '_vba_project', 'project', 'projectwm']);

export const MATERIAL_DEFINITIONS: Record<string, MaterialDefinition> = {
  '.pdf': { previewKind: 'PDF', contentType: 'application/pdf', mimeTypes: ['application/pdf'], signatures: ['25504446'] },
  '.png': { previewKind: 'IMAGE', contentType: 'image/png', mimeTypes: ['image/png'], signatures: ['89504e470d0a1a0a'] },
  '.jpg': { previewKind: 'IMAGE', contentType: 'image/jpeg', mimeTypes: ['image/jpeg'], signatures: ['ffd8ff'] },
  '.jpeg': { previewKind: 'IMAGE', contentType: 'image/jpeg', mimeTypes: ['image/jpeg'], signatures: ['ffd8ff'] },
  '.webp': { previewKind: 'IMAGE', contentType: 'image/webp', mimeTypes: ['image/webp'], signatures: ['52494646'] },
  '.md': { previewKind: 'TEXT', contentType: 'text/markdown; charset=utf-8', mimeTypes: ['text/markdown', 'text/plain'], signatures: [], text: true },
  '.txt': { previewKind: 'TEXT', contentType: 'text/plain; charset=utf-8', mimeTypes: ['text/plain'], signatures: [], text: true },
  '.docx': { previewKind: 'PDF', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'], signatures: ZIP_SIGNATURES, office: true },
  '.xlsx': { previewKind: 'PDF', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', mimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], signatures: ZIP_SIGNATURES, office: true },
  '.pptx': { previewKind: 'PDF', contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', mimeTypes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'], signatures: ZIP_SIGNATURES, office: true },
  '.doc': { previewKind: 'PDF', contentType: 'application/msword', mimeTypes: ['application/msword'], signatures: [OLE_SIGNATURE], office: true },
  '.xls': { previewKind: 'PDF', contentType: 'application/vnd.ms-excel', mimeTypes: ['application/vnd.ms-excel'], signatures: [OLE_SIGNATURE], office: true },
  '.ppt': { previewKind: 'PDF', contentType: 'application/vnd.ms-powerpoint', mimeTypes: ['application/vnd.ms-powerpoint'], signatures: [OLE_SIGNATURE], office: true }
};

export type ValidatedMaterial = MaterialDefinition & { extension: string };

export function containsOfficeMacro(buffer: Buffer, extension: string) {
  if (['.docx', '.xlsx', '.pptx'].includes(extension)) {
    const archiveNames = buffer.toString('latin1').toLowerCase();
    return archiveNames.includes('vbaproject.bin') || archiveNames.includes('macroenabled') || archiveNames.includes('vnd.ms-office.vbaproject');
  }
  if (!['.doc', '.xls', '.ppt'].includes(extension)) return false;
  // OLE compound-file directory entries are 128-byte aligned within 512-byte sectors.
  // Inspecting entry names avoids treating ordinary document text containing “VBA” as a macro.
  for (let offset = 512; offset + 128 <= buffer.length; offset += 128) {
    const entryType = buffer[offset + 66];
    const nameBytes = buffer.readUInt16LE(offset + 64);
    if (![1, 2, 5].includes(entryType) || nameBytes < 2 || nameBytes > 64 || nameBytes % 2 !== 0) continue;
    const name = buffer.subarray(offset, offset + nameBytes - 2).toString('utf16le').toLowerCase();
    if (LEGACY_MACRO_STREAMS.has(name)) return true;
  }
  return false;
}

export function validateMaterialFile(filename: string, buffer: Buffer, uploadedMimeType?: string): ValidatedMaterial {
  const extension = path.extname(filename).toLowerCase();
  if (/\.(docm|dotm|xlsm|xltm|xlam|pptm|potm|ppam|ppsm)$/i.test(filename)) throw new Error('不支持包含宏的 Office 文件');
  const definition = MATERIAL_DEFINITIONS[extension];
  if (!definition) throw new Error('不支持该材料格式');
  const normalizedMimeType = uploadedMimeType?.split(';', 1)[0]?.trim().toLowerCase();
  if (normalizedMimeType && normalizedMimeType !== 'application/octet-stream' && !definition.mimeTypes.includes(normalizedMimeType)) {
    throw new Error('文件扩展名与 MIME 类型不一致');
  }
  if (definition.text) {
    if (buffer.includes(0)) throw new Error('文本文件包含二进制内容');
    try { new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
    catch { throw new Error('文本文件必须使用 UTF-8 编码'); }
  } else if (!definition.signatures.some(signature => buffer.subarray(0, signature.length / 2).toString('hex') === signature)) {
    throw new Error('文件扩展名与内容签名不一致');
  }
  if (extension === '.webp' && buffer.subarray(8, 12).toString('ascii') !== 'WEBP') throw new Error('WebP 文件签名无效');
  if (definition.office && containsOfficeMacro(buffer, extension)) throw new Error('不支持包含宏的 Office 文件');
  return { extension, ...definition };
}

export function normalizeMaterialTags(raw: string) {
  const values = raw.split(',').map(value => value.trim()).filter(Boolean);
  return [...new Set(values)].slice(0, 10).map(value => Array.from(value).slice(0, 30).join(''));
}

export function ensureMaterialExtension(displayName: string, extension: string) {
  const cleaned = displayName.trim();
  if (!cleaned || Array.from(cleaned).length > 180) throw new Error('材料名称长度应为 1-180 个字符');
  if (path.extname(cleaned).toLowerCase() !== extension) throw new Error(`材料名称必须保留 ${extension} 扩展名`);
  return cleaned;
}

export function nextAvailableMaterialName(originalName: string, existingNames: string[]) {
  const lowered = new Set(existingNames.map(name => name.toLocaleLowerCase()));
  if (!lowered.has(originalName.toLocaleLowerCase())) return originalName;
  const extension = path.extname(originalName);
  const base = originalName.slice(0, -extension.length);
  let index = 2;
  while (lowered.has(`${base} (${index})${extension}`.toLocaleLowerCase())) index += 1;
  return `${base} (${index})${extension}`;
}
