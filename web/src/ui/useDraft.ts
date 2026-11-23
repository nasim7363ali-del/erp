import { useEffect, useState } from 'react';
import { idbGet, idbSet, idbDel } from '../idb';
/** Use only for nonsensitive business drafts. Never persist passwords or 2FA codes. */
export function useDraft(key: string, value: string, restore: (value: string) => void) {
  const [saved, setSaved] = useState<string>();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true; setReady(false);
    void idbGet<string>(key, 'drafts').then(v => { if (active) { setSaved(v); setReady(true); } }).catch(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, [key]);
  useEffect(() => {
    if (!ready || saved !== undefined) return;
    const timer = setTimeout(() => { void idbSet(key, value, 'drafts').catch(() => {}); }, 350);
    return () => clearTimeout(timer);
  }, [key, value, ready, saved]);
  const discard = () => { setSaved(undefined); void idbDel(key, 'drafts').catch(() => {}); };
  return { saved, discard, restore: () => { if (saved !== undefined) restore(saved); setSaved(undefined); } };
}
