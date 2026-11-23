import type { FastifyRequest } from 'fastify';
import type { Client } from './db.js';
import { HttpError } from './errors.js';

export interface Permissions { post: boolean; reverse: boolean; cashview: boolean; viewCost: boolean; giveDiscount: boolean; manageUsers: boolean; manageAccounting: boolean }
export type Permission = keyof Permissions;
export async function loadPermissions(c: Client, uid: string): Promise<Permissions> {
  const r = (await c.query(`SELECT r.can_post, r.can_reverse, r.can_view_cash_balance, r.can_view_cost,
    r.can_give_discount, r.permissions_json FROM users u JOIN roles r ON r.id=u.role_id AND r.tenant_id=u.tenant_id
    WHERE u.id=$1 AND u.is_active`, [uid])).rows[0];
  return { post: r?.can_post === true, reverse: r?.can_reverse === true, cashview: r?.can_view_cash_balance === true,
    viewCost: r?.can_view_cost === true, giveDiscount: r?.can_give_discount === true,
    manageAccounting: r?.permissions_json?.manageAccounting === true,
    manageUsers: r?.permissions_json?.manageUsers === true };
}
export function requirePerm(perm: Permission) {
  return async (req: FastifyRequest) => {
    if (!req.user?.perms?.[perm]) throw new HttpError(403, 'PERMISSION_DENIED', `يلزم صلاحية ${perm}`);
  };
}
const costFields = new Set(['unit_cost', 'moving_avg_cost', 'profit', 'gross_profit', 'cost_total', 'default_purchase_price']);
/** Non-mutating recursive response projection. Explicit SQL projections remain preferred. */
export function stripCostFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripCostFields);
  if (!value || typeof value !== 'object' || value instanceof Date || Buffer.isBuffer(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !costFields.has(key)).map(([key, val]) => [key, stripCostFields(val)]));
}
