import { test,expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { seed } from './seed'
test.beforeEach(async({page})=>{await seed(page);await page.getByRole('button',{name:'Νέα καταγραφή',exact:true}).click();await expect(page.getByRole('heading',{name:'Βρες το προϊόν.'})).toBeVisible()})
test('hardware scanner receives keyboard burst without focus',async({page})=>{
  await page.getByLabel('Scanner χειρός / Bluetooth πληκτρολόγιο (Enter)').check()
  await page.waitForTimeout(250)
  await page.locator('.capture-heading h2').first().click()
  await page.keyboard.type('0000001',{delay:2});await page.keyboard.press('Enter')
  await expect(page.locator('.scan-result.hit')).toContainText('Μουστάρδα')
})
test('permission rejection leaves scanner recoverable',async({page})=>{
  await page.evaluate(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Camera permission denied','NotAllowedError')}})
  await page.getByRole('button',{name:'Άνοιγμα κάμερας',exact:true}).click()
  await expect(page.getByRole('alert')).toContainText('Camera permission denied')
  await expect(page.getByRole('button',{name:'Άνοιγμα κάμερας',exact:true})).toBeEnabled()
})
test('review is required and a double click produces one operation',async({page})=>{
  let writes=0
  await page.route('**/rest/v1/rpc/commit_capture_price',async r=>{writes++;await r.fulfill({status:200,contentType:'application/json',body:'"receipt"'})})
  await page.getByLabel('Κωδικός ή barcode').fill('0000002')
  await page.getByRole('button',{name:'Καταγραφή τιμής',exact:true}).click()
  await page.getByLabel('Τιμή επιβεβαίωσης').fill('1,95')
  const save=page.getByRole('button',{name:'Επιβεβαίωση και αποθήκευση',exact:true})
  await expect(save).toBeDisabled();expect(writes).toBe(0)
  await page.getByLabel('Έλεγξα προϊόν, τιμή και μονάδα').check()
  await save.click()
  await expect.poll(()=>writes).toBe(1)
  await expect(save).toBeDisabled()
})
test('offline draft survives navigation and syncs after reconnection',async({page,context})=>{
  await page.getByRole('button',{name:'Τιμή ραφιού',exact:true}).click()
  await page.getByLabel('Κωδικός επιβεβαίωσης').fill('0000002');await page.getByLabel('Τιμή επιβεβαίωσης').fill('1,95')
  await context.setOffline(true)
  await page.getByLabel('Έλεγξα προϊόν, τιμή και μονάδα').check();await page.getByRole('button',{name:'Επιβεβαίωση και αποθήκευση',exact:true}).click()
  await expect(page.locator('.capture-draft')).toHaveCount(1)
  await page.getByRole('button',{name:'Barcode / scanner',exact:true}).click();await expect(page.locator('.capture-draft')).toHaveCount(1)
  await context.setOffline(false)
  await expect(page.locator('.capture-draft')).toHaveCount(0)
})
test('scan and price modes remain accessible on mobile',async({page})=>{
  for(const name of ['Barcode / scanner','Τιμή ραφιού','Σελίδα Α4']){
    await page.getByRole('button',{name,exact:true}).click()
    const report=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()
    expect(report.violations).toEqual([])
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
  }
})
test('real Greek OCR engine reads a generated fixture without remote OCR',async({page},info)=>{
  test.setTimeout(150000)
  // This is an engine smoke test, NOT a benchmark on supermarket packaging.
  const data=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=900;c.height=300;const x=c.getContext('2d')!;x.fillStyle='white';x.fillRect(0,0,900,300);x.fillStyle='black';x.font='42px sans-serif';x.fillText('ΜΟΥΣΤΑΡΔΑ 250 ΓΡ',35,65);x.fillText('0000002',35,145);x.font='58px sans-serif';x.fillText('1,95 €',35,235);return c.toDataURL('image/png').split(',')[1]})
  await page.getByRole('button',{name:'Τιμή ραφιού',exact:true}).click()
  await page.getByLabel('Φωτογραφία για OCR').setInputFiles({name:'synthetic-greek-label.png',mimeType:'image/png',buffer:Buffer.from(data,'base64')})
  await expect(page.getByRole('button',{name:'Ανάγνωση OCR',exact:true})).toBeEnabled()
  await page.getByRole('button',{name:'Ανάγνωση OCR',exact:true}).click()
  await page.waitForFunction(() => document.querySelector('.capture-status')?.textContent?.includes('ολοκληρώθηκε') || document.querySelector('.capture-pane > [role=alert]'), undefined, { timeout: 120000 })
  await expect(page.locator('.capture-pane > [role=alert]')).toHaveCount(0)
  await expect(page.locator('.capture-status')).toContainText('ολοκληρώθηκε')
  await page.getByText('Κείμενο και προέλευση OCR', {exact:true}).click()
  await expect(page.locator('.capture-raw')).toContainText('0000002')
  await expect(page.locator('.capture-raw')).toContainText('ΜΟΥΣΤΑΡΔΑ')
  await expect(page.getByLabel('Τιμή επιβεβαίωσης')).toHaveValue('1.95')
  await expect(page.getByRole('button',{name:'Επιβεβαίωση και αποθήκευση',exact:true})).toBeDisabled()
  await page.screenshot({path:`test-results/${info.project.name}-capture-ocr.png`,fullPage:true})
})

test('real WASM barcode decoder reads a generated EAN13 image', async ({page}) => {
  const {prepareZXingModule,writeBarcode} = await import('zxing-wasm/writer')
  const {readFile} = await import('node:fs/promises')
  await prepareZXingModule({overrides:{wasmBinary:new Uint8Array(await readFile('node_modules/zxing-wasm/dist/writer/zxing_writer.wasm'))},fireImmediately:true})
  const fixture = await writeBarcode('5201050130807',{format:'EAN13',scale:4,addHRT:true})
  expect(fixture.error).toBe('')
  await page.getByLabel('Εικόνα barcode').setInputFiles({name:'synthetic-ean.png',mimeType:'image/png',buffer:Buffer.from(await fixture.image!.arrayBuffer())})
  await expect(page.getByLabel('Κωδικός ή barcode')).toHaveValue('5201050130807',{timeout:20000})
})
