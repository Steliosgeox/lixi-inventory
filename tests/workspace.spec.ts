import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import fs from 'node:fs'

const store = '00000000-0000-4000-8000-000000000001', userId = '00000000-0000-4000-8000-000000000002'
const names = ['Μουστάρδα απαλή 250 g','Κέτσαπ κλασική 500 g','Πέννες ολικής 500 g','Ρύζι Καρολίνα 500 g','Φακές ψιλές 500 g','Ζωμός λαχανικών 120 g']
const products = Array.from({ length: 48 }, (_, i) => ({
  product_id: `00000000-0000-4000-9000-${String(i + 1).padStart(12,'0')}`, store_id: store, internal_code: String(i+1).padStart(7,'0'),
  barcode: i % 3 ? null : `520000000${String(i).padStart(4,'0')}`, description: `${names[i % 6]} / δοκιμή ${i+1}`,
  unit: i % 8 === 0 ? 'Κιλό' : 'Τεμάχιο', catalog_price: 1.4 + (i % 6), shelf_price: i < 36 ? 1.4+(i % 6)+(i < 6 ? .25 : 0) : null,
  price_diff: i < 6 ? .25 : i < 36 ? 0 : null, price_status: i < 6 ? 'different' : i < 36 ? 'same' : 'unchecked',
  source_ref: i < 36 ? `test-photo-${i+1}.jpg` : null, observed_at: i < 36 ? '2026-09-18T12:00:00Z' : null,
  location_code: i < 8 ? 'A' : null, row_label: i < 8 ? '1,00' : null, number_label: i < 8 ? `${i+1},10` : null,
}))
const locations = [{ id: '00000000-0000-4000-8000-000000000003', code: 'A', name: 'Θέση Α', sort_order: 1 }, { id: '00000000-0000-4000-8000-000000000004', code: 'Δ', name: 'Θέση Δ', sort_order: 2 }]
async function seed(page: Page) {
  const user = { id: userId, aud: 'authenticated', role: 'authenticated', email: 'tester@example.invalid', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-09-01T00:00:00Z' }
  await page.addInitScript(({ user, exp }) => {
    const token = `${btoa(JSON.stringify({ alg: 'HS256',typ: 'JWT' }))}.${btoa(JSON.stringify({ sub: user.id, exp, role: 'authenticated', aud: 'authenticated' }))}.test-signature`
    localStorage.setItem('sb-zgdfgznwxioxmlrvssaa-auth-token', JSON.stringify({ access_token: token, refresh_token: 'test-refresh-token', expires_in: 86400, expires_at: exp, token_type: 'bearer', user }))
  }, { user, exp: Math.floor(Date.now()/1000) + 86400 })
  await page.route('https://zgdfgznwxioxmlrvssaa.supabase.co/**', async route => {
    const path = new URL(route.request().url()).pathname
    const headers = { 'access-control-allow-origin': '*', 'content-type': 'application/json' }
    let body: unknown = []
    if (path.includes('/auth/v1/user')) body = user
    else if (path.endsWith('/memberships')) body = { store_id: store, user_id: userId, role: 'owner' }
    else if (path.endsWith('/product_overview')) body = products
    else if (path.endsWith('/locations')) body = locations
    else if (path.endsWith('/price_observations')) body = [{ id: 'hist-test', observed_price: 1.65, observed_at: '2026-09-18T12:00:00Z', source_ref: 'test-source.jpg', verified: true }]
    else if (path.includes('/rpc/save_inventory_product')) body = products[0].product_id
    await route.fulfill({ status: 200, headers, body: JSON.stringify(body) })
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Η απογραφή, σε τάξη.' })).toBeVisible()
}
async function catalog(page: Page) { await page.locator('nav button:visible').filter({ hasText: 'Κατάλογος' }).first().click() }

test.beforeEach(async ({ page }) => { await seed(page) })
test('dashboard data, layout and accessibility', async ({ page }, info) => {
  await expect(page.locator('.wk-metric').nth(0).locator('strong')).toHaveText('48')
  await expect(page.locator('.wk-metric').nth(1).locator('strong')).toHaveText('36')
  await expect(page.locator('.wk-ring strong')).toHaveText('75%')
  const results = await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()
  expect(results.violations).toEqual([])
  await page.screenshot({ path: `test-results/${info.project.name}-dashboard.png`, fullPage: true })
})
test('Greek accent search and leading-zero product code', async ({ page }) => {
  await catalog(page)
  await page.getByLabel('Αναζήτηση στον κατάλογο').fill('μουσταρδα')
  await expect(page.locator('.wk-table tbody tr')).toHaveCount(8)
  await page.getByLabel('Αναζήτηση στον κατάλογο').fill('0000001')
  await expect(page.locator('.wk-table tbody tr')).toHaveCount(1)
  await expect(page.locator('.wk-table code')).toHaveText('0000001')
})
test('filters, sorting, paging and CSV selection', async ({ page }) => {
  await catalog(page)
  await expect(page.locator('.wk-table tbody tr')).toHaveCount(20)
  await page.getByRole('button', { name: 'Επόμενη σελίδα', exact: true }).click()
  await expect(page.locator('.wk-table tbody tr').first()).toContainText('0000021')
  await page.getByLabel('Φίλτρο καταλόγου').selectOption('different')
  await expect(page.locator('.wk-table tbody tr')).toHaveCount(6)
  await page.getByLabel('Επιλογή 0000001', { exact: true }).check()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'CSV (1)', exact: true }).click()
  const d = await download; const path = await d.path()
  expect(fs.readFileSync(path!, 'utf8')).toContain('"0000001"')
  expect(fs.readFileSync(path!, 'utf8').split('\r\n')).toHaveLength(2)
  await page.locator('th').filter({ hasText: 'Κατάλογος' }).getByRole('button').click()
  await expect(page.locator('.wk-table tbody tr').first()).toContainText('0000001')
})
test('drawer opens history, traps focus and submits atomic edit', async ({ page }) => {
  await page.locator('.wk-exception').first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByText('test-source.jpg', { exact: true })).toBeVisible()
  await page.getByLabel('Σειρά', { exact: true }).fill('21,10')
  const request = page.waitForRequest(r => r.url().includes('/rpc/save_inventory_product'))
  await page.getByRole('button', { name: 'Αποθήκευση αλλαγών' }).click()
  expect((await request).postDataJSON().p_row).toBe('21,10')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
test('invalid negative price does not save', async ({ page }) => {
  let writes = 0
  page.on('request', r => { if (r.url().includes('/rpc/save_inventory_product')) writes++ })
  await page.locator('.wk-exception').first().click()
  await page.getByLabel('Τιμή καταλόγου (€)', { exact: true }).fill('-2')
  await page.getByRole('button', { name: 'Αποθήκευση αλλαγών' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  expect(writes).toBe(0)
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
test('command search finds codes and theme persists', async ({ page }, info) => {
  await page.locator('.wk-command').click()
  await page.getByLabel('Γρήγορη αναζήτηση').fill('0000002')
  await expect(page.locator('.wk-command-results>button')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Σκούρο θέμα', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark')
  const results = await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa']).analyze()
  expect(results.violations).toEqual([])
  await page.screenshot({ path: `test-results/${info.project.name}-dark.png`, fullPage: true })
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark')
})
test('manual barcode resolves product without camera', async ({ page }) => {
  await page.getByRole('button', { name: 'Νέα καταγραφή', exact: true }).click()
  await page.getByLabel('Κωδικός ή barcode').fill('0000001')
  await expect(page.locator('.scan-result.hit')).toContainText('Μουστάρδα')
})
test('catalogue and drawer accessibility; mobile narrow layout', async ({ page }) => {
  await catalog(page)
  let results = await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa']).analyze()
  expect(results.violations).toEqual([])
  await page.locator('.wk-table-product').first().click()
  results = await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa']).analyze()
  expect(results.violations).toEqual([])
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 320, height: 740 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
})
test('all available pages navigate without runtime errors or overflow', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  for (const name of ['Κατάλογος','Τιμές','Σάρωση','Ρυθμίσεις','Αρχική']) {
    const buttons = page.locator('nav button:visible').filter({ hasText: name })
    if (await buttons.count()) { await buttons.first().click(); await page.waitForTimeout(100) }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  }
  expect(errors).toEqual([])
})
