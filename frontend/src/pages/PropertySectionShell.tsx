import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router'

import { ApiError, apiRequest, hasAccessToken, setAccessToken } from '../api/client'
import type { PropertySummary } from '../api/properties'
import './PropertyPage.css'

type Props = {
  title: string
  ownerOnly?: boolean
  children: (
    property: PropertySummary,
    onUnauthorized: () => void,
    onNotFound: () => void,
  ) => ReactNode
}

function PropertySectionShell({ title, ownerOnly = false, children }: Props) {
  const { propertyId } = useParams()
  const id = Number(propertyId)
  const validId = Number.isSafeInteger(id) && id > 0
  const authorized = hasAccessToken()
  const [property, setProperty] = useState<PropertySummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expired, setExpired] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [reload, setReload] = useState(0)

  const onUnauthorized = useCallback(() => {
    setAccessToken(null)
    setExpired(true)
  }, [])
  const onNotFound = useCallback(() => setNotFound(true), [])

  useEffect(() => {
    if (!authorized || !validId) return

    let active = true
    apiRequest<PropertySummary>(`/properties/${id}`)
      .then((result) => {
        if (active) setProperty(result)
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
  }, [authorized, id, validId, reload, onUnauthorized, onNotFound])

  function retry() {
    setProperty(null)
    setError(null)
    setReload((value) => value + 1)
  }

  return (
    <main className="property-page">
      <nav className="property-top-nav" aria-label="Навигация по объекту">
        <Link to="/properties">← Все объекты</Link>
        {validId && <Link to={`/properties/${id}`}>К объекту</Link>}
      </nav>
      {!authorized || expired ? (
        <p>Войдите в аккаунт, чтобы увидеть раздел. <Link to="/login">Войти</Link></p>
      ) : !validId || notFound ? (
        <p role="alert">Объект не найден.</p>
      ) : error ? (
        <div role="alert">
          <p>{error}</p>
          <button type="button" onClick={retry}>Повторить</button>
        </div>
      ) : property?.id !== id ? (
        <p role="status">Загружаем объект…</p>
      ) : (
        <>
          <h1 className="property-section-title">{title}</h1>
          <p className="property-section-subtitle">{property.name || property.address}</p>
          {ownerOnly && property.role !== 'owner' ? (
            <p role="alert">Раздел доступен только владельцу объекта.</p>
          ) : children(property, onUnauthorized, onNotFound)}
        </>
      )}
    </main>
  )
}

export default PropertySectionShell
