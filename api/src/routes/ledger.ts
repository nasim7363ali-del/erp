import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant, type Client } from '../db.js';
import { requirePerm } from '../rbac.js';
import { deviceInfo } from '../app.js';
import { HttpError } from '../errors.js';
const money = z.string().regex(/^\d{1,14}(\.\d{1,4})?$/,'أدخل مبلغًا دقيقًا حتى أربع منازل عشرية');
const date = z.iso.date();
const nullableId = z.string().uuid().nullable().default(null);
const header = { date, description:z.string().trim().max(2000).default(''), reference_no:z.string().trim().max(80).default('') };
const line = z.strictObject({ account_id:z.string().uuid(), party_id:nullableId, cost_center_id:nullableId, debit:money, credit:money })
  .refine(l => (Number(l.debit)>0 && Number(l.credit)===0) || (Number(l.credit)>0 && Number(l.debit)===0));
const journal = z.strictObject({...header, lines:z.array(line).min(1).max(200)});
const voucher = z.strictObject({...header,voucher_type:z.enum(['RECEIPT','PAYMENT','PETTY_CASH']),cash_account_id:z.string().uuid(),counter_account_id:z.string().uuid(),party_id:nullableId,cost_center_id:nullableId,shift_id:nullableId,amount:money.refine(v=>Number(v)>0)});
const idParam = z.object({id:z.string().uuid()});
const revision = z.strictObject({revision:z.number().int().positive()});
const reversal = z.strictObject({reason:z.string().trim().min(1).max(500), date, shift_id:nullableId});
async function owned(c:Client, kind:string, id:string, branch:string) {
  const table=kind==='JOURNAL'?'journal_entries':'vouchers';
  const row=(await c.query(`SELECT id FROM ${table} WHERE id=$1 AND branch_id=$2 ${kind==='JOURNAL'?"AND source_type='MANUAL'":''}`,[id,branch])).rows[0];
  if(!row) throw new HttpError(404,'NOT_FOUND','المستند غير موجود في هذا الفرع');
}
export async function ledgerRoutes(app:FastifyInstance) {
  const access={preHandler:[app.authenticate,requirePerm('manageAccounting')],config:{rateLimit:{max:120,timeWindow:'1 minute'}}};
  app.get('/document-options',access,req=>withTenant(app.pool,req.user.tid,async c=>({
    accounts:(await c.query('SELECT id,code,name_ar,account_type,is_active,is_analytical FROM accounts ORDER BY code')).rows,
    parties:(await c.query('SELECT id,code,name_ar,party_type,is_active FROM parties ORDER BY code')).rows,
    centers:(await c.query('SELECT id,code,name_ar,is_active FROM cost_centers ORDER BY code')).rows,
    shifts:(await c.query("SELECT id, cash_account_id,opened_at FROM pos_shifts WHERE branch_id=$1 AND status='OPEN' ORDER BY opened_at",[req.user.branch])).rows,
  })));
  for(const [path,kind,schema] of [['journals','JOURNAL',journal],['vouchers','VOUCHER',voucher]] as const) {
    const table=kind==='JOURNAL'?'journal_entries':'vouchers';
    app.get(`/${path}`,access,req=>withTenant(app.pool,req.user.tid,async c=>{
      const {limit,offset}=z.object({limit:z.coerce.number().int().min(1).max(100).default(40),offset:z.coerce.number().int().min(0).max(1000000).default(0)}).parse(req.query);
      const rows=(await c.query(`SELECT d.id,${kind==='JOURNAL'?'d.entry_no AS number,d.entry_date AS date':'d.voucher_no AS number,d.voucher_date AS date,d.voucher_type,d.amount_original AS amount'},d.status,d.description,v.revision,
        EXISTS(SELECT 1 FROM journal_entries r WHERE r.reverses_entry_id=${kind==='JOURNAL'?'d.id':'d.journal_entry_id'}) AS reversed
        FROM ${table} d JOIN accounting_document_versions v ON v.document_id=d.id AND v.tenant_id=d.tenant_id AND v.kind=$4
        WHERE d.branch_id=$1 ORDER BY ${kind==='JOURNAL'?'d.entry_date':'d.voucher_date'} DESC,d.id LIMIT $2 OFFSET $3`,[req.user.branch,limit,offset,kind])).rows;
      return {rows,limit,offset};
    }));
    app.get(`/${path}/:id`,access,async req=>{
      const {id}=idParam.parse(req.params);
      return withTenant(app.pool,req.user.tid,async c=>{
        await owned(c,kind,id,req.user.branch);
        const row=(await c.query(`SELECT d.*,v.revision FROM ${table} d JOIN accounting_document_versions v ON v.document_id=d.id AND v.tenant_id=d.tenant_id WHERE d.id=$1 AND v.kind=$2`,[id,kind])).rows[0];
        if(!row) throw new HttpError(404,'NOT_FOUND','المستند غير مسجل في مسار المحاسبة');
        const lines=kind==='JOURNAL'?(await c.query('SELECT id,account_id,party_id,cost_center_id,debit_original AS debit,credit_original AS credit FROM journal_lines WHERE journal_entry_id=$1 ORDER BY id',[id])).rows:undefined;
        const reverse=(await c.query('SELECT id,entry_date,description FROM journal_entries WHERE reverses_entry_id=$1',[kind==='JOURNAL'?id:row.journal_entry_id])).rows[0]??null;
        return {document:row,lines,reversal:reverse};
      });
    });
    app.post(`/${path}`,access,async(req,reply)=>{
      const b=z.strictObject({id:z.string().uuid(),payload:schema}).parse(req.body);
      const result=await withTenant(app.pool,req.user.tid,async c=>{
        await c.query('SELECT save_accounting_draft($1,$2,$3,$4::jsonb,$5,NULL,$6)',[req.user.tid,b.id,kind,JSON.stringify(b.payload),req.user.uid,deviceInfo(req)]);
        return (await c.query('SELECT document_id AS id,revision FROM accounting_document_versions WHERE document_id=$1',[b.id])).rows[0];
      }); return reply.code(201).send(result);
    });
    app.put(`/${path}/:id`,access,async req=>{
      const {id}=idParam.parse(req.params); const b=z.strictObject({revision:z.number().int().positive(),payload:schema}).parse(req.body);
      return withTenant(app.pool,req.user.tid,async c=>{
        await c.query('SELECT save_accounting_draft($1,$2,$3,$4::jsonb,$5,$6,$7)',[req.user.tid,id,kind,JSON.stringify(b.payload),req.user.uid,b.revision,deviceInfo(req)]);
        return (await c.query('SELECT document_id AS id,revision FROM accounting_document_versions WHERE document_id=$1',[id])).rows[0];
      });
    });
    app.post(`/${path}/:id/post`,{...access,preHandler:[...access.preHandler,requirePerm('post')]},async req=>{
      const {id}=idParam.parse(req.params),b=revision.parse(req.body);
      return withTenant(app.pool,req.user.tid,async c=>({journal_entry_id:(await c.query('SELECT post_accounting_document($1,$2,$3,$4,$5,$6) AS id',[req.user.tid,id,kind,req.user.uid,b.revision,deviceInfo(req)])).rows[0].id}));
    });
    app.post(`/${path}/:id/reverse`,{...access,preHandler:[...access.preHandler,requirePerm('reverse')]},async req=>{
      const {id}=idParam.parse(req.params),b=reversal.parse(req.body),s=req.user;
      return withTenant(app.pool,s.tid,async c=>{
        await owned(c,kind,id,s.branch);
        if(kind==='JOURNAL') {
          if(b.shift_id) throw new HttpError(400,'BAD_REQUEST','القيد اليدوي لا يرتبط بوردية');
          return {journal_entry_id:(await c.query('SELECT reverse_manual_journal($1,$2,$3,$4,$5::date,$6) AS id',[s.tid,id,s.uid,b.reason,b.date,deviceInfo(req)])).rows[0].id};
        }
        // Serialize exact retries; never replay a different reason/date/shift as a successful reversal.
        await c.query('SELECT id FROM vouchers WHERE id=$1 FOR UPDATE',[id]);
        const old=(await c.query("SELECT reversal_journal_entry_id,reason,reversal_date,shift_id FROM document_reversals WHERE source_type='VOUCHER' AND source_id=$1",[id])).rows[0];
        if(old) {
          if(old.reason!==b.reason || old.reversal_date!==b.date || old.shift_id!==b.shift_id) throw new HttpError(409,'REVERSAL_INVALID','سبق عكس المستند ببيانات مختلفة');
          return {journal_entry_id:old.reversal_journal_entry_id};
        }
        return {journal_entry_id:(await c.query('SELECT reverse_voucher($1,$2,$3,$4,$5,$6::date,$7) AS id',[s.tid,id,s.uid,b.reason,b.shift_id,b.date,deviceInfo(req)])).rows[0].id};
      });
    });
  }
}
