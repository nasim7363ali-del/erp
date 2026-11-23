import type { Role } from '../../erp/catalog';
export type PickerKind = 'account' | 'customer' | 'supplier' | 'item' | 'party';
export type PickerRecord = {
  code: string;
  name: string;
  value: string;
  meta: string;
  phone?: string;
  barcode?: string;
  favorite?: boolean;
  balance?: number;
  direction?: string;
  limit?: number;
  price?: number;
  stock?: number[];
  restriction?: 'group' | 'inactive' | 'system' | 'permission';
};
export type PickerContext = {
  role?: Role;
  warehouse?: string;
  hideStock?: boolean;
  accountUse?: 'posting' | 'parent' | 'report';
  blockedValue?: string;
  conflictLabel?: string;
};

export const itemWarehouse = (warehouse?: string) => warehouse?.includes('عدن') ? 'مخزن عدن' : warehouse?.includes('تعز') ? 'مخزن تعز' : 'المخزن الرئيسي';
export const stockAt = (record: PickerRecord, warehouse?: string) => record.stock?.[warehouse?.includes('عدن') ? 1 : warehouse?.includes('تعز') ? 2 : 0];
export const canSeeCash = (role?: Role) => role === 'owner' || role === 'accountant';

export function restrictionFor(record: PickerRecord, { role, accountUse, blockedValue, conflictLabel }: PickerContext = {}) {
  if (record.value === blockedValue) return `لا يمكن اختيار ${record.name} مرة أخرى${conflictLabel ? `؛ هو ${conflictLabel}` : ' في هذا المستند'}.`;
  if (record.restriction === 'group' && !['parent','report'].includes(accountUse ?? '')) return 'حساب رئيسي — اختر حسابًا فرعيًا.';
  if (record.restriction === 'inactive') return 'هذا السجل غير نشط — اختر سجلًا نشطًا.';
  if (record.restriction === 'system') return 'حساب نظام — يُستخدم تلقائيًا فقط.';
  if (record.restriction === 'permission' && role !== 'owner') return 'لا تملك صلاحية استخدام هذا الحساب.';
  return '';
}

export function normalizePicker(text: string) {
  return Array.from(text.toLowerCase(), (char) => {
    const point = char.charCodeAt(0);
    if (point >= 0x660 && point <= 0x669) return String(point - 0x660);
    if (point >= 0x6f0 && point <= 0x6f9) return String(point - 0x6f0);
    return char.replace(/[أإآٱ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[\u0610-\u061a\u0640\u064b-\u065f\u0670]/g,'');
  }).join('').trim();
}

export function exactPicker(records: PickerRecord[], query: string, field: 'code' | 'name') {
  return records.find((record) => [record.code,record.barcode, ...(field === 'name' ? [record.name,record.phone] : [])].some((value) => value && normalizePicker(value) === query));
}

export function matchesPicker(record: PickerRecord, query: string, field: 'code' | 'name') {
  return field === 'code' ? [record.code,record.barcode].some((value) => value && normalizePicker(value).startsWith(query))
    : [record.name,record.code,record.phone,record.barcode].some((value) => value && normalizePicker(value).includes(query));
}

export const pickerNouns: Record<PickerKind,string> = { account: 'حساب', customer: 'عميل', supplier: 'مورد', item: 'صنف', party: 'طرف' };
