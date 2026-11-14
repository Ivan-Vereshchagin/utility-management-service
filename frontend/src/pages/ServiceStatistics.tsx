import { useEffect, useState } from 'react'

import { ApiError, apiRequest } from '../api/client'
import { formatSum } from '../utils/money'

type ServiceTotal = {
  service_type_code: string | null
  name: string
  total_amount: string
}

type Props = {
  propertyId: number
  reload: number
  month: string | null
  onUnauthorized: () => void
  onNotFound: () => void
}

const rubles = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' })
const percentFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })
const monthFormat = new Intl.DateTimeFormat('ru-RU', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})
const serviceColors: Record<string, string> = {
  cold_water: '#0284c7',
  hot_water: '#dc2626',
  sewerage: '#4f46e5',
  electricity: '#ca8a04',
  heating: '#ea580c',
  gas: '#16a34a',
  housing: '#9333ea',
  capital_repairs: '#7c3aed',
  waste: '#0d9488',
  other: '#475569',
  unallocated: '#9ca3af',
}

function ServiceStatistics({ propertyId, reload, month, onUnauthorized, onNotFound }: Props) {
  const [data, setData] = useState<{ key: string; totals: ServiceTotal[] } | null>(null)
  const [error, setError] = useState<{ key: string; message: string } | null>(null)
  const [retry, setRetry] = useState(0)
  const key = `${propertyId}:${month}:${reload}:${retry}`

  useEffect(() => {
    if (month === null) return
    let active = true
    apiRequest<ServiceTotal[]>(`/properties/${propertyId}/statistics/services?month=${month}`)
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
          setError({
            key,
            message: cause instanceof ApiError ? cause.message : 'Не удалось связаться с сервером',
          })
        }
      })

    return () => { active = false }
  }, [propertyId, reload, month, retry, key, onUnauthorized, onNotFound])

  function retryLoad() {
    setData(null)
    setError(null)
    setRetry((value) => value + 1)
  }

  if (month === null) return <p>Выберите месяц на графике выше.</p>

  if (error?.key === key) {
    return (
      <div role="alert">
        <p>{error.message}</p>
        <button type="button" onClick={retryLoad}>Повторить</button>
      </div>
    )
  }

  const totals = data?.key === key ? data.totals : null
  if (totals === null) return <p role="status">Загружаем распределение…</p>
  if (totals.length === 0) return <p>Начислений для распределения пока нет.</p>

  const overall = totals.reduce((sum, item) => sum + Number(item.total_amount), 0)
  const positive = totals.filter((item) => Number(item.total_amount) > 0)
  if (overall <= 0 || positive.length === 0) {
    return <p>Сумма начислений за выбранный месяц равна нулю.</p>
  }

  let boundary = 0
  const sectors = positive.map((item, index) => {
    const start = boundary
    boundary = index === positive.length - 1
      ? 100
      : start + Number(item.total_amount) / overall * 100
    const color = serviceColors[item.service_type_code ?? 'unallocated'] ?? '#64748b'
    return `${color} ${start}% ${boundary}%`
  })

  return (
    <div className="service-distribution">
      <p>
        {monthFormat.format(new Date(`${month}T00:00:00Z`))}: {formatSum(
          totals.map((item) => item.total_amount),
        )}
      </p>
      <div className="service-distribution-content">
        <div
          className="service-pie"
          style={{ background: `conic-gradient(${sectors.join(', ')})` }}
          aria-hidden="true"
        />
        <ul className="service-legend">
          {totals.map((item) => {
            const amount = Number(item.total_amount)
            const color = serviceColors[item.service_type_code ?? 'unallocated'] ?? '#64748b'
            return (
              <li key={item.service_type_code ?? 'unallocated'}>
                <span className="service-legend-color" style={{ backgroundColor: color }} aria-hidden="true" />
                <span>{item.name}</span>
                <strong>{rubles.format(amount)} · {percentFormat.format(amount / overall * 100)}%</strong>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

export default ServiceStatistics
