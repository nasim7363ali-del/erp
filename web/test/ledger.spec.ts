import { test,expect } from '@playwright/test';
const option=(id:string,code:string,name_ar:string)=>({id,code,name_ar,is_active:true,is_analytical:true,account_type:'ASSET',non_inventory:true,non_drawer:true,non_control:true});
const accounts=[option('11111111-1111-4111-8111-111111111111','B1','البنك الأول'),option('22222222-2222-4222-8222-222222222222','B2','البنك الثاني')];
test.beforeEach(async({page})=>{
 let document:any,lines:any[]=[];let reversal:any=null;
 await page.addInitScript(()=>localStorage.setItem('erp.token','fixture'));
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url());const path=url.pathname;
  if(path==='/api/pos/bootstrap')return route.fulfill({json:{tenant_id:'t',perms:{manageAccounting:true,post:true,reverse:true,cashview:true,viewCost:true},user:{id:'u',name:'محاسب',can_post:true,can_reverse:true},branch:{id:'b',name_ar:'فرع'},warehouse:{id:'w',name_ar:'مخزن'},shift:null,items:[],customers:[],methods:[],server_date:'2026-11-23'}});
  if(path==='/api/ref-cache')return route.fulfill({json:{tenant_id:'t',cachedAt:new Date().toISOString(),accounts,parties:[],items:[],warehouses:[]}});
  if(path==='/api/accounting/document-options')return route.fulfill({json:{accounts,parties:[],centers:[],shifts:[]}});
  if(path==='/api/accounting/journals'&&req.method()==='POST'){
   const b=req.postDataJSON();lines=b.payload.lines;document={id:b.id,entry_no:'1',entry_date:b.payload.date,description:b.payload.description,reference_no:'',status:'DRAFT',revision:1};
   return route.fulfill({status:201,json:{id:b.id,revision:1}});
  }
  if(path.endsWith('/post')){document.status='POSTED';return route.fulfill({json:{journal_entry_id:document.id}});}
  if(path.endsWith('/reverse')){reversal={id:'r',entry_date:req.postDataJSON().date,description:req.postDataJSON().reason};return route.fulfill({json:{journal_entry_id:'r'}});}
  if(path==='/api/accounting/journals')return route.fulfill({json:{rows:document?[{...document,number:'1',date:document.entry_date,reversed:!!reversal}]:[],offset:0,limit:40}});
  if(path.startsWith('/api/accounting/journals/'))return route.fulfill({json:{document,lines,reversal}});
  return route.fulfill({json:[]});
 });
});
test('journal draft uses exact balance, posts through confirmation, and reverses with reason',async({page})=>{
 await page.goto('/#/accounting/journals');
 await page.getByRole('button',{name:'إنشاء قيد',exact:true}).click();
 for(const [i,code] of [[1,'B1'],[2,'B2']] as const){const field=page.getByRole('combobox',{name:`الرقم — الحساب ${i}`,exact:true});await field.fill(code);await field.press('Enter');}
 await page.getByRole('textbox',{name:'مدين 1',exact:true}).fill('0.1001');
 await page.getByRole('textbox',{name:'دائن 2',exact:true}).fill('0.1001');
 await expect(page.getByRole('status').filter({hasText:'الفرق'})).toContainText('0.0000');
 await page.getByRole('button',{name:'حفظ المسودة',exact:true}).click();
 await page.getByRole('button',{name:'ترحيل',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'تأكيد',exact:true}).click();
 await expect(page.getByRole('button',{name:'عكس المستند',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'عكس المستند',exact:true}).click();
 await expect(page.getByRole('dialog').getByRole('button',{name:'تراجع',exact:true})).toBeFocused();
 await page.getByRole('dialog').getByRole('textbox',{name:'سبب العملية',exact:true}).fill('تصحيح محاسبي');
 await page.getByRole('dialog').getByRole('button',{name:'تأكيد',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'تم العكس'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('decimal arithmetic preserves four places without floating point drift',async()=>{
 const {units,decimal}=await import('../src/accounting-money');
 expect(decimal(units('0.1')+units('0.2'))).toBe('0.3000');
 expect(decimal(units('99999999999999.9999'))).toBe('99999999999999.9999');
 expect(()=>units('0.00001')).toThrow();expect(()=>units('1e3')).toThrow();
});
