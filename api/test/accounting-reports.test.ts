import { beforeAll,afterAll,it,expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startApp,login,auth,sqlAdmin } from './helpers.js';
let ctx:Awaited<ReturnType<typeof startApp>>, token:string,tid:string,branch:string,uid:string,fy:string,account:string,counter:string;
const get=(path:string,t=token)=>ctx.app.inject({url:'/api/accounting/'+path,headers:auth(t)});
const query=(from='2038-02-01',to='2038-02-28')=>`fiscal_year_id=${fy}&from=${from}&to=${to}`;
function journal(date:string,amount:string,post=true,b=branch){
 const id=randomUUID();
 sqlAdmin(`BEGIN; SELECT set_config('app.current_tenant_id','${tid}',true);
 INSERT INTO journal_entries(id,tenant_id,branch_id,fiscal_year_id,entry_date,source_type,created_by) VALUES('${id}','${tid}','${b}','${fy}','${date}','REPORT_TEST','${uid}');
 INSERT INTO journal_lines(tenant_id,journal_entry_id,account_id,currency_id,debit_original,debit_base,credit_original,credit_base)
 VALUES('${tid}','${id}','${account}',fn_base_currency('${tid}'),${amount},${amount},0,0),('${tid}','${id}','${counter}',fn_base_currency('${tid}'),0,0,${amount},${amount});
 ${post?`SELECT post_journal_entry('${tid}','${id}','${uid}');`:''} COMMIT;`);
 return id;
}
beforeAll(async()=>{
 ctx=await startApp();const m=await login(ctx.app,'mgr');token=m.token;tid=m.session.tid;uid=m.session.uid;branch=m.session.branch;
 // Read authoritative IDs rather than depending on session projection details.
 uid=sqlAdmin(`SELECT id FROM users WHERE tenant_id='${tid}' AND username='mgr'`);
 branch=sqlAdmin(`SELECT branch_id FROM users WHERE id='${uid}'`);
 fy=randomUUID();account=randomUUID();counter=randomUUID();
 sqlAdmin(`INSERT INTO fiscal_years(id,tenant_id,name,start_date,end_date) VALUES('${fy}','${tid}','REPORT2038','2038-01-01','2038-12-31');
 INSERT INTO accounts(id,tenant_id,code,name_ar,level,account_type,normal_balance) VALUES
 ('${account}','${tid}','RPT1','تقرير أول','ANALYTICAL','ASSET','DEBIT'),('${counter}','${tid}','RPT2','تقرير مقابل','ANALYTICAL','ASSET','DEBIT');`);
 journal('2038-01-15','10.1001');journal('2038-02-10','0.2002');journal('2038-03-01','700');journal('2038-02-11','999',false);
 const other=randomUUID();sqlAdmin(`INSERT INTO branches(id,tenant_id,code,name_ar) VALUES('${other}','${tid}','RPT_OTHER','فرع آخر')`);journal('2038-02-12','888',true,other);
});
afterAll(async()=>{await ctx.app.close();await ctx.pool.end();});
it('reports posted branch movement, exact opening and closing, excluding drafts and later dates',async()=>{
 const r=await get('trial-balance?'+query());expect(r.statusCode).toBe(200);
 const b=r.json();expect(b.scope).toBe('BRANCH');expect(b.currency).toBe('BASE');
 expect(b.rows.find((r:any)=>r.account_id===account)).toMatchObject({opening:'10.1001',debit:'0.2002',credit:'0',closing:'10.3003'});
 expect(Number(b.totals.debit)).toBe(Number(b.totals.credit));expect(Number(b.totals.closing)).toBe(0);
});
it('statement includes opening plus movement as running balance, including empty pages',async()=>{
 const r=await get(`account-statement?${query()}&account_id=${account}`);expect(r.statusCode).toBe(200);const b=r.json();
 expect(b).toMatchObject({opening:'10.1001',debit:'0.2002',credit:'0',closing:'10.3003',count:1});expect(b.rows[0].balance).toBe('10.3003');
 const empty=(await get(`account-statement?${query()}&account_id=${account}&offset=50`)).json();expect(empty.rows).toEqual([]);expect(empty.closing).toBe('10.3003');
});
it('keeps running balance across pages and uses deterministic tie ordering',async()=>{
 // 51 distinct lines on a shared date; posting from DB is intentional, covering non-manual sources too.
 for(let i=0;i<51;i++)journal('2038-04-01','1.0001');
 const url=`account-statement?${query('2038-04-01','2038-04-30')}&account_id=${account}`;
 const a=(await get(url)).json(),b=(await get(url+'&offset=50')).json();
 expect(a.rows).toHaveLength(50);expect(b.rows).toHaveLength(1);expect(b.rows[0].balance).toBe('761.3054');
 expect(b.rows[0].line_id).not.toBe(a.rows[49].line_id);expect((await get(url)).json().rows).toEqual(a.rows);
});
it('retains original and mirror reversal rather than dropping original history',async()=>{
 const id=randomUUID();const p={date:'2038-05-01',lines:[{account_id:account,debit:'3',credit:'0'},{account_id:counter,debit:'0',credit:'3'}]};
 for(const [path,body] of [['journals',{id,payload:p}],[`journals/${id}/post`,{revision:1}],[`journals/${id}/reverse`,{date:'2038-05-02',reason:'تقرير عكس'}]] as const){
 const r=await ctx.app.inject({method:'POST',url:'/api/accounting/'+path,headers:auth(token),payload:body});expect(r.statusCode).toBeLessThan(300);}
 const b=(await get(`account-statement?${query('2038-05-01','2038-05-31')}&account_id=${account}`)).json();expect(b.count).toBe(2);expect(b.rows[0].reversed).toBe(true);expect(b.rows[1].reverses_entry_id).toBe(id);expect(b.rows[1].balance).toBe(b.opening);
});
it('rejects invalid periods, missing accounts, foreign IDs and invalid pagination',async()=>{
 expect((await get('trial-balance?'+query('2038-03-01','2038-02-01'))).statusCode).toBe(400);
 expect((await get('trial-balance?'+query('2037-12-31','2038-02-01'))).statusCode).toBe(400);
 expect((await get('trial-balance?'+query().replace(fy,randomUUID()))).statusCode).toBe(404);
 expect((await get('account-statement?'+query())).statusCode).toBe(400);
 expect((await get(`account-statement?${query()}&account_id=${randomUUID()}`)).statusCode).toBe(404);
 expect((await get(`account-statement?${query()}&account_id=${account}&offset=-1`)).statusCode).toBe(400);
});
it('requires all report permissions and refreshes grants on each request',async()=>{
 const cashier=(await login(ctx.app,'cashier')).token;expect((await get('report-options',cashier)).statusCode).toBe(403);
 const role=sqlAdmin(`SELECT role_id FROM users WHERE id='${uid}'`);
 try {sqlAdmin(`UPDATE roles SET can_view_cost=false WHERE id='${role}'`);expect((await get('trial-balance?'+query())).statusCode).toBe(403);}
 finally {sqlAdmin(`UPDATE roles SET can_view_cost=true WHERE id='${role}'`);}
 try {sqlAdmin(`UPDATE roles SET can_view_cash_balance=false WHERE id='${role}'`);expect((await get('report-options')).statusCode).toBe(403);}
 finally {sqlAdmin(`UPDATE roles SET can_view_cash_balance=true WHERE id='${role}'`);}
 expect((await get('report-options')).statusCode).toBe(200);
});
