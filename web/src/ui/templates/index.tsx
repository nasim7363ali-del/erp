import { useRef, useState, type ReactNode } from 'react';
export interface ScreenProps { title?: string; children: ReactNode; actions?: ReactNode }
export function DetailScreen({ title, children, actions }: ScreenProps) {
  return <section className="screen-template">{title && <h2>{title}</h2>}{actions && <div className="no-print">{actions}</div>}{children}</section>;
}
export function ListScreen({ query, onQuery, ...props }: ScreenProps & { query?: string; onQuery?: (query: string) => void }) {
  return <DetailScreen {...props}>{onQuery && <label className="no-print">بحث في القائمة<input type="search" value={query ?? ''} onChange={e => onQuery(e.target.value)} /></label>}{props.children}</DetailScreen>;
}
/** Native form constraints are shown on first blur, cleared immediately on edit, and focused on submit. */
export function FormScreen(props: ScreenProps) {
  const root = useRef<HTMLDivElement>(null); const [error, setError] = useState('');
  return <div ref={root} onBlurCapture={e => {
    const input = e.target; if (input instanceof HTMLInputElement && !input.validity.valid) { input.setAttribute('aria-invalid', 'true'); setError(input.validationMessage); }
  }} onInputCapture={e => { if (e.target instanceof HTMLElement) e.target.removeAttribute('aria-invalid'); setError(''); }} onInvalidCapture={e => {
    e.preventDefault(); const input = root.current?.querySelector<HTMLElement>('input:invalid, select:invalid, textarea:invalid');
    input?.scrollIntoView({ block: 'center' }); input?.focus(); setError('راجع الحقول المطلوبة');
  }}><DetailScreen {...props} />{error && <p className="error" role="alert">{error}</p>}</div>;
}
export function ReportScreen(props: ScreenProps) {
  return <DetailScreen {...props}><button className="btn no-print" type="button" onClick={() => window.print()}>طباعة التقرير</button>{props.children}</DetailScreen>;
}
export function WizardScreen({ step, total, ...props }: ScreenProps & { step: number; total: number }) {
  return <DetailScreen {...props}><p role="status">الخطوة {step} من {total}</p><progress value={step} max={total} aria-label="تقدم الخطوات" />{props.children}</DetailScreen>;
}
export function ModuleHome(props: ScreenProps) { return <DetailScreen {...props} />; }
