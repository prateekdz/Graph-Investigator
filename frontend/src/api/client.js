export async function postJson(url, body) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  const text = await resp.text()
  let json
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { error: text }
  }
  if (!resp.ok) {
    const message = json?.error || `Request failed (${resp.status})`
    throw new Error(message)
  }
  return json
}

