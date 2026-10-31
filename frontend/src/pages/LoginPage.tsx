import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router'

import { ApiError, apiRequest, setAccessToken } from '../api/client'
import './AuthForm.css'

type LoginResponse = {
  access_token: string
  token_type: 'bearer'
}

function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loggedIn, setLoggedIn] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setLoggedIn(false)
    setPending(true)
    setAccessToken(null)

    try {
      const result = await apiRequest<LoginResponse>('/auth/login', {
        method: 'POST',
        json: { email: email.trim(), password },
      })
      setAccessToken(result.access_token)
      setPassword('')
      setLoggedIn(true)
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
      <h1>Вход</h1>
      <form className="auth-form" onSubmit={handleSubmit}>
        <label htmlFor="login-email">Email</label>
        <input
          id="login-email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />

        <label htmlFor="login-password">Пароль</label>
        <input
          id="login-password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        <button type="submit" disabled={pending}>
          {pending ? 'Входим…' : 'Войти'}
        </button>
      </form>
      {error && <p className="auth-error" role="alert">{error}</p>}
      {loggedIn && <p className="auth-success" role="status">Вход выполнен</p>}
      <p className="auth-link"><Link to="/register">Создать аккаунт</Link></p>
    </main>
  )
}

export default LoginPage
