import { lazy } from 'react';
import { Clock3, LayoutGrid, ReceiptText, RefreshCw, UserRound, BookOpen, Network } from 'lucide-react';
export type Permission = 'post' | 'reverse' | 'cashview' | 'viewCost' | 'giveDiscount' | 'manageUsers' | 'manageAccounting';
export const screens = [
  { id: 'pos', route: '#/pos', title: 'نقطة البيع', description: 'أضف الأصناف إلى السلة وأتمم عملية البيع من مكان واحد.', icon: LayoutGrid, module: 'sales', section: 'operations', pattern: 'form', requiredPerm: null, offlinePolicy: 'offline-capable', component: lazy(() => import('./screens/Pos')) },
  { id: 'invoices', route: '#/invoices', title: 'الفواتير', description: 'راجع المبيعات والمرتجعات.', icon: ReceiptText, module: 'sales', section: 'operations', pattern: 'list', requiredPerm: null, offlinePolicy: 'online-only', component: lazy(() => import('./screens/Invoices')) },
  { id: 'shift', route: '#/shift', title: 'الوردية', description: 'راجع العهدة النقدية وحركة المبيعات.', icon: Clock3, module: 'sales', section: 'reports', pattern: 'detail', requiredPerm: null, offlinePolicy: 'online-only', component: lazy(() => import('./screens/Shift')) },
  { id: 'conflicts', route: '#/conflicts', title: 'المزامنة', description: 'تابع الإيصالات المعلّقة.', icon: RefreshCw, module: 'sales', section: 'operations', pattern: 'list', requiredPerm: 'reverse', offlinePolicy: 'online-only', component: lazy(() => import('./screens/Conflicts')) },
  { id: 'account', route: '#/account', title: 'حسابي', description: 'إعدادات الأمان والجلسات.', icon: UserRound, module: 'system', section: 'setup', pattern: 'form', requiredPerm: null, offlinePolicy: 'online-only', component: lazy(() => import('./screens/Account')) },
  { id: 'accounts', route: '#/accounting/accounts', title: 'دليل الحسابات', description: 'إدارة شجرة الحسابات دون تغيير القيود التاريخية.', icon: BookOpen, module: 'accounting', section: 'setup', pattern: 'list', requiredPerm: 'manageAccounting', offlinePolicy: 'online-only', component: lazy(() => import('./screens/Accounts')) },
  { id: 'cost-centers', route: '#/accounting/cost-centers', title: 'مراكز التكلفة', description: 'تنظيم مراكز التكلفة وتفعيلها وتعطيلها.', icon: Network, module: 'accounting', section: 'setup', pattern: 'list', requiredPerm: 'manageAccounting', offlinePolicy: 'online-only', component: lazy(() => import('./screens/CostCenters')) },
] as const;
export type ScreenId = typeof screens[number]['id'];
export function resolveScreen(hash: string) { return screens.find(s => s.route === hash || `#${s.id}` === hash); }
export function searchScreens(query: string) { return screens.filter(s => `${s.title} ${s.description}`.includes(query)); }
