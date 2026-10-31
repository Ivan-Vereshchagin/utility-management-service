import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
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
  const [editing, setEditing] = useState(false)
  const [address, setAddress] = useState('')
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

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

  function startEditing() {
    if (property === null) return
    setAddress(property.address)
    setName(property.name ?? '')
    setSaveError(null)
    setEditing(true)
  }

  function cancelEditing() {
    setEditing(false)
    setSaveError(null)
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving || property === null || property.role !== 'owner') return

    const trimmedAddress = address.trim()
    if (!trimmedAddress) {
      setSaveError('Укажите адрес')
      return
    }

    setSaveError(null)
    setSaving(true)
    try {
      const updated = await apiRequest<PropertySummary>(`/properties/${property.id}`, {
        method: 'PATCH',
        json: { address: trimmedAddress, name: name.trim() || null },
      })
      setProperty(updated)
      setEditing(false)
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        setAccessToken(null)
        setExpired(true)
      } else if (cause instanceof ApiError && cause.status === 404) {
        setNotFound(true)
      } else {
        setSaveError(
          cause instanceof ApiError
            ? cause.message
            : 'Не удалось связаться с сервером',
        )
      }
    } finally {
      setSaving(false)
    }
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
          {property.role === 'owner' && (
            editing ? (
              <form className="property-edit-form" onSubmit={handleSave}>
                <label htmlFor="edit-address">Адрес</label>
                <input
                  id="edit-address"
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                  maxLength={500}
                  required
                />
                <label htmlFor="edit-name">Название (необязательно)</label>
                <input
                  id="edit-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={120}
                />
                {saveError && <p className="property-error" role="alert">{saveError}</p>}
                <div className="property-edit-actions">
                  <button type="submit" disabled={saving}>
                    {saving ? 'Сохраняем…' : 'Сохранить'}
                  </button>
                  <button type="button" disabled={saving} onClick={cancelEditing}>Отмена</button>
                </div>
              </form>
            ) : (
              <button type="button" onClick={startEditing}>Редактировать</button>
            )
          )}
        </>
      )}
    </main>
  )
}

export default PropertyPage
