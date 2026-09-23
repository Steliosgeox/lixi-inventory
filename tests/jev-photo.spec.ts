import {test,expect} from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {seed} from './seed'
test.beforeEach(async({page})=>{await seed(page);await page.route('**/functions/v1/lixi-jev',async r=>{const b=r.request().postDataJSON();await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(b.action==='status'?{configured:false,model:'typesafe/jev-1.13',runs:[],captures:[]}:{state:'waiting',reason:'provider_not_configured'})})});await page.getByRole('button',{name:'Νέα καταγραφή',exact:true}).click();await expect(page.getByRole('heading',{name:'Μία λήψη. Τα πεδία στη θέση τους.'})).toBeVisible()})
test('Jev is the default workflow and missing key is not presented as connected',async({page})=>{await expect(page.getByText('Jev · αναμονή ενεργοποίησης',{exact:true})).toBeVisible();await expect(page.getByRole('checkbox',{name:/Έλεγξα/})).toHaveCount(0)})
test('camera permission denial is recoverable in the continuous workflow',async({page})=>{await page.evaluate(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Denied','NotAllowedError')}});const open=page.getByRole('button',{name:/Ενεργοποίηση κάμερας|Άνοιγμα κάμερας/});await open.click();await expect(page.locator('.jev-message')).toContainText('κάμερα');await expect(open).toBeEnabled()})
test('automatic photo layout has accessible controls and no horizontal overflow',async({page})=>{await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);const report=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(report.violations).toEqual([])})
test('one selected photograph is OCRed, sent to Jev and retained when provider is unavailable',async({page})=>{
 test.setTimeout(150000)
 let calls=0
 await page.route('**/storage/v1/object/capture-evidence/**',r=>r.fulfill({status:200,contentType:'application/json',body:'{"Key":"evidence.jpg"}'}))
 await page.route('**/functions/v1/lixi-jev',async r=>{const b=r.request().postDataJSON();if(b.action==='capture'){calls++;expect(b.capture.ocr.engine).toContain('PP-OCRv5');expect(b.capture.ocr.lines.length).toBeGreaterThan(0);expect(b.capture.evidencePath).toContain(b.capture.id);expect(r.request().postData()).not.toContain('sk-or-');}await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(b.action==='status'?{configured:false,runs:[]}:{state:'waiting',reason:'provider_not_configured'})})})
 const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1000;c.height=500;const x=c.getContext('2d')!;x.fillStyle='white';x.fillRect(0,0,1000,500);x.fillStyle='black';x.font='48px sans-serif';x.fillText('ΜΟΥΣΤΑΡΔΑ ΑΠΑΛΗ',50,80);x.fillText('0000001',50,180);x.fillText('1,95 €',50,280);x.fillText('ΛΗΞΗ 20/10/2026',50,380);return c.toDataURL('image/png').split(',')[1]})
 await page.getByLabel('Φωτογραφίες για αυτόματη καταχώριση').setInputFiles({name:'label.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')})
 await expect.poll(()=>calls,{timeout:120000}).toBe(1)
 await expect(page.locator('.jev-job.waiting')).toContainText('Αναμονή ενεργοποίησης Jev')
 await expect(page.locator('.jev-job.committed')).toHaveCount(0)
})

test('owner provider configuration clears the key and never writes it to browser storage',async({page})=>{
 let supplied=false
 await page.route('**/functions/v1/lixi-jev',async r=>{const b=r.request().postDataJSON();if(b.action==='configure')supplied=true;await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({configured:true,can_configure:true,runs:[],captures:[]})})})
 await page.getByText('Σύνδεση OpenRouter / Jev',{exact:true}).click()
 await page.getByLabel('OpenRouter API key').fill('sk-or-test-placeholder-not-a-real-credential')
 await page.getByRole('button',{name:'Σύνδεση Jev',exact:true}).click()
 await expect.poll(()=>supplied).toBe(true)
 await expect(page.getByLabel('OpenRouter API key')).toHaveValue('')
 expect(await page.evaluate(()=>JSON.stringify(localStorage))).not.toContain('test-placeholder')
})
