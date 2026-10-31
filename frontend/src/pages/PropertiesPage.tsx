import { useEffect, useState } from 'react'
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

  return (
    <main className="properties-page">
      <div className="properties-header">
        <h1>Мои объекты</h1>
        {authorized && !expired && (
          <button type="button" disabled={loggingOut} onClick={handleLogout}>
            {loggingOut ? 'Выходим…' : 'Выйти'}
          </button>
        )}
      </div>
      {logoutError && <p className="properties-error" role="alert">{logoutError}</p>}
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
