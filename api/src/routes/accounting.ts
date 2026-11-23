import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant, type Client } from '../db.js';
import { requirePerm } from '../rbac.js';
import { HttpError } from '../errors.js';

const idParams = z.object({ id: z.string().uuid() });
const code = z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/);
const parent = z.string().uuid().nullable().default(null);
const accountInput = z.strictObject({ code, name_ar: z.string().trim().min(1).max(200), name_en: z.string().trim().max(200).nullable().optional(),
  parent_id: parent, level: z.enum(['MAIN', 'SUB', 'ANALYTICAL']), account_type: z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']), normal_balance: z.enum(['DEBIT', 'CREDIT']) });
const centerInput = z.strictObject({ code, name_ar: z.string().trim().min(1).max(160), parent_id: parent });
const patchInput = z.strictObject({ name_ar: z.string().trim().min(1).max(200).optional(), name_en: z.string().trim().max(200).nullable().optional(), is_active: z.boolean().optional() }).refine(v => Object.keys(v).length > 0);
const centerPatch = z.strictObject({ name_ar: z.string().trim().min(1).max(160).optional(), is_active: z.boolean().optional() }).refine(v => Object.keys(v).length > 0);
const accountFields = 'id, parent_id, code, name_ar, name_en, level, account_type, normal_balance, is_system, is_active';
const centerFields = 'id, parent_id, code, name_ar, is_active';

// Serialize hierarchy mutations per tenant. Structural edits are deliberately not exposed:
// immutable code/parent/type/currency preserve ledger meaning and prevent cycles.
async function lock(c: Client, tid: string) { await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`accounting-setup:${tid}`]); }
async function audit(c: Client, tid: string, uid: string, action: string, table: string, id: string, before: unknown, after: unknown) {
  await c.query(`INSERT INTO audit_logs (tenant_id, user_id, action, table_name, record_id, old_json, new_json) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)`, [tid, uid, action, table, id, JSON.stringify(before), JSON.stringify(after)]);
}
function conflict(e: unknown): never {
  if ((e as {code?: string}).code === '23505') throw new HttpError(409, 'CODE_EXISTS', 'الرمز مستخدم بالفعل داخل هذه الشركة');
  throw e;
}
export async function accountingRoutes(app: FastifyInstance) {
  const access = { preHandler: [app.authenticate, requirePerm('manageAccounting')], config: { rateLimit: { max: 120, timeWindow: '1 minute' } } };
  app.get('/accounts', access, req => withTenant(app.pool, req.user.tid, async c => (await c.query(`SELECT ${accountFields} FROM accounts ORDER BY code`)).rows));
  app.get('/cost-centers', access, req => withTenant(app.pool, req.user.tid, async c => (await c.query(`SELECT ${centerFields} FROM cost_centers ORDER BY code`)).rows));
  app.post('/accounts', access, async (req, reply) => {
    const b = accountInput.parse(req.body), s = req.user;
    try {
      const row = await withTenant(app.pool, s.tid, async c => {
        await lock(c, s.tid);
        if ((b.level === 'MAIN') !== (b.parent_id === null)) throw new HttpError(400, 'ACCOUNT_RULE', 'الحساب الرئيسي بلا أب؛ بقية المستويات تحتاج حسابًا أبًا');
        if (b.parent_id) {
          const p = (await c.query('SELECT level, account_type, is_active FROM accounts WHERE id=$1 FOR KEY SHARE', [b.parent_id])).rows[0];
          if (!p) throw new HttpError(404, 'NOT_FOUND', 'الحساب الأب غير موجود');
          if (!p.is_active || p.account_type !== b.account_type || (b.level === 'SUB' ? p.level !== 'MAIN' : p.level !== 'SUB'))
            throw new HttpError(409, 'ACCOUNT_RULE', 'اختر حسابًا أبًا نشطًا من المستوى والنوع المناسبين');
        }
        const r = (await c.query(`INSERT INTO accounts (tenant_id,code,name_ar,name_en,parent_id,level,account_type,normal_balance)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${accountFields}`, [s.tid,b.code,b.name_ar,b.name_en ?? null,b.parent_id,b.level,b.account_type,b.normal_balance])).rows[0];
        await audit(c,s.tid,s.uid,'CREATE','accounts',r.id,null,r); return r;
      });
      return reply.code(201).send(row);
    } catch (e) { conflict(e); }
  });
  app.post('/cost-centers', access, async (req, reply) => {
    const b = centerInput.parse(req.body), s = req.user;
    try {
      const row = await withTenant(app.pool,s.tid,async c => {
        await lock(c,s.tid);
        if (b.parent_id) {
          const p = (await c.query('SELECT is_active FROM cost_centers WHERE id=$1 FOR KEY SHARE',[b.parent_id])).rows[0];
          if (!p) throw new HttpError(404,'NOT_FOUND','مركز التكلفة الأب غير موجود');
          if (!p.is_active) throw new HttpError(409,'PARENT_INACTIVE','مركز التكلفة الأب غير نشط');
        }
        const r = (await c.query(`INSERT INTO cost_centers (tenant_id,code,name_ar,parent_id) VALUES ($1,$2,$3,$4) RETURNING ${centerFields}`,[s.tid,b.code,b.name_ar,b.parent_id])).rows[0];
        await audit(c,s.tid,s.uid,'CREATE','cost_centers',r.id,null,r); return r;
      }); return reply.code(201).send(row);
    } catch (e) { conflict(e); }
  });
  for (const kind of ['accounts','cost-centers'] as const) {
    const table = kind === 'accounts' ? 'accounts' : 'cost_centers';
    app.patch(`/${kind}/:id`,access,async req => {
      const {id} = idParams.parse(req.params), s=req.user;
      const b = kind === 'accounts' ? patchInput.parse(req.body) : centerPatch.parse(req.body);
      return withTenant(app.pool,s.tid,async c => {
        await lock(c,s.tid);
        const row = (await c.query(`SELECT * FROM ${table} WHERE id=$1 FOR UPDATE`,[id])).rows[0];
        if (!row) throw new HttpError(404,'NOT_FOUND','السجل غير موجود');
        if (row.is_system) throw new HttpError(409,'SYSTEM_ACCOUNT','لا يمكن تعديل حساب نظامي');
        if (b.is_active === false && (await c.query(`SELECT 1 FROM ${table} WHERE parent_id=$1 AND is_active LIMIT 1`,[id])).rowCount)
          throw new HttpError(409,'ACTIVE_CHILDREN','عطّل السجلات الفرعية أولًا');
        if (b.is_active === true && row.parent_id) {
          const p = (await c.query(`SELECT is_active FROM ${table} WHERE id=$1`,[row.parent_id])).rows[0];
          if (!p?.is_active) throw new HttpError(409,'PARENT_INACTIVE','فعّل السجل الأب أولًا');
        }
        const entries = Object.entries(b); // keys are strictly validated above, never arbitrary SQL identifiers
        const updated = (await c.query(`UPDATE ${table} SET ${entries.map(([key],i)=>`${key}=$${i+2}`).join(',')} WHERE id=$1 RETURNING ${kind === 'accounts' ? accountFields : centerFields}`,[id,...entries.map(([,v])=>v)])).rows[0];
        await audit(c,s.tid,s.uid,'UPDATE',table,id,row,updated); return updated;
      });
    });
  }
}
