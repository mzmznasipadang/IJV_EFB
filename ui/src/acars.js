export const validCallsign = callsign => /^[A-Z0-9]{3,8}$/.test(callsign)

export async function sendTelex(to, text, { multiline = false, signal } = {}) {
  const timeout = AbortSignal.timeout(20000)
  const response = await fetch("/ops/index.php?hoppie=1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, text, ...(multiline && text.includes("\n") ? { multiline: true } : {}) }),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  })
  const result = await response.json().catch(() => null)
  if (!response.ok || result?.ok !== true) throw new Error(result?.error || "Hoppie ACARS is unavailable.")
}
