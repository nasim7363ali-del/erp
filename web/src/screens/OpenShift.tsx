import { useDraft } from '../ui/useDraft';
import { useState } from 'react';
import { Clock3 } from 'lucide-react';
import { api, ApiError } from '../api';
import { today } from '../format';

export default function OpenShift({ onOpened, offline, draftKey = "opening-shift" }: { draftKey?: string; onOpened: () => void; offline: boolean }) {
  const [float, setFloat] = useState('0'); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const draft = useDraft(draftKey, float, setFloat);
  async function open(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    if (offline) { setErr('يلزم اتصال بالإنترنت'); return; }
    const openingFloat = Number(float);
    if (!float.trim() || !Number.isFinite(openingFloat) || openingFloat < 0) { setErr('أدخل مبلغًا صالحًا، أو 0 إذا كان الدرج فارغًا.'); (e.currentTarget.elements.namedItem('opening-float') as HTMLElement)?.focus(); return; }
    setBusy(true); setErr('');
    try { await api('/shifts/open', { body: { opening_float: openingFloat, date: today() } }); draft.discard(); onOpened(); }
    catch (x) { setErr(x instanceof ApiError ? (x.code === 'SHIFT_ALREADY_OPEN' ? 'توجد وردية مفتوحة على صندوق الكاشير (ربما عند مستخدم آخر).' : x.message) : 'خطأ'); }
    finally { setBusy(false); }
  }
  return (
    <form className="card pad task-card" onSubmit={open}>
      <div className="panel-title"><span className="panel-icon"><Clock3 size={21} aria-hidden="true" /></span><div><h2>افتح وردية لبدء البيع</h2><p>عُدّ النقد الموجود في الدرج ثم سجّل المبلغ.</p></div></div>
      <>{draft.saved !== undefined && <p role="status">توجد مسودة محفوظة <button type="button" onClick={draft.restore}>استعادة</button> <button type="button" onClick={draft.discard}>تجاهل</button></p>}</>
      <label>العهدة الافتتاحية (ر.ي)<input name="opening-float" inputMode="decimal" dir="ltr" autoComplete="off" value={float} aria-invalid={!!err} onBlur={() => { if (!float.trim() || !Number.isFinite(Number(float))) setErr('أدخل مبلغًا صالحًا'); }} onChange={(e) => { setFloat(e.target.value.replace(/[^\d.]/g, '')); setErr(''); }} /></label>
      {offline && <p className="error">فتح الوردية يحتاج اتصالًا بالخادم.</p>}
      {err && <p className="error" role="alert">{err}</p>}
      <button className="btn primary" aria-busy={busy}>{busy ? 'جارٍ الفتح…' : 'فتح الوردية'}</button>
    </form>
  );
}
