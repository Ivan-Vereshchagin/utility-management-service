import { useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

import { ApiError, apiRequest } from '../api/client'
import { formatSum } from '../utils/money'

type MonthlyTotal = {
  month: string
  total_amount: string
}

type Props = {
  propertyId: number
  reload: number
  monthStart: string
  monthEnd: string
  selectedMonth: string | null
  setSelectedMonth: Dispatch<SetStateAction<string | null>>
  onUnauthorized: () => void
  onNotFound: () => void
}

const monthFormat = new Intl.DateTimeFormat('ru-RU', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})
const rubles = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' })

function MonthlyStatistics({
  propertyId, reload, monthStart, monthEnd, selectedMonth, setSelectedMonth,
  onUnauthorized, onNotFound,
}: Props) {
  const [data, setData] = useState<{ key: string; totals: MonthlyTotal[] } | null>(null)
  const [error, setError] = useState<{ key: string; message: string } | null>(null)
  const [retry, setRetry] = useState(0)
  const key = `${propertyId}:${monthStart}:${monthEnd}:${reload}:${retry}`

  useEffect(() => {
    let active = true
    const params = new URLSearchParams()
    if (monthStart) params.set('month_start', `${monthStart}-01`)
    if (monthEnd) params.set('month_end', `${monthEnd}-01`)
    const query = params.toString()
    apiRequest<MonthlyTotal[]>(`/properties/${propertyId}/statistics/monthly${query ? `?${query}` : ''}`)
      .then((result) => {
        if (active) {
          setData({ key, totals: result })
          setSelectedMonth((current) => result.some((item) => item.month === current)
            ? current
            : result[result.length - 1]?.month ?? null)
        }
      })
      .catch((cause: unknown) => {
        if (!active) return
        if (cause instanceof ApiError && cause.status === 401) {
          onUnauthorized()
        } else if (cause instanceof ApiError && cause.status === 404) {
          onNotFound()
        } else {
          setError({
            key,
            message: cause instanceof ApiError ? cause.message : 'Не удалось связаться с сервером',
          })
        }
      })

    return () => { active = false }
  }, [propertyId, reload, monthStart, monthEnd, retry, key, setSelectedMonth, onUnauthorized, onNotFound])

  function retryLoad() {
    setData(null)
    setError(null)
    setRetry((value) => value + 1)
  }

  if (error?.key === key) {
    return (
      <div role="alert">
        <p>{error.message}</p>
        <button type="button" onClick={retryLoad}>Повторить</button>
      </div>
    )
  }

  const totals = data?.key === key ? data.totals : null
  if (totals === null) return <p role="status">Загружаем статистику…</p>
  if (totals.length === 0) {
    return <p>{monthStart || monthEnd
      ? 'Начислений за выбранные месяцы нет.'
      : 'Начислений для статистики пока нет.'}</p>
  }

  const maximum = Math.max(...totals.map((item) => Number(item.total_amount)))

  return (
    <>
      <p className="statistics-total">
        Итого за показанные месяцы: <strong>{formatSum(totals.map((item) => item.total_amount))}</strong>
      </p>
      <ul className="monthly-chart" aria-label="Начисления по месяцам">
        {totals.map((item) => {
          const amount = Number(item.total_amount)
          return (
            <li key={item.month}>
              <button
                className="monthly-chart-option"
                type="button"
                aria-pressed={selectedMonth === item.month}
                onClick={() => setSelectedMonth(item.month)}
              >
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
              </button>
            </li>
          )
        })}
      </ul>
    </>
  )
}

export default MonthlyStatistics
