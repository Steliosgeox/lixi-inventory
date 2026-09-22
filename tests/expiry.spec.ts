import { test,expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { seed } from './seed'

test.beforeEach(async({page})=>{await seed(page)})

test('expiry monitor shows physical batches and priority buckets',async({page})=>{
  await page.locator('.wk-nav').getByRole('button',{name:/Λήξεις/}).click()
  await expect(page.getByRole('heading',{name:'Λήξεις',exact:true})).toBeVisible()
  await expect(page.getByText('ΛΗΓΜΕΝΑ',{exact:true})).toBeVisible()
  await expect(page.getByText('ΕΠΟΜΕΝΕΣ 7 ΗΜ.',{exact:true})).toBeVisible()
  await expect(page.locator('.wk-expiry-row')).toHaveCount(4)
  await expect(page.locator('.wk-expiry-row').first()).toContainText('LOT-1')
  await expect(page.locator('.wk-expiry-row').first()).toContainText('Ληγμένο')
})

test('expiry monitor is usable on phone without horizontal overflow',async({page})=>{
  await page.setViewportSize({width:390,height:844})
  await page.locator('.wk-mobile-nav').getByRole('button',{name:'Λήξεις',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Λήξεις',exact:true})).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
  const report=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()
  expect(report.violations).toEqual([])
})
