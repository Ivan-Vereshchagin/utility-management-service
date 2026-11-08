import { useState } from 'react'

import { ApiError, apiRequest } from '../api/client'

type Props = {
  accrualId: number
  propertyId: number
  onDeleted: () => void
  onUnauthorized: () => void
}

function AccrualDeleteButton({ accrualId, propertyId, onDeleted, onUnauthorized }: Props) {
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDelete() {
    if (pending) return
    setError(null)
    setPending(true)

    try {
      await apiRequest<void>(`/properties/${propertyId}/accruals/${accrualId}`, {
        method: 'DELETE',
      })
      onDeleted()
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        onUnauthorized()
      } else if (cause instanceof ApiError && cause.status === 404) {
        onDeleted()
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

  if (!confirming) {
    return (
      <button className="accrual-delete-button" type="button" onClick={() => setConfirming(true)}>
        Удалить
      </button>
    )
  }

  return (
    <div className="accrual-delete-confirmation">
      <p>Удалить это начисление вместе с разбивкой по услугам?</p>
      {error && <p className="property-error" role="alert">{error}</p>}
      <button className="accrual-delete-button" type="button" disabled={pending} onClick={handleDelete}>
        {pending ? 'Удаляем…' : 'Удалить начисление'}
      </button>
      <button type="button" disabled={pending} onClick={() => {
        setConfirming(false)
        setError(null)
      }}>
        Отмена
      </button>
    </div>
  )
}

export default AccrualDeleteButton
