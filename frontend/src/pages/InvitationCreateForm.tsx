import { useState } from 'react'
import type { FormEvent } from 'react'

import { ApiError, apiRequest } from '../api/client'

type InvitationRole = 'reader' | 'editor'

type InvitationIssued = {
  id: number
  property_id: number
  role: InvitationRole
  code: string
  created_at: string
  expires_at: string
}

type Props = {
  propertyId: number
  onUnauthorized: () => void
  onNotFound: () => void
}

const expirationFormat = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'short',
  timeStyle: 'short',
})

function InvitationCreateForm({ propertyId, onUnauthorized, onNotFound }: Props) {
  const [open, setOpen] = useState(false)
  const [role, setRole] = useState<InvitationRole>('reader')
  const [issued, setIssued] = useState<InvitationIssued | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return

    setError(null)
    setPending(true)
    try {
      const result = await apiRequest<InvitationIssued>(
        `/properties/${propertyId}/invitations`,
        { method: 'POST', json: { role } },
      )
      setIssued(result)
      setOpen(false)
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        onUnauthorized()
      } else if (cause instanceof ApiError && cause.status === 404) {
        onNotFound()
      } else {
        setError(
          cause instanceof ApiError
            ? cause.message
            : 'Не удалось связаться с сервером',
        )
      }
    } finally {
      setPending(false)
    }
  }

  if (issued !== null) {
    return (
      <div className="invitation-issued">
        <p>Код приглашения для роли «{issued.role === 'reader' ? 'Читатель' : 'Редактор'}»:</p>
        <code>{issued.code}</code>
        <p>Действует до {expirationFormat.format(new Date(issued.expires_at))}.</p>
        <p>Сохраните код сейчас: после закрытия его нельзя будет посмотреть снова.</p>
        <button type="button" onClick={() => setIssued(null)}>Закрыть</button>
      </div>
    )
  }

  if (!open) {
    return <button type="button" onClick={() => setOpen(true)}>Создать код приглашения</button>
  }

  return (
    <form className="invitation-create-form" onSubmit={handleSubmit}>
      <label htmlFor="invitation-role">Роль приглашённого</label>
      <select
        id="invitation-role"
        value={role}
        onChange={(event) => setRole(event.target.value as InvitationRole)}
      >
        <option value="reader">Читатель</option>
        <option value="editor">Редактор</option>
      </select>
      {error && <p className="property-error" role="alert">{error}</p>}
      <div className="invitation-create-actions">
        <button type="submit" disabled={pending}>
          {pending ? 'Создаём…' : 'Создать код'}
        </button>
        <button type="button" disabled={pending} onClick={() => {
          setOpen(false)
          setError(null)
        }}>
          Отмена
        </button>
      </div>
    </form>
  )
}

export default InvitationCreateForm
