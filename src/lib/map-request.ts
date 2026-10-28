export async function mapDeadline<T>(request: Promise<T>, timeoutMs = 8000): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([request, new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error('El servicio de mapas tardó demasiado. Intentá nuevamente.')), timeoutMs);
    })]);
  } finally { clearTimeout(timeout); }
}

export async function fetchMapJson(url: string, timeoutMs = 8000): Promise<any> {
  const controller = new AbortController();
  try {
    return await mapDeadline((async () => {
      const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'AnnyApp/4.0 (contact@anny.com)' } });
      if (!response.ok) throw new Error('No se pudo consultar el servicio de mapas.');
      return response.json();
    })(), timeoutMs);
  } finally { controller.abort(); }
}
