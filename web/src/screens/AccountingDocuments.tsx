import { useCallback,useEffect,useState } from 'react';
import { api,type Bootstrap } from '../api';
import { ListScreen,FormScreen,DetailScreen } from '../ui/templates';
import { Confirm } from '../ui/overlay/Confirm';
import { CodeNamePicker } from '../ui/kit/CodeNamePicker';
import { useDraft } from '../ui/useDraft';
import { units,decimal } from '../accounting-money';
import { today } from '../format';
interface Account {id:string;code:string;name_ar:string;is_active:boolean;is_analytical?:boolean;account_type?:string;non_inventory?:boolean;non_drawer?:boolean;non_control?:boolean}
interface Options {accounts:Account[];parties:Account[];centers:Account[];shifts:{id:string;cash_account_id:string;opened_at:string}[]}
interface Line {account_id:string;party_id:string|null;cost_center_id:string|null;debit:string;credit:string}
interface Payload {date:string;description:string;reference_no:string;lines?:Line[];voucher_type?:string;cash_account_id?:string;counter_account_id?:string;party_id?:string|null;cost_center_id?:string|null;shift_id?:string|null;amount?:string}
interface Summary {id:string;number:string;date:string;description:string;status:string;revision:number;reversed:boolean;amount?:string;voucher_type?:string}
interface Document {id:string;entry_no?:string;voucher_no?:string;entry_date?:string;voucher_date?:string;status:string;revision:number;description:string;reference_no:string;voucher_type?:string;cash_account_id?:string;counter_account_id?:string;party_id?:string|null;cost_center_id?:string|null;shift_id?:string|null;amount_original?:string}
interface Detail {document:Document;lines?:Line[];reversal:{id:string;entry_date:string;description:string}|null}
interface Props {boot:Bootstrap;offline:boolean;kind:'journals'|'vouchers'}
const errorMessage=(e:unknown)=>e instanceof Error?e.message:'تعذّرت العملية';
const blankLine=():Line=>({account_id:'',party_id:null,cost_center_id:null,debit:'0',credit:'0'});
export default function AccountingDocuments({boot,offline,kind}:Props){
 const [rows,setRows]=useState<Summary[]>([]),[offset,setOffset]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const [options,setOptions]=useState<Options>(),[detail,setDetail]=useState<Detail>(),[editor,setEditor]=useState<{id:string;payload:Payload;revision?:number}|null>(null);
 const [action,setAction]=useState<'post'|'reverse'|null>(null),[busy,setBusy]=useState(false),[date,setDate]=useState(today());
 const endpoint=`/accounting/${kind}`,journal=kind==='journals';
 const load=useCallback(async()=>{if(offline){setLoading(false);return;}setLoading(true);setError('');try{setRows((await api<{rows:Summary[]}>(`${endpoint}?offset=${offset}`)).rows);setOptions(await api<Options>('/accounting/document-options'));}catch(e){setError(errorMessage(e));}finally{setLoading(false);}},[endpoint,offset,offline]);
 useEffect(()=>{void load();},[load]);
 const open=async(id:string)=>{try{setDetail(await api<Detail>(`${endpoint}/${id}`));setError('');}catch(e){setError(errorMessage(e));}};
 const create=()=>{setDetail(undefined);setEditor({id:crypto.randomUUID(),payload:{date:today(),description:'',reference_no:'',...(journal?{lines:[blankLine(),blankLine()]}:{voucher_type:'RECEIPT',cash_account_id:'',counter_account_id:'',party_id:null,cost_center_id:null,shift_id:null,amount:'0'})}});};
 const edit=()=>{if(!detail)return;const d=detail.document;setEditor({id:d.id,revision:d.revision,payload:{date:(d.entry_date??d.voucher_date)!,description:d.description??'',reference_no:d.reference_no??'',...(journal?{lines:detail.lines?.map(({account_id,party_id,cost_center_id,debit,credit})=>({account_id,party_id,cost_center_id,debit,credit}))}:{voucher_type:d.voucher_type,cash_account_id:d.cash_account_id,counter_account_id:d.counter_account_id,party_id:d.party_id,cost_center_id:d.cost_center_id,shift_id:d.shift_id,amount:d.amount_original})}});};
 async function transition(reason:string){
  if(!detail||busy)return;if(offline){setError('يلزم اتصال بالإنترنت');return;}
  setBusy(true);setError('');try{const body=action==='post'?{revision:detail.document.revision}:{reason,date,shift_id:journal?null:detail.document.shift_id??null};
   await api(`${endpoint}/${detail.document.id}/${action}`,{body});setAction(null);await open(detail.document.id);await load();
  }catch(e){setAction(null);setError(errorMessage(e));}finally{setBusy(false);}
 }
 if(editor&&options)return <Editor key={editor.id} {...{boot,offline,kind,options}} initial={editor} cancel={()=>setEditor(null)} saved={async id=>{setEditor(null);await open(id);await load();}}/>;
 return <ListScreen actions={<div className="actions"><button type="button" className="btn primary" onClick={create}>إنشاء {journal?'قيد':'سند'}</button><button type="button" className="btn" onClick={()=>void load()}>تحديث</button></div>}>
  {error&&<p className="error" role="alert">{error}</p>}{loading&&<p role="status">جارٍ تحميل المستندات…</p>}
  {detail&&<DetailScreen title={`${journal?'قيد':'سند'} رقم ${detail.document.entry_no??detail.document.voucher_no}`}>
   <p>{detail.document.status==='POSTED'?'مرحّل':'مسودة'} · {detail.document.entry_date??detail.document.voucher_date} · {detail.document.description}</p>
   {detail.lines&&<ul>{detail.lines.map((l,i)=><li key={i}>{options?.accounts.find(a=>a.id===l.account_id)?.name_ar??l.account_id} · مدين {l.debit} · دائن {l.credit}</li>)}</ul>}
   {!journal&&<p>المبلغ: <bdi>{detail.document.amount_original}</bdi></p>}
   {detail.reversal&&<p role="status">تم العكس بتاريخ {detail.reversal.entry_date} — {detail.reversal.description}</p>}
   <div className="actions">{detail.document.status==='DRAFT'&&<><button className="btn" onClick={edit}>تعديل المسودة</button>{boot.perms?.post?<button className="btn primary" onClick={()=>setAction('post')}>ترحيل</button>:<p>يلزم صلاحية الترحيل</p>}</>}
    {detail.document.status==='POSTED'&&!detail.reversal&&(boot.perms?.reverse?<button className="btn danger" onClick={()=>setAction('reverse')}>عكس المستند</button>:<p>يلزم صلاحية العكس</p>)}
    <button className="btn ghost" onClick={()=>setDetail(undefined)}>إغلاق التفاصيل</button></div>
  </DetailScreen>}
  <ul className="accounting-tree">{rows.map(r=><li key={r.id}><button className="btn ghost" onClick={()=>void open(r.id)}>#{r.number} · {r.date} · {r.description||'بلا وصف'} · {r.reversed?'معكوس':r.status==='POSTED'?'مرحّل':'مسودة'}</button></li>)}</ul>
  {!loading&&!rows.length&&<p>لا توجد مستندات في هذه الصفحة</p>}
  <div className="actions"><button className="btn" onClick={()=>setOffset(Math.max(0,offset-40))}>السابق</button><span>الصفحة {offset/40+1}</span><button className="btn" onClick={()=>{if(rows.length===40)setOffset(offset+40);}}>التالي</button></div>
  {action&&detail&&<Confirm title={`${action==='post'?'ترحيل':'عكس'} ${journal?'القيد':'السند'} رقم ${detail.document.entry_no??detail.document.voucher_no}`} label="تأكيد" reason={action==='reverse'} danger={action==='reverse'} onClose={()=>{if(!busy)setAction(null);}} onConfirm={reason=>void transition(reason)}>
   <p>المستند المرحّل لا يعدّل؛ العكس ينشئ قيدًا مقابلًا ويحفظ الأصل.</p>{action==='reverse'&&<label>تاريخ العكس<input type="date" required value={date} onChange={e=>setDate(e.target.value)}/></label>}
   {!journal&&action==='reverse'&&detail.document.shift_id&&<label>وردية العكس<select value={detail.document.shift_id} onChange={e=>setDetail({...detail,document:{...detail.document,shift_id:e.target.value}})}>{options?.shifts.map(s=><option key={s.id} value={s.id}>{s.opened_at}</option>)}</select></label>}
  </Confirm>}
 </ListScreen>;
}
function Editor({boot,offline,kind,options,initial,cancel,saved}:Props&{options:Options;initial:{id:string;payload:Payload;revision?:number};cancel:()=>void;saved:(id:string)=>Promise<void>}){
 const [form,setForm]=useState(initial),[error,setError]=useState(''),[busy,setBusy]=useState(false);const journal=kind==='journals';
 const draft=useDraft(`ledger:${boot.tenant_id}:${boot.user.id}:${kind}:${initial.revision?initial.id:'new'}`,JSON.stringify(form),value=>{try{const parsed=JSON.parse(value);if(parsed?.payload&&typeof parsed.id==='string')setForm(parsed);else setError('المسودة المحفوظة غير صالحة');}catch{setError('المسودة المحفوظة غير صالحة');}});
 const p=form.payload;const patch=(value:Partial<Payload>)=>{setForm({...form,payload:{...p,...value}});setError('');};
 const linePatch=(index:number,value:Partial<Line>)=>patch({lines:p.lines!.map((l,i)=>i===index?{...l,...value}:l)});
 const records=(rows:Account[],mode:'manual'|'cash'|'all'='all')=>rows.map(a=>({code:a.code,name:a.name_ar,value:a.id,meta:'',restriction:!a.is_active?'inactive' as const:a.is_analytical===false?'group' as const:mode==='manual'&&(!a.non_drawer||!a.non_inventory)?'system' as const:mode==='cash'&&(!a.non_inventory||!a.non_control||a.account_type!=='ASSET')?'system' as const:undefined}));
 const picker=(label:string,value:string|null|undefined,onChange:(v:string)=>void,rows:Account[],mode:'manual'|'cash'|'all'='all',optional=false,kind:'account'|'party'='account')=><div className="erp picker-surface"><CodeNamePicker {...{label,onChange,kind,optional}} value={value??''} records={records(rows,mode)} context={{hideStock:true}} storageKey={`${boot.tenant_id}:${boot.user.id}:ledger`}/></div>;
 let balance='';try{if(journal)balance=decimal(p.lines!.reduce((sum,l)=>sum+units(l.debit)-units(l.credit),0n));}catch{balance='راجع المبالغ';}
 async function submit(e:React.FormEvent<HTMLFormElement>){e.preventDefault();if(busy)return;if(offline){setError('يلزم اتصال بالإنترنت — المسودة محفوظة محليًا');return;}
  try{
   if(journal){for(const l of p.lines!){if(!l.account_id)throw new Error('اختر حساب كل سطر');units(l.debit);units(l.credit);}}
   else {if(!p.cash_account_id||!p.counter_account_id)throw new Error('اختر الحسابين');if(units(p.amount!)<=0n)throw new Error('أدخل مبلغًا موجبًا');}
   setBusy(true);setError('');const body={payload:p,...(form.revision?{revision:form.revision}:{id:form.id})};
   await api(`/accounting/${kind}${form.revision?'/'+form.id:''}`,{method:form.revision?'PUT':'POST',body});draft.discard();await saved(form.id);
  }catch(e){setError(errorMessage(e));}finally{setBusy(false);}
 }
 return <FormScreen title={journal?'مسودة قيد يومية':'مسودة سند'}><form onSubmit={submit}>
  {draft.saved!==undefined&&<p role="status">توجد مسودة محلية <button type="button" onClick={draft.restore}>استعادة</button> <button type="button" onClick={draft.discard}>تجاهل</button></p>}
  <label>التاريخ<input type="date" required value={p.date} onChange={e=>patch({date:e.target.value})}/></label>
  <label>المرجع<input maxLength={80} value={p.reference_no} onChange={e=>patch({reference_no:e.target.value})}/></label>
  <label>الوصف<input maxLength={2000} value={p.description} onChange={e=>patch({description:e.target.value})}/></label>
  {journal?<>
   <p role="status">الفرق (مدين − دائن): <bdi>{balance}</bdi></p>
   {p.lines!.map((l,i)=><fieldset key={i}><legend>سطر {i+1}</legend>
    {picker(`الحساب ${i+1}`,l.account_id,v=>linePatch(i,{account_id:v}),options.accounts,'manual')}
    <label>مدين {i+1}<input required inputMode="decimal" pattern="[0-9]{1,14}(\.[0-9]{1,4})?" value={l.debit} onChange={e=>linePatch(i,{debit:e.target.value})}/></label>
    <label>دائن {i+1}<input required inputMode="decimal" pattern="[0-9]{1,14}(\.[0-9]{1,4})?" value={l.credit} onChange={e=>linePatch(i,{credit:e.target.value})}/></label>
    {picker(`الطرف ${i+1}`,l.party_id,v=>linePatch(i,{party_id:v||null}),options.parties,'all',true,'party')}
    {picker(`مركز التكلفة ${i+1}`,l.cost_center_id,v=>linePatch(i,{cost_center_id:v||null}),options.centers,'all',true)}
    <button type="button" className="btn ghost" onClick={()=>{if(p.lines!.length>1)patch({lines:p.lines!.filter((_,n)=>n!==i)});}}>حذف السطر {i+1}</button>
   </fieldset>)}<button className="btn" type="button" onClick={()=>{if(p.lines!.length<200)patch({lines:[...p.lines!,blankLine()]});}}>إضافة سطر</button>
  </>:<>
   <label>نوع السند<select value={p.voucher_type} disabled={!!form.revision} onChange={e=>patch({voucher_type:e.target.value})}><option value="RECEIPT">قبض</option><option value="PAYMENT">صرف</option><option value="PETTY_CASH">مصروف من الوردية</option></select></label>
   {picker('حساب النقد أو البنك',p.cash_account_id,v=>patch({cash_account_id:v,shift_id:null}),options.accounts,'cash')}
   {picker('الحساب المقابل',p.counter_account_id,v=>patch({counter_account_id:v}),options.accounts,'manual')}
   <label>المبلغ<input required inputMode="decimal" pattern="[0-9]{1,14}(\.[0-9]{1,4})?" value={p.amount} onChange={e=>patch({amount:e.target.value})}/></label>
   {picker('الطرف',p.party_id,v=>patch({party_id:v||null}),options.parties,'all',true,'party')}
   {picker('مركز التكلفة',p.cost_center_id,v=>patch({cost_center_id:v||null}),options.centers,'all',true)}
   <label>الوردية (مطلوبة لحساب الدرج)<select value={p.shift_id??''} onChange={e=>patch({shift_id:e.target.value||null})}><option value="">بدون وردية — بنك أو محفظة</option>{options.shifts.filter(s=>s.cash_account_id===p.cash_account_id).map(s=><option key={s.id} value={s.id}>{s.opened_at}</option>)}</select></label>
  </>}
  {error&&<p className="error" role="alert">{error}</p>}<div className="actions"><button type="button" className="btn ghost" onClick={()=>{if(!busy)cancel();}}>رجوع</button><button className="btn primary" aria-busy={busy}>حفظ المسودة</button></div>
 </form></FormScreen>;
}
