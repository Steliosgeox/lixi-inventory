import type { ProductOverview } from '../lib/types'

export type Box = { x: number; y: number; width: number; height: number }
export type OcrLine = { text: string; score: number | null; box: Box }
export type OcrResult = { lines: OcrLine[]; engine: string; elapsedMs: number; width: number; height: number }
export type PriceCandidate = { cents: number; line: OcrLine; unitPrice: boolean }
export type DocumentRow = { code: string; description: string; price: string; unit: string; row: string; number: string; text: string; known: boolean; needsReview: true }

/** Never change identifiers to numbers. Leading zeroes are meaningful. */
export function gtinValid(value: string): boolean {
  if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(value)) return false
  let sum = 0
  for (let i = value.length - 2, w = 3; i >= 0; i--, w = 4 - w) sum += Number(value[i]) * w
  return (10 - sum % 10) % 10 === Number(value.at(-1))
}
export function identifier(raw: string): { value: string; kind: 'gtin' | 'internal' | 'unsupported'; valid: boolean } {
  let value = raw.trim()
  // Only explicitly tagged GS1 GTIN is extracted. Never guess an AI from a random URL.
  if (/^\]C1|^\]d2|^\]Q3/.test(value)) value = value.slice(3)
  const gs1 = value.match(/^\(01\)(\d{14})(?:\(|$)/) ?? value.match(/^01(\d{14})(?=\x1d|10|11|15|17|21|30|37|$)/)
  if (gs1) value = gs1[1]
  if (/^\]E[0-9]/.test(value)) value = value.slice(3)
  if (/^\d{7}$/.test(value)) return { value, kind: 'internal', valid: true }
  if (/^\d+$/.test(value)) return { value, kind: 'gtin', valid: gtinValid(value) }
  return { value, kind: 'unsupported', valid: false }
}
export function buildIndex(products: ProductOverview[]) {
  const map = new Map<string, ProductOverview[]>()
  const add = (key: string, p: ProductOverview) => {
    const items = map.get(key) ?? []
    if (!items.some(x => x.product_id === p.product_id)) items.push(p)
    map.set(key, items)
  }
  for (const p of products) {
    add(p.internal_code, p)
    if (p.barcode) { add(p.barcode, p); if (gtinValid(p.barcode)) add(p.barcode.padStart(14, '0'), p) }
  }
  return (raw: string): ProductOverview[] => {
    const id = identifier(raw)
    if (!id.valid) return []
    return map.get(id.value) ?? (id.kind === 'gtin' ? map.get(id.value.padStart(14, '0')) : undefined) ?? []
  }
}
export class FrameConsensus {
  private last = ''; private when = 0; private hits = 0
  reset() { this.last = ''; this.when = 0; this.hits = 0 }
  accept(raw: string, time: number): boolean {
    const id = identifier(raw)
    if (!id.valid) { this.reset(); return false }
    if (id.value !== this.last || time - this.when > 1200) { this.last = id.value; this.when = time; this.hits = 1; return false }
    if (time - this.when < 60) return false
    this.when = time; this.hits++
    return this.hits >= 2
  }
}
export function parseCents(input: string): number | null {
  const value = input.trim()
  if (!/^\d{1,7}(?:[.,]\d{1,2})?$/.test(value)) return null
  const [whole, frac = ''] = value.replace(',', '.').split('.')
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'))
  return Number.isSafeInteger(cents) && cents <= 999999999 ? cents : null
}
export function priceCandidates(result: OcrResult): PriceCandidate[] {
  const found: PriceCandidate[] = []
  for (const line of result.lines) {
    const unitPrice = /(?:\/\s*(?:kg|κιλ|κγ|lt|λίτ|λιτ)|(?:ανα|ανά)\s*(?:κιλ|λίτ)|(?:kg|κιλό|litre)\s*[:€])/iu.test(line.text)
    // Decimals must be bounded; do not extract a suffix from a long barcode or date.
    for (const m of line.text.matchAll(/(?<![\d.,/])\d{1,5}[,.]\d{2}(?![\d.,/])/gu)) {
      const cents = parseCents(m[0]); if (cents !== null) found.push({ cents, line, unitPrice })
    }
  }
  return found
}
export function codesFromOcr(result: OcrResult, lookup: ReturnType<typeof buildIndex>): string[] {
  const codes = new Set<string>()
  for (const line of result.lines) for (const match of line.text.matchAll(/(?<!\d)\d{7,14}(?!\d)/g)) {
    const matches = lookup(match[0]); if (matches.length === 1) codes.add(matches[0].internal_code)
  }
  return [...codes]
}
export function groupLines(lines: OcrLine[]): OcrLine[][] {
  const rows: OcrLine[][] = []
  for (const line of [...lines].sort((a,b) => a.box.y - b.box.y || a.box.x - b.box.x)) {
    const cy = line.box.y + line.box.height / 2
    const row = rows.find(r => Math.abs(cy - (r[0].box.y + r[0].box.height / 2)) <= Math.max(5, Math.min(line.box.height, r[0].box.height) * .55))
    if (row) row.push(line); else rows.push([line])
  }
  return rows.map(r => r.sort((a,b) => a.box.x-b.box.x))
}
/** A draft, not a verified catalogue importer. Handwritten count marks are never quantities. */
export function documentRows(result: OcrResult, lookup: ReturnType<typeof buildIndex>): DocumentRow[] {
  const rows: DocumentRow[] = []
  for (const cells of groupLines(result.lines)) {
    const text = cells.map(l => l.text).join(' ')
    const allCodes = [...text.matchAll(/(?<!\d)\d{7}(?!\d)/g)]
    if (allCodes.length !== 1) continue
    const code = allCodes[0][0], position = allCodes[0].index!
    const before = text.slice(0, position), after = text.slice(position + code.length)
    const unit = after.match(/Τεμάχιο|Κιλό|Κιβώτιο/iu)?.[0] ?? ''
    const split = unit ? after.toLowerCase().indexOf(unit.toLowerCase()) : -1
    const afterUnit = split >= 0 ? after.slice(split + unit.length) : ''
    const price = afterUnit.match(/^\s*(\d{1,5}[,.]\d{2})(?!\d)/)?.[1] ?? ''
    const places = [...before.matchAll(/(?<!\d)\d{1,3}[,.]\d{2}(?!\d)/g)].map(m => m[0])
    rows.push({ code, description: (split >= 0 ? after.slice(0, split) : after).trim(), price,
      unit, row: places.at(-2) ?? '', number: places.at(-1) ?? '', text,
      known: lookup(code).length === 1, needsReview: true })
  }
  return rows
}
export function safeCsv(rows: string[][]): string {
  return '\ufeff' + rows.map(r => r.map(s => `"${(/^[=+@\-\t\r]/.test(s) ? "'" + s : s).replaceAll('"', '""')}"`).join(';')).join('\r\n')
}
