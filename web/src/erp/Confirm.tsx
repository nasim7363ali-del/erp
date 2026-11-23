import { type ReactNode } from 'react';
import { Action } from './ui';
export { PanelDialog, Confirm } from '../ui/overlay/Confirm';
export function DoneMessage({ title, children, onReset }: { title: string; children: ReactNode; onReset?: () => void }) { return <div className="e-panel e-form"><h2 tabIndex={-1}>{title}</h2><p role="status">{children}</p>{onReset && <div><Action onClick={onReset}>ابدأ من جديد</Action></div>}</div>; }
