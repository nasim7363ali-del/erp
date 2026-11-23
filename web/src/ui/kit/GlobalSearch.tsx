import { useState } from 'react';
import { screens, type Permission } from '../../screens';
import Modal from '../overlay/Modal';
export function GlobalSearch({ perms }: { perms?: Record<Permission, boolean> }) {
  const [open, setOpen] = useState(false); const [query, setQuery] = useState('');
  const visible = screens.filter(s => (!s.requiredPerm || perms?.[s.requiredPerm]) && `${s.title} ${s.description}`.includes(query));
  return <><button type="button" className="btn ghost no-print" onClick={() => setOpen(true)} aria-haspopup="dialog">القائمة والبحث</button>
    {open && <Modal title="القائمة والبحث" onClose={() => setOpen(false)}><label>ابحث عن شاشة<input autoFocus type="search" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <nav aria-label="جميع الشاشات">{visible.map(s => <a className="btn" key={s.id} href={s.route} onClick={() => setOpen(false)}>{s.title}</a>)}</nav>
      {!visible.length && <p role="status">لا توجد نتائج</p>}
    </Modal>}</>;
}
