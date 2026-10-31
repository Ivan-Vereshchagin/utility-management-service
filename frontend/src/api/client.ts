type ApiOptions = Omit<RequestInit, 'body'> & {
  json?: unknown
}

let accessToken: string | null = null

export function setAccessToken(token: string | null): void {
  accessToken = token
}

export function hasAccessToken(): boolean {
  return accessToken !== null
}

export class ApiError extends Error {
  readonly status: number
  readonly detail: unknown

  constructor(status: number, detail: unknown) {
    super(typeof detail === 'string' ? detail : `Ошибка запроса (${status})`)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

export async function apiRequest<T>(
  path: `/${string}`,
  options: ApiOptions = {},
): Promise<T> {
  const { json, ...init } = options
  const headers = new Headers(init.headers)
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json')
  }
  if (json !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  if (accessToken !== null && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${accessToken}`)
  }

  const response = await fetch(`/api${path}`, {
    ...init,
    headers,
    body: json === undefined ? undefined : JSON.stringify(json),
    credentials: 'same-origin',
  })

  if (!response.ok) {
    const errorBody: unknown = await response.json().catch(() => null)
    const detail =
      errorBody !== null &&
      typeof errorBody === 'object' &&
      'detail' in errorBody
        ? errorBody.detail
        : null
    throw new ApiError(response.status, detail)
  }

  if (response.status === 204) {
    return undefined as T
  }
  return response.json() as Promise<T>
}

export function getHealth(): Promise<{ status: 'ok' }> {
  return apiRequest('/health')
}
