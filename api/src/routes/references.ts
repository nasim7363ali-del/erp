import type { FastifyInstance } from 'fastify';
import { withTenant } from '../db.js';

export async function referenceRoutes(app: FastifyInstance) {
  app.get('/ref-cache', { preHandler: app.authenticate, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async req =>
    withTenant(app.pool, req.user.tid, async c => {
      const accounts = (await c.query('SELECT id, code, name_ar, is_active, is_analytical, is_system FROM accounts ORDER BY code')).rows;
      const parties = (await c.query('SELECT id, code, name_ar, party_type, phone, is_active FROM parties ORDER BY code')).rows;
      const items = (await c.query('SELECT id, item_code AS code, name_ar, barcode, base_unit_id, default_sale_price AS price, is_active FROM items ORDER BY item_code')).rows;
      const warehouses = (await c.query('SELECT id, code, name_ar, is_active FROM warehouses ORDER BY code')).rows;
      return { tenant_id: req.user.tid, cachedAt: new Date().toISOString(), accounts, parties, items, warehouses };
    }));
}
