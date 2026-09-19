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
}

export type Location = {
  id: string
  code: string
  name: string
  sort_order: number
}
