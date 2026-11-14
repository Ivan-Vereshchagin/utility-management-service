import { useState } from 'react'
import type { FormEvent } from 'react'

import MonthlyStatistics from './MonthlyStatistics'
import PropertySectionShell from './PropertySectionShell'
import ServiceComparison from './ServiceComparison'
import ServiceStatistics from './ServiceStatistics'

function PropertyStatisticsContent({
  propertyId, onUnauthorized, onNotFound,
}: {
  propertyId: number
  onUnauthorized: () => void
  onNotFound: () => void
}) {
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null)
  const [monthStart, setMonthStart] = useState('')
  const [monthEnd, setMonthEnd] = useState('')
  const [filterError, setFilterError] = useState<string | null>(null)
  const [appliedFilter, setAppliedFilter] = useState({ start: '', end: '' })

  function applyFilter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (monthStart && monthEnd && monthStart > monthEnd) {
      setFilterError('Начало диапазона не может быть позже окончания')
      return
    }
    setFilterError(null)
    setSelectedMonth(null)
    setAppliedFilter({ start: monthStart, end: monthEnd })
  }

  function resetFilter() {
    setMonthStart('')
    setMonthEnd('')
    setFilterError(null)
    setSelectedMonth(null)
    setAppliedFilter({ start: '', end: '' })
  }

  return (
    <section className="property-statistics">
      <h2>Начисления по месяцам</h2>
      <p>Месяцы определяются по месяцу учёта начислений.</p>
      <form className="statistics-filter" onSubmit={applyFilter}>
        <div>
          <label htmlFor="statistics-month-start">С</label>
          <input
            id="statistics-month-start"
            type="month"
            value={monthStart}
            onChange={(event) => setMonthStart(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="statistics-month-end">До</label>
          <input
            id="statistics-month-end"
            type="month"
            value={monthEnd}
            onChange={(event) => setMonthEnd(event.target.value)}
          />
        </div>
        <div className="statistics-filter-actions">
          <button type="submit">Показать</button>
          <button type="button" onClick={resetFilter}>Сбросить</button>
        </div>
        <p className="statistics-filter-hint">
          Показаны месяцы, в которых есть начисления по объекту.
        </p>
        {filterError && <p className="property-error" role="alert">{filterError}</p>}
      </form>
      <MonthlyStatistics
        propertyId={propertyId}
        reload={0}
        monthStart={appliedFilter.start}
        monthEnd={appliedFilter.end}
        selectedMonth={selectedMonth}
        setSelectedMonth={setSelectedMonth}
        onUnauthorized={onUnauthorized}
        onNotFound={onNotFound}
      />
      <h2>Распределение по услугам</h2>
      <ServiceStatistics
        propertyId={propertyId}
        reload={0}
        month={selectedMonth}
        onUnauthorized={onUnauthorized}
        onNotFound={onNotFound}
      />
      <h2>Сравнение услуги по месяцам</h2>
      <ServiceComparison
        propertyId={propertyId}
        reload={0}
        monthStart={appliedFilter.start}
        monthEnd={appliedFilter.end}
        onUnauthorized={onUnauthorized}
        onNotFound={onNotFound}
      />
    </section>
  )
}

function PropertyStatisticsPage() {
  return (
    <PropertySectionShell title="Статистика">
      {(property, onUnauthorized, onNotFound) => (
        <PropertyStatisticsContent
          propertyId={property.id}
          onUnauthorized={onUnauthorized}
          onNotFound={onNotFound}
        />
      )}
    </PropertySectionShell>
  )
}

export default PropertyStatisticsPage
