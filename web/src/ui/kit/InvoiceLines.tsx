import { useRef } from 'react';
import { CodeNamePicker } from './CodeNamePicker';
import type { PickerRecord } from './pickerCatalog';
export interface InvoiceLine { id: string; item: string; qty: number; price: number }
/** Reference UUIDs and prices are supplied by the caller; no fixture or hidden purchase-cost arithmetic. */
export function InvoiceLines({ lines, records, onChange }: { lines: InvoiceLine[]; records: PickerRecord[]; onChange: (lines: InvoiceLine[]) => void }) {
  const quantity = useRef<HTMLInputElement>(null);
  const patch = (id: string, value: Partial<InvoiceLine>) => onChange(lines.map(line => line.id === id ? { ...line, ...value } : line));
  return <div className="erp picker-surface">{lines.map(line => <fieldset key={line.id}><legend>بند الفاتورة</legend>
    <CodeNamePicker kind="item" label="الصنف" records={records} value={line.item} onChange={item => patch(line.id, { item })} context={{ hideStock: true }} nextField={`qty-${line.id}`} />
    <label>الكمية<input ref={quantity} name={`qty-${line.id}`} type="number" min="0.0001" step="any" value={line.qty} onChange={e => patch(line.id, { qty: Number(e.target.value) })} onKeyDown={e => {
      if (e.key === 'Enter' && line.item && line.qty > 0) { e.preventDefault(); onChange([...lines, { id: crypto.randomUUID(), item: '', qty: 1, price: 0 }]); }
    }} /></label>
    <label>السعر<input type="number" min="0" step="any" value={line.price} onChange={e => patch(line.id, { price: Number(e.target.value) })} /></label>
    <button type="button" onClick={() => onChange(lines.filter(row => row.id !== line.id))}>حذف البند</button>
  </fieldset>)}</div>;
}
