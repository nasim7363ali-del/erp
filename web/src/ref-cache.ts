import { api } from './api';
import { idbGet, idbSet } from './idb';
export interface Reference { id: string; code: string; name_ar: string; is_active: boolean; barcode?: string; phone?: string; party_type?: string; is_analytical?: boolean; is_system?: boolean; price?: string }
export interface RefCache { tenant_id: string; cachedAt: string; accounts: Reference[]; parties: Reference[]; items: Reference[]; warehouses: Reference[] }
export const referenceKey = (tenant: string, user: string) => `references:${tenant}:${user}`;
export const staleReferences = (cachedAt: string) => !Number.isFinite(Date.parse(cachedAt)) || Date.now() - Date.parse(cachedAt) > 86400000;
export function loadReferences(tenant: string, user: string) { return idbGet<RefCache>(referenceKey(tenant, user), 'references'); }
export async function refreshReferences(tenant: string, user: string) {
  const data = await api<RefCache>('/ref-cache');
  if (data.tenant_id !== tenant) throw new Error('مرجع بيانات لشركة مختلفة');
  await idbSet(referenceKey(tenant, user), data, 'references');
  return data;
}
