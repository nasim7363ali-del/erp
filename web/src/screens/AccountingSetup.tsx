import { refreshReferences } from '../ref-cache';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type Bootstrap } from '../api';
import { ListScreen, FormScreen } from '../ui/templates';
import Modal from '../ui/overlay/Modal';
import { Confirm } from '../ui/overlay/Confirm';
import { CodeNamePicker } from '../ui/kit/CodeNamePicker';
import { normalizePicker } from '../ui/kit/pickerCatalog';

interface Row { id: string; code: string; name_ar: string; parent_id: string | null; is_active: boolean; is_system?: boolean; level?: string; account_type?: string; normal_balance?: string }
interface Props { boot: Bootstrap; offline: boolean; kind: 'accounts' | 'cost-centers' }
const types = { ASSET: 'أصول', LIABILITY: 'خصوم', EQUITY: 'حقوق ملكية', REVENUE: 'إيرادات', EXPENSE: 'مصروفات' };
const levels = { MAIN: 'رئيسي', SUB: 'فرعي', ANALYTICAL: 'تحليلي' };
const message = (e: unknown) => e instanceof Error ? e.message : 'تعذّر حفظ البيانات';
export default function AccountingSetup({ boot, offline, kind }: Props) {
  const accounts = kind === 'accounts';
  const [rows, setRows] = useState<Row[]>([]); const [loading, setLoading] = useState(true);
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [query, setQuery] = useState('');
  const [editor, setEditor] = useState<Row | 'new' | null>(null); const [toggle, setToggle] = useState<Row | null>(null); const [busy, setBusy] = useState(false);
  const [code, setCode] = useState(''); const [name, setName] = useState(''); const [parent, setParent] = useState('');
  const [level, setLevel] = useState('ANALYTICAL'); const [type, setType] = useState('ASSET'); const [balance, setBalance] = useState('DEBIT');
  const endpoint = `/accounting/${kind}`;
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setRows(await api<Row[]>(endpoint)); } catch (e) { setError(message(e)); } finally { setLoading(false); }
  }, [endpoint]);
  useEffect(() => { if (!offline) void load(); else setLoading(false); }, [load, offline]);
  const visible = useMemo(() => {
    const byId = new Map(rows.map(r => [r.id, r]));
    const included = new Set<string>();
    for (const row of rows) if (!query || normalizePicker(`${row.code} ${row.name_ar}`).includes(normalizePicker(query))) {
      let current: Row | undefined = row;
      const path = new Set<string>();
      while (current && !path.has(current.id)) { included.add(current.id); path.add(current.id); current = current.parent_id ? byId.get(current.parent_id) : undefined; }
    }
    const children = new Map<string | null, Row[]>();
    for (const row of rows) { const key = row.parent_id && byId.has(row.parent_id) ? row.parent_id : null; children.set(key, [...(children.get(key) ?? []), row]); }
    const result: { row: Row; depth: number }[] = [], visited = new Set<string>();
    const stack = (children.get(null) ?? []).map(row => ({ row, depth: 0 })).reverse();
    while (stack.length) {
      const entry = stack.pop()!; if (visited.has(entry.row.id)) continue; visited.add(entry.row.id);
      if (included.has(entry.row.id)) result.push(entry);
      for (const child of [...(children.get(entry.row.id) ?? [])].reverse()) stack.push({ row: child, depth: entry.depth + 1 });
    }
    return result;
  }, [rows, query]);
  function edit(row: Row | 'new') {
    setEditor(row); setError(''); setCode(row === 'new' ? '' : row.code); setName(row === 'new' ? '' : row.name_ar); setParent(row === 'new' ? '' : row.parent_id ?? '');
    setLevel(row === 'new' ? 'ANALYTICAL' : row.level ?? 'ANALYTICAL'); setType(row === 'new' ? 'ASSET' : row.account_type ?? 'ASSET'); setBalance(row === 'new' ? 'DEBIT' : row.normal_balance ?? 'DEBIT');
  }
  async function refreshLocalReferences() { if (boot.tenant_id) await refreshReferences(boot.tenant_id, boot.user.id).catch(() => {}); }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    if (offline) { setError('يلزم اتصال بالإنترنت — لم تُرسل البيانات'); return; }
    if (editor === 'new' && accounts && level !== 'MAIN' && !parent) { setError('اختر الحساب الأب'); event.currentTarget.querySelector<HTMLInputElement>('[role=combobox]')?.focus(); return; }
    setBusy(true); setError('');
    try {
      if (editor === 'new') await api(endpoint, { body: { code, name_ar: name, parent_id: accounts && level === 'MAIN' ? null : parent || null, ...(accounts ? { level, account_type: type, normal_balance: balance } : {}) } });
      else if (editor) await api(`${endpoint}/${editor.id}`, { method: 'PATCH', body: { name_ar: name } });
      setEditor(null); setNotice('تم الحفظ'); await load(); await refreshLocalReferences();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function changeStatus(row: Row) {
    if (busy || offline) { setError('يلزم اتصال بالإنترنت'); return; }
    setBusy(true); setError('');
    try { await api(`${endpoint}/${row.id}`, { method: 'PATCH', body: { is_active: !row.is_active } }); setToggle(null); setNotice('تم تحديث حالة السجل'); await load(); await refreshLocalReferences(); }
    catch (e) { setToggle(null); setError(message(e)); } finally { setBusy(false); }
  }
  return <ListScreen query={query} onQuery={setQuery} actions={<button className="btn primary" type="button" onClick={() => edit('new')}>{accounts ? 'إضافة حساب' : 'إضافة مركز تكلفة'}</button>}>
    <p className="muted">الرمز والأب والتصنيف ثابتة بعد الإنشاء. لا تُحذف السجلات التاريخية.</p>
    {notice && <p role="status">{notice}</p>}{error && !editor && <p className="error" role="alert">{error}</p>}
    {loading && <p role="status">جارٍ تحميل القائمة…</p>}
    {!loading && !rows.length && !error && <p>{offline ? 'يلزم اتصال لعرض البيانات الحالية' : 'لا توجد سجلات بعد'}</p>}
    {!loading && !visible.length && !!rows.length && <p role="status">لا توجد نتائج مطابقة</p>}
    <ul className="accounting-tree">{visible.map(({row, depth}) => <li key={row.id} style={{ paddingInlineStart: `${Math.min(depth, 8) * 12 + 12}px` }}>
      <div><bdi>{row.code}</bdi> · <strong>{row.name_ar}</strong> <span>{row.is_active ? 'نشط' : 'غير نشط'}</span>{row.is_system && <small> · حساب نظامي محمي</small>}{row.level && <small> · {levels[row.level as keyof typeof levels]}</small>}</div>
      <div className="actions">{row.is_system ? <small>يلزم استخدام إعدادات النظام لتعديل هذا الحساب</small> : <>
        <button className="btn ghost" type="button" aria-label={`تعديل ${row.name_ar}`} onClick={() => edit(row)}>تعديل الاسم</button>
        <button className="btn ghost" type="button" aria-label={`${row.is_active ? 'تعطيل' : 'تفعيل'} ${row.name_ar}`} onClick={() => setToggle(row)}>{row.is_active ? 'تعطيل' : 'تفعيل'}</button></>}</div>
    </li>)}</ul>
    {editor && <Modal title={editor === 'new' ? (accounts ? 'إضافة حساب' : 'إضافة مركز تكلفة') : 'تعديل الاسم'} locked={busy} onClose={() => setEditor(null)}><FormScreen><form onSubmit={save}>
      {editor === 'new' && <label>الرمز<input autoFocus required maxLength={40} pattern="[A-Za-z0-9_-]+" value={code} dir="ltr" onChange={e => setCode(e.target.value)} /></label>}
      <label>الاسم العربي<input required maxLength={accounts ? 200 : 160} value={name} onChange={e => { setName(e.target.value); setError(''); }} /></label>
      {editor === 'new' && accounts && <>
        <label>المستوى<select value={level} onChange={e => { setLevel(e.target.value); setParent(''); }}>{Object.entries(levels).map(([v,label]) => <option key={v} value={v}>{label}</option>)}</select></label>
        <label>نوع الحساب<select value={type} onChange={e => { setType(e.target.value); setParent(''); }}>{Object.entries(types).map(([v,label]) => <option key={v} value={v}>{label}</option>)}</select></label>
        <label>طبيعة الرصيد<select value={balance} onChange={e => setBalance(e.target.value)}><option value="DEBIT">مدين</option><option value="CREDIT">دائن</option></select></label>
      </>}
      {editor === 'new' && (!accounts || level !== 'MAIN') && <div className="erp picker-surface"><CodeNamePicker kind="account" label={accounts ? 'الحساب الأب' : 'مركز التكلفة الأب'} value={parent} onChange={setParent} optional={!accounts} storageKey={`${boot.tenant_id}:${boot.user.id}:${kind}`} context={{accountUse:'parent'}}
        records={rows.filter(r => !accounts || (r.account_type === type && r.level === (level === 'SUB' ? 'MAIN' : 'SUB'))).map(r => ({ code: r.code, name: r.name_ar, value: r.id, meta: '', restriction: r.is_active ? undefined : 'inactive' }))} /></div>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions"><button className="btn ghost" type="button" onClick={() => { if (!busy) setEditor(null); }}>تراجع</button><button className="btn primary" aria-busy={busy}>حفظ</button></div>
    </form></FormScreen></Modal>}
    {toggle && <Confirm title={`${toggle.is_active ? 'تعطيل' : 'تفعيل'} ${toggle.code} — ${toggle.name_ar}`} label="تأكيد" danger={toggle.is_active} onClose={() => setToggle(null)} onConfirm={() => void changeStatus(toggle)}><p>يبقى السجل وتاريخه محفوظين. يجب تعطيل الفروع قبل الأب، وتفعيل الأب قبل الفروع.</p></Confirm>}
  </ListScreen>;
}
