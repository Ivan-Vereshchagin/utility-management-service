import { useEffect, useState } from 'react'

import { ApiError, apiRequest } from '../api/client'

type MonthlyTotal = {
  month: string
  total_amount: string
}

type Props = {
  propertyId: number
  reload: number
  onUnauthorized: () => void
  onNotFound: () => void
}

const monthFormat = new Intl.DateTimeFormat('ru-RU', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})
const rubles = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' })

function MonthlyStatistics({ propertyId, reload, onUnauthorized, onNotFound }: Props) {
  const [totals, setTotals] = useState<MonthlyTotal[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let active = true
    apiRequest<MonthlyTotal[]>(`/properties/${propertyId}/statistics/monthly`)
      .then((result) => {
        if (active) setTotals(result)
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
    setTotals(null)
    setError(null)
    setRetry((value) => value + 1)
  }

  if (error) {
    return (
      <div role="alert">
        <p>{error}</p>
        <button type="button" onClick={retryLoad}>Повторить</button>
      </div>
    )
  }

  if (totals === null) return <p role="status">Загружаем статистику…</p>
  if (totals.length === 0) return <p>Начислений для статистики пока нет.</p>

  const maximum = Math.max(...totals.map((item) => Number(item.total_amount)))

  return (
    <ul className="monthly-chart" aria-label="Начисления по месяцам">
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
  )
}

export default MonthlyStatistics
