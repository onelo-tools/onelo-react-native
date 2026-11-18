import { adoptPageLanguage as adoptCorePageLanguage, deviceLanguage, resetPageLanguageForTest as resetCorePageLanguage } from '@onelo/core'

/**
 * #1076 — the language this SDK's own texts are drawn in: the App User's
 * **Page Language** (ADR-0043). The order is the language the App passes
 * (`new Onelo({ language })`), else the device language when it is one of the
 * App Languages, else the App's default — the same language as the Hosted
 * Pages.
 *
 * The SDK never chooses it. `/api/sdk/config` is asked with the App's language
 * (or the device language) and the device languages as `Accept-Language`, and
 * answers `page_language`, chosen in Python (`backend/app/lib/page_language.py`).
 * The SDK adopts that answer, keeps it for the next launch, and renders. Until
 * a first answer arrives (and with nothing kept from an earlier launch) the
 * texts are English: the language every App starts with.
 *
 * One value per process, like Swift (#1074) and Android (#1075): the SDK's
 * screens and `FeatureState.badgeLabel` have no SDK instance to ask. An app
 * that builds two `Onelo` instances gets the latest answer.
 */

/** The languages Onelo translates its own texts into (`SUPPORTED_LANGUAGES` in
 *  `backend/app/lib/app_languages.py`). `pt` is European Portuguese. */
export const SUPPORTED_TEXT_LANGUAGES = ['en', 'pl', 'de', 'fr', 'es', 'it', 'pt', 'nl'] as const

/** Keychain key of the last Page Language, for the next launch's first paint. */
export const PAGE_LANGUAGE_STORAGE_KEY = 'onelo_page_language'

let current = 'en'

/** The Page Language the SDK's own texts are drawn in now (`'en'` until the
 *  backend first answers). */
export function currentPageLanguage(): string {
  return current
}

/** The primary subtag of a language tag (`pl-PL` → `pl`), or null when the
 *  value is not a language tag. */
export function primarySubtag(tag: unknown): string | null {
  if (typeof tag !== 'string') return null
  const primary = tag.trim().split(/[-_]/)[0]?.toLowerCase() ?? ''
  return /^[a-z]{2,3}$/.test(primary) ? primary : null
}

/** Adopt the Page Language the backend answered (or the one kept from the last
 *  launch). Returns the adopted value, or null — nothing changes — when the
 *  answer is missing (an older backend, App Languages unreadable) or not a
 *  language tag. */
export function adoptPageLanguage(answer: unknown): string | null {
  const lang = primarySubtag(answer)
  if (!lang) return null
  current = lang
  adoptCorePageLanguage(lang) // #1079: `OneloError` messages (@onelo/core) follow it too
  return lang
}

/** Test hook: back to the English every launch starts with. */
export function _resetPageLanguageForTests(): void {
  current = 'en'
  resetCorePageLanguage()
}

/** The language a Page Language request sends: the call's own `lang`, else the
 *  App's `language`, else the device language (#1039). The backend picks the
 *  Page Language within the App Languages; the SDK never does. */
export function requestLanguage(appLanguage?: string | null, passed?: string | null): string {
  const pick = (v?: string | null) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  return pick(passed) ?? pick(appLanguage) ?? deviceLanguage()
}

/** The device's preferred languages, most preferred first. Hermes has no
 *  `navigator.languages`, so this falls back to `deviceLanguage()`. */
export function deviceLanguages(): string[] {
  try {
    const nav = (globalThis as { navigator?: { languages?: unknown } }).navigator
    const list = Array.isArray(nav?.languages)
      ? (nav!.languages as unknown[]).filter((t): t is string => typeof t === 'string' && primarySubtag(t) !== null)
      : []
    if (list.length > 0) return list
  } catch {
    // fall through
  }
  return [deviceLanguage()]
}

/** The device languages as an `Accept-Language` value (`pl-PL, en;q=0.9`): the
 *  backend's next choice when the language asked with (the App's) is not one
 *  the App offers (ADR-0043). Null when there is no usable tag. */
export function acceptLanguage(tags: string[] = deviceLanguages()): string | null {
  const usable = tags.filter((t) => primarySubtag(t) !== null).slice(0, 6)
  if (usable.length === 0) return null
  return usable
    .map((tag, i) => (i === 0 ? tag : `${tag};q=${Math.max(0.1, 1 - i * 0.1).toFixed(1)}`))
    .join(', ')
}
