import { api } from '../../api';
import { useEffect, useState } from 'react';
import { CodeNamePicker, type Props, type CatalogState } from './CodeNamePicker';
import { loadReferences, refreshReferences, type RefCache, type Reference } from '../../ref-cache';
/** Tenant/user-scoped, cache-first reference selector. UUID values, never display labels. */
function ReferencePickerInner({ tenant, user, ...props }: Omit<Props, 'records' | 'catalogState'> & { tenant: string; user: string }) {
  const [cache, setCache] = useState<RefCache>();
  const [state, setState] = useState<CatalogState>('loading');
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState<Reference[]>([]);
  const key = props.kind === 'account' ? 'accounts' : props.kind === 'item' ? 'items' : 'parties';
  useEffect(() => {
    let active = true;
    if (!cache?.hasMore?.[key] || !query || !navigator.onLine) return;
    const timer = setTimeout(() => { void api<{ tenant_id: string; records: Reference[] }>(`/ref-search/${key}?q=${encodeURIComponent(query)}`).then(r => { if (active && r.tenant_id === tenant) setRemote(previous => [...new Map([...previous.filter(row => row.id === props.value), ...r.records].map(row => [row.id, row])).values()]); }).catch(() => {}); }, 180);
    return () => { active = false; clearTimeout(timer); };
  }, [cache, key, query, tenant, user]);
  useEffect(() => {
    let active = true; setCache(undefined); setState('loading');
    const run = async () => {
      const local = await loadReferences(tenant, user).catch(() => undefined);
      if (active && local) { setCache(local); setState(navigator.onLine ? 'ready' : 'offline'); }
      try { const fresh = await refreshReferences(tenant, user); if (active) { setCache(fresh); setState('ready'); } }
      catch { if (active) setState(local ? 'offline' : 'error'); }
    };
    void run(); return () => { active = false; };
  }, [tenant, user, revision]);
  const group: Reference[] = !cache ? [] : props.kind === 'account' ? cache.accounts : props.kind === 'item' ? cache.items
    : cache.parties.filter(p => props.kind === 'party' || p.party_type === 'BOTH' || p.party_type === props.kind.toUpperCase());
  const combined = [...new Map([...group, ...remote.filter(r => key !== 'parties' || props.kind === 'party' || r.party_type === 'BOTH' || r.party_type === props.kind.toUpperCase())].map(r => [r.id, r])).values()];
  const records = combined.map(r => ({ code: r.code, name: r.name_ar, value: r.id, barcode: r.barcode, phone: r.phone, meta: '', price: Number(r.price ?? 0),
    restriction: !r.is_active ? 'inactive' as const : props.kind === 'account' && !r.is_analytical ? 'group' as const : r.is_system ? 'system' as const : undefined }));
  return <div className="erp picker-surface"><CodeNamePicker {...props} onSearch={setQuery} records={records} context={{ ...props.context, hideStock: true }} catalogState={state} storageKey={`${tenant}:${user}`}
    cacheAgeDays={cache ? (Date.now() - Date.parse(cache.cachedAt)) / 86400000 : 0} onRetry={() => setRevision(v => v + 1)} />{cache?.hasMore?.[key] && <p role="status">القائمة المحلية جزئية؛ يتوفر البحث الكامل عند الاتصال بالإنترنت</p>}</div>;
}

export function ReferencePicker(props: Parameters<typeof ReferencePickerInner>[0]) { return <ReferencePickerInner key={`${props.tenant}:${props.user}`} {...props} />; }
