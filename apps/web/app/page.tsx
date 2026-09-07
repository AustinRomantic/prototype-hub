'use client';

import { type FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { type PrototypeSearchResult } from '@prototype-hub/contracts';

type Project = { id: string; name: string; description: string; _count: { assets: number }; updatedAt: string };
type SearchResult = PrototypeSearchResult;
type MaterialSearchResult = { id: string; displayName: string; category: string; status: string; tags: string[]; version: { id: string; versionNo: number; asset: { id: string; name: string; project: { id: string; name: string } } } };

const CATEGORY_LABELS: Record<string, string> = { PRODUCT: '产品', DATA: '数据', BACKEND: '后端', FRONTEND: '前端', TEST: '测试', DESIGN: '设计', OTHER: '其他' };

export default function HomePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [materialResults, setMaterialResults] = useState<MaterialSearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [assetSearchError, setAssetSearchError] = useState('');
  const [materialSearchError, setMaterialSearchError] = useState('');
  const searchSequence = useRef(0);
  const [modal, setModal] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    const response = await fetch('/api/v1/projects', { credentials: 'include' });
    if (response.status === 401) { window.location.href = '/login'; return; }
    setProjects(await response.json());
  };
  useEffect(() => { load(); }, []);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    const response = await fetch('/api/v1/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, description }), credentials: 'include' });
    if (!response.ok) { setError((await response.json()).error); return; }
    setModal(false); setName(''); setDescription(''); setError(''); load();
  };

  const search = async (event: FormEvent) => {
    event.preventDefault();
    const sequence = ++searchSequence.current;
    const q = query.trim();
    setAssetSearchError(''); setMaterialSearchError('');
    if (!q) { setResults([]); setMaterialResults([]); setSearched(false); setSearching(false); return; }
    setSearching(true); setSearched(false);
    const read = async <T,>(url: string): Promise<T> => {
      const response = await fetch(url, { credentials: 'include' });
      if (response.status === 401) { window.location.href = '/login'; throw new Error('登录已过期'); }
      if (!response.ok) throw new Error('搜索服务暂不可用，请重试');
      return response.json();
    };
    const [assets, materials] = await Promise.allSettled([
      read<SearchResult[]>(`/api/v1/search?q=${encodeURIComponent(q)}`),
      read<MaterialSearchResult[]>(`/api/v1/materials/search?q=${encodeURIComponent(q)}`)
    ]);
    if (sequence !== searchSequence.current) return;
    setResults(assets.status === 'fulfilled' ? assets.value : []);
    setMaterialResults(materials.status === 'fulfilled' ? materials.value : []);
    if (assets.status === 'rejected') setAssetSearchError('原型搜索失败，请检查连接后重试。');
    if (materials.status === 'rejected') setMaterialSearchError('材料搜索失败，请检查连接后重试。');
    setSearching(false); setSearched(true);
  };

  const logout = async () => { await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' }); window.location.href = '/login'; };

  return <div className="shell">
    <header className="topbar"><Link className="brand" href="/"><span className="brand-mark">P</span><span>Prototype Hub</span></Link><div className="top-actions"><span>个人工作区</span><button className="button ghost" onClick={logout}>退出</button></div></header>
    <main className="page">
      <section className="hero"><div><div className="eyebrow">Prototype library</div><h1>原型资产，一处管理。</h1><p className="subtle">从本地 HTML 到可检索的产品研发资产，保留每一个可预览版本。</p></div><button className="button primary" onClick={() => setModal(true)}>＋ 新建项目</button></section>
      <form className="toolbar" onSubmit={search}><input className="search" placeholder="搜索项目、原型、迭代材料、标签或文档正文…" value={query} onChange={event => setQuery(event.target.value)} /><button className="button secondary" disabled={searching}>{searching ? '搜索中…' : '搜索'}</button></form>
      {searched && <section className="search-results-section">
        <h2>搜索结果</h2>
        <h3 className="search-group-title">原型与版本 <span>{results.length}</span></h3>
        {assetSearchError ? <p className="error" role="alert">{assetSearchError}</p> : results.length ? <div className="asset-list">{results.map(result => <Link className="asset-row" key={`${result.matchType}-${result.matchedVersion?.id || result.id}`} href={result.matchType === 'VERSION' ? `/versions/${result.matchedVersion.id}` : `/assets/${result.id}`}><div><h3>{result.name}</h3><div className="subtle">{result.project.name} · {result.matchType === 'VERSION' ? `版本内容命中 · v${result.matchedVersion.versionNo}${result.matchedVersion.sourceFileName ? ` · ${result.matchedVersion.sourceFileName}` : ''}` : `资产信息命中${result.versions[0] ? ` · 最新版本 v${result.versions[0].versionNo}` : ' · 暂无版本'}`}</div></div><span className="arrow">{result.matchType === 'VERSION' ? '进入命中版本 →' : '查看资产 →'}</span></Link>)}</div> : <div className="empty compact-empty">没有匹配的原型或版本</div>}
        <h3 className="search-group-title">迭代材料 <span>{materialResults.length}</span></h3>
        {materialSearchError ? <p className="error" role="alert">{materialSearchError}</p> : materialResults.length ? <div className="asset-list">{materialResults.map(material => <Link className="asset-row" key={material.id} href={`/versions/${material.version.id}?material=${material.id}`}><div><h3>{material.displayName}</h3><div className="subtle">{material.version.asset.project.name} · {material.version.asset.name} · v{material.version.versionNo} · {CATEGORY_LABELS[material.category] || '其他'}</div><div className="pills">{material.tags.map(tag => <span className="pill" key={tag}>{tag}</span>)}</div></div><span className="arrow">进入版本空间 →</span></Link>)}</div> : <div className="empty compact-empty">没有匹配的迭代材料</div>}
      </section>}
      <section><div className="section-heading"><h2>我的项目</h2><span className="subtle">{projects.length} 个项目</span></div>{projects.length ? <div className="grid">{projects.map(project => <Link href={`/projects/${project.id}`} className="card project-card" key={project.id}><div className="card-top"><div><h3>{project.name}</h3><p className="subtle">{project.description || '还没有项目描述'}</p></div><span className="count">{project._count.assets} 个原型</span></div><div className="card-footer"><span>更新于 {new Date(project.updatedAt).toLocaleDateString('zh-CN')}</span><span className="arrow">进入项目 →</span></div></Link>)}</div> : <div className="empty">还没有项目，创建第一个项目开始管理原型。</div>}</section>
    </main>
    {modal && <div className="modal-backdrop"><form className="modal" onSubmit={create}><h2>新建项目</h2><label className="field">项目名称<input autoFocus value={name} onChange={event => setName(event.target.value)} placeholder="例如：电商后台" /></label><label className="field">项目描述<textarea value={description} onChange={event => setDescription(event.target.value)} placeholder="这个项目用来管理什么原型？" /></label>{error && <p className="error">{error}</p>}<div className="modal-actions"><button type="button" className="button ghost" onClick={() => setModal(false)}>取消</button><button className="button primary">创建项目</button></div></form></div>}
  </div>;
}
