import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startApp, login, auth, sqlAdmin } from './helpers.js';
let ctx: Awaited<ReturnType<typeof startApp>>; let manager: string; let cashier: string;
const get = (path: string, token = manager) => ctx.app.inject({ method: 'GET', url: `/api/accounting/${path}`, headers: auth(token) });
const post = (path: string, payload: object, token = manager) => ctx.app.inject({ method: 'POST', url: `/api/accounting/${path}`, headers: auth(token), payload });
const patch = (path: string, payload: object) => ctx.app.inject({ method: 'PATCH', url: `/api/accounting/${path}`, headers: auth(manager), payload });
const base = { code: 'TROOT', name_ar: 'حساب اختباري', parent_id: null, level: 'MAIN', account_type: 'ASSET', normal_balance: 'DEBIT' };
let root: string, sub: string, analytical: string, center: string, childCenter: string, foreignAccount: string, foreignCenter: string;
beforeAll(async () => {
  ctx = await startApp(); manager = (await login(ctx.app, 'mgr')).token; cashier = (await login(ctx.app, 'cashier')).token;
  const tenant = randomUUID(); foreignAccount = randomUUID(); foreignCenter = randomUUID();
  sqlAdmin(`INSERT INTO tenants(id,code,name_ar) VALUES ('${tenant}','ACCOUNTING_FOREIGN','شركة أخرى');
    INSERT INTO accounts(id,tenant_id,code,name_ar,level,account_type,normal_balance) VALUES ('${foreignAccount}','${tenant}','FOREIGN','حساب شركة أخرى','MAIN','ASSET','DEBIT');
    INSERT INTO cost_centers(id,tenant_id,code,name_ar) VALUES ('${foreignCenter}','${tenant}','FOREIGN','مركز شركة أخرى')`);
});
afterAll(async () => { await ctx.app.close(); await ctx.pool.end(); });
describe('accounting master data', () => {
  it('requires explicit accounting management permission, not just posting permission', async () => {
    expect((await ctx.app.inject('/api/accounting/accounts')).statusCode).toBe(401);
    for (const kind of ['accounts','cost-centers']) {
      expect((await get(kind,cashier)).statusCode).toBe(403);
      expect((await post(kind,base,cashier)).statusCode).toBe(403);
      expect((await ctx.app.inject({method:'PATCH',url:`/api/accounting/${kind}/${randomUUID()}`,headers:auth(cashier),payload:{name_ar:'ممنوع'}})).statusCode).toBe(403);
    }
  });
  it('creates a three-level account tree with no financial postings', async () => {
    const before = sqlAdmin('SELECT count(*) FROM journal_entries');
    const a = await post('accounts',base); expect(a.statusCode).toBe(201); root=a.json().id;
    const b = await post('accounts',{...base,code:'TSUB',level:'SUB',parent_id:root}); expect(b.statusCode).toBe(201); sub=b.json().id;
    const c = await post('accounts',{...base,code:'TLEAF',level:'ANALYTICAL',parent_id:sub}); expect(c.statusCode).toBe(201); analytical=c.json().id;
    const list = (await get('accounts')).json();
    expect(list.find((r: {id:string}) => r.id===analytical).parent_id).toBe(sub);
    expect(sqlAdmin('SELECT count(*) FROM journal_entries')).toBe(before);
  });
  it('rejects duplicates, invalid hierarchy, invalid enum and forged fields', async () => {
    expect((await post('accounts',base)).statusCode).toBe(409);
    expect((await post('accounts',{...base,code:'BAD1',level:'ANALYTICAL',parent_id:root})).statusCode).toBe(409);
    expect((await post('accounts',{...base,code:'BAD2',level:'SUB',parent_id:analytical})).statusCode).toBe(409);
    expect((await post('accounts',{...base,code:'BAD3',level:'SUB',parent_id:root,account_type:'REVENUE'})).statusCode).toBe(409);
    expect((await post('accounts',{...base,code:'BAD4',level:'SUB'})).statusCode).toBe(400);
    expect((await post('accounts',{...base,code:'BAD5',level:'OTHER'})).statusCode).toBe(400);
    expect((await post('accounts',{...base,code:'BAD6',tenant_id:randomUUID()})).statusCode).toBe(400);
  });
  it('keeps structural identity immutable and system accounts protected', async () => {
    for (const value of [{parent_id:analytical},{code:'NEW'},{level:'MAIN'},{account_type:'REVENUE'},{normal_balance:'CREDIT'},{is_system:false},{}])
      expect((await patch(`accounts/${analytical}`,value)).statusCode).toBe(400);
    const system = (await get('accounts')).json().find((r: {is_system:boolean})=>r.is_system);
    expect(system).toBeDefined();
    expect((await patch(`accounts/${system.id}`,{name_ar:'تعديل ممنوع'})).statusCode).toBe(409);
  });
  it('deactivates children first, blocks inactive parents, and restores parent first', async () => {
    expect((await patch(`accounts/${root}`,{is_active:false})).statusCode).toBe(409);
    expect((await patch(`accounts/${analytical}`,{is_active:false})).statusCode).toBe(200);
    expect((await patch(`accounts/${sub}`,{is_active:false})).statusCode).toBe(200);
    expect((await post('accounts',{...base,code:'BAD7',level:'ANALYTICAL',parent_id:sub})).statusCode).toBe(409);
    expect((await patch(`accounts/${root}`,{is_active:false})).statusCode).toBe(200);
    expect((await patch(`accounts/${sub}`,{is_active:true})).statusCode).toBe(409);
    expect((await patch(`accounts/${root}`,{is_active:true})).statusCode).toBe(200);
    expect((await patch(`accounts/${sub}`,{is_active:true})).statusCode).toBe(200);
  });
  it('renames without touching historical lines and records before/after audit data', async () => {
    const before = sqlAdmin('SELECT count(*) FROM journal_lines');
    expect((await patch(`accounts/${root}`,{name_ar:'الاسم الجديد'})).statusCode).toBe(200);
    expect(sqlAdmin('SELECT count(*) FROM journal_lines')).toBe(before);
    expect(sqlAdmin(`SELECT new_json->>'name_ar' FROM audit_logs WHERE record_id='${root}' AND action='UPDATE' ORDER BY id DESC LIMIT 1`)).toBe('الاسم الجديد');
  });
  it('supports cost-center hierarchy and controlled activation', async () => {
    const r = await post('cost-centers',{code:'TCENTER',name_ar:'إدارة'}); expect(r.statusCode).toBe(201); center=r.json().id;
    const child = await post('cost-centers',{code:'TCHILD',name_ar:'فرع',parent_id:center}); expect(child.statusCode).toBe(201); childCenter=child.json().id;
    expect((await post('cost-centers',{code:'TCENTER',name_ar:'مكرر'})).statusCode).toBe(409);
    expect((await patch(`cost-centers/${center}`,{parent_id:childCenter})).statusCode).toBe(400);
    expect((await patch(`cost-centers/${center}`,{is_active:false})).statusCode).toBe(409);
    expect((await patch(`cost-centers/${childCenter}`,{is_active:false})).statusCode).toBe(200);
    expect((await patch(`cost-centers/${center}`,{is_active:false})).statusCode).toBe(200);
    expect((await post('cost-centers',{code:'BADCHILD',name_ar:'فرع',parent_id:center})).statusCode).toBe(409);
    expect((await patch(`cost-centers/${childCenter}`,{is_active:true})).statusCode).toBe(409);
  });
  it('does not expose or mutate another tenant records, including parent links', async () => {
    expect((await get('accounts')).json().some((r:{id:string})=>r.id===foreignAccount)).toBe(false);
    expect((await get('cost-centers')).json().some((r:{id:string})=>r.id===foreignCenter)).toBe(false);
    expect((await patch(`accounts/${foreignAccount}`,{name_ar:'ممنوع'})).statusCode).toBe(404);
    expect((await patch(`cost-centers/${foreignCenter}`,{is_active:false})).statusCode).toBe(404);
    expect((await post('accounts',{...base,code:'CROSS',level:'SUB',parent_id:foreignAccount})).statusCode).toBe(404);
    expect((await post('cost-centers',{code:'CROSS',name_ar:'ممنوع',parent_id:foreignCenter})).statusCode).toBe(404);
    expect((await patch(`accounts/${randomUUID()}`,{name_ar:'مفقود'})).statusCode).toBe(404);
  });
});
