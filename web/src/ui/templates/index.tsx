import type { ReactNode } from 'react';
export interface ScreenProps { title?: string; children: ReactNode; actions?: ReactNode }
export function DetailScreen({ title, children, actions }: ScreenProps) {
  return <section className="screen-template">{title && <h2>{title}</h2>}{actions && <div className="no-print">{actions}</div>}{children}</section>;
}
export function ListScreen(props: ScreenProps) { return <DetailScreen {...props} />; }
export function FormScreen(props: ScreenProps) { return <DetailScreen {...props} />; }
export function ReportScreen(props: ScreenProps) { return <DetailScreen {...props} />; }
export function WizardScreen({ step, total, ...props }: ScreenProps & { step: number; total: number }) {
  return <DetailScreen {...props}><p role="status">الخطوة {step} من {total}</p>{props.children}</DetailScreen>;
}
export function ModuleHome(props: ScreenProps) { return <DetailScreen {...props} />; }
