// Llamadas del panel a la API de Medusa con la sesión del usuario.
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: init?.body instanceof FormData ? init.headers : { 'content-type': 'application/json', ...init?.headers },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.message ?? `Error ${res.status}`)
  }
  return res.json()
}

/** Sube una imagen al almacenamiento de la tienda y devuelve su URL. */
export async function uploadImage(file: File): Promise<string> {
  const form = new FormData()
  form.append('files', file)
  const { files } = await api<{ files: { url: string }[] }>('/admin/uploads', { method: 'POST', body: form })
  return files[0].url
}

export type Content<T> = { key: string; configured: boolean; data: T; updated_at: string | null }
