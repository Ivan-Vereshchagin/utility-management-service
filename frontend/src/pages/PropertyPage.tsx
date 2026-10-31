import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'

import { ApiError, apiRequest, hasAccessToken, setAccessToken } from '../api/client'
import { roleLabels } from '../api/properties'
import type { PropertySummary } from '../api/properties'
import './PropertyPage.css'

function PropertyPage() {
  const { propertyId } = useParams()
  const id = Number(propertyId)
  const validId = Number.isSafeInteger(id) && id > 0
  const authorized = hasAccessToken()
  const [property, setProperty] = useState<PropertySummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expired, setExpired] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [reload, setReload] = useState(0)

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
          setAccessToken(null)
          setExpired(true)
        } else if (cause instanceof ApiError && cause.status === 404) {
          setNotFound(true)
        } else {
          setError(
            cause instanceof ApiError
              ? cause.message
              : 'Не удалось связаться с сервером',
          )
        }
      })

    return () => { active = false }
  }, [authorized, id, validId, reload])

  function retry() {
    setError(null)
    setReload((value) => value + 1)
  }

  return (
    <main className="property-page">
      <p><Link to="/properties">← Мои объекты</Link></p>
      {!authorized || expired ? (
        <p>Войдите в аккаунт, чтобы увидеть объект. <Link to="/login">Войти</Link></p>
      ) : !validId || notFound ? (
        <p role="alert">Объект не найден.</p>
      ) : error ? (
        <div role="alert">
          <p>{error}</p>
          <button type="button" onClick={retry}>Повторить</button>
        </div>
      ) : property === null ? (
        <p role="status">Загружаем объект…</p>
      ) : (
        <>
          <h1>{property.name || property.address}</h1>
          {property.name && <p className="property-address">{property.address}</p>}
          <p>Роль: {roleLabels[property.role]}</p>
        </>
      )}
    </main>
  )
}

export default PropertyPage
