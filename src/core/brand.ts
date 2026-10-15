/**
 * The React Native SDK's native chrome, from the app's brand tokens (#681).
 *
 * `OneloAuth` holds the one in-memory `BrandSource` (`@onelo/core`): config
 * sets it, store / portal / upgrade initiate responses refresh it, and until
 * either arrives it is the NEUTRAL set (never Onelo orange). Every modal —
 * auth, store, portal, consent, feedback, the auth gate's restore / retry
 * screens — takes its styles from `chromeStyles(tokens)` below, so a retry
 * button, a ✕ chip and a header cannot drift from each other or from the
 * hosted page.
 *
 * Fonts: the tokens name CSS font stacks. React Native cannot tell whether a
 * family is installed (an unknown `fontFamily` warns on iOS), so native text
 * stays on the system font; the WebView skeletons use the stack as CSS.
 */
import { NEUTRAL_BRAND_TOKENS, brandTokensFromLegacy, statusColor, type BrandTokens } from '@onelo/core'

/**
 * The tokens a modal paints with. `tokens` is what the SDK passes; the
 * deprecated `backgroundColor` prop (pre-#681 callers that render a modal view
 * themselves with `onelo.auth.pageBackgroundColor()`) still sets the ground.
 */
export function resolveModalTokens(tokens?: BrandTokens | null, backgroundColor?: string | null): BrandTokens {
  if (tokens) return tokens
  return backgroundColor ? brandTokensFromLegacy(null, backgroundColor) : NEUTRAL_BRAND_TOKENS
}

/** Plain style objects (StyleSheet-compatible) for every piece of native chrome. */
export function chromeStyles(t: BrandTokens) {
  return {
    container: { flex: 1, backgroundColor: t.page_bg },
    webview: { flex: 1, backgroundColor: t.page_bg },
    errorContainer: { flex: 1, justifyContent: 'center' as const, alignItems: 'center' as const, gap: 16, padding: 32, backgroundColor: t.page_bg },
    errorTitle: { color: t.text, fontSize: 17, fontWeight: '600' as const, textAlign: 'center' as const },
    errorText: { color: statusColor(t, 'danger'), fontSize: 13, textAlign: 'center' as const },
    retryButton: { backgroundColor: t.button_bg, paddingHorizontal: 32, paddingVertical: 14, borderRadius: t.button_radius },
    retryText: { color: t.button_text, fontSize: 16, fontWeight: '600' as const },
    cancelButton: { paddingHorizontal: 32, paddingVertical: 14 },
    cancelText: { color: t.text_muted, fontSize: 16 },
    /** Round ✕ chip over a WebView. */
    closeChip: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: t.card_bg,
      borderWidth: 1,
      borderColor: t.border,
      justifyContent: 'center' as const,
      alignItems: 'center' as const,
    },
    closeText: { color: t.text, fontSize: 19, fontWeight: '600' as const, lineHeight: 21 },
    /** Native header bar above a hosted page (store / portal / feedback). */
    header: { backgroundColor: t.page_bg, borderBottomColor: t.border },
    headerText: { color: t.text },
    /** Spinner (ActivityIndicator `color`). */
    spinnerColor: t.brand,
  }
}

/** Shimmer placeholder CSS for the WebView skeletons (JS-driven sweep, so no
 *  `animation` here): `.onelo-skel` soft block, `.onelo-skel-strong` field. */
export function skeletonBlockCss(t: BrandTokens): string {
  const sweep = `background-image:linear-gradient(90deg,transparent 0%,${t.spinner_track} 50%,transparent 100%);background-size:60vw 100%;background-repeat:no-repeat;background-position:-100vw 0`
  return `.onelo-skel{background-color:${t.card_bg};${sweep};border-radius:${t.field_radius}px}
.onelo-skel-strong{background-color:${t.border};${sweep};border-radius:${t.field_radius}px}`
}
