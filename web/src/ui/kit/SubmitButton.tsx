import { useState, type ButtonHTMLAttributes } from 'react';
/** A submit action stays clickable: explain the restriction instead of silently disabling it. */
export function SubmitButton({ blocked, blockedReason = 'راجع الحقول المطلوبة أولًا', onClick, children, ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { blocked?: boolean; blockedReason?: string }) {
  const [error, setError] = useState('');
  return <><button {...props} onClick={event => {
    if (blocked) {
      event.preventDefault(); setError(blockedReason);
      const container = event.currentTarget.closest('form, .card, section, dialog');
      const target = container?.querySelector<HTMLElement>('[aria-invalid=true], input:invalid, textarea:invalid, input, textarea, select');
      target?.scrollIntoView({ block: 'center' }); target?.focus(); return;
    }
    setError(''); onClick?.(event);
  }}>{children}</button>{error && <p className="error" role="alert">{error}</p>}</>;
}
