import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import fs from 'node:fs'

export const store = '00000000-0000-4000-8000-000000000001', userId = '00000000-0000-4000-8000-000000000002'
const names = ['Μουστάρδα απαλή 250 g','Κέτσαπ κλασική 500 g','Πέννες ολικής 500 g','Ρύζι Καρολίνα 500 g','Φακές ψιλές 500 g','Ζωμός λαχανικών 120 g']
export const products = Array.from({ length: 48 }, (_, i) => ({
  product_id: `00000000-0000-4000-9000-${String(i + 1).padStart(12,'0')}`, store_id: store, internal_code: String(i+1).padStart(7,'0'),
  barcode: i === 0 ? '5201050130807' : i % 3 ? null : `520000000${String(i).padStart(4,'0')}`, description: `${names[i % 6]} / δοκιμή ${i+1}`,
  unit: i % 8 === 0 ? 'Κιλό' : 'Τεμάχιο', catalog_price: 1.4 + (i % 6), shelf_price: i < 36 ? 1.4+(i % 6)+(i < 6 ? .25 : 0) : null,
  price_diff: i < 6 ? .25 : i < 36 ? 0 : null, price_status: i < 6 ? 'different' : i < 36 ? 'same' : 'unchecked',
  source_ref: i < 36 ? `test-photo-${i+1}.jpg` : null, observed_at: i < 36 ? '2026-09-18T12:00:00Z' : null,
  location_code: i < 8 ? 'A' : null, row_label: i < 8 ? '1,00' : null, number_label: i < 8 ? `${i+1},10` : null,
  nearest_expiry: i===0?'2026-09-20':i===1?'2026-09-25':i===2?'2026-10-10':i===3?'2026-11-15':null,
  expiry_batch_count: i<4?1:0, expiry_quantity: i<4?1:null,
  expiry_status: i===0?'expired':i===1?'critical':i===2?'warning':i===3?'monitor':'untracked',
  days_until_expiry: i===0?-2:i===1?3:i===2?18:i===3?54:null,
}))
export const expiryBatches = products.slice(0,4).map((p,i)=>({
  batch_id:'00000000-0000-4000-7000-'+String(i+1).padStart(12,'0'),store_id:store,product_id:p.product_id,internal_code:p.internal_code,barcode:p.barcode,description:p.description,unit:p.unit,
  location_id:i<4?'00000000-0000-4000-8000-000000000003':null,location_code:'A',lot_number:'LOT-'+(i+1),expiry_date:p.nearest_expiry!,expiry_kind:'expiry',quantity:1,
  source_type:i===1?'gs1':'ocr',source_ref:'test-expiry-'+(i+1),confidence:.95,captured_at:'2026-09-20T12:00:00Z',days_until_expiry:p.days_until_expiry!,expiry_status:p.expiry_status
}))
const locations = [{ id: '00000000-0000-4000-8000-000000000003', code: 'A', name: 'Θέση Α', sort_order: 1 }, { id: '00000000-0000-4000-8000-000000000004', code: 'Δ', name: 'Θέση Δ', sort_order: 2 }]
export async function seed(page: Page) {
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
    else if (path.endsWith('/expiry_batches_overview')) body = expiryBatches
    else if (path.endsWith('/price_observations')) body = [{ id: 'hist-test', observed_price: 1.65, observed_at: '2026-09-18T12:00:00Z', source_ref: 'test-source.jpg', verified: true }]
    else if (path.includes('/rpc/save_inventory_product')) body = products[0].product_id
    await route.fulfill({ status: 200, headers, body: JSON.stringify(body) })
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Έλεγχος καταλόγου' })).toBeVisible()
}
async function catalog(page: Page) { await page.locator('nav button:visible').filter({ hasText: 'Κατάλογος' }).first().click() }

