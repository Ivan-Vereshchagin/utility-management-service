import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'

import { ApiError, apiRequest } from '../api/client'

type Props = {
  propertyId: number
  onCreated: () => void
  onUnauthorized: () => void
  onNotFound: () => void
}

type ServiceType = { code: string; name: string }
type LineDraft = { id: number; serviceTypeCode: string; amount: string }

const moneyPattern = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/
const rubles = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' })

function toKopeks(value: string): number | null {
  const normalized = value.trim().replace(',', '.')
  if (!moneyPattern.test(normalized)) return null
  const [whole, fraction = ''] = normalized.split('.')
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
}

function AccrualCreateForm({ propertyId, onCreated, onUnauthorized, onNotFound }: Props) {
  const nextLineId = useRef(0)
  const [open, setOpen] = useState(false)
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [totalAmount, setTotalAmount] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lines, setLines] = useState<LineDraft[]>([])
  const [serviceTypes, setServiceTypes] = useState<ServiceType[] | null>(null)
  const [serviceError, setServiceError] = useState<string | null>(null)
  const [serviceReload, setServiceReload] = useState(0)

  useEffect(() => {
    if (!open) return

    let active = true
    apiRequest<ServiceType[]>('/service-types')
      .then((result) => {
        if (active) setServiceTypes(result)
      })
      .catch((cause: unknown) => {
        if (!active) return
        if (cause instanceof ApiError && cause.status === 401) {
          onUnauthorized()
        } else {
          setServiceError(
            cause instanceof ApiError
              ? cause.message
              : 'Не удалось связаться с сервером',
          )
        }
      })

    return () => { active = false }
  }, [open, serviceReload, onUnauthorized])

  function addLine() {
    nextLineId.current += 1
    setLines((current) => [
      ...current,
      { id: nextLineId.current, serviceTypeCode: '', amount: '' },
    ])
  }

  function updateLine(id: number, changes: Partial<LineDraft>) {
    setLines((current) => current.map((line) =>
      line.id === id ? { ...line, ...changes } : line,
    ))
  }

  function retryServiceTypes() {
    setServiceTypes(null)
    setServiceError(null)
    setServiceReload((value) => value + 1)
  }

  const totalKopeks = toKopeks(totalAmount)
  const lineAmounts = lines.map((line) => toKopeks(line.amount))
  const allocatedKopeks = lineAmounts.reduce<number>(
    (sum, amount) => sum + (amount ?? 0), 0,
  )
  const remainingKopeks = totalKopeks !== null && lineAmounts.every((amount) => amount !== null)
    ? totalKopeks - allocatedKopeks
    : null

  function close() {
    setOpen(false)
    setPeriodStart('')
    setPeriodEnd('')
    setTotalAmount('')
    setLines([])
    setError(null)
    setServiceError(null)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return

    if (periodStart > periodEnd) {
      setError('Начало периода не может быть позже окончания')
      return
    }

    const amount = totalAmount.trim().replace(',', '.')
    if (totalKopeks === null) {
      setError('Укажите сумму в рублях с точностью до копеек')
      return
    }

    if (lines.some((line) => !serviceTypes?.some((item) => item.code === line.serviceTypeCode))) {
      setError('Выберите вид услуги для каждой строки')
      return
    }
    if (lineAmounts.some((lineAmount) => lineAmount === null)) {
      setError('Укажите сумму каждой услуги с точностью до копеек')
      return
    }
    if (allocatedKopeks > totalKopeks) {
      setError('Сумма услуг превышает общую сумму начисления')
      return
    }

    setError(null)
    setPending(true)
    try {
      await apiRequest<unknown>(`/properties/${propertyId}/accruals`, {
        method: 'POST',
        json: {
          period_start: periodStart,
          period_end: periodEnd,
          total_amount: amount,
          lines: lines.map((line) => ({
            service_type_code: line.serviceTypeCode,
            amount: line.amount.trim().replace(',', '.'),
          })),
        },
      })
      close()
      onCreated()
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        onUnauthorized()
      } else if (cause instanceof ApiError && cause.status === 404) {
        onNotFound()
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
    return <button type="button" onClick={() => {
      setServiceTypes(null)
      setOpen(true)
    }}>Добавить начисление</button>
  }

  return (
    <form className="accrual-create-form" onSubmit={handleSubmit}>
      <label htmlFor="accrual-period-start">Начало периода</label>
      <input
        id="accrual-period-start"
        type="date"
        value={periodStart}
        onChange={(event) => setPeriodStart(event.target.value)}
        required
      />
      <label htmlFor="accrual-period-end">Конец периода</label>
      <input
        id="accrual-period-end"
        type="date"
        value={periodEnd}
        onChange={(event) => setPeriodEnd(event.target.value)}
        required
      />
      <label htmlFor="accrual-total-amount">Начислено, ₽</label>
      <input
        id="accrual-total-amount"
        type="text"
        inputMode="decimal"
        maxLength={15}
        value={totalAmount}
        onChange={(event) => setTotalAmount(event.target.value)}
        required
      />
      <h3>Услуги</h3>
      {serviceError ? (
        <div role="alert">
          <p>{serviceError}</p>
          <button type="button" onClick={retryServiceTypes}>Повторить загрузку услуг</button>
        </div>
      ) : serviceTypes === null ? (
        <p role="status">Загружаем виды услуг…</p>
      ) : serviceTypes.length === 0 ? (
        <p>Виды услуг не найдены.</p>
      ) : (
        <>
          {lines.map((line) => (
            <div className="accrual-line-row" key={line.id}>
              <div>
                <label htmlFor={`accrual-service-${line.id}`}>Вид услуги</label>
                <select
                  id={`accrual-service-${line.id}`}
                  value={line.serviceTypeCode}
                  onChange={(event) => updateLine(line.id, { serviceTypeCode: event.target.value })}
                  required
                >
                  <option value="">Выберите услугу</option>
                  {serviceTypes.map((service) => (
                    <option key={service.code} value={service.code}>{service.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor={`accrual-line-amount-${line.id}`}>Сумма, ₽</label>
                <input
                  id={`accrual-line-amount-${line.id}`}
                  type="text"
                  inputMode="decimal"
                  maxLength={15}
                  value={line.amount}
                  onChange={(event) => updateLine(line.id, { amount: event.target.value })}
                  required
                />
              </div>
              <button type="button" disabled={pending} onClick={() =>
                setLines((current) => current.filter((item) => item.id !== line.id))
              }>
                Удалить
              </button>
            </div>
          ))}
          <button type="button" disabled={pending} onClick={addLine}>Добавить услугу</button>
        </>
      )}
      {remainingKopeks !== null && remainingKopeks >= 0 && (
        <p>Без разбивки по услугам: {rubles.format(remainingKopeks / 100)}</p>
      )}
      {error && <p className="property-error" role="alert">{error}</p>}
      <div className="accrual-create-actions">
        <button type="submit" disabled={pending}>
          {pending ? 'Сохраняем…' : 'Сохранить'}
        </button>
        <button type="button" disabled={pending} onClick={close}>Отмена</button>
      </div>
    </form>
  )
}

export default AccrualCreateForm
