'use client';

import { type ChangeEvent, type FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

type Version = {
  id: string;
  versionNo: number;
  status: string;
  sourceFileName?: string | null;
  note: string;
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
  const [asset, setAsset] = useState<Asset | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
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

  const upload = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) return;
    setUploading(true);
    setMessage('正在上传并排队处理…');
    const body = new FormData();
    body.append('note', note);
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

  if (!asset) return <div className="page"><p className="subtle">正在加载…</p></div>;

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
        </form>
        {message && <p className="subtle form-message">{message}</p>}
      </section>

      <div className="section-heading"><h2>版本时间线</h2><span className="subtle">{asset.versions.length} 个版本</span></div>
      <div className="timeline">
        {asset.versions.length ? asset.versions.map(version => <div className="version-row" key={version.id}>
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
          <div className="version-actions">
            {asset.previewVersionId === version.id && <span className="pill">预览版</span>}
            {asset.releaseVersionId === version.id && <span className="pill">发布版</span>}
            {version.status === 'READY' && <>
              <button className="button secondary small" onClick={() => preview(version.id)}>预览</button>
              <button className="button ghost small" onClick={() => mark(version.id, 'preview')}>设为预览</button>
              <button className="button ghost small" onClick={() => mark(version.id, 'release')}>设为发布</button>
            </>}
          </div>
        </div>) : <div className="empty">上传第一个版本后，它会出现在这里。</div>}
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
  </div>;
}
