export type Membership = {
  store_id: string
  user_id: string
  role: 'owner' | 'admin' | 'editor' | 'viewer'
}

export type ProductOverview = {
  product_id: string
  store_id: string
  internal_code: string
  barcode: string | null
  description: string
  unit: string | null
  catalog_price: number | null
  shelf_price: number | null
  price_diff: number | null
  price_status: 'unchecked' | 'review' | 'same' | 'different'
  source_ref: string | null
  observed_at: string | null
  location_code: string | null
  row_label: string | null
  number_label: string | null
  nearest_expiry: string | null
  expiry_batch_count: number | null
  expiry_quantity: number | null
  expiry_status: 'untracked' | 'expired' | 'critical' | 'warning' | 'monitor' | 'ok'
  days_until_expiry: number | null
}

export type ExpiryKind = 'expiry' | 'best_before' | 'sell_by' | 'unknown'
export type ExpiryStatus = ProductOverview['expiry_status']

export type ExpiryBatchOverview = {
  batch_id: string
  store_id: string
  product_id: string
  internal_code: string
  barcode: string | null
  description: string
  unit: string | null
  location_id: string | null
  location_code: string | null
  lot_number: string | null
  expiry_date: string
  expiry_kind: ExpiryKind
  quantity: number | null
  source_type: 'gs1' | 'ocr' | 'manual' | 'galaxy'
  source_ref: string | null
  confidence: number | null
  captured_at: string
  days_until_expiry: number
  expiry_status: Exclude<ExpiryStatus, 'untracked'>
}

export type ExpirySettings = {
  store_id: string
  critical_days: number
  warning_days: number
  monitor_days: number
  updated_at: string
}

export type Location = {
  id: string
  code: string
  name: string
  sort_order: number
}
