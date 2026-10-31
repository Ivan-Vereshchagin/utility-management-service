import { apiRequest, setAccessToken } from '../api/client'

export type AccessTokenResponse = {
  access_token: string
  token_type: 'bearer'
}

let restoration: Promise<boolean> | null = null

export function restoreSession(): Promise<boolean> {
  if (restoration === null) {
    restoration = (async () => {
      try {
        const refresh = () =>
          apiRequest<AccessTokenResponse>('/auth/refresh', {
            method: 'POST',
          })
        const result = 'locks' in navigator
          ? await navigator.locks.request('ums-refresh-token', refresh)
          : await refresh()
        setAccessToken(result.access_token)
        return true
      } catch {
        setAccessToken(null)
        return false
      }
    })()
  }
  return restoration
}
