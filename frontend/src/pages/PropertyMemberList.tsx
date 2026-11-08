import { useEffect, useState } from 'react'

import { ApiError, apiRequest } from '../api/client'
import { roleLabels } from '../api/properties'

type PropertyMember = {
  user_id: number
  email: string
  role: 'editor' | 'reader'
  joined_at: string
}

type Props = {
  propertyId: number
  onUnauthorized: () => void
  onNotFound: () => void
}

function PropertyMemberList({ propertyId, onUnauthorized, onNotFound }: Props) {
  const [members, setMembers] = useState<PropertyMember[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<number | null>(null)
  const [pending, setPending] = useState(false)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let active = true
    apiRequest<PropertyMember[]>(`/properties/${propertyId}/members`)
      .then((result) => {
        if (active) setMembers(result)
      })
      .catch((cause: unknown) => {
        if (!active) return
        if (cause instanceof ApiError && cause.status === 401) {
          onUnauthorized()
        } else if (cause instanceof ApiError && cause.status === 404) {
          onNotFound()
        } else {
          setLoadError(cause instanceof ApiError ? cause.message : 'Не удалось связаться с сервером')
        }
      })

    return () => { active = false }
  }, [propertyId, reload, onUnauthorized, onNotFound])

  function retryLoad() {
    setMembers(null)
    setLoadError(null)
    setReload((value) => value + 1)
  }

  async function removeMember(userId: number) {
    if (pending) return
    setRemoveError(null)
    setPending(true)
    try {
      await apiRequest<void>(`/properties/${propertyId}/members/${userId}`, {
        method: 'DELETE',
      })
      setMembers((current) => current?.filter((member) => member.user_id !== userId) ?? null)
      setConfirmingId(null)
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        onUnauthorized()
      } else if (cause instanceof ApiError && cause.status === 404) {
        setConfirmingId(null)
        retryLoad()
      } else {
        setRemoveError(cause instanceof ApiError ? cause.message : 'Не удалось связаться с сервером')
      }
    } finally {
      setPending(false)
    }
  }

  if (loadError) {
    return (
      <div role="alert">
        <p>{loadError}</p>
        <button type="button" onClick={retryLoad}>Повторить</button>
      </div>
    )
  }

  if (members === null) return <p role="status">Загружаем участников…</p>
  if (members.length === 0) return <p>Участников пока нет.</p>

  return (
    <ul className="property-member-list">
      {members.map((member) => (
        <li key={member.user_id}>
          <div className="property-member-details">
            <span>{member.email}</span>
            <span>{roleLabels[member.role]}</span>
          </div>
          {confirmingId === member.user_id ? (
            <div className="property-member-confirmation">
              <p>Удалить доступ пользователя {member.email} к этому объекту?</p>
              {removeError && <p className="property-error" role="alert">{removeError}</p>}
              <button
                className="property-member-remove"
                type="button"
                disabled={pending}
                onClick={() => void removeMember(member.user_id)}
              >
                {pending ? 'Удаляем…' : 'Удалить доступ'}
              </button>
              <button type="button" disabled={pending} onClick={() => {
                setConfirmingId(null)
                setRemoveError(null)
              }}>
                Отмена
              </button>
            </div>
          ) : (
            <button className="property-member-remove" type="button" disabled={pending} onClick={() => {
              setConfirmingId(member.user_id)
              setRemoveError(null)
            }}>
              Удалить
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

export default PropertyMemberList
