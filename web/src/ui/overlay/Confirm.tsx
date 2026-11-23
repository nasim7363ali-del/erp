import { useEffect, useRef, useState, type ReactNode } from 'react';
export function PanelDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const node = dialog.current; node?.showModal(); node?.querySelector<HTMLElement>('[autofocus]')?.focus(); return () => { if (node?.open) node.close(); }; }, []);
  return <dialog ref={dialog} className="e-dialog" aria-label={title} onCancel={e => { e.preventDefault(); onClose(); }}>{children}</dialog>;
}
export function Confirm({ title, label, children, reason = false, danger = true, onClose, onConfirm }: {
  title: string; label: string; children: ReactNode; reason?: boolean; danger?: boolean; onClose: () => void; onConfirm: (reason: string) => void;
}) {
  const [text, setText] = useState(''); const [error, setError] = useState(''); const input = useRef<HTMLTextAreaElement>(null);
  return <PanelDialog title={title} onClose={onClose}><h2>{title}</h2>{children}<form noValidate onSubmit={e => {
    e.preventDefault(); if (reason && !text.trim()) { setError('اذكر سبب العملية'); input.current?.focus(); return; } onConfirm(text.trim());
  }}>{reason && <label>سبب العملية<textarea ref={input} value={text} aria-invalid={!!error} onBlur={() => { if (!text.trim()) setError('اذكر سبب العملية'); }} onChange={e => { setText(e.target.value); setError(''); }} /></label>}
    {error && <p role="alert">{error}</p>}
    <div className="e-actions"><button autoFocus type="button" className="e-button secondary" onClick={onClose}>تراجع</button><button className={`e-button ${danger ? 'danger' : 'primary'}`}>{label}</button></div>
  </form></PanelDialog>;
}
