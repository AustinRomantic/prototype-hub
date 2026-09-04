'use client';
import { FormEvent, useState } from 'react';

export default function LoginPage() {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123456');
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError('');
    const response = await fetch('/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include', body: JSON.stringify({ username, password }) });
    if (!response.ok) { setError((await response.json()).error || '登录失败'); return; }
    window.location.href = '/';
  };
  return <main className="login-wrap"><form className="login-card" onSubmit={submit}><div className="brand"><span className="brand-mark">P</span><span>Prototype Hub</span></div><h1>管理你的原型资产</h1><p className="subtle">把每次上传都变成可追溯、可预览的研发版本。</p><label className="field">用户名<input value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" /></label><label className="field">密码<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" /></label>{error && <p className="error">{error}</p>}<button className="button primary" style={{ width: '100%', marginTop: 10 }}>登录</button></form></main>;
}
