import { screens } from './screens';
const Invoices = screens[1].component;
const Shift = screens[2].component;
const Conflicts = screens[3].component;
const Account = screens[4].component;
import { Suspense, useCallback, useEffect, useState } from 'react';
import { api, ApiError, getToken, setToken, type Bootstrap } from './api';
import { clearAll, clearBoot, flush, queue, failed, init, loadBoot, saveBoot } from './offline';
import Login from './screens/Login';
import OpenShift from './screens/OpenShift';
import Pos from './screens/Pos';
import { useTab } from './Workstation';
import AppShell from './ui/AppShell';
import { ListScreen, DetailScreen, FormScreen } from './ui/templates';

export default function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const [ready, setReady] = useState(false);
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [pending, setPending] = useState(0);
  const [problems, setProblems] = useState(0);
  const tab = useTab();
  const [loadError, setLoadError] = useState('');
  const [forced2fa, setForced2fa] = useState(false);

  const load = useCallback(async () => {
    try {
      const b = await api<Bootstrap>('/pos/bootstrap');
      await saveBoot(b); setBoot(b); setOffline(false); setLoadError(''); setForced2fa(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) setOffline(true);            // keep working from the cached copy
      else if (e instanceof ApiError && e.code === 'TWO_FA_ENROLLMENT_REQUIRED') setForced2fa(true);
      else if (!(e instanceof ApiError && e.status === 401)) setLoadError(e instanceof Error ? e.message : 'خطأ');
    }
  }, []);

  useEffect(() => {
    const sync = () => { setPending(queue().length); setProblems(failed().length); };
    const on = () => { setOffline(false); flush().then(load); };
    const off = () => setOffline(true);
    const out = () => { setAuthed(false); };
    window.addEventListener('erp:queue', sync); window.addEventListener('online', on); window.addEventListener('offline', off); window.addEventListener('erp:logout', out);
    const t = setInterval(() => { if (queue().length) flush(); }, 15000);
    return () => { window.removeEventListener('erp:queue', sync); window.removeEventListener('online', on); window.removeEventListener('offline', off); window.removeEventListener('erp:logout', out); clearInterval(t); };
  }, [load]);

  // open the local database first: the cached catalogue and any unsent sales must be there before anything is shown
  useEffect(() => { init().then(loadBoot).then((b) => { if (b) setBoot(b); setReady(true); }); }, []);
  useEffect(() => { if (authed && ready) { flush().then(load); } }, [authed, ready, load]);

  async function logout() {
    if (queue().length && !confirm('يوجد إيصالات لم تُرسل بعد وستبقى على هذا الجهاز. تسجيل الخروج؟')) return;
    setToken(null); if (queue().length) await clearBoot(); else await clearAll(); setBoot(null); setAuthed(false);
  }

  if (!ready) return <div className="center muted">جارٍ التحميل…</div>;
  if (!authed) return <Login onDone={() => setAuthed(true)} />;
  if (forced2fa) return <Suspense fallback={<p role="status">جارٍ التحميل…</p>}><main className="standalone workspace"><div className="page-intro"><div className="intro-copy"><h1>إعداد الحساب</h1><p>فعّل التحقق بخطوتين للمتابعة إلى مساحة العمل.</p></div></div><Account forced onChanged={() => { setForced2fa(false); load(); }} onLogout={logout} /></main></Suspense>;
  if (!boot) return <main className="center muted"><p role="status">{loadError || (offline ? 'تعذّر الاتصال بالخادم ولا توجد بيانات محفوظة.' : 'جارٍ التحميل…')}</p>{(loadError || offline) && <button className="btn" onClick={load}>إعادة المحاولة</button>}</main>;

  return <AppShell boot={boot} tab={tab} offline={offline} pending={pending} problems={problems} onLogout={logout}>
    <div hidden={tab !== 'pos'}>{boot.shift ? <Pos key={boot.shift.id} boot={boot} setBoot={setBoot} active={tab === 'pos'} /> : <OpenShift draftKey={`opening-shift:${boot.tenant_id}:${boot.user.id}`} onOpened={load} offline={offline} />}</div>
    {tab !== 'pos' && <Suspense fallback={<p role="status">جارٍ التحميل…</p>}><div className="module-content">
      {tab === 'invoices' && <ListScreen><Invoices boot={boot} offline={offline} /></ListScreen>}
      {tab === 'shift' && <DetailScreen><Shift boot={boot} reload={load} /></DetailScreen>}
      {tab === 'conflicts' && boot.perms?.reverse && <ListScreen><Conflicts boot={boot} reload={load} /></ListScreen>}
      {tab === 'account' && <FormScreen><Account forced={false} onChanged={load} onLogout={() => { setToken(null); clearBoot().then(() => { setBoot(null); setAuthed(false); }); }} /><button className="btn ghost mobile-logout" type="button" onClick={logout}>تسجيل الخروج من هذا الجهاز</button></FormScreen>}
    </div></Suspense>}
  </AppShell>;
}
