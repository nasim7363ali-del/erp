import { useId, useState, type ReactNode } from 'react';
import { CodeNamePicker } from './CodeNamePicker';
import { pickerRecords, restrictionFor, type PickerContext, type PickerKind } from './pickerCatalog';
import { ArrowLeft, Check, CircleAlert, Clock3, FileText, Info, LockKeyhole, Search, TriangleAlert, Undo2, type LucideIcon } from 'lucide-react';

export const demoDate = '2026-11-23';
export { num, Money, Action, statusTypes, Badge, Notice, PageIntro, SearchBox, downloadCsv, Empty, type Status } from '../ui/kit/ui';
export type FieldSpec = { label: string; type?: string; options?: string[]; picker?: PickerKind; optional?: boolean; initial?: string; min?: number };
export function Field({ spec, value, set, error, onBlur, pickerContext }: { spec: FieldSpec; value?: string; set?: (v: string) => void; error?: string; onBlur?: () => void; pickerContext?: PickerContext }) {
  if (spec.picker) return <CodeNamePicker kind={spec.picker} label={spec.label} value={value ?? ''} onChange={set ?? (() => {})} optional={spec.optional} error={error} context={pickerContext} />;
  return <BasicField spec={spec} value={value} set={set} error={error} onBlur={onBlur} />;
}
function BasicField({ spec, value, set, error, onBlur }: { spec: FieldSpec; value?: string; set?: (v: string) => void; error?: string; onBlur?: () => void }) {
  const id = useId();
  const [fileName, setFileName] = useState('');
  const a = { id, name: spec.label, 'aria-invalid': !!error, 'aria-describedby': error ? `${id}-error` : undefined, onBlur };
  const change = (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => set?.(event.currentTarget.value);
  return <div className={`e-field ${spec.type === 'checkbox' ? 'e-check-field' : ''}`}>
    {spec.type === 'checkbox' ? <label htmlFor={id}><input {...a} type="checkbox" checked={value === '1'} onChange={(event) => set?.(event.currentTarget.checked ? '1' : '0')} />{spec.label}</label> : <><label htmlFor={id}>{spec.label}{spec.optional && <small> · اختياري</small>}</label>
    {spec.options ? <select {...a} value={value ?? ''} onChange={change}><option value="">اختر من القائمة</option>{spec.options.map((option) => <option key={option}>{option}</option>)}</select>
    : spec.type === 'textarea' ? <textarea {...a} value={value ?? ''} onChange={change} rows={3} />
    : spec.type === 'file' ? <div className="e-file"><input {...a} className="sr-only" type="file" onChange={(event) => { const file = event.currentTarget.files?.[0]?.name ?? ''; setFileName(file); set?.(file); }} /><label className="e-button secondary" htmlFor={id}>اختر ملفًا</label><span className="e-caption" aria-live="polite">{fileName || 'لم يُختر ملف'}</span></div>
    : <input {...a} type={spec.type || 'text'} dir={['number', 'date', 'time'].includes(spec.type || '') ? 'ltr' : undefined} value={value ?? ''} onChange={change} min={spec.min} step={spec.type === 'number' ? '0.01' : undefined} inputMode={spec.type === 'number' ? 'decimal' : undefined} />}</>}
    {error && <small id={`${id}-error`} className="e-field-error">{error}</small>}
  </div>;
}
export function formError(field: FieldSpec, value: string, pickerContext?: PickerContext) {
  if (field.type === 'checkbox') return '';
  if (!value.trim()) return field.optional ? '' : `أدخل ${field.label}.`;
  if (field.picker) {
    const record = pickerRecords[field.picker].find((entry) => entry.value === value);
    return record ? restrictionFor(record,pickerContext) : 'اختر قيمة متاحة من القائمة.';
  }
  if (field.options && !field.options.includes(value)) return 'اختر قيمة متاحة من القائمة.';
  if (field.type === 'number' && (!Number.isFinite(Number(value)) || (field.min !== undefined && Number(value) < field.min))) return `أدخل رقمًا لا يقل عن ${field.min ?? 0}.`;
  return '';
}
export function useFields(fields: FieldSpec[]) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((field) => [field.label, field.initial ?? field.options?.[0] ?? ''])));
  const [errors, setErrors] = useState<Record<string, string>>({});
  return { values, setValues, bind: (spec: FieldSpec) => ({ spec, value: values[spec.label], error: errors[spec.label], set: (value: string) => { setValues((current) => ({ ...current, [spec.label]: value })); setErrors((current) => ({ ...current, [spec.label]: '' })); }, onBlur: () => setErrors((current) => ({ ...current, [spec.label]: formError(spec, values[spec.label] ?? '') })) }), validate: (form: HTMLFormElement, pickerContext?: (field: FieldSpec) => PickerContext) => {
    const entries = fields.filter((field) => form.elements.namedItem(field.label)).map((field) => [field.label, formError(field, values[field.label] ?? '', pickerContext?.(field))] as const).filter(([, message]) => message);
    setErrors(Object.fromEntries(entries));
    if (entries.length) { const node = form.elements.namedItem(entries[0][0]); if (node instanceof HTMLElement) { node.focus(); node.scrollIntoView({ block: 'nearest' }); } }
    return !entries.length;
  } };
}
