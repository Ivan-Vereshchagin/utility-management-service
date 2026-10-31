import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useParams } from 'react-router'

import { ApiError, apiRequest, hasAccessToken, setAccessToken } from '../api/client'
import { roleLabels } from '../api/properties'
import type { PropertySummary } from '../api/properties'
import AccrualCreateForm from './AccrualCreateForm'
import './PropertyPage.css'

type Accrual = {
  id: number
  period_start: string
  period_end: string
  total_amount: string
  unallocated_amount: string
  notes: string | null
  lines: {
    id: number
    service_type_code: string
    description: string | null
    amount: string
  }[]
}

type ServiceType = { code: string; name: string }

const rubles = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' })

function formatDate(value: string) {
  const [year, month, day] = value.split('-')
  return `${day}.${month}.${year}`
}

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
  const [accruals, setAccruals] = useState<Accrual[] | null>(null)
  const [accrualError, setAccrualError] = useState<string | null>(null)
  const [accrualReload, setAccrualReload] = useState(0)
  const [serviceNames, setServiceNames] = useState<Record<string, string>>({})

  const handleUnauthorized = useCallback(() => {
    setAccessToken(null)
    setExpired(true)
  }, [])

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

  useEffect(() => {
    if (property?.id !== id || expired || notFound) return

    let active = true
    apiRequest<Accrual[]>(`/properties/${id}/accruals`)
      .then((result) => {
        if (active) setAccruals(result)
      })
      .catch((cause: unknown) => {
        if (!active) return
        if (cause instanceof ApiError && cause.status === 401) {
          setAccessToken(null)
          setExpired(true)
        } else if (cause instanceof ApiError && cause.status === 404) {
          setNotFound(true)
        } else {
          setAccrualError(
            cause instanceof ApiError
              ? cause.message
              : 'Не удалось связаться с сервером',
          )
        }
      })

    apiRequest<ServiceType[]>('/service-types')
      .then((result) => {
        if (active) {
          setServiceNames(Object.fromEntries(result.map((item) => [item.code, item.name])))
        }
      })
      .catch(() => {})

    return () => { active = false }
  }, [property?.id, id, expired, notFound, accrualReload])

  function retry() {
    setError(null)
    setReload((value) => value + 1)
  }

  function retryAccruals() {
    setAccruals(null)
    setAccrualError(null)
    setAccrualReload((value) => value + 1)
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
          <section className="accrual-history">
            <h2>Начисления</h2>
            {property.role !== 'reader' && (
              <AccrualCreateForm
                propertyId={property.id}
                onCreated={retryAccruals}
                onUnauthorized={handleUnauthorized}
                onNotFound={() => setNotFound(true)}
              />
            )}
            {accrualError ? (
              <div role="alert">
                <p>{accrualError}</p>
                <button type="button" onClick={retryAccruals}>Повторить</button>
              </div>
            ) : accruals === null ? (
              <p role="status">Загружаем начисления…</p>
            ) : accruals.length === 0 ? (
              <p>Начислений пока нет.</p>
            ) : (
              <ul className="accrual-list">
                {accruals.map((accrual) => (
                  <li key={accrual.id} className="accrual-card">
                    <div className="accrual-heading">
                      <h3>
                        {formatDate(accrual.period_start)} — {formatDate(accrual.period_end)}
                      </h3>
                      <strong>{rubles.format(Number(accrual.total_amount))}</strong>
                    </div>
                    {accrual.lines.length > 0 && (
                      <ul className="accrual-lines">
                        {accrual.lines.map((line) => (
                          <li key={line.id}>
                            <span>
                              {serviceNames[line.service_type_code] ?? line.service_type_code}
                            </span>
                            <span>{rubles.format(Number(line.amount))}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {Number(accrual.unallocated_amount) > 0 && (
                      <p>Без разбивки по услугам: {rubles.format(Number(accrual.unallocated_amount))}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  )
}

export default PropertyPage
