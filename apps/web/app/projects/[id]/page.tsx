'use client';

import { type FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

type Asset = {
  id: string;
  name: string;
  description: string;
  iconUrl?: string | null;
  releaseVersionId?: string | null;
  _count: { versions: number };
  tags: { tag: { name: string } }[];
  updatedAt: string;
};

type Project = { id: string; name: string; description: string; assets: Asset[] };

function AssetIcon({ asset }: { asset: Asset }) {
  return <div className="asset-icon" aria-hidden="true">
    {asset.iconUrl ? <img src={asset.iconUrl} alt="" /> : <span>{asset.name.trim().charAt(0).toUpperCase() || 'P'}</span>}
  </div>;
}

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [show, setShow] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    const response = await fetch(`/api/v1/projects/${id}`, { credentials: 'include' });
    if (response.status === 401) window.location.href = '/login';
    else if (response.ok) setProject(await response.json());
  };

  useEffect(() => { load(); }, [id]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    const response = await fetch(`/api/v1/projects/${id}/assets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ name, description, tags: tags.split(',').map(value => value.trim()).filter(Boolean) })
    });
    if (!response.ok) {
      setError((await response.json()).error);
      return;
    }
    setShow(false);
    setName('');
    setDescription('');
    setTags('');
    setError('');
    load();
  };

  if (!project) return <div className="page"><p className="subtle">正在加载…</p></div>;

  return <div className="shell">
    <header className="topbar"><Link className="brand" href="/"><span className="brand-mark">P</span><span>Prototype Hub</span></Link></header>
    <main className="page">
      <div className="crumbs"><Link href="/">项目</Link>　/　{project.name}</div>
      <section className="hero">
        <div><div className="eyebrow">Project</div><h1>{project.name}</h1><p className="subtle">{project.description || '管理这个项目下的所有原型版本。'}</p></div>
        <button className="button primary" onClick={() => setShow(true)}>＋ 新建原型</button>
      </section>
      <div className="section-heading"><h2>原型资产</h2><span className="subtle">{project.assets.length} 个资产</span></div>
      {project.assets.length ? <div className="asset-list">
        {project.assets.map(asset => <article className="asset-row asset-card-row" key={asset.id}>
          <div className="asset-row-main">
            <AssetIcon asset={asset} />
            <div className="asset-card-copy">
              <Link className="asset-title-link" href={`/assets/${asset.id}`}><h3>{asset.name}</h3></Link>
              <p className="subtle">{asset.description || '暂无描述'} · {asset._count.versions} 个版本</p>
              <div className="pills">{asset.tags.map(item => <span className="pill" key={item.tag.name}>{item.tag.name}</span>)}</div>
            </div>
          </div>
          <div className="asset-quick-actions" aria-label={`${asset.name}快捷操作`}>
            {asset.releaseVersionId
              ? <Link className="button secondary small" href={`/viewer/${asset.releaseVersionId}`} target="_blank" rel="noopener noreferrer">查看发布版 ↗</Link>
              : <button className="button secondary small" disabled title="请先在版本时间线中设置发布版">尚未发布</button>}
            <Link className="button ghost small" href={`/assets/${asset.id}`}>管理资产 →</Link>
          </div>
        </article>)}
      </div> : <div className="empty">项目里还没有原型资产。</div>}
    </main>
    {show && <div className="modal-backdrop">
      <form className="modal" onSubmit={create}>
        <h2>新建原型资产</h2>
        <label className="field">原型名称<input autoFocus value={name} onChange={event => setName(event.target.value)} placeholder="例如：订单详情页" /></label>
        <label className="field">描述<textarea value={description} onChange={event => setDescription(event.target.value)} /></label>
        <label className="field">标签<input value={tags} onChange={event => setTags(event.target.value)} placeholder="后台, 订单, v1（逗号分隔）" /></label>
        <p className="form-hint">创建后可在资产详情中上传专属图标。</p>
        {error && <p className="error">{error}</p>}
        <div className="modal-actions"><button type="button" className="button ghost" onClick={() => setShow(false)}>取消</button><button className="button primary">创建资产</button></div>
      </form>
    </div>}
  </div>;
}
