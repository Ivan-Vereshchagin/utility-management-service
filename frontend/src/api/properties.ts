export type PropertySummary = {
  id: number
  owner_id: number
  address: string
  name: string | null
  created_at: string
  role: 'owner' | 'editor' | 'reader'
}

export const roleLabels: Record<PropertySummary['role'], string> = {
  owner: 'Владелец',
  editor: 'Редактор',
  reader: 'Читатель',
}
