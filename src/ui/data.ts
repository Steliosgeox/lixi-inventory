import type { ProductOverview } from '../lib/types'

export const money = (n: number | null | undefined) => n == null ? '—' : new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR' }).format(n)
export const signed = (n: number | null) => n == null ? '—' : `${n > 0 ? '+' : ''}${money(n)}`
export const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('el-GR')
export type Filter = 'all' | 'checked' | 'different' | 'same' | 'unchecked' | 'unlocated' | 'nobarcode' | 'review'
export const labels: Record<Filter, string> = { all: 'Όλα', checked: 'Με τιμή ραφιού', different: 'Διαφορές', same: 'Ίδια τιμή', unchecked: 'Χωρίς τιμή ραφιού', unlocated: 'Χωρίς θέση', nobarcode: 'Χωρίς barcode', review: 'Προς έλεγχο' }
export function matches(p: ProductOverview, f: Filter) {
  return f === 'all' || (f === 'checked' && p.shelf_price != null) || (f === 'different' && p.price_status === 'different') || (f === 'same' && p.price_status === 'same') || (f === 'unchecked' && p.shelf_price == null) || (f === 'unlocated' && !p.location_code) || (f === 'nobarcode' && !p.barcode) || (f === 'review' && (p.price_status === 'review' || p.catalog_price === 0 || p.unit !== 'Τεμάχιο'))
}
export function csvCell(value: unknown) {
  let v = String(value ?? '')
  if (/^[\s]*[=+@\-\t\r]/.test(v)) v = `'${v}`
  return `"${v.replaceAll('"', '""')}"`
}
export function exportProducts(rows: ProductOverview[]) {
  const header = ['Κωδικός', 'Περιγραφή', 'Μονάδα', 'Τιμή καταλόγου', 'Τιμή ραφιού', 'Διαφορά', 'Θέση', 'Σειρά', 'Αριθμός', 'Barcode', 'Πηγή']
  const decimal = (n: number | null) => n == null ? '' : n.toFixed(2).replace('.', ',')
  const content = [header, ...rows.map(p => [p.internal_code, p.description, p.unit, decimal(p.catalog_price), decimal(p.shelf_price), decimal(p.price_diff), p.location_code, p.row_label, p.number_label, p.barcode, p.source_ref])].map(r => r.map(csvCell).join(';')).join('\r\n')
  const url = URL.createObjectURL(new Blob(['\ufeff', content], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a'); a.href = url; a.download = `Leaksy-${new Date().toISOString().slice(0,10)}.csv`; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export const dateLabel = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('el-GR', { day: '2-digit', month: 'short', timeZone: 'Europe/Athens' }).format(new Date(value)) : 'Χωρίς ημερομηνία'

// Exact identifiers take precedence over fragments inside another barcode.
export function searchProducts(rows: ProductOverview[], query: string) {
  const q = normalize(query.trim())
  if (!q) return rows
  const exact = rows.filter(p => normalize(p.internal_code) === q || normalize(p.barcode ?? '') === q)
  return exact.length ? exact : rows.filter(p => normalize(`${p.internal_code} ${p.description} ${p.barcode ?? ''}`).includes(q))
}
