import { OneloError } from '@onelo/core'
import { currentPageLanguage, primarySubtag } from './page-language'

/**
 * #1076 — every text this SDK draws itself, in the eight languages Onelo
 * translates into (en, pl, de, fr, es, it, pt = European Portuguese, nl;
 * German "Sie"). Drawn in the App User's Page Language (`page-language.ts`).
 *
 * A developer's own content (app name, plan names, their texts) is never here:
 * it is shown as written. Log lines and messages that address the developer
 * (an invalid key, a missing configuration) stay English. The feature-badge
 * words are the hosted pages' (Coming soon / Available in <plan>:
 * `frontend/lib/hosted-notice-i18n.ts` lockComingSoon / lockAvailableIn; the
 * upsell fallback: `frontend/lib/store-i18n.ts` changePlan), as in Swift/Android;
 * the error messages match the Swift (#1074) and Android (#1075) SDKs.
 */
export type OneloTextKey =
  // Chrome
  | 'signIn'
  | 'cancel'
  | 'retry'
  | 'manageSubscription'
  | 'back'
  | 'backButton'
  | 'goBack'
  | 'close'
  | 'closeFeedback'
  | 'closeCheckout'
  | 'closeCustomerPortal'
  // Feature badges (`FeatureState.badgeLabel`); `{plan}` is the plan name as written
  | 'badgeNew'
  | 'badgeBeta'
  | 'badgeComingSoon'
  | 'badgeAvailableIn'
  | 'badgeUpgrade'
  // The sign-in retry screen
  | 'somethingWentWrong'
  | 'connectionProblem'
  | 'linkOtherSignIn'
  | 'storeNotConfiguredContactSupport'
  | 'errorNotAuthenticated'
  | 'errorCancelled'
  | 'errorSessionEnded'
  | 'errorUserRevoked'
  | 'errorNoActivePlan'
  | 'errorInAppStoreNotAllowed'
  | 'errorVerificationRateLimited'
  | 'errorInvalidVerificationToken'

type Table = Record<OneloTextKey, string>

export const ONELO_TEXTS: Record<string, Table> = {
  en: {
    signIn: 'Sign In',
    cancel: 'Cancel',
    retry: 'Retry',
    manageSubscription: 'Manage Subscription',
    back: 'Back',
    backButton: '‹ Back',
    goBack: 'Go back',
    close: 'Close',
    closeFeedback: 'Close feedback',
    closeCheckout: 'Close checkout',
    closeCustomerPortal: 'Close customer portal',
    badgeNew: 'New',
    badgeBeta: 'Beta',
    badgeComingSoon: 'Coming soon',
    badgeAvailableIn: 'Available in {plan}',
    badgeUpgrade: 'Change plan',
    somethingWentWrong: 'Something went wrong. Please try again.',
    connectionProblem: "Couldn't connect. Check your internet connection and try again.",
    linkOtherSignIn: "This sign-in link belongs to a different sign-in on this device. Open the sign-in again and request a new link.",
    storeNotConfiguredContactSupport: "The store hasn't been configured yet. Please contact support.",
    errorNotAuthenticated: 'User is not authenticated',
    errorCancelled: 'Sign in was cancelled',
    errorSessionEnded: 'Your session ended — please sign in again',
    errorUserRevoked: 'This user account has been suspended',
    errorNoActivePlan: 'No active subscription — the plan has expired or was cancelled.',
    errorInAppStoreNotAllowed: "Plans can't be purchased inside this app. Buyers purchase on the web and sign in here.",
    errorVerificationRateLimited: 'At most 3 verification emails an hour — try again later',
    errorInvalidVerificationToken: 'This verification link is invalid, already used, replaced by a newer one, or expired',
  },
  pl: {
    signIn: 'Zaloguj się',
    cancel: 'Anuluj',
    retry: 'Spróbuj ponownie',
    manageSubscription: 'Zarządzaj subskrypcją',
    back: 'Wstecz',
    backButton: '‹ Wstecz',
    goBack: 'Wróć',
    close: 'Zamknij',
    closeFeedback: 'Zamknij opinie',
    closeCheckout: 'Zamknij sklep',
    closeCustomerPortal: 'Zamknij portal klienta',
    badgeNew: 'Nowość',
    badgeBeta: 'Beta',
    badgeComingSoon: 'Wkrótce',
    badgeAvailableIn: 'Dostępne w planie {plan}',
    badgeUpgrade: 'Zmień plan',
    somethingWentWrong: 'Coś poszło nie tak. Spróbuj ponownie.',
    connectionProblem: 'Nie udało się połączyć. Sprawdź połączenie z internetem i spróbuj ponownie.',
    linkOtherSignIn: "Ten link do logowania należy do innego logowania na tym urządzeniu. Otwórz logowanie ponownie i poproś o nowy link.",
    storeNotConfiguredContactSupport: "Sklep nie został jeszcze skonfigurowany. Skontaktuj się z pomocą techniczną.",
    errorNotAuthenticated: 'Użytkownik nie jest zalogowany',
    errorCancelled: 'Logowanie zostało anulowane',
    errorSessionEnded: 'Twoja sesja się zakończyła — zaloguj się ponownie',
    errorUserRevoked: 'To konto użytkownika zostało zawieszone',
    errorNoActivePlan: 'Brak aktywnej subskrypcji — plan wygasł lub został anulowany.',
    errorInAppStoreNotAllowed: 'W tej aplikacji nie można kupić planu. Kupujący kupują w przeglądarce i logują się tutaj.',
    errorVerificationRateLimited: 'Najwyżej 3 e-maile weryfikacyjne na godzinę — spróbuj później',
    errorInvalidVerificationToken: 'Ten link weryfikacyjny jest nieprawidłowy, został już użyty, zastąpiony nowszym albo wygasł',
  },
  de: {
    signIn: 'Anmelden',
    cancel: 'Abbrechen',
    retry: 'Erneut versuchen',
    manageSubscription: 'Abo verwalten',
    back: 'Zurück',
    backButton: '‹ Zurück',
    goBack: 'Zurück',
    close: 'Schließen',
    closeFeedback: 'Feedback schließen',
    closeCheckout: 'Shop schließen',
    closeCustomerPortal: 'Kundenportal schließen',
    badgeNew: 'Neu',
    badgeBeta: 'Beta',
    badgeComingSoon: 'Demnächst verfügbar',
    badgeAvailableIn: 'Verfügbar im Plan {plan}',
    badgeUpgrade: 'Plan ändern',
    somethingWentWrong: 'Etwas ist schiefgelaufen. Bitte versuchen Sie es erneut.',
    connectionProblem: 'Keine Verbindung möglich. Bitte prüfen Sie Ihre Internetverbindung und versuchen Sie es erneut.',
    linkOtherSignIn: "Dieser Anmeldelink gehört zu einer anderen Anmeldung auf diesem Gerät. Öffnen Sie die Anmeldung erneut und fordern Sie einen neuen Link an.",
    storeNotConfiguredContactSupport: "Der Shop ist noch nicht eingerichtet. Bitte wenden Sie sich an den Support.",
    errorNotAuthenticated: 'Der Benutzer ist nicht angemeldet',
    errorCancelled: 'Die Anmeldung wurde abgebrochen',
    errorSessionEnded: 'Ihre Sitzung ist abgelaufen — bitte melden Sie sich erneut an',
    errorUserRevoked: 'Dieses Benutzerkonto wurde gesperrt',
    errorNoActivePlan: 'Kein aktives Abonnement — der Plan ist abgelaufen oder wurde gekündigt.',
    errorInAppStoreNotAllowed: 'In dieser App können keine Pläne gekauft werden. Käufer kaufen im Web und melden sich hier an.',
    errorVerificationRateLimited: 'Höchstens 3 Bestätigungs-E-Mails pro Stunde — bitte versuchen Sie es später erneut',
    errorInvalidVerificationToken: 'Dieser Bestätigungslink ist ungültig, wurde bereits verwendet, durch einen neueren ersetzt oder ist abgelaufen',
  },
  fr: {
    signIn: 'Se connecter',
    cancel: 'Annuler',
    retry: 'Réessayer',
    manageSubscription: 'Gérer l’abonnement',
    back: 'Retour',
    backButton: '‹ Retour',
    goBack: 'Revenir en arrière',
    close: 'Fermer',
    closeFeedback: 'Fermer les commentaires',
    closeCheckout: 'Fermer la boutique',
    closeCustomerPortal: 'Fermer le portail client',
    badgeNew: 'Nouveau',
    badgeBeta: 'Bêta',
    badgeComingSoon: 'Bientôt disponible',
    badgeAvailableIn: 'Disponible avec le plan {plan}',
    badgeUpgrade: 'Changer de plan',
    somethingWentWrong: 'Une erreur s’est produite. Veuillez réessayer.',
    connectionProblem: 'Connexion impossible. Vérifiez votre connexion Internet et réessayez.',
    linkOtherSignIn: "Ce lien de connexion appartient à une autre connexion sur cet appareil. Rouvrez la connexion et demandez un nouveau lien.",
    storeNotConfiguredContactSupport: "La boutique n’est pas encore configurée. Veuillez contacter l’assistance.",
    errorNotAuthenticated: 'L’utilisateur n’est pas connecté',
    errorCancelled: 'La connexion a été annulée',
    errorSessionEnded: 'Votre session a pris fin — veuillez vous reconnecter',
    errorUserRevoked: 'Ce compte utilisateur a été suspendu',
    errorNoActivePlan: 'Aucun abonnement actif — le plan a expiré ou a été résilié.',
    errorInAppStoreNotAllowed: 'Aucun plan ne peut être acheté dans cette application. Les acheteurs achètent sur le web et se connectent ici.',
    errorVerificationRateLimited: '3 e-mails de vérification par heure au maximum — réessayez plus tard',
    errorInvalidVerificationToken: 'Ce lien de vérification n’est pas valide, a déjà été utilisé, a été remplacé par un plus récent ou a expiré',
  },
  es: {
    signIn: 'Iniciar sesión',
    cancel: 'Cancelar',
    retry: 'Reintentar',
    manageSubscription: 'Gestionar suscripción',
    back: 'Atrás',
    backButton: '‹ Atrás',
    goBack: 'Volver',
    close: 'Cerrar',
    closeFeedback: 'Cerrar comentarios',
    closeCheckout: 'Cerrar la tienda',
    closeCustomerPortal: 'Cerrar el portal de cliente',
    badgeNew: 'Nuevo',
    badgeBeta: 'Beta',
    badgeComingSoon: 'Próximamente',
    badgeAvailableIn: 'Disponible en el plan {plan}',
    badgeUpgrade: 'Cambiar plan',
    somethingWentWrong: 'Algo ha salido mal. Inténtalo de nuevo.',
    connectionProblem: 'No se ha podido conectar. Comprueba tu conexión a internet e inténtalo de nuevo.',
    linkOtherSignIn: "Este enlace de inicio de sesión pertenece a otro inicio de sesión en este dispositivo. Vuelve a abrir el inicio de sesión y solicita un nuevo enlace.",
    storeNotConfiguredContactSupport: "La tienda aún no está configurada. Ponte en contacto con el soporte.",
    errorNotAuthenticated: 'El usuario no ha iniciado sesión',
    errorCancelled: 'Se ha cancelado el inicio de sesión',
    errorSessionEnded: 'Tu sesión ha terminado — vuelve a iniciar sesión',
    errorUserRevoked: 'Esta cuenta de usuario ha sido suspendida',
    errorNoActivePlan: 'No hay ninguna suscripción activa — el plan ha caducado o se ha cancelado.',
    errorInAppStoreNotAllowed: 'No se pueden comprar planes dentro de esta aplicación. Los compradores compran en la web e inician sesión aquí.',
    errorVerificationRateLimited: 'Como máximo 3 correos de verificación por hora — inténtalo más tarde',
    errorInvalidVerificationToken: 'Este enlace de verificación no es válido, ya se ha usado, se ha sustituido por uno más reciente o ha caducado',
  },
  it: {
    signIn: 'Accedi',
    cancel: 'Annulla',
    retry: 'Riprova',
    manageSubscription: 'Gestisci abbonamento',
    back: 'Indietro',
    backButton: '‹ Indietro',
    goBack: 'Torna indietro',
    close: 'Chiudi',
    closeFeedback: 'Chiudi feedback',
    closeCheckout: 'Chiudi il negozio',
    closeCustomerPortal: 'Chiudi il portale clienti',
    badgeNew: 'Novità',
    badgeBeta: 'Beta',
    badgeComingSoon: 'Prossimamente',
    badgeAvailableIn: 'Disponibile nel piano {plan}',
    badgeUpgrade: 'Cambia piano',
    somethingWentWrong: 'Si è verificato un problema. Riprova.',
    connectionProblem: 'Impossibile connettersi. Controlla la connessione a internet e riprova.',
    linkOtherSignIn: "Questo link di accesso appartiene a un altro accesso su questo dispositivo. Apri di nuovo l’accesso e richiedi un nuovo link.",
    storeNotConfiguredContactSupport: "Lo store non è ancora configurato. Contatta l’assistenza.",
    errorNotAuthenticated: 'L’utente non ha effettuato l’accesso',
    errorCancelled: 'L’accesso è stato annullato',
    errorSessionEnded: 'La tua sessione è terminata — accedi di nuovo',
    errorUserRevoked: 'Questo account utente è stato sospeso',
    errorNoActivePlan: 'Nessun abbonamento attivo — il piano è scaduto o è stato annullato.',
    errorInAppStoreNotAllowed: 'In questa app non è possibile acquistare piani. Gli acquirenti acquistano sul web e accedono qui.',
    errorVerificationRateLimited: 'Al massimo 3 e-mail di verifica all’ora — riprova più tardi',
    errorInvalidVerificationToken: 'Questo link di verifica non è valido, è già stato usato, è stato sostituito da uno più recente o è scaduto',
  },
  pt: {
    signIn: 'Iniciar sessão',
    cancel: 'Cancelar',
    retry: 'Tentar novamente',
    manageSubscription: 'Gerir subscrição',
    back: 'Voltar',
    backButton: '‹ Voltar',
    goBack: 'Voltar atrás',
    close: 'Fechar',
    closeFeedback: 'Fechar comentários',
    closeCheckout: 'Fechar a loja',
    closeCustomerPortal: 'Fechar o portal do cliente',
    badgeNew: 'Novo',
    badgeBeta: 'Beta',
    badgeComingSoon: 'Brevemente',
    badgeAvailableIn: 'Disponível no plano {plan}',
    badgeUpgrade: 'Mudar de plano',
    somethingWentWrong: 'Ocorreu um erro. Tente novamente.',
    connectionProblem: 'Não foi possível estabelecer ligação. Verifique a sua ligação à internet e tente novamente.',
    linkOtherSignIn: "Este link de início de sessão pertence a outro início de sessão neste dispositivo. Abra novamente o início de sessão e peça um novo link.",
    storeNotConfiguredContactSupport: "A loja ainda não foi configurada. Contacte o apoio ao cliente.",
    errorNotAuthenticated: 'O utilizador não iniciou sessão',
    errorCancelled: 'O início de sessão foi cancelado',
    errorSessionEnded: 'A sua sessão terminou — inicie sessão novamente',
    errorUserRevoked: 'Esta conta de utilizador foi suspensa',
    errorNoActivePlan: 'Nenhuma subscrição ativa — o plano expirou ou foi cancelado.',
    errorInAppStoreNotAllowed: 'Não é possível comprar planos nesta aplicação. Os compradores compram na web e iniciam sessão aqui.',
    errorVerificationRateLimited: 'No máximo 3 e-mails de verificação por hora — tente mais tarde',
    errorInvalidVerificationToken: 'Este link de verificação é inválido, já foi utilizado, foi substituído por um mais recente ou expirou',
  },
  nl: {
    signIn: 'Inloggen',
    cancel: 'Annuleren',
    retry: 'Opnieuw proberen',
    manageSubscription: 'Abonnement beheren',
    back: 'Terug',
    backButton: '‹ Terug',
    goBack: 'Ga terug',
    close: 'Sluiten',
    closeFeedback: 'Feedback sluiten',
    closeCheckout: 'Winkel sluiten',
    closeCustomerPortal: 'Klantportaal sluiten',
    badgeNew: 'Nieuw',
    badgeBeta: 'Bèta',
    badgeComingSoon: 'Binnenkort beschikbaar',
    badgeAvailableIn: 'Beschikbaar in het plan {plan}',
    badgeUpgrade: 'Plan wijzigen',
    somethingWentWrong: 'Er is iets misgegaan. Probeer het opnieuw.',
    connectionProblem: 'Kan geen verbinding maken. Controleer je internetverbinding en probeer het opnieuw.',
    linkOtherSignIn: "Deze inloglink hoort bij een andere inlogpoging op dit apparaat. Open het inloggen opnieuw en vraag een nieuwe link aan.",
    storeNotConfiguredContactSupport: "De winkel is nog niet ingesteld. Neem contact op met de ondersteuning.",
    errorNotAuthenticated: 'De gebruiker is niet ingelogd',
    errorCancelled: 'Inloggen is geannuleerd',
    errorSessionEnded: 'Je sessie is beëindigd — log opnieuw in',
    errorUserRevoked: 'Dit gebruikersaccount is opgeschort',
    errorNoActivePlan: 'Geen actief abonnement — het abonnement is verlopen of opgezegd.',
    errorInAppStoreNotAllowed: 'In deze app kunnen geen abonnementen worden gekocht. Kopers kopen op het web en loggen hier in.',
    errorVerificationRateLimited: 'Maximaal 3 verificatie-e-mails per uur — probeer het later opnieuw',
    errorInvalidVerificationToken: 'Deze verificatielink is ongeldig, al gebruikt, vervangen door een nieuwere of verlopen',
  },
}

/** This text in `language` (default: the current Page Language); English for a
 *  language Onelo does not translate into (one carried over from an older
 *  setting). `{plan}` is replaced by `vars.plan`, shown as written. */
export function oneloText(
  key: OneloTextKey,
  vars: { plan?: string } = {},
  language: string = currentPageLanguage(),
): string {
  const lang = primarySubtag(language) ?? 'en'
  const raw = (ONELO_TEXTS[lang] ?? ONELO_TEXTS.en)[key]
  return vars.plan === undefined ? raw : raw.replace('{plan}', vars.plan)
}

/** OneloError codes an App User may be shown, in their own words. */
const APP_USER_ERROR_TEXT: Partial<Record<OneloError['code'], OneloTextKey>> = {
  not_authenticated: 'errorNotAuthenticated',
  cancelled: 'errorCancelled',
  session_ended: 'errorSessionEnded',
  user_revoked: 'errorUserRevoked',
  no_active_plan: 'errorNoActivePlan',
  in_app_store_not_allowed: 'errorInAppStoreNotAllowed',
  verification_rate_limited: 'errorVerificationRateLimited',
  invalid_verification_token: 'errorInvalidVerificationToken',
  network_error: 'connectionProblem',
  timeout: 'connectionProblem',
}

const APP_USER_TEXT = Symbol.for('onelo.appUserText')

/** Mark `error` with the text an App User is shown for it, when its code alone
 *  (`server_error`) does not say: a magic link from another sign-in, a store
 *  not configured yet. The error's own message stays for the developer. */
export function withAppUserText<E extends object>(error: E, key: OneloTextKey): E {
  ;(error as { [APP_USER_TEXT]?: OneloTextKey })[APP_USER_TEXT] = key
  return error
}

/**
 * What an App User is shown for `error` on an SDK screen (the sign-in retry
 * screen), in the Page Language. An OneloError meant for them is translated; a
 * failed connection says so; anything else — a server's own message, a
 * developer-facing configuration error (invalid key, hosted flow required) —
 * becomes "Something went wrong". The raw error is logged for the developer.
 * Parity with Swift `oneloAppUserMessage` (#1074).
 */
export function appUserMessage(error: unknown, context = 'sign-in'): string {
  console.warn(`[Onelo] ${context}: ${error instanceof Error ? error.message : String(error)}`)
  const marked = error !== null && typeof error === 'object'
    ? (error as { [APP_USER_TEXT]?: OneloTextKey })[APP_USER_TEXT]
    : undefined
  if (marked) return oneloText(marked)
  if (error instanceof OneloError) {
    return oneloText(APP_USER_ERROR_TEXT[error.code] ?? 'somethingWentWrong')
  }
  // React Native's fetch rejects a lost connection with
  // `TypeError: Network request failed`.
  if (error instanceof TypeError && /network request failed/i.test(error.message)) {
    return oneloText('connectionProblem')
  }
  return oneloText('somethingWentWrong')
}
