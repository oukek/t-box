export const SITE = 'https://www.dianxiaomi.com'
export function isDianxiaomi(url: string) {
  try {
    return new URL(url).origin === SITE
  } catch {
    return false
  }
}
export function listBody(pageNo: number, pageSize: number, searchValue = '') {
  if (!Number.isSafeInteger(pageNo) || pageNo < 1 || ![20, 50, 100].includes(pageSize)) {
    throw new Error('分页参数无效')
  }
  return new URLSearchParams({
    pageNo: String(pageNo),
    pageSize: String(pageSize),
    site: 'all',
    searchValue: searchValue.trim().slice(0, 200),
    productSearchType: 'name',
    sortTime: '',
    accountName: '',
    commentType: '',
    commentValue: '',
    sourcePriceUsdMin: '',
    sourcePriceUsdMax: '',
    orderName: '',
    orderValue: '',
  }).toString()
}
// This function is serialized by executeScript. Keep it self-contained.
export async function fetchListInPage(body: string) {
  if (location.origin !== 'https://www.dianxiaomi.com') {
    return { error: '请在店小秘页面读取列表' }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 25000)
  try {
    const response = await fetch('/api/crawl/list.json', {
      method: 'POST',
      body: new URLSearchParams(body),
      credentials: 'include',
      signal: controller.signal,
      redirect: 'error',
    })
    if (!response.ok) {
      return { error: `列表读取失败（HTTP ${response.status}），请确认登录状态` }
    }
    const raw = await response.text()
    if (raw.length > 10_000_000) {
      return { error: '本页资料过大，请减少每页数量' }
    }
    return { raw }
  } catch (error) {
    return { error: error instanceof Error && error.name === 'AbortError' ? '读取超时，请重试' : '读取失败，请确认店小秘登录状态后重试' }
  } finally {
    clearTimeout(timer)
  }
}
