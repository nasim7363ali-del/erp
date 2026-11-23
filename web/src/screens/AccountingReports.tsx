import { useEffect,useState } from 'react';
import { api,type Bootstrap } from '../api';
import { ListScreen } from '../ui/templates';
import { CodeNamePicker } from '../ui/kit/CodeNamePicker';
interface Year {id:string;name:string;start_date:string;end_date:string}
interface Account {id:string;code:string;name_ar:string}
interface Totals {opening:string;debit:string;credit:string;closing:string}
interface Row {account_id?:string;code?:string;name_ar?:string;line_id?:string;entry_no?:string;entry_date?:string;description?:string;opening?:string;debit:string;credit:string;closing?:string;balance?:string;reversed?:boolean;reverses_entry_id?:string}
interface Result extends Partial<Totals> {rows:Row[];totals?:Totals;count?:number;account?:Account;from:string;to:string;year:Year;offset?:number}
export default function AccountingReports({boot,offline}:{boot:Bootstrap;offline:boolean}) {
 const [options,setOptions]=useState<{years:Year[];accounts:Account[]}>(),[year,setYear]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState('');
 const [mode,setMode]=useState('trial-balance'),[account,setAccount]=useState(''),[result,setResult]=useState<Result>(),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const permitted=!!boot.perms?.cashview&&!!boot.perms?.viewCost;
 useEffect(()=>{if(!permitted||offline)return;let active=true;void api<{years:Year[];accounts:Account[]}>('/accounting/report-options').then(o=>{if(!active)return;setOptions(o);if(o.years[0]){setYear(o.years[0].id);setFrom(o.years[0].start_date);setTo(o.years[0].end_date);}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[permitted,offline]);
 const reset=()=>{setResult(undefined);setError('');};
 async function load(offset=0) {
  if(busy)return;if(offline){setError('يلزم اتصال بالإنترنت لقراءة تقرير محدث');return;}
  setBusy(true);setError('');try{const q=new URLSearchParams({fiscal_year_id:year,from,to,...(mode==='account-statement'?{account_id:account,offset:String(offset)}:{})});setResult(await api<Result>(`/accounting/${mode}?${q}`));}catch(e){setResult(undefined);setError(e instanceof Error?e.message:'تعذر تحميل التقرير');}finally{setBusy(false);}
 }
 const totals=result?.totals??(result as Totals|undefined);
 return <ListScreen>
  <p>تقارير فرع الجلسة فقط، بالعملة الأساسية. تشمل القيود المرحّلة والعكوس؛ لا تشمل المسودات. الرصيد الموجب مدين والسالب دائن.</p>
  {!permitted?<p role="alert">يلزم السماح بعرض النقدية والتكلفة بالإضافة إلى إدارة المحاسبة.</p>:<>
   <form onSubmit={e=>{e.preventDefault();void load();}}>
    <fieldset disabled={busy}><legend>نطاق التقرير</legend>
    <label>التقرير<select value={mode} onChange={e=>{setMode(e.target.value);reset();}}><option value="trial-balance">ميزان المراجعة</option><option value="account-statement">كشف حساب الأستاذ</option></select></label>
    <label>السنة المالية<select required value={year} onChange={e=>{const y=options?.years.find(y=>y.id===e.target.value);setYear(e.target.value);if(y){setFrom(y.start_date);setTo(y.end_date);}reset();}}>{options?.years.map(y=><option key={y.id} value={y.id}>{y.name}</option>)}</select></label>
    <label>من تاريخ<input required type="date" value={from} onChange={e=>{setFrom(e.target.value);reset();}}/></label>
    <label>إلى تاريخ<input required type="date" value={to} onChange={e=>{setTo(e.target.value);reset();}}/></label>
    {mode==='account-statement'&&<div className="erp picker-surface"><CodeNamePicker label="حساب الأستاذ" kind="account" value={account} onChange={v=>{setAccount(v);reset();}} records={(options?.accounts??[]).map(a=>({code:a.code,name:a.name_ar,value:a.id,meta:''}))}/></div>}
    <button className="btn primary" aria-busy={busy}>عرض التقرير</button>
    </fieldset>
   </form>
   {error&&<p role="alert" className="error">{error}</p>}{busy&&<p role="status">جارٍ إعداد التقرير…</p>}
   {result&&<section aria-label="نتيجة التقرير">
    <h2>{mode==='trial-balance'?'ميزان المراجعة':`كشف ${result.account?.code} — ${result.account?.name_ar}`}</h2>
    <p>{result.year.name} · {result.from} — {result.to}</p>
    {totals&&<dl><dt>الرصيد الافتتاحي</dt><dd><bdi>{totals.opening}</bdi></dd><dt>إجمالي المدين</dt><dd><bdi>{totals.debit}</bdi></dd><dt>إجمالي الدائن</dt><dd><bdi>{totals.credit}</bdi></dd><dt>الرصيد الختامي</dt><dd><bdi>{totals.closing}</bdi></dd></dl>}
    {mode==='trial-balance'&&<p role="status">{totals?.closing==='0.0000'||totals?.closing==='0'?'الميزان متوازن':'تنبيه: يوجد فرق؛ راجع القيود والنطاق'}</p>}
    <div style={{overflowX:'auto',maxWidth:'100%'}} tabIndex={0} role="region" aria-label="جدول التقرير"><table><thead><tr><th>{mode==='trial-balance'?'الحساب':'القيد / التاريخ'}</th><th>البيان</th>{mode==='trial-balance'&&<th>افتتاحي</th>}<th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead><tbody>
    {result.rows.map(r=><tr key={r.account_id??r.line_id}><td>{r.code??`${r.entry_no} / ${r.entry_date}`}</td><td>{r.name_ar??r.description}{r.reversed?' (معكوس)':''}{r.reverses_entry_id?' (قيد عكس)':''}</td>{mode==='trial-balance'&&<td><bdi>{r.opening}</bdi></td>}<td><bdi>{r.debit}</bdi></td><td><bdi>{r.credit}</bdi></td><td><bdi>{r.closing??r.balance}</bdi></td></tr>)}
    </tbody></table></div>
    {!result.rows.length&&<p>لا توجد حركة في النطاق المحدد</p>}
    {mode==='account-statement'&&<div className="actions"><button className="btn" disabled={busy||!result.offset} onClick={()=>void load(Math.max(0,(result.offset??0)-50))}>السابق</button><span>{result.count} حركة · صفحة {(result.offset??0)/50+1}</span><button className="btn" disabled={busy||(result.offset??0)+50>=(result.count??0)} onClick={()=>void load((result.offset??0)+50)}>التالي</button></div>}
   </section>}
  </>}
 </ListScreen>;
}
