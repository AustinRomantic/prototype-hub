'use client';

import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { versionStatusLabel, type VersionBaseline } from '@prototype-hub/contracts';
import { VersionBaselineInfo } from '../../components/version-baseline';
import { RichTextEditor } from '../../components/rich-text-editor';

type Category = 'PRODUCT' | 'DATA' | 'BACKEND' | 'FRONTEND' | 'TEST' | 'DESIGN' | 'OTHER';
type Material = {
  id: string;
  category: Category;
  displayName: string;
  originalFileName: string;
  extension: string;
  mimeType: string;
  previewKind: 'IMAGE' | 'PDF' | 'TEXT';
  status: 'PROCESSING' | 'READY' | 'FAILED';
  sizeBytes: number;
  tags: string[];
  errorMessage?: string | null;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  previewUrl: string;
  downloadUrl: string;
};
type Workspace = VersionBaseline & {
  id: string;
  versionNo: number;
  status: string;
  sourceFileName?: string | null;
  note: string;
  changeContent: string;
  createdAt: string;
  previewFor?: { id: string } | null;
  releaseFor?: { id: string } | null;
  asset: {
    id: string;
    name: string;
    previewVersionId?: string | null;
    releaseVersionId?: string | null;
    project: { id: string; name: string };
  };
  stats: { activeCount: number; trashCount: number; totalCount: number; totalBytes: number };
};
type UploadItem = { key: string; file: File; state: 'WAITING' | 'UPLOADING' | 'SUCCESS' | 'FAILED'; error?: string };

const CATEGORIES: Array<{ value: Category; label: string }> = [
  { value: 'PRODUCT', label: '产品' }, { value: 'DATA', label: '数据' }, { value: 'BACKEND', label: '后端' },
  { value: 'FRONTEND', label: '前端' }, { value: 'TEST', label: '测试' }, { value: 'DESIGN', label: '设计' }, { value: 'OTHER', label: '其他' }
];
const ACCEPTED = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.webp,.md,.txt';

const categoryLabel = (category: Category) => CATEGORIES.find(item => item.value === category)?.label || '其他';
const statusLabel = versionStatusLabel;
const formatBytes = (bytes: number) => bytes === 0 ? '0 B' : bytes < 1024 ? `${bytes} B` : bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
const fileIcon = (extension: string) => extension === '.pdf' ? 'PDF' : ['.doc', '.docx'].includes(extension) ? 'W' : ['.xls', '.xlsx'].includes(extension) ? 'X' : ['.ppt', '.pptx'].includes(extension) ? 'P' : ['.png', '.jpg', '.jpeg', '.webp'].includes(extension) ? '图' : extension === '.md' ? 'M' : 'T';

export default function VersionWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [trash, setTrash] = useState(false);
  const [category, setCategory] = useState<'ALL' | Category>('ALL');
  const [tag, setTag] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'latest' | 'oldest' | 'name'>('latest');
  const [uploadCategory, setUploadCategory] = useState<Category>('OTHER');
  const [uploadTags, setUploadTags] = useState('');
  const [uploadItems, setUploadItems] = useState<UploadItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [selectedMaterial, setSelectedMaterial] = useState<Material | null>(null);
  const [editMaterial, setEditMaterial] = useState<Material | null>(null);
  const [editName, setEditName] = useState('');
  const [editCategory, setEditCategory] = useState<Category>('OTHER');
  const [editTags, setEditTags] = useState('');
  const [editError, setEditError] = useState('');
  const [savingMaterial, setSavingMaterial] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);
  const [manageVersionOpen, setManageVersionOpen] = useState(false);
  const [versionNote, setVersionNote] = useState('');
  const [versionChange, setVersionChange] = useState('');
  const [versionError, setVersionError] = useState('');
  const [savingVersion, setSavingVersion] = useState(false);

  const loadWorkspace = async () => {
    const response = await fetch(`/api/v1/versions/${id}/workspace`, { credentials: 'include' });
    if (response.status === 401) { window.location.href = '/login'; return; }
    if (!response.ok) { setMessage((await response.json()).error || '版本空间加载失败'); setLoading(false); return; }
    setWorkspace(await response.json());
    setLoading(false);
  };

  const loadMaterials = async () => {
    const params = new URLSearchParams({ trash: String(trash), sort });
    if (category !== 'ALL') params.set('category', category);
    if (tag.trim()) params.set('tag', tag.trim());
    if (query.trim()) params.set('q', query.trim());
    const response = await fetch(`/api/v1/versions/${id}/materials?${params}`, { credentials: 'include' });
    if (!response.ok) return;
    const rows = await response.json() as Material[];
    setMaterials(rows);
    setSelectedMaterial(current => current ? rows.find(item => item.id === current.id) || current : null);
    const requestedMaterial = new URLSearchParams(window.location.search).get('material');
    if (requestedMaterial) setSelectedMaterial(current => current || rows.find(item => item.id === requestedMaterial) || null);
  };

  useEffect(() => { loadWorkspace(); }, [id]);
  useEffect(() => { loadMaterials(); }, [id, trash, category, tag, query, sort]);
  useEffect(() => {
    const timer = window.setInterval(() => { loadWorkspace(); loadMaterials(); }, 3000);
    return () => window.clearInterval(timer);
  }, [id, trash, category, tag, query, sort]);
  useEffect(() => {
    if (!selectedMaterial && !changeOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { setSelectedMaterial(null); setChangeOpen(false); } };
    document.addEventListener('keydown', close);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', close); document.body.style.overflow = ''; };
  }, [selectedMaterial, changeOpen]);

  const chooseFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    setUploadItems(files.map((file, index) => ({ key: `${file.name}-${file.size}-${index}`, file, state: 'WAITING' })));
  };

  const uploadAll = async () => {
    if (!uploadItems.length || uploading) return;
    setUploading(true);
    let cursor = 0;
    let succeeded = 0;
    let failed = 0;
    const runNext = async () => {
      while (cursor < uploadItems.length) {
        const index = cursor++;
        const item = uploadItems[index]!;
        if (item.state === 'SUCCESS') continue;
        setUploadItems(current => current.map((value, itemIndex) => itemIndex === index ? { ...value, state: 'UPLOADING', error: undefined } : value));
        const body = new FormData();
        body.append('category', uploadCategory);
        body.append('tags', uploadTags);
        body.append('file', item.file);
        try {
          const response = await fetch(`/api/v1/versions/${id}/materials`, { method: 'POST', body, credentials: 'include' });
          if (!response.ok) throw new Error((await response.json()).error || '上传失败');
          succeeded += 1;
          setUploadItems(current => current.map((value, itemIndex) => itemIndex === index ? { ...value, state: 'SUCCESS' } : value));
        } catch (error) {
          failed += 1;
          setUploadItems(current => current.map((value, itemIndex) => itemIndex === index ? { ...value, state: 'FAILED', error: error instanceof Error ? error.message : '上传失败' } : value));
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, uploadItems.length) }, runNext));
    setUploading(false);
    setMessage(`本次 ${succeeded} 个原件已保存，${failed} 个上传失败。已保存项不会重复上传，预览状态见材料列表。`);
    await Promise.all([loadWorkspace(), loadMaterials()]);
  };

  const openEditMaterial = (material: Material) => {
    setEditMaterial(material); setEditName(material.displayName); setEditCategory(material.category); setEditTags(material.tags.join(', ')); setEditError('');
  };

  const saveMaterial = async (event: FormEvent) => {
    event.preventDefault();
    if (!editMaterial) return;
    setSavingMaterial(true); setEditError('');
    const response = await fetch(`/api/v1/materials/${editMaterial.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ displayName: editName, category: editCategory, tags: editTags.split(',').map(value => value.trim()).filter(Boolean) })
    });
    setSavingMaterial(false);
    if (!response.ok) { setEditError((await response.json()).error || '保存失败'); return; }
    const updated = await response.json() as Material;
    setEditMaterial(null); setSelectedMaterial(updated); setMessage('材料信息已更新。'); await loadMaterials();
  };

  const moveToTrash = async (material: Material) => {
    if (!window.confirm(`将“${material.displayName}”移入回收站？30 天内可以恢复。`)) return;
    const response = await fetch(`/api/v1/materials/${material.id}`, { method: 'DELETE', credentials: 'include' });
    if (!response.ok) { setMessage((await response.json()).error || '删除失败'); return; }
    setSelectedMaterial(null); setMessage('材料已移入回收站。'); await Promise.all([loadWorkspace(), loadMaterials()]);
  };

  const restore = async (material: Material) => {
    const response = await fetch(`/api/v1/materials/${material.id}/restore`, { method: 'POST', credentials: 'include' });
    if (!response.ok) { setMessage((await response.json()).error || '恢复失败'); return; }
    setSelectedMaterial(null); setMessage('材料已恢复。'); await Promise.all([loadWorkspace(), loadMaterials()]);
  };

  const purge = async (material: Material) => {
    if (!window.confirm(`永久删除“${material.displayName}”？原文件和预览都将无法恢复。`)) return;
    const response = await fetch(`/api/v1/materials/${material.id}/permanent`, { method: 'DELETE', credentials: 'include' });
    if (!response.ok) { setMessage((await response.json()).error || '永久删除失败'); return; }
    setSelectedMaterial(null); setMessage('材料已永久删除。'); await Promise.all([loadWorkspace(), loadMaterials()]);
  };

  const retry = async (material: Material) => {
    const response = await fetch(`/api/v1/materials/${material.id}/retry-preview`, { method: 'POST', credentials: 'include' });
    if (!response.ok) { setMessage((await response.json()).error || '重试失败'); return; }
    setMessage('已重新提交预览生成任务。'); await loadMaterials();
  };

  const openVersionManager = () => {
    if (!workspace) return;
    setVersionNote(workspace.note); setVersionChange(workspace.changeContent || ''); setVersionError(''); setManageVersionOpen(true);
  };

  const saveVersion = async (event: FormEvent) => {
    event.preventDefault(); setSavingVersion(true); setVersionError('');
    const response = await fetch(`/api/v1/versions/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, credentials: 'include', body: JSON.stringify({ note: versionNote, changeContent: versionChange }) });
    setSavingVersion(false);
    if (!response.ok) { setVersionError((await response.json()).error || '保存失败'); return; }
    setManageVersionOpen(false); setMessage('版本信息已更新。'); await loadWorkspace();
  };

  const deleteVersion = async () => {
    if (!workspace || !window.confirm(`永久删除 v${workspace.versionNo} 及其全部迭代材料？此操作无法撤销。`)) return;
    const response = await fetch(`/api/v1/versions/${id}`, { method: 'DELETE', credentials: 'include' });
    if (!response.ok) { setVersionError((await response.json()).error || '删除失败'); return; }
    router.push(`/assets/${workspace.asset.id}`);
  };

  if (loading || !workspace) return <div className="page"><p className="subtle">正在加载版本空间…</p>{message && <p className="error">{message}</p>}</div>;
  const referenced = workspace.asset.previewVersionId === id || workspace.asset.releaseVersionId === id;
  const allTags = [...new Set(materials.flatMap(material => material.tags))].sort();

  return <div className="shell">
    <header className="topbar"><Link className="brand" href="/"><span className="brand-mark">P</span><span>Prototype Hub</span></Link><div className="top-actions"><Link href={`/assets/${workspace.asset.id}`}>返回版本时间线</Link></div></header>
    <main className="page version-workspace-page">
      <div className="crumbs"><Link href={`/projects/${workspace.asset.project.id}`}>{workspace.asset.project.name}</Link>　/　<Link href={`/assets/${workspace.asset.id}`}>{workspace.asset.name}</Link>　/　v{workspace.versionNo}</div>
      <section className="workspace-hero">
        <div className="workspace-version-badge">v{workspace.versionNo}</div>
        <div className="workspace-hero-copy"><div className="eyebrow">Version workspace</div><h1>{workspace.asset.name} · v{workspace.versionNo}</h1><p className="subtle">{workspace.sourceFileName || '历史上传（未记录原名）'} · {new Date(workspace.createdAt).toLocaleString('zh-CN')}</p><div className="pills"><span className={`status ${workspace.status}`}>{versionStatusLabel(workspace.status)}</span>{workspace.asset.previewVersionId === id && <span className="pill">预览版</span>}{workspace.asset.releaseVersionId === id && <span className="pill">发布原型</span>}</div></div>
        <div className="hero-actions"><a className="button secondary" href={`/api/v1/versions/${id}/download`}>下载原型原件</a><button className="button secondary" disabled={workspace.status !== 'READY'} onClick={() => window.open(`/viewer/${id}`, '_blank', 'noopener,noreferrer')}>打开原型 ↗</button><button className="button secondary" onClick={() => setChangeOpen(true)}>查看版本变更</button><button className="button secondary" onClick={openVersionManager}>管理版本</button></div>
      </section>

      <p className="subtle"><VersionBaselineInfo version={workspace} /></p>
      <p className="form-hint">材料为可继续整理的工作资料；设置当前发布原型不会固定这些材料。</p>
      <section className="workspace-summary-grid">
        <div className="workspace-summary-card"><span>活动材料</span><strong>{workspace.stats.activeCount}</strong></div>
        <div className="workspace-summary-card"><span>回收站</span><strong>{workspace.stats.trashCount}</strong></div>
        <div className="workspace-summary-card"><span>原文件容量</span><strong>{formatBytes(workspace.stats.totalBytes)}</strong><small>上限 1 GB</small></div>
        <div className="workspace-note-card"><span>版本备注</span><p>{workspace.note || '暂无版本备注'}</p></div>
      </section>

      {!trash && <section className="card material-upload-card">
        <div className="section-heading"><div><h2>新增迭代材料</h2><p className="subtle">支持 PDF、Office、图片、Markdown 和 TXT；单文件最大 100MB，可批量选择。</p></div><button className="button primary" disabled={!uploadItems.some(item => item.state !== 'SUCCESS') || uploading} onClick={uploadAll}>{uploading ? '上传中…' : uploadItems.length ? `上传 ${uploadItems.filter(item => item.state !== 'SUCCESS').length} 个材料` : '上传材料'}</button></div>
        <div className="material-upload-controls">
          <label className="field">选择文件<input ref={fileInputRef} disabled={uploading} type="file" multiple accept={ACCEPTED} onChange={chooseFiles} /></label>
          <label className="field">统一分类<select value={uploadCategory} onChange={event => setUploadCategory(event.target.value as Category)}>{CATEGORIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label className="field">统一标签<input value={uploadTags} onChange={event => setUploadTags(event.target.value)} placeholder="接口, 评审（逗号分隔）" /></label>
        </div>
        {uploadItems.length > 0 && <div className="upload-queue">{uploadItems.map(item => <div className={`upload-queue-item ${item.state}`} key={item.key}><span className="file-type-mini">{fileIcon(item.file.name.slice(item.file.name.lastIndexOf('.')).toLowerCase())}</span><strong>{item.file.name}</strong><span>{formatBytes(item.file.size)}</span><span className="queue-state">{item.state === 'WAITING' ? '等待上传' : item.state === 'UPLOADING' ? '上传中…' : item.state === 'SUCCESS' ? '原件已保存' : item.error || '上传失败'}</span></div>)}</div>}
      </section>}

      <section className="materials-section">
        <div className="section-heading materials-heading"><div><h2>{trash ? '材料回收站' : '版本材料'}</h2><span className="subtle">当前显示 {materials.length} 个</span></div><div className="workspace-view-switch"><button className={`button small ${trash ? 'ghost' : 'primary'}`} onClick={() => setTrash(false)}>活动材料</button><button className={`button small ${trash ? 'primary' : 'ghost'}`} onClick={() => setTrash(true)}>回收站 {workspace.stats.trashCount || ''}</button></div></div>
        <div className="material-toolbar"><input className="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索文件名、标签或文档正文…" /><select className="compact-select" value={category} onChange={event => setCategory(event.target.value as 'ALL' | Category)}><option value="ALL">全部分类</option>{CATEGORIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select><select className="compact-select" value={tag} onChange={event => setTag(event.target.value)}><option value="">全部标签</option>{allTags.map(value => <option key={value} value={value}>{value}</option>)}</select><select className="compact-select" value={sort} onChange={event => setSort(event.target.value as typeof sort)}><option value="latest">最新上传</option><option value="oldest">最早上传</option><option value="name">按名称</option></select></div>
        {message && <p className="subtle form-message workspace-message">{message}</p>}
        <div className="material-list">{materials.length ? materials.map(material => <article className="material-row" key={material.id} onClick={() => setSelectedMaterial(material)}>
          <div className={`material-file-icon ${material.previewKind}`}>{fileIcon(material.extension)}</div>
          <div className="material-main"><div className="material-title-line"><h3>{material.displayName}</h3><span className={`status ${material.status}`}>{statusLabel(material.status)}</span></div><div className="material-meta"><span>{categoryLabel(material.category)}</span><span>{formatBytes(material.sizeBytes)}</span><span>{new Date(material.createdAt).toLocaleString('zh-CN')}</span>{material.deletedAt && <span>剩余约 {Math.max(0, 30 - Math.floor((Date.now() - new Date(material.deletedAt).getTime()) / 86400000))} 天</span>}</div><div className="pills">{material.tags.map(value => <span className="pill" key={value}>{value}</span>)}</div>{material.errorMessage && <p className="error">{material.errorMessage}</p>}</div>
          <div className="material-actions" onClick={event => event.stopPropagation()}>{trash ? <><button className="button ghost small" onClick={() => restore(material)}>恢复</button><button className="button ghost-danger small" onClick={() => purge(material)}>永久删除</button></> : <><a className="button ghost small" href={material.downloadUrl}>下载</a><button className="button ghost small" onClick={() => openEditMaterial(material)}>管理</button><span className="arrow">预览 →</span></>}</div>
        </article>) : <div className="empty">{trash ? '回收站为空。' : '还没有迭代材料，上传文档、表格或图片开始整理这个版本。'}</div>}</div>
      </section>
    </main>

    {selectedMaterial && <div className="drawer-backdrop" onClick={() => setSelectedMaterial(null)}><aside className="change-drawer material-preview-drawer" role="dialog" aria-modal="true" aria-labelledby="material-preview-title" onClick={event => event.stopPropagation()}><div className="drawer-head"><div><span className="eyebrow">Iteration material</span><h2 id="material-preview-title">{selectedMaterial.displayName}</h2><p>{categoryLabel(selectedMaterial.category)} · {formatBytes(selectedMaterial.sizeBytes)}</p></div><button className="drawer-close" aria-label="关闭材料预览" onClick={() => setSelectedMaterial(null)}>×</button></div><div className="material-drawer-actions"><a className="button secondary small" href={selectedMaterial.downloadUrl}>下载原文件</a>{!selectedMaterial.deletedAt && <button className="button ghost small" onClick={() => openEditMaterial(selectedMaterial)}>管理</button>}{!selectedMaterial.deletedAt && <button className="button ghost-danger small" onClick={() => moveToTrash(selectedMaterial)}>移入回收站</button>}{selectedMaterial.deletedAt && <button className="button ghost small" onClick={() => restore(selectedMaterial)}>恢复</button>}</div><div className="material-preview-stage">{selectedMaterial.status === 'READY' ? selectedMaterial.previewKind === 'IMAGE' ? <img src={selectedMaterial.previewUrl} alt={selectedMaterial.displayName} /> : <iframe src={selectedMaterial.previewUrl} title={`${selectedMaterial.displayName} 预览`} /> : selectedMaterial.status === 'PROCESSING' ? <div className="drawer-empty"><strong>正在生成预览</strong><p>文档已经安全保存，正在生成预览，期间可下载原文件。</p></div> : <div className="drawer-empty"><strong>预览生成失败</strong><p>{selectedMaterial.errorMessage || '可以下载原文件或重新生成预览。'}</p>{!selectedMaterial.deletedAt && <button className="button secondary small" onClick={() => retry(selectedMaterial)}>重新生成预览</button>}</div>}</div></aside></div>}

    {changeOpen && <div className="drawer-backdrop" onClick={() => setChangeOpen(false)}><aside className="change-drawer" role="dialog" aria-modal="true" aria-labelledby="workspace-change-title" onClick={event => event.stopPropagation()}><div className="drawer-head"><div><span className="eyebrow">Version changes</span><h2 id="workspace-change-title">v{workspace.versionNo} 版本变更</h2><p><VersionBaselineInfo version={workspace} /></p></div><button className="drawer-close" aria-label="关闭版本变更" onClick={() => setChangeOpen(false)}>×</button></div><div className="drawer-meta"><span className={`status ${workspace.status}`}>{versionStatusLabel(workspace.status)}</span><strong>{workspace.sourceFileName || '历史上传（未记录原名）'}</strong><span>{new Date(workspace.createdAt).toLocaleString('zh-CN')}</span></div>{workspace.note && <div className="drawer-note"><span>上传备注</span><p>{workspace.note}</p></div>}<div className="drawer-section-title">变更内容</div>{workspace.changeContent ? <div className="rich-content" dangerouslySetInnerHTML={{ __html: workspace.changeContent }} /> : <div className="drawer-empty"><strong>未填写版本变更</strong><p>可通过“管理版本”补充。</p></div>}</aside></div>}

    {editMaterial && <div className="modal-backdrop"><form className="modal" onSubmit={saveMaterial}><h2>管理迭代材料</h2><p className="immutable-note">原文件内容不可覆盖；改名时必须保留 {editMaterial.extension} 扩展名。</p><label className="field">显示名称<input autoFocus required maxLength={180} value={editName} onChange={event => setEditName(event.target.value)} /></label><label className="field">分类<select value={editCategory} onChange={event => setEditCategory(event.target.value as Category)}>{CATEGORIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label className="field">标签<input value={editTags} onChange={event => setEditTags(event.target.value)} placeholder="接口, 评审（逗号分隔）" /></label>{editError && <p className="error">{editError}</p>}<div className="modal-actions"><button type="button" className="button ghost" onClick={() => setEditMaterial(null)}>取消</button><button className="button primary" disabled={savingMaterial}>{savingMaterial ? '保存中…' : '保存修改'}</button></div></form></div>}

    {manageVersionOpen && <div className="modal-backdrop"><form className="modal" onSubmit={saveVersion}><h2>管理 v{workspace.versionNo}</h2><p className="immutable-note">版本文件、版本号和入口路径不可修改；版本备注和变更说明可以修订。</p><label className="field">版本备注<textarea maxLength={2000} value={versionNote} onChange={event => setVersionNote(event.target.value)} /></label><label className="field">版本变更内容 <span className="optional-label">选填 · 相较记录的比较基线</span><RichTextEditor value={versionChange} onChange={setVersionChange} placeholder="填写新增、优化和修复内容" /></label>{referenced && <p className="form-hint">当前版本被预览版或发布原型引用，需要先在时间线切换指针后才能删除。</p>}{versionError && <p className="error">{versionError}</p>}<div className="modal-actions split-actions"><button type="button" className="button ghost-danger" disabled={referenced || savingVersion} onClick={deleteVersion}>删除版本</button><span className="action-spacer" /><button type="button" className="button ghost" onClick={() => setManageVersionOpen(false)}>取消</button><button className="button primary" disabled={savingVersion}>{savingVersion ? '保存中…' : '保存版本信息'}</button></div></form></div>}
  </div>;
}
