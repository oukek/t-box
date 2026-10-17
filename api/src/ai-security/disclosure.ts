const omitted = '[内部信息已隐藏]'
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Defense in depth for known literals, not a semantic jailbreak detector. */
export class DisclosureFilter {
  private readonly pattern?: RegExp
  private readonly prefixes = new Set<string>()
  private maxPrefix = 0
  constructor(values: string[], prompts: string[] = [], identities: string[] = []) {
    const identityTerms = new Set(identities.filter((value) => value.length >= 2).map((value) => value.toLowerCase()))
    const terms = new Set([...values.filter(Boolean), ...identityTerms])
    for (const prompt of prompts) {
      if (prompt.length >= 12 && prompt.length <= 128) {
        terms.add(prompt)
      }
      // Bounded overlapping windows catch copied prompt passages without treating
      // dynamic user facts/receipts inside assembled instructions as secrets.
      for (const line of prompt.split(/\r?\n/)) {
        if (line.trim().length < 32) {
          continue
        }
        for (let offset = 0; offset + 32 <= line.length; offset += 16) {
          terms.add(line.slice(offset, offset + 32))
        }
      }
    }
    const ordered = [...terms].sort((a, b) => b.length - a.length)
    for (const term of ordered) {
      for (let size = 1; size < term.length; size++) {
        this.prefixes.add(term.slice(0, size).toLowerCase())
        this.maxPrefix = Math.max(this.maxPrefix, size)
      }
    }
    if (ordered.length) {
      this.pattern = new RegExp(ordered.map((term) => identityTerms.has(term.toLowerCase())
        ? [...term].map((char) => /[a-z]/i.test(char) ? `[${char.toLowerCase()}${char.toUpperCase()}]` : escape(char)).join('')
        : escape(term)).join('|'), 'gu')
    }
  }

  mask(text: string) {
    return this.pattern ? text.replace(this.pattern, omitted) : text
  }

  /** Scan decoded argument values too: JSON Unicode escapes cannot bypass the gate. */
  contains(value: unknown): boolean {
    if (typeof value === 'string') {
      return this.mask(value) !== value
    }
    if (value && typeof value === 'object') {
      return Object.entries(value).some(([key, child]) => this.contains(key) || this.contains(child))
    }
    return false
  }

  stream(emit: (text: string) => void) {
    let pending = ''
    return {
      push: (delta: string) => {
        const text = pending + delta
        // Hold a possible match suffix BEFORE replacement: overlapping prompt
        // fragments must never expose the next fragment's unmatched prefix.
        let hold = 0
        const folded = text.toLowerCase()
        for (let size = Math.min(this.maxPrefix, text.length); size > 0; size--) {
          if (this.prefixes.has(folded.slice(-size))) {
            hold = size
            break
          }
        }
        let boundary = text.length - hold
        if (this.pattern) {
          for (const match of text.matchAll(this.pattern)) {
            if (match.index < boundary && match.index + match[0].length > boundary) {
              boundary = match.index
            }
          }
        }
        const safe = this.mask(text.slice(0, boundary))
        pending = text.slice(boundary)
        if (safe) {
          emit(safe)
        }
      },
      finish: () => {
        const safe = this.mask(pending)
        pending = ''
        if (safe) {
          emit(safe)
        }
      },
    }
  }
}
