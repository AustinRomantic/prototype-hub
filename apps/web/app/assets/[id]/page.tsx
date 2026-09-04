'use client';

import { type ChangeEvent, type FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { RichTextEditor } from '../../components/rich-text-editor';

type Version = {
  id: string;
  versionNo: number;
  status: string;
  sourceFileName?: string | null;
  note: string;
  changeContent: string;
  fileCount: number;
  sizeBytes: number;
  createdAt: string;
  errorMessage?: string;
};

type Asset = {
  id: string;
  name: string;
  description: string;
  iconUrl?: string | null;
  project: { id: string; name: string };
  previewVersionId?: string | null;
  releaseVersionId?: string | null;
  tags: { tag: { name: string } }[];
  versions: Version[];
};

function AssetIcon({ asset, large = false }: { asset: Asset; large?: boolean }) {
  return <div className={`asset-icon${large ? ' large' : ''}`} aria-hidden="true">
    {asset.iconUrl ? <img src={asset.iconUrl} alt="" /> : <span>{asset.name.trim().charAt(0).toUpperCase() || 'P'}</span>}
  </div>;
}

export default function AssetPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [asset, setAsset] = useState<Asset | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [changeContent, setChangeContent] = useState('');
  const [entryPath, setEntryPath] = useState('index.html');
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');

  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editIcon, setEditIcon] = useState<File | null>(null);
  const [removeIcon, setRemoveIcon] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState('');

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'READY' | 'PROCESSING' | 'FAILED'>('ALL');
  const [managedVersion, setManagedVersion] = useState<Version | null>(null);
  const [versionNote, setVersionNote] = useState('');
  const [versionChangeContent, setVersionChangeContent] = useState('');
  const [savingVersion, setSavingVersion] = useState(false);
  const [versionError, setVersionError] = useState('');
  const [deleteVersionOpen, setDeleteVersionOpen] = useState(false);
  const [deletingVersion, setDeletingVersion] = useState(false);
  const [drawerVersion, setDrawerVersion] = useState<Version | null>(null);

  const load = async () => {
    const response = await fetch(`/api/v1/assets/${id}`, { credentials: 'include' });
    if (response.status === 401) window.location.href = '/login';
    else if (response.ok) setAsset(await response.json());
  };

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 3000);
    return () => window.clearInterval(timer);
  }, [id]);

  useEffect(() => {
    if (!drawerVersion) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setDrawerVersion(null); };
    document.addEventListener('keydown', closeOnEscape);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.body.style.overflow = '';
    };
  }, [drawerVersion]);

  const upload = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) return;
    setUploading(true);
    setMessage('正在上传并排队处理…');
    const body = new FormData();
    body.append('note', note);
    body.append('changeContent', changeContent);
    body.append('entryPath', entryPath);
    body.append('file', file);
    const response = await fetch(`/api/v1/assets/${id}/versions`, { method: 'POST', body, credentials: 'include' });
    setUploading(false);
    if (!response.ok) {
      setMessage((await response.json()).error || '上传失败');
      return;
    }
    setFile(null);
    setNote('');
    setChangeContent('');
    setEntryPath('index.html');
    setMessage(`“${file.name}”上传成功，Worker 正在处理版本。`);
    load();
  };

  const preview = (versionId: string) => window.open(`/viewer/${versionId}`, '_blank', 'noopener,noreferrer');

  const mark = async (versionId: string, kind: 'preview' | 'release') => {
    const response = await fetch(`/api/v1/versions/${versionId}/set-${kind}`, { method: 'POST', credentials: 'include' });
    if (response.ok) load();
    else setMessage((await response.json()).error);
  };

  const openEdit = () => {
    if (!asset) return;
    setEditName(asset.name);
    setEditDescription(asset.description);
    setEditTags(asset.tags.map(item => item.tag.name).join(', '));
    setEditIcon(null);
    setRemoveIcon(false);
    setEditError('');
    setEditOpen(true);
  };

  const saveEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!asset) return;
    setSavingEdit(true);
    setEditError('');

    const metadataResponse = await fetch(`/api/v1/assets/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        name: editName,
        description: editDescription,
        tags: editTags.split(',').map(value => value.trim()).filter(Boolean)
      })
    });
    if (!metadataResponse.ok) {
      setEditError((await metadataResponse.json()).error || '资产信息保存失败');
      setSavingEdit(false);
      return;
    }

    let iconResponse: Response | null = null;
    if (editIcon) {
      const iconBody = new FormData();
      iconBody.append('file', editIcon);
      iconResponse = await fetch(`/api/v1/assets/${id}/icon`, { method: 'POST', body: iconBody, credentials: 'include' });
    } else if (removeIcon && asset.iconUrl) {
      iconResponse = await fetch(`/api/v1/assets/${id}/icon`, { method: 'DELETE', credentials: 'include' });
    }

    if (iconResponse && !iconResponse.ok) {
      setEditError((await iconResponse.json()).error || '资产信息已保存，但图标处理失败');
      setSavingEdit(false);
      await load();
      return;
    }

    setSavingEdit(false);
    setEditOpen(false);
    setMessage('原型资产信息已更新。');
    await load();
  };

  const deleteAsset = async () => {
    if (!asset) return;
    setDeleting(true);
    setDeleteError('');
    const response = await fetch(`/api/v1/assets/${id}`, { method: 'DELETE', credentials: 'include' });
    if (!response.ok) {
      setDeleteError((await response.json()).error || '删除失败');
      setDeleting(false);
      return;
    }
    window.location.href = `/projects/${asset.project.id}`;
  };

  const openVersionManager = (version: Version) => {
    setManagedVersion(version);
    setVersionNote(version.note);
    setVersionChangeContent(version.changeContent || '');
    setVersionError('');
    setDeleteVersionOpen(false);
  };

  const saveVersion = async (event: FormEvent) => {
    event.preventDefault();
    if (!managedVersion) return;
    setSavingVersion(true);
    setVersionError('');
    const response = await fetch(`/api/v1/versions/${managedVersion.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ note: versionNote, changeContent: versionChangeContent })
    });
    setSavingVersion(false);
    if (!response.ok) {
      setVersionError((await response.json()).error || '版本备注保存失败');
      return;
    }
    setManagedVersion(null);
    setMessage(`v${managedVersion.versionNo} 的版本信息已更新。`);
    await load();
  };

  const deleteVersion = async () => {
    if (!managedVersion) return;
    setDeletingVersion(true);
    setVersionError('');
    const response = await fetch(`/api/v1/versions/${managedVersion.id}`, { method: 'DELETE', credentials: 'include' });
    setDeletingVersion(false);
    if (!response.ok) {
      setDeleteVersionOpen(false);
      setVersionError((await response.json()).error || '版本删除失败');
      return;
    }
    const versionNo = managedVersion.versionNo;
    setDeleteVersionOpen(false);
    setManagedVersion(null);
    setMessage(`v${versionNo} 已删除。`);
    await load();
  };

  if (!asset) return <div className="page"><p className="subtle">正在加载…</p></div>;

  const visibleVersions = asset.versions
    .filter(version => statusFilter === 'ALL' || version.status === statusFilter)
    .sort((left, right) => sortOrder === 'newest' ? right.versionNo - left.versionNo : left.versionNo - right.versionNo);
  const managedVersionReferenced = Boolean(managedVersion && (asset.previewVersionId === managedVersion.id || asset.releaseVersionId === managedVersion.id));

  return <div className="shell">
    <header className="topbar"><Link className="brand" href="/"><span className="brand-mark">P</span><span>Prototype Hub</span></Link></header>
    <main className="page">
      <div className="crumbs"><Link href={`/projects/${asset.project.id}`}>{asset.project.name}</Link>　/　{asset.name}</div>
      <section className="hero asset-hero">
        <div className="asset-hero-main">
          <AssetIcon asset={asset} large />
          <div>
            <div className="eyebrow">Prototype asset</div>
            <h1>{asset.name}</h1>
            <p className="subtle">{asset.description || '上传一个 HTML 或 ZIP，开始建立版本时间线。'}</p>
            <div className="pills">{asset.tags.map(item => <span className="pill" key={item.tag.name}>{item.tag.name}</span>)}</div>
          </div>
        </div>
        <div className="hero-actions">
          {asset.releaseVersionId
            ? <button className="button secondary" onClick={() => preview(asset.releaseVersionId!)}>查看发布版 ↗</button>
            : <button className="button secondary" disabled title="请先在版本时间线中设置发布版">尚未设置发布版</button>}
          <button className="button secondary" onClick={openEdit}>编辑资产</button>
          <button className="button danger ghost-danger" onClick={() => { setDeleteError(''); setDeleteOpen(true); }}>删除</button>
        </div>
      </section>

      <section className="card" style={{ marginBottom: 30 }}>
        <h2>上传新版本</h2>
        <p className="subtle">支持单 HTML 或包含静态资源的 ZIP，最大 100MB。</p>
        <form onSubmit={upload}>
          <div className="upload-fields">
            <label className="field upload-file-field">原型文件
              <input type="file" accept=".html,.htm,.zip" onChange={(event: ChangeEvent<HTMLInputElement>) => setFile(event.target.files?.[0] || null)} />
            </label>
            <label className="field upload-entry-field">入口文件<input value={entryPath} onChange={event => setEntryPath(event.target.value)} placeholder="index.html" /></label>
            <label className="field upload-note-field">上传备注<input value={note} onChange={event => setNote(event.target.value)} placeholder="例如：补充支付流程" /></label>
            <button className="button primary" disabled={uploading || !file}>{uploading ? '处理中…' : '上传版本'}</button>
          </div>
          <label className="field change-content-field">版本变更内容 <span className="optional-label">选填 · 说明相较上一版本的变化</span>
            <RichTextEditor value={changeContent} onChange={setChangeContent} placeholder="例如：新增支付结果页；优化订单筛选交互；修复移动端按钮遮挡。" />
          </label>
        </form>
        {message && <p className="subtle form-message">{message}</p>}
      </section>

      <div className="section-heading timeline-heading">
        <div><h2>版本时间线</h2><span className="subtle">共 {asset.versions.length} 个版本，当前显示 {visibleVersions.length} 个</span></div>
        <div className="timeline-controls">
          <label>状态<select className="compact-select" value={statusFilter} onChange={event => setStatusFilter(event.target.value as typeof statusFilter)}><option value="ALL">全部</option><option value="READY">可用</option><option value="PROCESSING">处理中</option><option value="FAILED">失败</option></select></label>
          <label>排序<select className="compact-select" value={sortOrder} onChange={event => setSortOrder(event.target.value as typeof sortOrder)}><option value="newest">最新在前</option><option value="oldest">最早在前</option></select></label>
        </div>
      </div>
      <div className="version-guide">
        <div className="version-guide-item"><span className="version-guide-label preview">预览版</span><div><strong>内部验收候选</strong><p>团队正在评审或测试的默认版本，可以频繁切换，不影响对外稳定入口。</p></div></div>
        <div className="version-guide-item"><span className="version-guide-label release">发布版</span><div><strong>已确认的稳定版本</strong><p>项目页“查看发布版”会打开它，适合提供给产品、研发或其他协作者长期查看。</p></div></div>
        <p className="version-guide-footnote">“打开此版本”只临时查看这一条记录，不会改变预览版或发布版。</p>
      </div>
      <div className="timeline">
        {visibleVersions.length ? visibleVersions.map(version => <div id={`version-${version.id}`} className="version-row clickable-version-row" key={version.id} onClick={() => router.push(`/versions/${version.id}`)}>
          <div className="version-main">
            <div className="version-number">v{version.versionNo}</div>
            <div className="version-content">
              <div className="version-heading">
                <span className={`status ${version.status}`}>{version.status}</span>
                <strong className={`source-file-name${version.sourceFileName ? '' : ' missing'}`} title={version.sourceFileName || '该版本创建时尚未记录原文件名'}>{version.sourceFileName || '历史上传（未记录原名）'}</strong>
              </div>
              {version.note && <div className="version-note"><span>上传备注</span>{version.note}</div>}
              <div className="subtle">{new Date(version.createdAt).toLocaleString('zh-CN')} · {version.fileCount || 0} 个文件 · {Math.round((version.sizeBytes || 0) / 1024)} KB</div>
              {version.errorMessage && <div className="error">{version.errorMessage}</div>}
            </div>
          </div>
          <div className="version-actions" onClick={event => event.stopPropagation()}>
            {asset.previewVersionId === version.id && <span className="pill">预览版</span>}
            {asset.releaseVersionId === version.id && <span className="pill">发布版</span>}
            {version.status === 'READY' && <>
              <button className="button secondary small" onClick={() => preview(version.id)}>打开此版本</button>
              <button className="button ghost small" disabled={asset.previewVersionId === version.id} onClick={() => mark(version.id, 'preview')}>设为预览版</button>
              <button className="button ghost small" disabled={asset.releaseVersionId === version.id} onClick={() => mark(version.id, 'release')}>设为发布版</button>
            </>}
            <button className="button ghost small" onClick={() => setDrawerVersion(version)}>查看变更</button>
            <button className="button ghost small manage-button" onClick={() => openVersionManager(version)}>管理</button>
          </div>
        </div>) : <div className="empty">{asset.versions.length ? '没有符合当前筛选条件的版本。' : '上传第一个版本后，它会出现在这里。'}</div>}
      </div>
    </main>

    {editOpen && <div className="modal-backdrop">
      <form className="modal" onSubmit={saveEdit}>
        <h2>编辑原型资产</h2>
        <div className="icon-editor">
          <AssetIcon asset={asset} large />
          <div><strong>资产图标</strong><p className="form-hint">支持 PNG、JPEG、WebP，最大 2MB。建议使用正方形图片。</p></div>
        </div>
        <label className="field">更换图标<input type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" onChange={(event: ChangeEvent<HTMLInputElement>) => { setEditIcon(event.target.files?.[0] || null); setRemoveIcon(false); }} /></label>
        {asset.iconUrl && !editIcon && <label className="remove-icon"><input type="checkbox" checked={removeIcon} onChange={event => setRemoveIcon(event.target.checked)} /> 删除当前图标</label>}
        <label className="field">原型名称<input autoFocus required maxLength={120} value={editName} onChange={event => setEditName(event.target.value)} /></label>
        <label className="field">描述<textarea maxLength={2000} value={editDescription} onChange={event => setEditDescription(event.target.value)} /></label>
        <label className="field">标签<input value={editTags} onChange={event => setEditTags(event.target.value)} placeholder="后台, 订单, v1（逗号分隔）" /></label>
        {editError && <p className="error">{editError}</p>}
        <div className="modal-actions"><button type="button" className="button ghost" disabled={savingEdit} onClick={() => setEditOpen(false)}>取消</button><button className="button primary" disabled={savingEdit}>{savingEdit ? '保存中…' : '保存修改'}</button></div>
      </form>
    </div>}

    {deleteOpen && <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="delete-asset-title">
        <h2 id="delete-asset-title">删除原型资产？</h2>
        <p className="danger-note">将永久删除“{asset.name}”的全部版本、原始文件、预览文件和图标，此操作无法撤销。</p>
        {deleteError && <p className="error">{deleteError}</p>}
        <div className="modal-actions"><button className="button ghost" disabled={deleting} onClick={() => setDeleteOpen(false)}>取消</button><button className="button danger" disabled={deleting} onClick={deleteAsset}>{deleting ? '正在删除…' : '确认删除'}</button></div>
      </div>
    </div>}

    {managedVersion && <div className="modal-backdrop">
      <form className="modal" onSubmit={saveVersion}>
        <h2>管理 v{managedVersion.versionNo}</h2>
        <div className="version-manage-summary"><strong>{managedVersion.sourceFileName || '历史上传（未记录原名）'}</strong><span className={`status ${managedVersion.status}`}>{managedVersion.status}</span></div>
        <p className="immutable-note">版本文件、版本号和入口路径保持不可变，以确保历史可追溯；管理备注和版本变更说明可以修订。</p>
        <label className="field">版本备注<textarea autoFocus maxLength={2000} value={versionNote} onChange={event => setVersionNote(event.target.value)} placeholder="例如：产品确认版，修复支付流程" /></label>
        <label className="field">版本变更内容 <span className="optional-label">选填 · 相较上一版本</span><RichTextEditor value={versionChangeContent} onChange={setVersionChangeContent} placeholder="填写新增、优化和修复内容" /></label>
        {managedVersionReferenced && <p className="form-hint">该版本当前被设为{asset.previewVersionId === managedVersion.id && asset.releaseVersionId === managedVersion.id ? '预览版和发布版' : asset.previewVersionId === managedVersion.id ? '预览版' : '发布版'}，需要先切换指针后才能删除。</p>}
        {versionError && <p className="error">{versionError}</p>}
        <div className="modal-actions split-actions"><button type="button" className="button ghost-danger" disabled={savingVersion || managedVersionReferenced} onClick={() => setDeleteVersionOpen(true)}>删除版本</button><span className="action-spacer" /><button type="button" className="button ghost" disabled={savingVersion} onClick={() => setManagedVersion(null)}>取消</button><button className="button primary" disabled={savingVersion}>{savingVersion ? '保存中…' : '保存版本信息'}</button></div>
      </form>
    </div>}

    {managedVersion && deleteVersionOpen && <div className="modal-backdrop modal-confirm-layer">
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-version-title">
        <h2 id="delete-version-title">永久删除 v{managedVersion.versionNo}？</h2>
        <p className="danger-note">将同时删除该版本的原始上传文件和全部预览文件，版本号不会被重新使用。此操作无法撤销。</p>
        <div className="modal-actions"><button className="button ghost" disabled={deletingVersion} onClick={() => setDeleteVersionOpen(false)}>取消</button><button className="button danger" disabled={deletingVersion} onClick={deleteVersion}>{deletingVersion ? '正在删除…' : '确认删除版本'}</button></div>
      </div>
    </div>}

    {drawerVersion && <div className="drawer-backdrop" onClick={() => setDrawerVersion(null)}>
      <aside className="change-drawer" role="dialog" aria-modal="true" aria-labelledby="change-drawer-title" onClick={event => event.stopPropagation()}>
        <div className="drawer-head"><div><span className="eyebrow">Version changes</span><h2 id="change-drawer-title">v{drawerVersion.versionNo} 版本变更</h2><p>{drawerVersion.versionNo > 1 ? `上传时相较于 v${drawerVersion.versionNo - 1}` : '首个版本，无上一版本可比较'}</p></div><button className="drawer-close" aria-label="关闭版本变更" onClick={() => setDrawerVersion(null)}>×</button></div>
        <div className="drawer-meta"><span className={`status ${drawerVersion.status}`}>{drawerVersion.status}</span><strong>{drawerVersion.sourceFileName || '历史上传（未记录原名）'}</strong><span>{new Date(drawerVersion.createdAt).toLocaleString('zh-CN')}</span></div>
        {drawerVersion.note && <div className="drawer-note"><span>上传备注</span><p>{drawerVersion.note}</p></div>}
        <div className="drawer-section-title">变更内容</div>
        {drawerVersion.changeContent
          ? <div className="rich-content" dangerouslySetInnerHTML={{ __html: drawerVersion.changeContent }} />
          : <div className="drawer-empty"><strong>未填写版本变更</strong><p>该版本上传时没有记录相较上一版本的变更内容，可通过“管理”补充。</p></div>}
      </aside>
    </div>}
  </div>;
}
