import React from 'react'
import type { BrandTokens } from '@onelo/core'
import { resolveModalTokens, skeletonBlockCss } from '../core/brand'

/**
 * Auth loading skeleton — the React Native SDK's pre-auth placeholder, shown
 * while config + the hosted sign-in page load. Before this, RN showed only a
 * bare `ActivityIndicator` (no auth-shaped elements) — inconsistent with Swift's
 * `AuthSkeletonView` and the hosted page's own skeleton (#26 part B).
 *
 * ## Why a WebView + HTML (not native RN views)
 * Parity with the Flutter/Android SDKs, which render an HTML skeleton in their
 * WebView. Reuses `react-native-webview` (already a peer dep). The HTML is the
 * ONE artifact that guarantees a pixel-match with the hosted page's own skeleton
 * → the SDK-skeleton → hosted-skeleton → form transition has zero jump.
 *
 * ## Layout = CENTERED (not the canonical file's top-align)
 * The real hosted form (`frontend/app/auth/hosted/page.tsx`) is vertically
 * CENTERED (`justify-content:center; min-height:100vh`). The canonical
 * `HostedAuthSkeleton.tsx` is top-aligned (48px) — a layout-shift bug in that
 * file; the real reference is the form. We center to match it (as Flutter does).
 *
 * ## Shimmer = single RAF beam
 * One light source sweeps left→right across ALL placeholders in unison (a RAF
 * loop sets each element's `backgroundPositionX` from its `getBoundingClientRect`
 * left). This is the canonical approach — superior to CSS
 * `background-attachment:fixed`, which silently degrades to per-element shimmer
 * inside transformed WebView ancestors.
 */

/** Self-contained HTML for the auth loading skeleton.
 *  @param socialCount number of OAuth provider pills (0 = social disabled → none)
 *  @param t the app's brand tokens (#681): ground, block colours, radii, font
 *  @param redirectTo when set, the skeleton `location.replace()`s to this URL after
 *    it paints — the single-WebView hand-off (#28): the ONE WebView shows the
 *    skeleton, then navigates to the hosted page (kept visible until it paints),
 *    with NO extra history entry (replace, not push) so `goBack` still works (#27). */
export function authSkeletonHtml(socialCount: number, t: BrandTokens, redirectTo?: string): string {
  const n = Math.max(0, Math.min(4, Math.floor(socialCount || 0)))
  // Redirect after two frames so the skeleton is actually painted first; the
  // current page stays rendered during the load, so there's no flash.
  const redirect = redirectTo
    ? `<script>requestAnimationFrame(function(){requestAnimationFrame(function(){location.replace(${JSON.stringify(redirectTo)})})})</script>`
    : ''
  const pills = Array.from({ length: n })
    .map(() => '<div class="onelo-skel-strong pill"></div>')
    .join('')
  const divider =
    n > 0
      ? '<div class="divider"><span class="dline"></span><span class="onelo-skel dtext"></span><span class="dline"></span></div>'
      : ''
  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{background:${t.page_bg};font-family:${t.body_font};overflow:hidden}
.wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;width:100%;padding:48px 24px}
.col{width:100%;max-width:300px;display:flex;flex-direction:column;gap:10px}
${skeletonBlockCss(t)}
.icon{width:64px;height:64px;border-radius:${t.card_radius}px;margin-bottom:14px}
.title{width:200px;height:22px;margin-bottom:10px}
.sub{width:140px;height:13px;opacity:0.7;margin-bottom:28px}
.pill{height:44px;border-radius:${t.button_radius}px}
.divider{display:flex;align-items:center;gap:12px;margin:16px 0 4px}
.dline{flex:1;height:1px;background:${t.border}}
.dtext{width:14px;height:11px;opacity:0.5}
.lbl{width:38px;height:11px}
.input{height:44px}
.lblrow{display:flex;justify-content:space-between;align-items:center}
.lbl2{width:58px;height:11px}
.forgot{width:90px;height:11px;opacity:0.7}
.cta{height:48px;border-radius:${t.button_radius}px;margin-top:6px}
.signup{width:200px;height:12px;opacity:0.6;margin:6px auto 0}
</style></head><body>
<div class="wrap" aria-hidden="true">
<div class="onelo-skel icon"></div>
<div class="onelo-skel title"></div>
<div class="onelo-skel sub"></div>
<div class="col">
${pills}${divider}
<div class="onelo-skel lbl"></div>
<div class="onelo-skel-strong input"></div>
<div class="lblrow"><div class="onelo-skel lbl2"></div><div class="onelo-skel forgot"></div></div>
<div class="onelo-skel-strong input"></div>
<div class="onelo-skel-strong cta"></div>
<div class="onelo-skel signup"></div>
</div>
</div>
<script>(function(){var D=2400,BW=60;var q=function(){return document.querySelectorAll('.onelo-skel,.onelo-skel-strong')};var s=performance.now();function tick(now){var vw=window.innerWidth;var bpx=vw*(BW/100);var span=vw+bpx;var p=((now-s)%D)/D;var bx=-bpx+p*span;q().forEach(function(el){var r=el.getBoundingClientRect();el.style.backgroundPositionX=(bx-r.left)+'px'});requestAnimationFrame(tick)}requestAnimationFrame(tick)})();</script>
${redirect}
</body></html>`
}

export interface AuthSkeletonProps {
  /** Number of OAuth pills to draw (from `auth.oauthProviders`). Default 0. */
  socialCount?: number
  /** The app's brand tokens (from `auth.brandTokens()`, #681). Neutral when absent. */
  tokens?: BrandTokens
}

/**
 * Renders {@link authSkeletonHtml} in a non-interactive WebView. Used as the
 * pre-auth loading surface (OneloAuthGate fallback + AuthModal loading overlay).
 * `react-native` / `react-native-webview` are required LAZILY so a pure-Node
 * import of the SDK never pulls the native modules.
 */
export function AuthSkeleton({ socialCount = 0, tokens }: AuthSkeletonProps) {
  const t = resolveModalTokens(tokens)
  const backgroundColor = t.page_bg
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const RN = require('react-native')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { WebView } = require('react-native-webview')
  const { View } = RN
  const html = authSkeletonHtml(socialCount, t)
  return React.createElement(
    View,
    // pointerEvents none: it's a placeholder — never swallow touches (so the
    // AuthModal close ✕ layered above it stays tappable).
    { style: { flex: 1, backgroundColor }, pointerEvents: 'none' },
    React.createElement(WebView, {
      source: { html },
      originWhitelist: ['*'],
      scrollEnabled: false,
      showsVerticalScrollIndicator: false,
      showsHorizontalScrollIndicator: false,
      // Kill the react-native-webview white default paint before first render.
      backgroundColor,
      style: { flex: 1, backgroundColor },
    }),
  )
}
