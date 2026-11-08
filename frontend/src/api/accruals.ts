export type Accrual = {
  id: number
  period_start: string
  period_end: string
  total_amount: string
  unallocated_amount: string
  notes: string | null
  lines: {
    id: number
    service_type_code: string
    description: string | null
    amount: string
  }[]
}
