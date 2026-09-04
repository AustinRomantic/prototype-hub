'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

export default function ViewerPage() {
  const { id } = useParams<{ id: string }>();
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/v1/versions/${id}/preview-token`, { credentials: 'include' }).then(async response => {
      const body = await response.json();
      if (response.status === 401) { window.location.href = '/login'; return; }
      if (!response.ok) { setError(body.error || '无法打开预览'); return; }
      setUrl(body.url);
    }).catch(() => setError('无法连接预览服务'));
  }, [id]);

  return <main className="preview-shell"><header className="preview-head"><div className="brand"><span className="brand-mark">P</span><span>隔离预览</span></div><button className="button ghost" onClick={() => window.close()}>关闭</button></header>{error ? <div className="empty" style={{ margin: 30 }}>{error}</div> : url ? <iframe className="preview-frame" title="原型预览" src={url} sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads" referrerPolicy="no-referrer" /> : <div className="empty" style={{ margin: 30 }}>正在生成安全预览地址…</div>}</main>;
}
