import { test, expect } from '@playwright/test';
const boot = {
  tenant_id: 'tenant-a', perms: { post: true, reverse: false, cashview: false, viewCost: false, giveDiscount: false, manageUsers: false },
  user: { id: 'cashier-a', name: 'أحمد خالد', can_post: true, can_reverse: false },
  branch: { id: 'branch-a', name_ar: 'الفرع الرئيسي' }, warehouse: { id: 'warehouse-a', name_ar: 'المخزن الرئيسي' },
  shift: { id: 'shift-a', opened_at: '2026-11-23T08:00:00Z', opening_float: '0' }, server_date: '2026-11-23',
  items: [{ id: '1001', item_code: '1001', barcode: '6281001', name_ar: 'أرز بسمتي', unit_id: 'unit-a', price: '4500', stock: '40' }],
  customers: [{ id: 'customer-a', code: 'C001', name_ar: 'مؤسسة النور', credit_limit: '0', balance: '0' }],
  methods: [{ method: 'CASH', label_ar: 'نقدًا' }, { method: 'CREDIT', label_ar: 'آجل (على الحساب)' }],
};
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('erp.token', 'fixture-token'));
  await page.route('**/api/**', async route => {
    const url = route.request().url();
    const body = url.endsWith('/pos/bootstrap') ? boot : url.endsWith('/ref-cache')
      ? { tenant_id: boot.tenant_id, cachedAt: new Date().toISOString(), accounts: [], parties: [], items: [], warehouses: [] }
      : url.endsWith('/me') ? { name: 'أحمد خالد', two_fa_enabled: false, two_fa_required: false } : [];
    await route.fulfill({ json: body });
  });
});
test('live POS shell fits viewport, supports guarded/unknown routes, and returns to POS', async ({ page }) => {
  await page.goto('/#/pos');
  await expect(page.getByRole('heading', { name: 'نقطة البيع', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/pos-${test.info().project.name}.png`, fullPage: true });
  await page.evaluate(() => { location.hash = '#/conflicts'; });
  await expect(page.getByRole('alert')).toContainText('403');
  await page.evaluate(() => { location.hash = '#/unknown'; });
  await expect(page.getByRole('heading', { name: /404/ })).toBeVisible();
  await page.evaluate(() => { location.hash = '#/pos'; });
  await expect(page.getByRole('heading', { name: 'نقطة البيع', exact: true })).toBeVisible();
});
test('offline shell retains cached catalogue', async ({ page, context }) => {
  await page.goto('/#/pos');
  await expect(page.getByRole('heading', { name: 'نقطة البيع', exact: true })).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByRole('status').filter({ hasText: 'دون اتصال' })).toBeVisible();
  await expect(page.getByText('أرز بسمتي', { exact: true }).first()).toBeVisible();
});

test('Arabic normalization and code matching do not depend on a network', async () => {
  const { normalizePicker, exactPicker, matchesPicker, restrictionFor } = await import('../src/ui/kit/pickerCatalog');
  expect(normalizePicker('إِدارَة ١٢۳')).toBe('اداره 123');
  const records = [{ code: 'C001', name: 'مؤسسة النور', value: 'uuid-a', meta: '' }];
  expect(exactPicker(records, normalizePicker('c001'), 'code')?.value).toBe('uuid-a');
  expect(matchesPicker(records[0], normalizePicker('مؤسسه'), 'name')).toBe(true);
  expect(restrictionFor({ ...records[0], restriction: 'inactive' })).toContain('غير نشط');
});
