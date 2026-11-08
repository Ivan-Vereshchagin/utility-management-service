import { useState } from 'react'
import type { FormEvent } from 'react'

import { ApiError, apiRequest } from '../api/client'
import type { PropertySummary } from '../api/properties'

type Props = {
  onJoined: (property: PropertySummary) => void
  onUnauthorized: () => void
}

function InvitationRedeemForm({ onJoined, onUnauthorized }: Props) {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return

    const normalized = code.replace(/[-\s]/g, '').toUpperCase()
    if (!/^[0-9A-F]{24}$/.test(normalized)) {
      setError('Код должен содержать 24 шестнадцатеричных символа')
      return
    }

    setError(null)
    setPending(true)
    try {
      const property = await apiRequest<PropertySummary>('/invitations/redeem', {
        method: 'POST',
        json: { code: normalized },
      })
      setCode('')
      setOpen(false)
      onJoined(property)
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        onUnauthorized()
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

  if (!open) {
    return <button type="button" onClick={() => setOpen(true)}>Присоединиться по коду</button>
  }

  return (
    <form className="invitation-redeem-form" onSubmit={handleSubmit}>
      <label htmlFor="invitation-code">Код приглашения</label>
      <input
        id="invitation-code"
        value={code}
        onChange={(event) => setCode(event.target.value)}
        autoComplete="off"
        maxLength={64}
        required
      />
      {error && <p className="properties-error" role="alert">{error}</p>}
      <div className="invitation-redeem-actions">
        <button type="submit" disabled={pending}>
          {pending ? 'Присоединяемся…' : 'Присоединиться'}
        </button>
        <button type="button" disabled={pending} onClick={() => {
          setCode('')
          setError(null)
          setOpen(false)
        }}>
          Отмена
        </button>
      </div>
    </form>
  )
}

export default InvitationRedeemForm
