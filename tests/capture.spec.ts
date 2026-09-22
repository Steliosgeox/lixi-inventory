import { test,expect,type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { seed } from './seed'

test.beforeEach(async({page})=>{
  await seed(page)
  await page.getByRole('button',{name:'Νέα καταγραφή',exact:true}).click()
  await page.getByRole('button',{name:'Smart Scan',exact:true}).click()
  await expect(page.getByText('SMART SCAN',{exact:true})).toBeVisible()
})

async function scanKnown(page:Page){
  await page.getByLabel('Scanner χειρός / Bluetooth keyboard').check()
  await page.waitForTimeout(350)
  await page.locator('.smart-scan-head').click()
  await page.keyboard.type('5201050130807',{delay:2});await page.keyboard.press('Enter')
  await expect(page.locator('.smart-field').first()).toContainText('Μουστάρδα')
}

test('hardware scanner locks a product inside Smart Scan without changing screen',async({page})=>{
  await scanKnown(page)
  await expect(page.getByRole('button',{name:'Επιβεβαίωση → επόμενο προϊόν',exact:true})).toBeDisabled()
})

test('GS1 DataMatrix scanner fills product expiry and lot in one scan',async({page})=>{
  await page.getByLabel('Scanner χειρός / Bluetooth keyboard').check()
  await page.waitForTimeout(350)
  await page.locator('.smart-scan-head').click()
  await page.keyboard.type(']d201052010501308071726093010LOT-A1',{delay:2});await page.keyboard.press('Enter')
  await expect(page.locator('.smart-field').first()).toContainText('Μουστάρδα')
  await expect(page.getByLabel('Smart Scan λήξη')).toHaveValue('2026-09-30')
  await expect(page.getByLabel('Smart Scan lot')).toHaveValue('LOT-A1')
  await expect(page.getByText('Από GS1 barcode — δομημένο πεδίο',{exact:true})).toBeVisible()
})

test('permission rejection leaves Smart Scan recoverable',async({page})=>{
  await page.evaluate(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Camera permission denied','NotAllowedError')}})
  const open=page.getByRole('button',{name:'Έναρξη Smart Scan',exact:true})
  await open.click()
  await expect(page.getByRole('alert')).toContainText('Δεν επιτρέπεται η πρόσβαση στην κάμερα.')
  await expect(open).toBeEnabled()
})

test('one reviewed Smart Scan writes price and expiry through one operation',async({page})=>{
  let writes=0
  await page.route('**/rest/v1/rpc/commit_smart_capture',async r=>{writes++;await r.fulfill({status:200,contentType:'application/json',body:'{"price_id":"p","batch_id":"b"}'})})
  await scanKnown(page)
  await page.getByLabel('Smart Scan τιμή').fill('1,95')
  await page.getByLabel('Smart Scan λήξη').fill('2026-10-20')
  await page.getByLabel('Smart Scan lot').fill('LOT-42')
  const save=page.getByRole('button',{name:'Επιβεβαίωση → επόμενο προϊόν',exact:true})
  await expect(save).toBeDisabled();expect(writes).toBe(0)
  await page.getByLabel('Έλεγξα προϊόν, τιμή/λήξη και lot. Το OCR δεν αποθηκεύει τίποτα μόνο του.').check()
  await save.click()
  await expect.poll(()=>writes).toBe(1)
  await expect(page.locator('.smart-field').first()).toContainText('Περιμένω barcode')
})

test('legacy offline price draft remains available as a fallback workflow',async({page,context})=>{
  await page.getByRole('button',{name:'Μεμονωμένο OCR',exact:true}).click()
  await page.getByLabel('Κωδικός επιβεβαίωσης').fill('0000002')
  await page.getByLabel('Τιμή επιβεβαίωσης').fill('1,95')
  await context.setOffline(true)
  await page.getByLabel('Έλεγξα προϊόν, τιμή και μονάδα').check()
  await page.getByRole('button',{name:'Επιβεβαίωση και αποθήκευση',exact:true}).click()
  await expect(page.locator('.capture-draft')).toHaveCount(1)
  await page.getByRole('button',{name:'Σελίδα Α4',exact:true}).click()
  await expect(page.locator('.capture-draft')).toHaveCount(1)
  await context.setOffline(false)
  await expect(page.locator('.capture-draft')).toHaveCount(0)
})

test('Smart Scan, fallback OCR and A4 modes remain accessible on mobile',async({page})=>{
  for(const name of ['Smart Scan','Μεμονωμένο OCR','Σελίδα Α4']){
    await page.getByRole('button',{name,exact:true}).click()
    const report=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()
    expect(report.violations).toEqual([])
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
  }
})

test('real Greek PP-OCRv5 engine reads a generated fixture without remote OCR',async({page},info)=>{
  test.setTimeout(150000)
  const data=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=900;c.height=300;const x=c.getContext('2d')!;x.fillStyle='white';x.fillRect(0,0,900,300);x.fillStyle='black';x.font='42px sans-serif';x.fillText('ΛΗΞΗ 20/10/2026',35,65);x.fillText('0000002',35,145);x.font='58px sans-serif';x.fillText('1,95 €',35,235);return c.toDataURL('image/png').split(',')[1]})
  await page.getByRole('button',{name:'Μεμονωμένο OCR',exact:true}).click()
  await page.getByLabel('Φωτογραφία για OCR').setInputFiles({name:'synthetic-greek-label.png',mimeType:'image/png',buffer:Buffer.from(data,'base64')})
  await page.getByRole('button',{name:'Ανάγνωση OCR',exact:true}).click()
  await page.waitForFunction(()=>document.querySelector('.capture-status')?.textContent?.includes('ολοκληρώθηκε')||document.querySelector('.capture-pane > [role=alert]'),undefined,{timeout:120000})
  await expect(page.locator('.capture-pane > [role=alert]')).toHaveCount(0)
  await page.getByText('Κείμενο και προέλευση OCR',{exact:true}).click()
  await expect(page.locator('.capture-raw')).toContainText('0000002')
  await expect(page.locator('.capture-raw')).toContainText(/ΛΗΞ|20\/10\/2026/)
  await expect(page.getByLabel('Τιμή επιβεβαίωσης')).toHaveValue('1.95')
  await page.screenshot({path:'test-results/'+info.project.name+'-capture-ocr.png',fullPage:true})
})
