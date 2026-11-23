import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant, type Client } from '../db.js';
import { requirePerm } from '../rbac.js';
import { HttpError } from '../errors.js';
const baseFilters = z.object({ fiscal_year_id:z.string().uuid(), from:z.iso.date(), to:z.iso.date(),
  account_id:z.string().uuid().optional(), offset:z.coerce.number().int().min(0).max(1000000).default(0) });
const filters=baseFilters.refine(v=>v.from<=v.to,{message:'بداية الفترة بعد نهايتها'});
async function period(c:Client, id:string, from:string, to:string) {
 const fy=(await c.query('SELECT id,name,start_date,end_date FROM fiscal_years WHERE id=$1',[id])).rows[0];
 if(!fy)throw new HttpError(404,'NOT_FOUND','السنة المالية غير موجودة');
 if(from<fy.start_date||to>fy.end_date)throw new HttpError(400,'BAD_REQUEST','يجب أن تكون الفترة ضمن السنة المالية');
 return fy;
}
export async function accountingReportRoutes(app:FastifyInstance) {
 // Full ledger reports reveal cash balances and inventory/expense costs. All three gates are intentional.
 const access={preHandler:[app.authenticate,requirePerm('manageAccounting'),requirePerm('cashview'),requirePerm('viewCost')]};
 app.get('/report-options',access,req=>withTenant(app.pool,req.user.tid,async c=>({
  years:(await c.query('SELECT id,name,start_date,end_date,is_closed FROM fiscal_years ORDER BY start_date DESC')).rows,
  accounts:(await c.query('SELECT id,code,name_ar FROM accounts WHERE is_analytical ORDER BY code')).rows,
  scope:'BRANCH',currency:'BASE',
 })));
 app.get('/trial-balance',access,async req=>{
  const f=baseFilters.omit({account_id:true,offset:true}).refine(v=>v.from<=v.to,{message:'بداية الفترة بعد نهايتها'}).parse(req.query);
  return withTenant(app.pool,req.user.tid,async c=>{
   const year=await period(c,f.fiscal_year_id,f.from,f.to);
   const rows=(await c.query(`SELECT a.id AS account_id,a.code,a.name_ar,
     COALESCE(SUM(l.debit_base-l.credit_base) FILTER(WHERE j.entry_date<$3::date),0)::text AS opening,
     COALESCE(SUM(l.debit_base) FILTER(WHERE j.entry_date>=$3::date),0)::text AS debit,
     COALESCE(SUM(l.credit_base) FILTER(WHERE j.entry_date>=$3::date),0)::text AS credit,
     SUM(l.debit_base-l.credit_base)::text AS closing
     FROM journal_entries j JOIN journal_lines l ON l.tenant_id=j.tenant_id AND l.journal_entry_id=j.id
     JOIN accounts a ON a.tenant_id=l.tenant_id AND a.id=l.account_id
     WHERE j.branch_id=$1 AND j.fiscal_year_id=$2 AND j.status='POSTED' AND j.entry_date<=$4::date
     GROUP BY a.id,a.code,a.name_ar ORDER BY a.code`,[req.user.branch,f.fiscal_year_id,f.from,f.to])).rows;
   const totals=(await c.query(`SELECT COALESCE(SUM(l.debit_base-l.credit_base) FILTER(WHERE j.entry_date<$3::date),0)::text AS opening,
     COALESCE(SUM(l.debit_base) FILTER(WHERE j.entry_date>=$3::date),0)::text AS debit,
     COALESCE(SUM(l.credit_base) FILTER(WHERE j.entry_date>=$3::date),0)::text AS credit,
     COALESCE(SUM(l.debit_base-l.credit_base),0)::text AS closing
     FROM journal_entries j JOIN journal_lines l ON l.tenant_id=j.tenant_id AND l.journal_entry_id=j.id
     WHERE j.branch_id=$1 AND j.fiscal_year_id=$2 AND j.status='POSTED' AND j.entry_date<=$4::date`,[req.user.branch,f.fiscal_year_id,f.from,f.to])).rows[0];
   return {year,from:f.from,to:f.to,scope:'BRANCH',currency:'BASE',rows,totals};
  }, {readOnlySnapshot:true});
 });
 app.get('/account-statement',access,async req=>{
  const f=filters.parse(req.query);
  if(!f.account_id)throw new HttpError(400,'BAD_REQUEST','اختر الحساب');
  return withTenant(app.pool,req.user.tid,async c=>{
   const year=await period(c,f.fiscal_year_id,f.from,f.to);
   const account=(await c.query('SELECT id,code,name_ar FROM accounts WHERE id=$1 AND is_analytical',[f.account_id])).rows[0];
   if(!account)throw new HttpError(404,'NOT_FOUND','الحساب التحليلي غير موجود');
   // One snapshot for opening, totals and all page balances; pagination never resets the running balance.
   const result=(await c.query(`WITH movements AS (
      SELECT j.id AS journal_entry_id,l.id AS line_id,j.entry_no,j.entry_date,j.created_at,j.source_type,j.reference_no,
       COALESCE(l.line_description,j.description) AS description,l.debit_base,l.credit_base,
       EXISTS(SELECT 1 FROM journal_entries r WHERE r.tenant_id=j.tenant_id AND r.reverses_entry_id=j.id AND r.status='POSTED') AS reversed,
       j.reverses_entry_id
      FROM journal_entries j JOIN journal_lines l ON l.tenant_id=j.tenant_id AND l.journal_entry_id=j.id
      WHERE j.branch_id=$1 AND j.fiscal_year_id=$2 AND j.status='POSTED' AND l.account_id=$3 AND j.entry_date<=$5::date
    ), totals AS (
      SELECT COALESCE(SUM(debit_base-credit_base) FILTER(WHERE entry_date<$4::date),0) AS opening,
       COALESCE(SUM(debit_base) FILTER(WHERE entry_date>=$4::date),0) AS debit,
       COALESCE(SUM(credit_base) FILTER(WHERE entry_date>=$4::date),0) AS credit,
       COALESCE(SUM(debit_base-credit_base),0) AS closing,
       COUNT(*) FILTER(WHERE entry_date>=$4::date)::int AS count FROM movements
    ), running AS (
      SELECT *,SUM(debit_base-credit_base) OVER(ORDER BY entry_date,created_at,journal_entry_id,line_id ROWS UNBOUNDED PRECEDING)::text AS balance FROM movements
    ), page AS (
      SELECT journal_entry_id,line_id,entry_no,entry_date,source_type,reference_no,description,
       debit_base::text AS debit,credit_base::text AS credit,balance,reversed,reverses_entry_id
      FROM running WHERE entry_date>=$4::date ORDER BY entry_date,created_at,journal_entry_id,line_id LIMIT 50 OFFSET $6
    ) SELECT opening::text,debit::text,credit::text,closing::text,count,
      COALESCE((SELECT jsonb_agg(page) FROM page),'[]'::jsonb) AS rows FROM totals`,[req.user.branch,f.fiscal_year_id,f.account_id,f.from,f.to,f.offset])).rows[0];
   return {year,account,from:f.from,to:f.to,scope:'BRANCH',currency:'BASE',offset:f.offset,limit:50,...result};
  }, {readOnlySnapshot:true});
 });
}
