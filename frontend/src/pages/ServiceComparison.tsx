import { useEffect, useState } from 'react'

import { ApiError, apiRequest } from '../api/client'
import { formatSum } from '../utils/money'

type ServiceType = { code: string; name: string }
type MonthlyTotal = { month: string; total_amount: string }

type Props = {
  propertyId: number
  reload: number
  monthStart: string
  monthEnd: string
  onUnauthorized: () => void
  onNotFound: () => void
}

const rubles = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' })
const monthFormat = new Intl.DateTimeFormat('ru-RU', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

function ServiceComparison({
  propertyId, reload, monthStart, monthEnd, onUnauthorized, onNotFound,
}: Props) {
  const [services, setServices] = useState<ServiceType[] | null>(null)
  const [serviceError, setServiceError] = useState<string | null>(null)
  const [serviceRetry, setServiceRetry] = useState(0)
  const [selectedCode, setSelectedCode] = useState('')
  const [data, setData] = useState<{ key: string; totals: MonthlyTotal[] } | null>(null)
  const [chartError, setChartError] = useState<{ key: string; message: string } | null>(null)
  const [chartRetry, setChartRetry] = useState(0)
  const key = `${propertyId}:${selectedCode}:${monthStart}:${monthEnd}:${reload}:${chartRetry}`

  useEffect(() => {
    let active = true
    apiRequest<ServiceType[]>('/service-types')
      .then((result) => {
        if (active) setServices(result)
      })
      .catch((cause: unknown) => {
        if (!active) return
        if (cause instanceof ApiError && cause.status === 401) {
          onUnauthorized()
        } else {
          setServiceError(cause instanceof ApiError ? cause.message : 'Не удалось связаться с сервером')
        }
      })

    return () => { active = false }
  }, [serviceRetry, onUnauthorized])

  useEffect(() => {
    if (!selectedCode) return
    let active = true
    const params = new URLSearchParams({ service_type_code: selectedCode })
    if (monthStart) params.set('month_start', `${monthStart}-01`)
    if (monthEnd) params.set('month_end', `${monthEnd}-01`)
    apiRequest<MonthlyTotal[]>(`/properties/${propertyId}/statistics/monthly?${params}`)
      .then((result) => {
        if (active) setData({ key, totals: result })
      })
      .catch((cause: unknown) => {
        if (!active) return
        if (cause instanceof ApiError && cause.status === 401) {
          onUnauthorized()
        } else if (cause instanceof ApiError && cause.status === 404) {
          onNotFound()
        } else {
          setChartError({
            key,
            message: cause instanceof ApiError ? cause.message : 'Не удалось связаться с сервером',
          })
        }
      })

    return () => { active = false }
  }, [propertyId, selectedCode, monthStart, monthEnd, reload, chartRetry, key, onUnauthorized, onNotFound])

  function retryServices() {
    setServices(null)
    setServiceError(null)
    setServiceRetry((value) => value + 1)
  }

  function retryChart() {
    setData(null)
    setChartError(null)
    setChartRetry((value) => value + 1)
  }

  if (serviceError) {
    return (
      <div role="alert">
        <p>{serviceError}</p>
        <button type="button" onClick={retryServices}>Повторить</button>
      </div>
    )
  }
  if (services === null) return <p role="status">Загружаем виды услуг…</p>
  if (services.length === 0) return <p>Виды услуг не найдены.</p>

  const totals = data?.key === key ? data.totals : null
  const maximum = totals === null ? 0 : Math.max(0, ...totals.map((item) => Number(item.total_amount)))

  return (
    <div className="service-comparison">
      <label htmlFor="comparison-service">Услуга</label>
      <select
        id="comparison-service"
        value={selectedCode}
        onChange={(event) => setSelectedCode(event.target.value)}
      >
        <option value="">Выберите услугу</option>
        {services.map((service) => (
          <option key={service.code} value={service.code}>{service.name}</option>
        ))}
      </select>
      {!selectedCode ? (
        <p>Выберите услугу для сравнения.</p>
      ) : chartError?.key === key ? (
        <div role="alert">
          <p>{chartError.message}</p>
          <button type="button" onClick={retryChart}>Повторить</button>
        </div>
      ) : totals === null ? (
        <p role="status">Загружаем сравнение…</p>
      ) : totals.length === 0 ? (
        <p>{monthStart || monthEnd
          ? 'Начислений за выбранные месяцы нет.'
          : 'Начислений пока нет.'}</p>
      ) : (
        <>
          <p className="statistics-total">
            Итого по услуге: <strong>{formatSum(totals.map((item) => item.total_amount))}</strong>
          </p>
          <ul className="service-comparison-chart" aria-label="Начисления выбранной услуги по месяцам">
            {totals.map((item) => {
              const amount = Number(item.total_amount)
              return (
                <li key={item.month}>
                  <span>{monthFormat.format(new Date(`${item.month}T00:00:00Z`))}</span>
                  <div className="monthly-chart-track" aria-hidden="true">
                    <div
                      className="monthly-chart-bar"
                      style={{ width: maximum > 0 && amount > 0
                        ? `${Math.max(1, amount / maximum * 100)}%`
                        : '0%' }}
                    />
                  </div>
                  <strong>{rubles.format(amount)}</strong>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}

export default ServiceComparison
