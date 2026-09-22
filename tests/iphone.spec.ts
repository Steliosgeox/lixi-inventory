import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { seed } from './seed'

// These are explicit layout/keyboard simulations, not real iOS safe-area emulation.
async function insets(page: Page, top = 59, bottom = 34, left = 0, right = 0) {
  await page.addStyleTag({ content: `:root{--safe-top:${top}px;--safe-bottom:${bottom}px;--safe-left:${left}px;--safe-right:${right}px}` })
}
async function phone(page: Page, width = 390, height = 844) {
  await page.setViewportSize({ width, height })
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { configurable: true, value: true }))
  await seed(page)
  await insets(page)
  await page.evaluate(() => document.fonts.ready)
}
async function catalogue(page: Page) {
  await page.locator('.wk-mobile-nav').getByRole('button', { name: 'Κατάλογος', exact: true }).click()
}

test('standalone header clears status bar before and after scrolling', async ({ page }, info) => {
  await phone(page)
  await expect(page.locator('html')).toHaveAttribute('data-standalone', 'true')
  for (const el of await page.locator('.wk-top button').all()) {
    const box = (await el.boundingBox())!
    expect(box.y).toBeGreaterThanOrEqual(59)
    expect(box.height).toBeGreaterThanOrEqual(44)
    expect(box.width).toBeGreaterThanOrEqual(44)
  }
  await page.evaluate(() => window.scrollTo(0, 500))
  await expect.poll(async () => (await page.locator('.wk-top').boundingBox())!.y).toBe(0)
  expect((await page.locator('.wk-command').boundingBox())!.y).toBeGreaterThanOrEqual(59)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: `test-results/${info.project.name}-iphone-safe-area.png`, fullPage: true })
})

test('Safari zero insets do not add an invented status bar gap', async ({ page }) => {
  await phone(page)
  await insets(page, 0, 0)
  const toolbarHeight = (await page.locator('.wk-top').boundingBox())!.height
  expect(toolbarHeight).toBeGreaterThanOrEqual(56)
  expect(toolbarHeight).toBeLessThanOrEqual(57)
  expect((await page.locator('.wk-command').boundingBox())!.y).toBe(6)
})

test('all phone widths show both prices without horizontal page scrolling', async ({ page }, info) => {
  await phone(page)
  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    await catalogue(page)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    const first = page.locator('.wk-table tbody tr').first()
    await expect(first.locator('[data-column=catalog_price]')).toBeVisible()
    await expect(first.locator('[data-column=shelf_price]')).toBeVisible()
    for (const cell of await first.locator('td').all()) {
      const box = (await cell.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1)
    }
  }
  await page.getByLabel('Ταξινόμηση προϊόντων').selectOption('catalog_price:desc')
  await expect(page.locator('.wk-table tbody tr').first()).toContainText('0000006')
  const report = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(report.violations).toEqual([])
  await page.screenshot({ path: `test-results/${info.project.name}-iphone-catalogue.png`, fullPage: false })
})

test('phone menu exposes locations and activity, not only desktop navigation', async ({ page }) => {
  await phone(page)
  await page.getByRole('button', { name: 'Όλες οι ενότητες', exact: true }).click()
  const menu = page.getByRole('dialog')
  await expect(menu).toBeVisible()
  expect((await menu.boundingBox())!.y).toBeGreaterThanOrEqual(59)
  const report = await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa']).analyze()
  expect(report.violations).toEqual([])
  await menu.getByRole('button', { name: 'Θέσεις & ράφια', exact: true }).click()
  await expect(menu).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Θέσεις & ράφια', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Όλες οι ενότητες', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Καταγραφές', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Καταγραφές', exact: true })).toBeVisible()
})

test('landscape notch sides and home indicator stay clear', async ({ page }, info) => {
  await phone(page, 844, 390)
  await insets(page, 0, 21, 59, 59)
  await expect(page.locator('.wk-sidebar')).toBeHidden()
  for (const button of await page.locator('.wk-top button, .wk-mobile-nav button').all()) {
    const box = (await button.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(59)
    expect(box.x + box.width).toBeLessThanOrEqual(785)
    expect(box.y + box.height).toBeLessThanOrEqual(369)
  }
  await page.locator('.wk-exception').first().click()
  const save = page.getByRole('button', { name: 'Αποθήκευση αλλαγών', exact: true })
  await expect(save).toBeVisible()
  expect((await save.boundingBox())!.y + (await save.boundingBox())!.height).toBeLessThanOrEqual(369)
  await page.screenshot({ path: `test-results/${info.project.name}-iphone-landscape-drawer.png`, fullPage: false })
})

test('visual keyboard shrinks dialogs and never covers the save controls', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    const vv = Object.assign(new EventTarget(), { height: 844, width: 390, offsetTop: 0, offsetLeft: 0, scale: 1 })
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv })
    const original = window.matchMedia.bind(window)
    window.matchMedia = (query: string) => {
      const mq = original(query)
      if (query === '(any-pointer: coarse)') Object.defineProperty(mq, 'matches', { value: true })
      return mq
    }
  })
  await seed(page); await insets(page)
  await page.locator('.wk-exception').first().click()
  await page.getByLabel('Τιμή καταλόγου (€)', { exact: true }).focus()
  await page.evaluate(() => { Object.assign(visualViewport!, { height: 390, offsetTop: 0 }); visualViewport!.dispatchEvent(new Event('resize')) })
  await expect(page.locator('html')).toHaveAttribute('data-keyboard', 'true')
  await expect(page.locator('.wk-mobile-nav')).toBeHidden()
  const save = page.getByRole('button', { name: 'Αποθήκευση αλλαγών', exact: true })
  const box = (await save.boundingBox())!
  expect(box.y + box.height).toBeLessThanOrEqual(390)
  expect(box.y).toBeGreaterThan(59)
  const textarea = page.locator('.wk-drawer textarea').first()
  await expect(textarea).toBeVisible()
  expect(await textarea.evaluate(el => getComputedStyle(el).fontSize)).toBe('16px')
  await page.screenshot({ path: `test-results/${info.project.name}-iphone-keyboard-layout.png` })
  // Zoom must never masquerade as a keyboard or disable magnification.
  await page.evaluate(() => { Object.assign(visualViewport!, { scale: 2 }); visualViewport!.dispatchEvent(new Event('resize')) })
  await expect(page.locator('html')).toHaveAttribute('data-keyboard','false')
  await page.evaluate(() => { Object.assign(visualViewport!, { height: 844, scale: 1 }); visualViewport!.dispatchEvent(new Event('resize')) })
  await expect(page.locator('.wk-mobile-nav')).toBeVisible()
})

test('photo scroll is native until crop mode is explicitly selected', async ({ page }) => {
  await phone(page)
  await page.getByRole('button', { name: 'Νέα καταγραφή', exact: true }).click()
  await page.getByRole('button', { name: 'Τιμή ραφιού', exact: true }).click()
  const data = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 600; c.height = 1600; const ctx = c.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0,0,600,1600); return c.toDataURL('image/png').split(',')[1] })
  await page.getByLabel('Φωτογραφία για OCR').setInputFiles({ name: 'scroll-fixture.png', mimeType: 'image/png', buffer: Buffer.from(data,'base64') })
  const preview = page.locator('.capture-preview')
  await expect(preview).toBeVisible()
  expect(await preview.evaluate(el => getComputedStyle(el).touchAction)).toContain('pan-y')
  await page.getByRole('button', { name: 'Επιλογή περικοπής', exact: true }).click()
  expect(await preview.evaluate(el => getComputedStyle(el).touchAction)).toBe('none')
  await page.getByRole('button', { name: 'Επιλογή περικοπής', exact: true }).click()
  expect(await preview.evaluate(el => getComputedStyle(el).touchAction)).toContain('pan-y')
})

test('final content can scroll above bottom navigation and theme remains readable', async ({ page }) => {
  await phone(page)
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  const footer = (await page.locator('.wk-footer').boundingBox())!
  const nav = (await page.locator('.wk-mobile-nav').boundingBox())!
  expect(footer.y + footer.height).toBeLessThanOrEqual(nav.y)
  await page.getByRole('button', { name: 'Σκούρο θέμα', exact: true }).click()
  const results = await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa']).analyze()
  expect(results.violations).toEqual([])
})
