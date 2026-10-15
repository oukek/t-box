try {
  const response = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/v1/health`, {
    signal: AbortSignal.timeout(4000),
  })
  const body = await response.json()
  process.exitCode = response.ok && body.data?.dependencies?.mysql === 'up' ? 0 : 1
} catch {
  process.exitCode = 1
}
