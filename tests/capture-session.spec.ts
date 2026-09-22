import { test, expect } from '@playwright/test'
import { seed } from './seed'

test('consecutive photos reuse one OCR worker and do not write unreviewed prices', async ({ page }, info) => {
  test.setTimeout(180000)
  await seed(page)
  await page.getByRole('button', { name: 'Νέα καταγραφή', exact: true }).click()
  await page.getByRole('button', { name: 'Μεμονωμένο OCR', exact: true }).click()
  let createdWorkers = 0
  let destroyedWorkers = 0
  page.on('worker', worker => {
    if (!worker.url().includes('ocr.worker')) return
    createdWorkers++
    worker.on('close', () => { destroyedWorkers++ })
  })
  let writes = 0
  await page.route('**/rest/v1/rpc/commit_capture_price', async route => {
    writes++
    await route.fulfill({ status: 200, contentType: 'application/json', body: '"unexpected"' })
  })
  const timings: number[] = []
  for (const price of ['1,95', '2,28']) {
    const image = await page.evaluate(value => {
      const canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 300
      const context = canvas.getContext('2d')!
      context.fillStyle = 'white'; context.fillRect(0, 0, 900, 300)
      context.fillStyle = 'black'; context.font = '42px sans-serif'
      context.fillText('ΜΟΥΣΤΑΡΔΑ 250 ΓΡ', 35, 65); context.fillText('0000002', 35, 145)
      context.font = '58px sans-serif'; context.fillText(`${value} €`, 35, 235)
      return canvas.toDataURL('image/png').split(',')[1]
    }, price)
    await page.getByLabel('Φωτογραφία για OCR').setInputFiles({ name: `label-${price}.png`, mimeType: 'image/png', buffer: Buffer.from(image, 'base64') })
    const read = page.getByRole('button', { name: 'Ανάγνωση OCR', exact: true })
    await expect(read).toBeEnabled()
    const started = Date.now()
    await read.click()
    await expect(page.locator('.capture-status')).toContainText('ολοκληρώθηκε', { timeout: 120000 })
    timings.push(Date.now() - started)
    await expect(page.getByLabel('Κωδικός επιβεβαίωσης')).toHaveValue('0000002')
    await expect(page.getByLabel('Τιμή επιβεβαίωσης')).toHaveValue(price.replace(',', '.'))
    await expect(page.getByRole('button', { name: 'Επιβεβαίωση και αποθήκευση', exact: true })).toBeDisabled()
    expect(createdWorkers).toBe(1)
    expect(destroyedWorkers).toBe(0)
  }
  // Switching to barcode and back is a common shop workflow, not a reason to reload models.
  await page.getByRole('button', { name: 'Smart Scan', exact: true }).click()
  await page.getByRole('button', { name: 'Μεμονωμένο OCR', exact: true }).click()
  expect(createdWorkers).toBe(1)
  expect(destroyedWorkers).toBe(0)
  expect(writes).toBe(0)
  await info.attach('cold-warm-ci-smoke-timings.json', {
    contentType: 'application/json',
    body: Buffer.from(JSON.stringify({ browser: info.project.name, coldMs: timings[0], warmMs: timings[1], note: 'Synthetic fixtures on CI, NOT measurements from a physical iPhone or a retail accuracy benchmark.' })),
  })
})
