const integerFormat = new Intl.NumberFormat('ru-RU')

export function formatSum(values: string[]): string {
  const kopeks = values.reduce((sum, value) => {
    const [rubles, fraction = ''] = value.split('.')
    return sum + BigInt(rubles) * 100n + BigInt(fraction.padEnd(2, '0'))
  }, 0n)
  const rubles = integerFormat.format(kopeks / 100n)
  const fraction = (kopeks % 100n).toString().padStart(2, '0')
  return `${rubles},${fraction} ₽`
}
