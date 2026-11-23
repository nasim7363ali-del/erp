import { test,expect } from '@playwright/test';
test('shows trial totals and account statement, clears stale results on changed filters',async({page})=>{
 const account='11111111-1111-4111-8111-111111111111',year='22222222-2222-4222-8222-222222222222';
 await page.addInitScript(()=>localStorage.setItem('erp.token','fixture'));
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/api/pos/bootstrap')return route.fulfill({json:{tenant_id:'t',perms:{manageAccounting:true,cashview:true,viewCost:true},user:{id:'u',name:'محاسب'},branch:{id:'b',name_ar:'فرع'},warehouse:{id:'w'},shift:null,items:[],customers:[],methods:[],server_date:'2026-11-23'}});
  if(path==='/api/ref-cache')return route.fulfill({json:{tenant_id:'t',cachedAt:new Date().toISOString(),accounts:[],parties:[],items:[],warehouses:[]}});
  const fy={id:year,name:'2026',start_date:'2026-01-01',end_date:'2026-12-31'};
  if(path==='/api/accounting/report-options')return route.fulfill({json:{years:[fy],accounts:[{id:account,code:'1101',name_ar:'البنك'}]}});
  if(path==='/api/accounting/trial-balance')return route.fulfill({json:{year:fy,from:'2026-01-01',to:'2026-12-31',totals:{opening:'0',debit:'10.1001',credit:'10.1001',closing:'0.0000'},rows:[{account_id:account,code:'1101',name_ar:'البنك',opening:'0',debit:'10.1001',credit:'0',closing:'10.1001'}]}});
  if(path==='/api/accounting/account-statement')return route.fulfill({json:{year:fy,account:{code:'1101',name_ar:'البنك'},from:'2026-01-01',to:'2026-12-31',opening:'0',debit:'10.1001',credit:'0',closing:'10.1001',count:1,offset:0,rows:[{line_id:'l',entry_no:'42',entry_date:'2026-02-01',description:'حركة اختبار',debit:'10.1001',credit:'0',balance:'10.1001'}]}});
  return route.fulfill({json:[]});
 });
 await page.goto('/#/accounting/reports');
 await expect(page.getByRole('combobox',{name:'السنة المالية',exact:true})).toHaveValue(year);
 await page.getByRole('button',{name:'عرض التقرير',exact:true}).click();
 await expect(page.getByRole('region',{name:'نتيجة التقرير'}).getByRole('status')).toHaveText('الميزان متوازن');
 await expect(page.getByRole('region',{name:'جدول التقرير'})).toContainText('10.1001');
 await page.getByRole('combobox',{name:'التقرير',exact:true}).selectOption('account-statement');
 await expect(page.getByRole('region',{name:'نتيجة التقرير'})).toHaveCount(0);
 const code=page.getByRole('combobox',{name:'الرقم — حساب الأستاذ',exact:true});await code.fill('1101');await code.press('Enter');
 await page.getByRole('button',{name:'عرض التقرير',exact:true}).click();
 await expect(page.getByRole('region',{name:'جدول التقرير'})).toContainText('حركة اختبار');
 await expect(page.getByRole('button',{name:'التالي',exact:true})).toBeDisabled();
 await page.getByLabel('من تاريخ',{exact:true}).fill('2026-02-01');
 await expect(page.getByRole('region',{name:'نتيجة التقرير'})).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
