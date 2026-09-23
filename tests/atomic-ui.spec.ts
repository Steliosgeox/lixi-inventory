import {test,expect} from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {seed} from './seed'

test.beforeEach(async({page})=>{
  await seed(page)
  await page.setViewportSize({width:390,height:844})
})

test('Atomic-style price audit stays compact on iPhone',async({page})=>{
  await page.getByRole('button',{name:'Όλες οι ενότητες',exact:true}).click()
  await page.getByRole('button',{name:'Έλεγχος τιμών',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Έλεγχος τιμών',exact:true})).toBeVisible()
  const title=await page.locator('.wk-page-title').boundingBox()
  expect(title?.height??999).toBeLessThan(70)
  const row=await page.locator('.wk-table tbody tr').first().boundingBox()
  expect(row?.height??999).toBeLessThan(105)
  const nav=await page.locator('.wk-mobile-nav').boundingBox()
  expect(nav?.height??0).toBeGreaterThanOrEqual(55)
  expect(nav?.height??999).toBeLessThan(100)
  const scan=await page.locator('.wk-mobile-nav button[data-page="scan"]').boundingBox()
  expect(scan?.width??0).toBeGreaterThanOrEqual(54)
  expect(scan?.height??0).toBeGreaterThanOrEqual(54)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
})

test('Atomic-style mobile catalogue keeps controls and list accessible',async({page})=>{
  await page.locator('.wk-mobile-nav button[data-page="products"]').click()
  await expect(page.getByRole('heading',{name:'Κατάλογος',exact:true})).toBeVisible()
  const search=await page.getByLabel('Αναζήτηση στον κατάλογο').boundingBox()
  expect(search?.height??999).toBeLessThanOrEqual(44)
  const report=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()
  expect(report.violations).toEqual([])
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
})

test('scan page gives the camera priority over page chrome',async({page})=>{
  await page.locator('.wk-mobile-nav button[data-page="scan"]').click()
  await expect(page.locator('.wk-main[data-page="scan"] .wk-page-title')).toBeHidden()
  await expect(page.getByRole('heading',{name:'Μία λήψη. Τα πεδία στη θέση τους.'})).toBeVisible()
})
