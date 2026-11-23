import { beforeAll,afterAll,it,expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startApp,login,auth,sqlAdmin } from './helpers.js';
import { withTenant } from '../src/db.js';
let ctx:Awaited<ReturnType<typeof startApp>>,manager:string,cashier:string,tid:string,date:string;
let bank:string,expense:string,bank2:string,closedDate='1999-01-01';
const call=(method:'GET'|'POST'|'PUT',path:string,payload?:object,token=manager)=>ctx.app.inject({method,url:'/api/accounting'+path,headers:auth(token),payload});
const payload=()=>({date,description:'قيد اختبار',lines:[{account_id:bank,debit:'10.0001',credit:'0'},{account_id:expense,debit:'0',credit:'10.0001'}]});
beforeAll(async()=>{
 ctx=await startApp();const m=await login(ctx.app,'mgr');manager=m.token;tid=m.session.tid;cashier=(await login(ctx.app,'cashier')).token;
 date=(await ctx.app.inject({url:'/api/pos/bootstrap',headers:auth(manager)})).json().server_date;
 const rows=sqlAdmin(`SELECT code||':'||id FROM accounts WHERE tenant_id='${tid}' AND code IN ('110201','110202','5101') ORDER BY code`).split('\n');
 bank=rows.find(r=>r.startsWith('110201:'))?.split(':')[1]??'';bank2=rows.find(r=>r.startsWith('110202:'))?.split(':')[1]??'';
 expense=sqlAdmin(`SELECT id FROM accounts WHERE tenant_id='${tid}' AND is_analytical AND account_type='EXPENSE' ORDER BY code LIMIT 1`);
 sqlAdmin(`INSERT INTO fiscal_years(tenant_id,name,start_date,end_date,is_closed) VALUES('${tid}','LEDGER_CLOSED','1999-01-01','1999-12-31',true)`);
});
afterAll(async()=>{await ctx.app.close();await ctx.pool.end();});
it('requires accounting authority in API and the database functions',async()=>{
 expect((await call('GET','/journals',undefined,cashier)).statusCode).toBe(403);
 const uid=sqlAdmin("SELECT id FROM users WHERE username='cashier'");
 await expect(withTenant(ctx.pool,tid,c=>c.query("SELECT save_accounting_draft($1,$2,'JOURNAL',$3::jsonb,$4)",[tid,randomUUID(),JSON.stringify(payload()),uid]))).rejects.toThrow(/PERMISSION_DENIED/);
});
it('creates a balanced journal, retries safely, posts once and preserves exact decimals',async()=>{
 const id=randomUUID(),body={id,payload:payload()};
 expect((await call('POST','/journals',body)).statusCode).toBe(201);
 expect((await call('POST','/journals',body)).json().revision).toBe(1);
 for(let i=0;i<2;i++) expect((await call('POST',`/journals/${id}/post`,{revision:1})).statusCode).toBe(200);
 const d=(await call('GET',`/journals/${id}`)).json();expect(d.document.status).toBe('POSTED');expect(d.lines.some((l:{debit:string})=>l.debit==='10.0001')).toBe(true);
 expect(sqlAdmin(`SELECT count(*) FROM audit_logs WHERE action='POST' AND record_id='${id}'`)).toBe('1');
 expect((await call('PUT',`/journals/${id}`,{revision:1,payload:{...payload(),description:'تعديل مرحل'}})).statusCode).toBe(409);
});
it('rejects empty/single-sided/unbalanced posting, precision tricks, and closed periods',async()=>{
 expect((await call('POST','/journals',{id:randomUUID(),payload:{...payload(),lines:[]}})).statusCode).toBe(400);
 expect((await call('POST','/journals',{id:randomUUID(),payload:{...payload(),lines:[{account_id:bank,debit:'1.00001',credit:'0'}]}})).statusCode).toBe(400);
 for(const lines of [[{account_id:bank,debit:'10',credit:'0'}],[{account_id:bank,debit:'10',credit:'0'},{account_id:expense,debit:'0',credit:'9'}]]){
  const id=randomUUID();expect((await call('POST','/journals',{id,payload:{...payload(),lines}})).statusCode).toBe(201);
  expect((await call('POST',`/journals/${id}/post`,{revision:1})).statusCode).toBe(409);
  expect((await call('GET',`/journals/${id}`)).json().document.status).toBe('DRAFT');
 }
 expect((await call('POST','/journals',{id:randomUUID(),payload:{...payload(),date:closedDate}})).statusCode).toBe(409);
});
it('updates drafts with revision checks and rejects stale editor submissions',async()=>{
 const id=randomUUID();await call('POST','/journals',{id,payload:payload()});
 expect((await call('PUT',`/journals/${id}`,{revision:1,payload:{...payload(),description:'نسخة ثانية'}})).json().revision).toBe(2);
 expect((await call('PUT',`/journals/${id}`,{revision:1,payload:{...payload(),description:'نسخة قديمة'}})).statusCode).toBe(409);
 expect((await call('POST',`/journals/${id}/post`,{revision:1})).statusCode).toBe(409);
});
it('reverses manual journals into an exact mirror without modifying history',async()=>{
 const id=randomUUID();await call('POST','/journals',{id,payload:payload()});await call('POST',`/journals/${id}/post`,{revision:1});
 const before=sqlAdmin(`SELECT row_to_json(j)::text FROM journal_entries j WHERE id='${id}'`);
 expect((await call('POST',`/journals/${id}/reverse`,{date,reason:' '})).statusCode).toBe(400);
 const r=await call('POST',`/journals/${id}/reverse`,{date,reason:'تصحيح'});expect(r.statusCode).toBe(200);
 expect((await call('POST',`/journals/${id}/reverse`,{date,reason:'تصحيح'})).json()).toEqual(r.json());
 expect((await call('POST',`/journals/${id}/reverse`,{date,reason:'سبب آخر'})).statusCode).toBe(409);
 expect(sqlAdmin(`SELECT row_to_json(j)::text FROM journal_entries j WHERE id='${id}'`)).toBe(before);
 expect(sqlAdmin(`SELECT SUM(debit_base-credit_base)::text FROM journal_lines WHERE journal_entry_id IN('${id}','${r.json().journal_entry_id}')`)).toBe('0.0000');
});
it('creates, posts and reverses non-drawer receipt and payment vouchers idempotently',async()=>{
 for(const voucher_type of ['RECEIPT','PAYMENT']){
  const id=randomUUID(),p={date,voucher_type,cash_account_id:bank,counter_account_id:bank2,amount:'12.3456'};
  const r=await call('POST','/vouchers',{id,payload:p});expect(r.statusCode).toBe(201);
  const a=await call('POST',`/vouchers/${id}/post`,{revision:1});expect(a.statusCode).toBe(200);
  expect((await call('POST',`/vouchers/${id}/post`,{revision:1})).json()).toEqual(a.json());
  const rev=await call('POST',`/vouchers/${id}/reverse`,{date,reason:'اختبار العكس'});expect(rev.statusCode).toBe(200);
  expect((await call('POST',`/vouchers/${id}/reverse`,{date,reason:'اختبار العكس'})).json()).toEqual(rev.json());
  expect((await call('GET',`/vouchers/${id}`)).json().document.status).toBe('POSTED');
 }
});
it('requires a matching shift for drawer vouchers and forbids manual stock/drawer bypasses',async()=>{
 const drawer=sqlAdmin(`SELECT default_cash_account_id FROM tenant_accounting_settings WHERE tenant_id='${tid}'`);
 const stock=sqlAdmin(`SELECT default_inventory_account_id FROM tenant_accounting_settings WHERE tenant_id='${tid}'`);
 for(const account_id of [drawer,stock]) expect((await call('POST','/journals',{id:randomUUID(),payload:{...payload(),lines:[{account_id,debit:'10',credit:'0'},{account_id:bank,debit:'0',credit:'10'}]}})).statusCode).toBe(409);
 expect((await call('POST','/vouchers',{id:randomUUID(),payload:{date,voucher_type:'PETTY_CASH',cash_account_id:drawer,counter_account_id:expense,amount:'10'}})).statusCode).toBe(409);
});
it('rejects foreign tenant accounts and forged source/branch fields without partial drafts',async()=>{
 const foreignTid=randomUUID(),foreignAccount=randomUUID();
 sqlAdmin(`INSERT INTO tenants(id,code,name_ar) VALUES('${foreignTid}','LEDGER_OTHER','شركة أخرى');
 INSERT INTO accounts(id,tenant_id,code,name_ar,level,account_type,normal_balance) VALUES('${foreignAccount}','${foreignTid}','1','رئيسي','MAIN','ASSET','DEBIT')`);
 const id=randomUUID();expect((await call('POST','/journals',{id,payload:{...payload(),lines:[{account_id:foreignAccount,debit:'1',credit:'0'}]}})).statusCode).toBe(409);
 expect(sqlAdmin(`SELECT count(*) FROM journal_entries WHERE id='${id}'`)).toBe('0');
 expect((await call('POST','/journals',{id:randomUUID(),payload:{...payload(),source_type:'SALES_INVOICE'}})).statusCode).toBe(400);
 expect((await call('GET',`/journals/${randomUUID()}`)).statusCode).toBe(404);
});
