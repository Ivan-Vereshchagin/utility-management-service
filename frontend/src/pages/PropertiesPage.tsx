import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'

import { ApiError, apiRequest, hasAccessToken, setAccessToken } from '../api/client'
import './PropertiesPage.css'

type PropertySummary = {
  id: number
  owner_id: number
  address: string
  name: string | null
  created_at: string
  role: 'owner' | 'editor' | 'reader'
}

const roleLabels: Record<PropertySummary['role'], string> = {
  owner: 'Владелец',
  editor: 'Редактор',
  reader: 'Читатель',
}

function PropertiesPage() {
  const navigate = useNavigate()
  const authorized = hasAccessToken()
  const [properties, setProperties] = useState<PropertySummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expired, setExpired] = useState(false)
  const [reload, setReload] = useState(0)
  const [loggingOut, setLoggingOut] = useState(false)
  const [logoutError, setLogoutError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [address, setAddress] = useState('')
  const [name, setName] = useState('')
  const [createPending, setCreatePending] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  useEffect(() => {
    if (!authorized) return

    let active = true
    apiRequest<PropertySummary[]>('/properties')
      .then((result) => {
        if (active) setProperties(result)
      })
      .catch((cause: unknown) => {
        if (!active) return
        if (cause instanceof ApiError && cause.status === 401) {
          setAccessToken(null)
          setExpired(true)
          return
        }
        setError(
          cause instanceof ApiError
            ? cause.message
            : 'Не удалось связаться с сервером',
        )
      })

    return () => { active = false }
  }, [authorized, reload])

  function retry() {
    setProperties(null)
    setError(null)
    setReload((value) => value + 1)
  }

  function cancelCreate() {
    setCreating(false)
    setAddress('')
    setName('')
    setCreateError(null)
  }

  async function handleLogout() {
    setLogoutError(null)
    setLoggingOut(true)

    try {
      await apiRequest<void>('/auth/logout', { method: 'POST' })
      setAccessToken(null)
      navigate('/login', { replace: true })
    } catch (cause) {
      setLogoutError(
        cause instanceof ApiError
          ? cause.message
          : 'Не удалось связаться с сервером',
      )
      setLoggingOut(false)
    }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (createPending || loggingOut) return

    const trimmedAddress = address.trim()
    if (!trimmedAddress) {
      setCreateError('Укажите адрес')
      return
    }

    setCreateError(null)
    setCreatePending(true)
    try {
      const created = await apiRequest<PropertySummary>('/properties', {
        method: 'POST',
        json: { address: trimmedAddress, name: name.trim() || null },
      })
      setProperties((current) => current === null ? [created] : [...current, created])
      setAddress('')
      setName('')
      setCreating(false)
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        setAccessToken(null)
        setExpired(true)
      } else {
        setCreateError(
          cause instanceof ApiError
            ? cause.message
            : 'Не удалось связаться с сервером',
        )
      }
    } finally {
      setCreatePending(false)
    }
  }

  return (
    <main className="properties-page">
      <div className="properties-header">
        <h1>Мои объекты</h1>
        {authorized && !expired && (
          <button type="button" disabled={loggingOut || createPending} onClick={handleLogout}>
            {loggingOut ? 'Выходим…' : 'Выйти'}
          </button>
        )}
      </div>
      {logoutError && <p className="properties-error" role="alert">{logoutError}</p>}
      {authorized && !expired && properties !== null && !error && (
        creating ? (
          <form className="property-create-form" onSubmit={handleCreate}>
            <h2>Новый объект</h2>
            <label htmlFor="property-address">Адрес</label>
            <input
              id="property-address"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              maxLength={500}
              required
            />
            <label htmlFor="property-name">Название (необязательно)</label>
            <input
              id="property-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
            />
            {createError && <p className="properties-error" role="alert">{createError}</p>}
            <div className="property-create-actions">
              <button type="submit" disabled={createPending || loggingOut}>
                {createPending ? 'Сохраняем…' : 'Сохранить'}
              </button>
              <button type="button" disabled={createPending || loggingOut} onClick={cancelCreate}>
                Отмена
              </button>
            </div>
          </form>
        ) : (
          <button type="button" onClick={() => setCreating(true)}>Добавить объект</button>
        )
      )}
      {!authorized || expired ? (
        <p>Войдите в аккаунт, чтобы увидеть объекты. <Link to="/login">Войти</Link></p>
      ) : error ? (
        <div role="alert">
          <p>{error}</p>
          <button type="button" onClick={retry}>Повторить</button>
        </div>
      ) : properties === null ? (
        <p role="status">Загружаем объекты…</p>
      ) : properties.length === 0 ? (
        <p>Объектов пока нет.</p>
      ) : (
        <ul className="properties-list">
          {properties.map((property) => (
            <li key={property.id} className="property-card">
              <h2>{property.name || property.address}</h2>
              {property.name && <p>{property.address}</p>}
              <p className="property-role">{roleLabels[property.role]}</p>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}

export default PropertiesPage
