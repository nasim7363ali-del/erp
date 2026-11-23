import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startApp, login, auth, addUser, sqlAdmin } from './helpers.js';
import { requirePerm, stripCostFields } from '../src/rbac.js';
let ctx: Awaited<ReturnType<typeof startApp>>;
beforeAll(async () => {
  ctx = await startApp();
  ctx.app.get('/api/test/manage-users', { preHandler: [ctx.app.authenticate, requirePerm('manageUsers')] }, async () => ({ ok: true }));
  ctx.app.get('/api/test/costs', { preHandler: ctx.app.authenticate }, async () => ({ unit_cost: 10, lines: [{ profit: 2, moving_avg_cost: 8, qty: 1 }] }));
  addUser('rbac_test', 'cashier');
});
afterAll(async () => { await ctx.app.close(); await ctx.pool.end(); });
const get = (token: string, url: string) => ctx.app.inject({ method: 'GET', url, headers: auth(token) });
describe('Phase 0 authorization and references', () => {
  it('requires authentication for reference data', async () => {
    expect((await ctx.app.inject('/api/ref-cache')).statusCode).toBe(401);
  });
  it('issues explicit deny-by-default permissions and protects management', async () => {
    const { token, session } = await login(ctx.app, 'rbac_test');
    expect(session.perms).toMatchObject({ viewCost: false, giveDiscount: false, manageUsers: false });
    expect((await get(token, '/api/test/manage-users')).statusCode).toBe(403);
    expect((await get(token, '/api/sync-conflicts')).statusCode).toBe(403);
    expect((await get(token, '/api/test/costs')).json()).toEqual({ lines: [{ qty: 1 }] });
  });
  it('retains authorized cost fields and removes nested costs without mutation', async () => {
    const { token } = await login(ctx.app, 'mgr');
    expect((await get(token, '/api/test/costs')).json().unit_cost).toBe(10);
    const original = { unit_cost: 2, lines: [{ profit: 3, qty: 1 }] };
    expect(stripCostFields(original)).toEqual({ lines: [{ qty: 1 }] });
    expect(original.lines[0].profit).toBe(3);
  });
  it('denies both invoice-level and line-level discounts before any sale mutation', async () => {
    const { token } = await login(ctx.app, 'rbac_test');
    const body = { offline_uuid: randomUUID(), receipt_no: 'RBAC', invoice_date: '2026-11-23', shift_id: randomUUID(),
      lines: [{ item_id: randomUUID(), unit_id: randomUUID(), qty: 1, unit_price: 10 }], payments: [{ payment_method: 'CASH', amount: 9 }] };
    for (const payload of [{ ...body, discount_amount: 1 }, { ...body, lines: [{ ...body.lines[0], line_discount: 1 }] }]) {
      const result = await ctx.app.inject({ method: 'POST', url: '/api/sales', headers: auth(token), payload });
      expect(result.statusCode).toBe(403);
    }
  });
  it('returns only tenant-scoped reference projections, including cache identity/time', async () => {
    const { token, session } = await login(ctx.app, 'rbac_test');
    const r = await get(token, '/api/ref-cache');
    expect(r.statusCode).toBe(200);
    const data = r.json();
    expect(data.tenant_id).toBe(session.tid);
    expect(Number.isFinite(Date.parse(data.cachedAt))).toBe(true);
    expect(data.items.length).toBeGreaterThan(0);
    expect(JSON.stringify(data)).not.toMatch(/unit_cost|moving_avg_cost|password_hash|default_purchase_price/);
    expect(data.accounts.every((a: {id: string}) => sqlAdmin(`SELECT tenant_id FROM accounts WHERE id='${a.id}'`) === session.tid)).toBe(true);
  });
  it('reloads role permissions without waiting for JWT expiration', async () => {
    const { token } = await login(ctx.app, 'rbac_test');
    sqlAdmin(`INSERT INTO roles (tenant_id,name_ar,permissions_json)
      SELECT tenant_id,'RBAC test role','{"manageUsers":true}'::jsonb FROM users WHERE username='rbac_test';
      UPDATE users SET role_id=(SELECT id FROM roles WHERE name_ar='RBAC test role' AND tenant_id=users.tenant_id) WHERE username='rbac_test'`);
    expect((await get(token, '/api/test/manage-users')).statusCode).toBe(200);
    sqlAdmin(`UPDATE roles SET permissions_json='{}'::jsonb WHERE name_ar='RBAC test role'`);
    expect((await get(token, '/api/test/manage-users')).statusCode).toBe(403);
  });
});
