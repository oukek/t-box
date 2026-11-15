import type { Quote } from '@t-box/shop-tools-contracts'
import { currencies, ShopError } from '@t-box/shop-tools-contracts'

const ttl = 600000
export function createDataService(fetcher: typeof fetch = fetch) {
  let cache: { at: number, data: Quote } | undefined
  let pending: Promise<Quote> | undefined
  async function json(url: string, signal?: AbortSignal) {
    const response = await fetcher(url, {
      headers: { Accept: 'application/json' },
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
        : AbortSignal.timeout(10000),
    })
    if (!response.ok) {
      throw ShopError.invalid(`数据源暂时不可用（HTTP ${response.status}）`)
    }
    return response.json()
  }
  function rates(): Promise<Quote> {
    if (cache && Date.now() - cache.at < ttl) {
      return Promise.resolve(cache.data)
    }
    if (pending) {
      return pending
    }
    pending = Promise.all(
      currencies.slice(1).map(async ([target]) => {
        const data = await json(
          `https://wise.com/rates/live?source=CNY&target=${target}`,
        )
        if (
          data.source !== 'CNY' ||
          data.target !== target ||
          !Number.isFinite(data.value) ||
          data.value <= 0 ||
          !Number.isFinite(data.time)
        ) {
          throw ShopError.invalid('Wise 汇率数据不完整')
        }
        return {
          target,
          value: data.value as number,
          time: data.time as number,
        }
      }),
    )
      .then((items) => {
        const data = {
          rates: Object.fromEntries([
            ['CNY', 1],
            ...items.map((i) => [i.target, i.value]),
          ]),
          source: 'Wise',
          updatedAt: new Date(
            Math.min(...items.map((i) => i.time)),
          ).toISOString(),
        }
        cache = { at: Date.now(), data }
        return data
      })
      .finally(() => {
        pending = undefined
      })
    return pending
  }
  async function invoke(method: string, args: unknown, signal?: AbortSignal) {
    if (method === 'rates') {
      return rates()
    }
    const input = args as { date?: unknown }
    const base = 'https://solutions.shopee.cn/sellers/pricing-simulator/api/'
    if (method === 'changelog') {
      return json(base + 'sls/changelog?page_size=10', signal)
    }
    if (method !== 'sites') {
      throw ShopError.invalid('方法不存在')
    }
    if (
      !input ||
      typeof input.date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(input.date) ||
      Number.isNaN(Date.parse(input.date)) ||
      new Date(input.date).toISOString().slice(0, 10) !== input.date
    ) {
      throw ShopError.invalid('物流日期无效')
    }
    const [sites, shipping] = await Promise.all([
      json(base + 'site', signal),
      json(
        base + 'sls/site-config?date=' + encodeURIComponent(input.date),
        signal,
      ),
    ])
    if (
      !Array.isArray(sites?.data) ||
      !Array.isArray(shipping?.data?.site_info)
    ) {
      throw ShopError.invalid('站点或物流数据格式无效')
    }
    return { sites: sites.data, shipping: shipping.data }
  }
  return { invoke }
}
