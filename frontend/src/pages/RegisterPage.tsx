import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router'

import { ApiError, apiRequest } from '../api/client'
import './AuthForm.css'

type RegisterResponse = {
  id: number
  email: string
  created_at: string
}

function RegisterPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdEmail, setCreatedEmail] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    if (password !== confirmation) {
      setError('Пароли не совпадают')
      return
    }

    setPending(true)
    try {
      const result = await apiRequest<RegisterResponse>('/auth/register', {
        method: 'POST',
        json: { email: email.trim(), password },
      })
      setCreatedEmail(result.email)
      setPassword('')
      setConfirmation('')
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : 'Не удалось связаться с сервером',
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="auth-page">
      <h1>Регистрация</h1>
      {createdEmail === null ? (
        <form className="auth-form" onSubmit={handleSubmit}>
          <label htmlFor="register-email">Email</label>
          <input
            id="register-email"
            type="email"
            autoComplete="username"
            maxLength={320}
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />

          <label htmlFor="register-password">Пароль</label>
          <input
            id="register-password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={128}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />

          <label htmlFor="register-confirmation">Повторите пароль</label>
          <input
            id="register-confirmation"
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={128}
            required
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />

          <button type="submit" disabled={pending}>
            {pending ? 'Создаём аккаунт…' : 'Зарегистрироваться'}
          </button>
        </form>
      ) : (
        <p className="auth-success" role="status">
          Аккаунт {createdEmail} создан.
        </p>
      )}
      {error && <p className="auth-error" role="alert">{error}</p>}
      <p className="auth-link"><Link to="/login">Войти</Link></p>
    </main>
  )
}

export default RegisterPage
