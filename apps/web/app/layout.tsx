import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Prototype Hub', description: '原型资产管理平台' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
