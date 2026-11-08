import { useEffect, useState } from 'react'

import { ApiError, apiRequest } from '../api/client'

type InvitationSummary = {
  id: number
  role: 'reader' | 'editor'
  created_at: string
  expires_at: string
  accepted_at: string | null
  accepted_by_email: string | null
  revoked_at: string | null
  status: 'active' | 'expired' | 'accepted' | 'revoked'
}

type Props = {
  propertyId: number
  reload: number
  onUnauthorized: () => void
  onNotFound: () => void
}

const dateFormat = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'short',
  timeStyle: 'short',
})

const statusLabels: Record<InvitationSummary['status'], string> = {
  active: 'Активно',
  expired: 'Истекло',
  accepted: 'Использовано',
  revoked: 'Отозвано',
}

function InvitationList({ propertyId, reload, onUnauthorized, onNotFound }: Props) {
  const [invitations, setInvitations] = useState<InvitationSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [showAll, setShowAll] = useState(false)
  const [confirmingId, setConfirmingId] = useState<number | null>(null)
  const [pending, setPending] = useState(false)
  const [revokeError, setRevokeError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    apiRequest<InvitationSummary[]>(`/properties/${propertyId}/invitations`)
      .then((result) => {
        if (active) setInvitations(result)
      })
      .catch((cause: unknown) => {
        if (!active) return
        if (cause instanceof ApiError && cause.status === 401) {
          onUnauthorized()
        } else if (cause instanceof ApiError && cause.status === 404) {
          onNotFound()
        } else {
          setError(cause instanceof ApiError ? cause.message : 'Не удалось связаться с сервером')
        }
      })

    return () => { active = false }
  }, [propertyId, reload, retry, onUnauthorized, onNotFound])

  function retryLoad() {
    setInvitations(null)
    setError(null)
    setRetry((value) => value + 1)
  }

  async function revokeInvitation(invitationId: number) {
    if (pending) return
    setRevokeError(null)
    setPending(true)
    try {
      await apiRequest<void>(`/properties/${propertyId}/invitations/${invitationId}`, {
        method: 'DELETE',
      })
      setConfirmingId(null)
      retryLoad()
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        onUnauthorized()
      } else if (cause instanceof ApiError && cause.status === 404) {
        onNotFound()
      } else if (cause instanceof ApiError && cause.status === 409) {
        setConfirmingId(null)
        retryLoad()
      } else {
        setRevokeError(
          cause instanceof ApiError ? cause.message : 'Не удалось связаться с сервером',
        )
      }
    } finally {
      setPending(false)
    }
  }

  if (error) {
    return (
      <div role="alert">
        <p>{error}</p>
        <button type="button" onClick={retryLoad}>Повторить</button>
      </div>
    )
  }

  if (invitations === null) return <p role="status">Загружаем приглашения…</p>
  if (invitations.length === 0) return <p>Приглашений пока нет.</p>

  return (
    <>
      <ul className="invitation-list">
        {(showAll ? invitations : invitations.slice(0, 5)).map((invitation) => (
          <li key={invitation.id}>
            <span>{invitation.role === 'reader' ? 'Читатель' : 'Редактор'}</span>
            <span>{statusLabels[invitation.status]}</span>
            <span>Действует до {dateFormat.format(new Date(invitation.expires_at))}</span>
            {invitation.status === 'accepted' && (
              <span>Принял: {invitation.accepted_by_email ?? 'аккаунт удалён'}</span>
            )}
            {invitation.status === 'active' && (
              confirmingId === invitation.id ? (
                <div className="invitation-revoke-confirmation">
                  <p>Отозвать это приглашение? Код перестанет действовать.</p>
                  {revokeError && <p className="property-error" role="alert">{revokeError}</p>}
                  <button
                    className="invitation-revoke"
                    type="button"
                    disabled={pending}
                    onClick={() => void revokeInvitation(invitation.id)}
                  >
                    {pending ? 'Отзываем…' : 'Отозвать код'}
                  </button>
                  <button type="button" disabled={pending} onClick={() => {
                    setConfirmingId(null)
                    setRevokeError(null)
                  }}>
                    Отмена
                  </button>
                </div>
              ) : (
                <button className="invitation-revoke" type="button" disabled={pending} onClick={() => {
                  setConfirmingId(invitation.id)
                  setRevokeError(null)
                }}>
                  Отозвать
                </button>
              )
            )}
          </li>
        ))}
      </ul>
      {invitations.length > 5 && (
        <button type="button" onClick={() => setShowAll((value) => !value)}>
          {showAll ? 'Скрыть старые' : `Показать остальные (${invitations.length - 5})`}
        </button>
      )}
    </>
  )
}

export default InvitationList
