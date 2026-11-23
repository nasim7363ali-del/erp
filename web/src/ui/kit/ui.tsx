import type { ReactNode } from 'react';
import { ArrowLeft, Check, CircleAlert, Clock3, FileText, Info, LockKeyhole, Search, TriangleAlert, Undo2, type LucideIcon } from 'lucide-react';
export const num = (n: number, digits = 0) => n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
export function Money({ value, digits = 0 }: { value: number; digits?: number }) { return <span className="e-money"><bdi dir="ltr">{num(value, digits)}</bdi><small>ر.ي</small></span>; }
export function Action({ children, href, icon: Icon, kind = 'secondary', onClick }: { children: ReactNode; href?: string; icon?: LucideIcon; kind?: 'primary' | 'secondary' | 'danger' | 'quiet'; onClick?: () => void }) {
  const klass = `e-button ${kind}`;
  const content = <>{Icon && <Icon aria-hidden="true" size={17} />}{children}</>;
  return href ? <a className={klass} href={href}>{content}</a> : <button className={klass} type="button" onClick={onClick}>{content}</button>;
}
export const statusTypes = { posted: ['مرحّل', Check, 'good'], draft: ['مسودة', FileText, 'neutral'], reversed: ['ملغى', Undo2, 'danger'], pending: ['معلّق', Clock3, 'warn'], overdue: ['متأخر', CircleAlert, 'danger'], low: ['مخزون منخفض', TriangleAlert, 'warn'], locked: ['مقفل', LockKeyhole, 'neutral'], active: ['نشط', Check, 'good'] } as const;
export type Status = keyof typeof statusTypes;
export function Badge({ status }: { status: Status }) { const [label, Icon, tone] = statusTypes[status]; return <span className={`e-badge ${tone}`}><Icon size={13} aria-hidden="true" />{label}</span>; }
export function Notice({ title, children, tone = 'info' }: { title?: string; children: ReactNode; tone?: 'info' | 'warn' | 'danger' | 'good' }) { const Icon = tone === 'good' ? Check : tone === 'info' ? Info : TriangleAlert; return <div className={`e-notice ${tone}`} role={tone === 'danger' ? 'alert' : undefined}><Icon size={18} aria-hidden="true" /><div>{title && <strong>{title}</strong>}<div>{children}</div></div></div>; }
export function PageIntro({ title, description, parent, children }: { title: string; description: string; parent?: { href: string; label: string }; children?: ReactNode }) { return <header className="e-page-intro"><div>{parent && <a className="e-back" href={parent.href}><ArrowLeft className="e-rtl-back" size={15} aria-hidden="true" />{parent.label}</a>}<h1 id="erp-title">{title}</h1><p>{description}</p></div>{children && <div className="e-page-actions">{children}</div>}</header>; }
export function SearchBox({ value, set, label = 'ابحث في السجلات' }: { value: string; set: (v: string) => void; label?: string }) { return <label className="e-search"><span className="sr-only">{label}</span><Search size={17} aria-hidden="true" /><input value={value} onChange={(event) => set(event.target.value)} placeholder={label} /></label>; }
export function downloadCsv(name: string, rows: (string | number)[][]) {
  const cell = (value: string | number) => `"${(typeof value === 'string' && /^[\s]*[=+@-]/.test(value) ? `'${value}` : String(value)).replaceAll('"', '""')}"`;
  const url = URL.createObjectURL(new Blob(['\uFEFF', rows.map((row) => row.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `${name}.csv`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function Empty({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) { return <div className="e-empty"><span className="e-icon-box"><FileText size={22} aria-hidden="true" /></span><h2>{title}</h2><p>{children}</p>{action}</div>; }
