import { describe, expect, it } from 'vitest';
import { containsOfficeMacro, ensureMaterialExtension, nextAvailableMaterialName, normalizeMaterialTags, validateMaterialFile } from './material.js';

describe('material validation', () => {
  it('validates supported signatures and UTF-8 text', () => {
    expect(validateMaterialFile('spec.pdf', Buffer.from('%PDF-1.7')).previewKind).toBe('PDF');
    expect(validateMaterialFile('说明.txt', Buffer.from('中文说明')).previewKind).toBe('TEXT');
    expect(validateMaterialFile('sheet.xlsx', Buffer.from('504b0304', 'hex')).office).toBe(true);
  });
  it('rejects disguised and binary text files', () => {
    expect(() => validateMaterialFile('fake.pdf', Buffer.from('not pdf'))).toThrow('签名');
    expect(() => validateMaterialFile('fake.pdf', Buffer.from('%PDF-1.7'), 'image/png')).toThrow('MIME');
    expect(() => validateMaterialFile('bad.txt', Buffer.from([0, 1, 2]))).toThrow('二进制');
    expect(() => validateMaterialFile('macro.docm', Buffer.from('504b0304', 'hex'))).toThrow('宏');
    expect(() => validateMaterialFile('run.exe', Buffer.from('x'))).toThrow('不支持');
  });
  it('rejects macro content even after an Office file is renamed', () => {
    const renamedOoxml = Buffer.concat([Buffer.from('504b0304', 'hex'), Buffer.from('word/vbaProject.bin')]);
    expect(containsOfficeMacro(renamedOoxml, '.docx')).toBe(true);
    expect(() => validateMaterialFile('renamed.docx', renamedOoxml)).toThrow('宏');
    const legacy = Buffer.alloc(640);
    Buffer.from('d0cf11e0a1b11ae1', 'hex').copy(legacy);
    Buffer.from('VBA\0', 'utf16le').copy(legacy, 512);
    legacy.writeUInt16LE(8, 512 + 64);
    legacy[512 + 66] = 1;
    expect(containsOfficeMacro(legacy, '.doc')).toBe(true);
    expect(() => validateMaterialFile('renamed.doc', legacy)).toThrow('宏');
  });
  it('keeps extensions and resolves duplicate names', () => {
    expect(ensureMaterialExtension('接口方案.DOCX', '.docx')).toBe('接口方案.DOCX');
    expect(() => ensureMaterialExtension('接口方案.pdf', '.docx')).toThrow('扩展名');
    expect(nextAvailableMaterialName('方案.pdf', ['方案.pdf', '方案 (2).pdf'])).toBe('方案 (3).pdf');
  });
  it('normalizes and limits tags', () => {
    expect(normalizeMaterialTags('后端, API, 后端')).toEqual(['后端', 'API']);
    expect(normalizeMaterialTags(Array(12).fill('tag').map((tag, index) => `${tag}${index}`).join(','))).toHaveLength(10);
  });
});
