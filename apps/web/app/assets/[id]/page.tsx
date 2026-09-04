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
  project: { id: string; name: string };
  previewVersionId?: string;
  releaseVersionId?: string;
  tags: { tag: { name: string } }[];
  versions: Version[];
};

export default function AssetPage() {
  const { id } = useParams<{ id: string }>();
  const [asset, setAsset] = useState<Asset | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [entryPath, setEntryPath] = useState('index.html');
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');

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

  if (!asset) return <div className="page"><p className="subtle">正在加载…</p></div>;

  return <div className="shell">
    <header className="topbar">
      <Link className="brand" href="/"><span className="brand-mark">P</span><span>Prototype Hub</span></Link>
    </header>
    <main className="page">
      <div className="crumbs"><Link href={`/projects/${asset.project.id}`}>{asset.project.name}</Link>　/　{asset.name}</div>
      <section className="hero">
        <div>
          <div className="eyebrow">Prototype asset</div>
          <h1>{asset.name}</h1>
          <p className="subtle">{asset.description || '上传一个 HTML 或 ZIP，开始建立版本时间线。'}</p>
          <div className="pills">{asset.tags.map(item => <span className="pill" key={item.tag.name}>{item.tag.name}</span>)}</div>
        </div>
      </section>

      <section className="card" style={{ marginBottom: 30 }}>
        <h2>上传新版本</h2>
        <p className="subtle">支持单 HTML 或包含静态资源的 ZIP，最大 100MB。</p>
        <form onSubmit={upload}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'end' }}>
            <label className="field" style={{ flex: 1, minWidth: 250 }}>原型文件
              <input type="file" accept=".html,.htm,.zip" onChange={(event: ChangeEvent<HTMLInputElement>) => setFile(event.target.files?.[0] || null)} />
            </label>
            <label className="field" style={{ minWidth: 190 }}>入口文件
              <input value={entryPath} onChange={event => setEntryPath(event.target.value)} placeholder="index.html" />
            </label>
            <label className="field" style={{ flex: 1, minWidth: 200 }}>上传备注
              <input value={note} onChange={event => setNote(event.target.value)} placeholder="例如：补充支付流程" />
            </label>
            <button className="button primary" disabled={uploading || !file}>{uploading ? '处理中…' : '上传版本'}</button>
          </div>
        </form>
        {message && <p className="subtle" style={{ marginBottom: 0 }}>{message}</p>}
      </section>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>版本时间线</h2><span className="subtle">{asset.versions.length} 个版本</span>
      </div>
      <div className="timeline">
        {asset.versions.length ? asset.versions.map(version => <div className="version-row" key={version.id}>
          <div className="version-main">
            <div className="version-number">v{version.versionNo}</div>
            <div className="version-content">
              <div className="version-heading">
                <span className={`status ${version.status}`}>{version.status}</span>
                <strong className={`source-file-name${version.sourceFileName ? '' : ' missing'}`} title={version.sourceFileName || '该版本创建时尚未记录原文件名'}>
                  {version.sourceFileName || '历史上传（未记录原名）'}
                </strong>
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
  </div>;
}
