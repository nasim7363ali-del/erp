import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant } from '../db.js';
// Every identifier below is a static allowlisted projection, never user-provided SQL.
const catalogs = {
  accounts: { table: 'accounts', fields: 'id, code, name_ar, is_active, is_analytical, is_system', code: 'code' },
  parties: { table: 'parties', fields: 'id, code, name_ar, party_type, phone, is_active', code: 'code' },
  items: { table: 'items', fields: 'id, item_code AS code, name_ar, barcode, base_unit_id, default_sale_price AS price, is_active', code: 'item_code' },
  warehouses: { table: 'warehouses', fields: 'id, code, name_ar, is_active', code: 'code' },
} as const;
const keys = ['accounts', 'parties', 'items', 'warehouses'] as const;
export async function referenceRoutes(app: FastifyInstance) {
  const options = { preHandler: app.authenticate, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } };
  app.get('/ref-cache', options, async req => withTenant(app.pool, req.user.tid, async c => {
    const result: Record<string, unknown> = { tenant_id: req.user.tid, cachedAt: new Date().toISOString() };
    const hasMore: Record<string, boolean> = {};
    for (const key of keys) {
      const { table, fields, code } = catalogs[key];
      const rows = (await c.query(`SELECT ${fields} FROM ${table} ORDER BY ${code} LIMIT 5001`)).rows;
      hasMore[key] = rows.length > 5000; result[key] = rows.slice(0, 5000);
    }
    return { ...result, hasMore };
  }));
  app.get('/ref-search/:kind', options, async req => {
    const { kind } = z.object({ kind: z.enum(keys) }).parse(req.params);
    const { q } = z.object({ q: z.string().trim().min(1).max(100) }).parse(req.query);
    const { table, fields, code } = catalogs[kind];
    // Same core Arabic folding as the local picker; bind the search string as data.
    const fold = (sql: string) => `regexp_replace(translate(lower(${sql}), 'أإآٱةى٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', 'ااااهي01234567890123456789'), '[ؐ-ؚـً-ٰٟ]', '', 'g')`;
    return withTenant(app.pool, req.user.tid, async c => ({ tenant_id: req.user.tid,
      records: (await c.query(`SELECT ${fields} FROM ${table} WHERE position(${fold('$1::text')} in ${fold(`concat_ws(' ', ${code}, name_ar${kind === 'items' ? ', barcode' : kind === 'parties' ? ', phone' : ''})`)}) > 0 ORDER BY ${code} LIMIT 100`, [q])).rows }));
  });
}
