import { test, expect } from '@playwright/test';
const initial = [
  { id: 'system', code: '100', name_ar: 'الأصول النظامية', parent_id: null, level: 'MAIN', account_type: 'ASSET', normal_balance: 'DEBIT', is_system: true, is_active: true },
  { id: 'editable', code: '900', name_ar: 'حساب اختبار', parent_id: null, level: 'MAIN', account_type: 'ASSET', normal_balance: 'DEBIT', is_system: false, is_active: true },
];
async function setup(page: import('@playwright/test').Page, allowed = true) {
  const accounts = structuredClone(initial); const centers: Record<string, unknown>[] = [];
  await page.addInitScript(() => localStorage.setItem('erp.token', 'fixture-token'));
  await page.route('**/api/**', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.pathname === '/api/pos/bootstrap') return route.fulfill({json:{ tenant_id:'fixture',perms:{post:true,reverse:false,cashview:false,viewCost:false,giveDiscount:false,manageUsers:false,manageAccounting:allowed},
      user:{id:'fixture',name:'محاسب',can_post:true,can_reverse:false},branch:{id:'b',name_ar:'الفرع'},warehouse:{id:'w',name_ar:'المخزن'},shift:null,items:[],customers:[],methods:[],server_date:'2026-11-23' }});
    if (url.pathname === '/api/ref-cache') return route.fulfill({json:{tenant_id:'fixture',cachedAt:new Date().toISOString(),accounts,parties:[],items:[],warehouses:[]}});
    const collection = url.pathname.includes('cost-centers') ? centers : accounts;
    if (url.pathname.startsWith('/api/accounting/')) {
      if (!allowed) return route.fulfill({status:403,json:{code:'PERMISSION_DENIED',message:'يلزم صلاحية إدارة المحاسبة'}});
      if (req.method()==='POST') { const row={id:'created',is_active:true,is_system:false,...req.postDataJSON()}; collection.push(row); return route.fulfill({status:201,json:row}); }
      if (req.method()==='PATCH') { const row=collection.find(r=>r.id===url.pathname.split('/').at(-1)); Object.assign(row!,req.postDataJSON()); return route.fulfill({json:row}); }
      return route.fulfill({json:collection});
    }
    return route.fulfill({json:[]});
  });
}
test('manager creates and renames an account; protected system accounts have no edit button', async ({ page }) => {
  await setup(page);
  await page.goto('/#/accounting/accounts');
  await expect(page.getByRole('heading',{name:'دليل الحسابات',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'تعديل الأصول النظامية'})).toHaveCount(0);
  await page.getByRole('button',{name:'إضافة حساب',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'إضافة حساب',exact:true});
  await dialog.getByRole('textbox',{name:'الرمز',exact:true}).fill('950');
  await dialog.getByRole('textbox',{name:'الاسم العربي',exact:true}).fill('حساب جديد');
  await dialog.getByRole('combobox',{name:/المستوى/}).selectOption('MAIN');
  await dialog.getByRole('button',{name:'حفظ',exact:true}).click();
  await expect(page.getByText('حساب جديد',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'تعديل حساب جديد',exact:true}).click();
  await page.getByRole('dialog').getByRole('textbox',{name:'الاسم العربي',exact:true}).fill('حساب معدل');
  await page.getByRole('dialog').getByRole('button',{name:'حفظ',exact:true}).click();
  await expect(page.getByText('حساب معدل',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('cashier cannot access accounting setup even through a direct route', async ({ page }) => {
  await setup(page,false); await page.goto('/#/accounting/accounts');
  await expect(page.getByRole('alert')).toContainText('403');
  await expect(page.getByRole('button',{name:'إضافة حساب',exact:true})).toHaveCount(0);
});
test('cost center drafts stay in the editor while offline and cannot be submitted', async ({ page, context }) => {
  await setup(page); await page.goto('/#/accounting/cost-centers');
  await page.getByRole('button',{name:'إضافة مركز تكلفة',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'إضافة مركز تكلفة',exact:true});
  await dialog.getByRole('textbox',{name:'الرمز',exact:true}).fill('CC1');
  await dialog.getByRole('textbox',{name:'الاسم العربي',exact:true}).fill('المبيعات');
  await context.setOffline(true);
  await dialog.getByRole('button',{name:'حفظ',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('يلزم اتصال');
  await expect(dialog.getByRole('textbox',{name:'الاسم العربي',exact:true})).toHaveValue('المبيعات');
});
