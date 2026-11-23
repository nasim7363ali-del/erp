import { useEffect, useState, useSyncExternalStore, type ComponentProps } from 'react';
import Workstation from '../Workstation';
import { resolveScreen, screens } from '../screens';
import { loadReferences, refreshReferences, staleReferences } from '../ref-cache';
const subscribe = (fn: () => void) => { window.addEventListener('hashchange', fn); return () => window.removeEventListener('hashchange', fn); };
export default function AppShell(props: ComponentProps<typeof Workstation>) {
  const [stale, setStale] = useState(false);
  const { boot } = props;
  useEffect(() => {
    let active = true;
    if (!boot.tenant_id) return;
    const tid = boot.tenant_id, uid = boot.user.id;
    void loadReferences(tid, uid).then(data => { if (active) setStale(!!data && staleReferences(data.cachedAt)); }).catch(() => {});
    if (!props.offline) void refreshReferences(tid, uid).then(() => { if (active) setStale(false); }).catch(() => {});
    return () => { active = false; };
  }, [boot.tenant_id, boot.user.id, props.offline]);
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  const route = resolveScreen(hash || '#/pos');
  const denied = route?.requiredPerm && !boot.perms?.[route.requiredPerm];
  return <Workstation {...props}>
    {stale && <p role="status">القائمة محفوظة على الجهاز — آخر تحديث منذ أكثر من 24 ساعة</p>}
    {props.offline && route?.offlinePolicy === 'online-only' && <p className="warnbox" role="status">يلزم اتصال بالإنترنت — تبقى البيانات المحلية محفوظة</p>}
    {!route ? <section role="alert"><h2>404 — الشاشة غير موجودة</h2>{screens.map(s => <a key={s.id} href={s.route}>{s.title} </a>)}</section>
      : denied ? <p role="alert">403 — يلزم صلاحية {route.requiredPerm}</p> : null}
    <div hidden={!route || !!denied}>{props.children}</div>
  </Workstation>;
}
