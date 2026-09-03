/**
 * App-OWNED user-facing strings — the copy that is NOT inherited from the
 * backend `message`. Follows the static-map convention of `statusLabels.ts`
 * (data only, no logic; error resolution lives in `errorCatalog.ts`).
 *
 * Two uses:
 *   • Success confirmations shown after an action the client considers done.
 *   • Domain fallbacks passed to `errorMessage(err, copy.<domain>.<x>)` so a
 *     failure with no useful backend message still reads specifically.
 *
 * Copy convention: full sentences, sentence case, end with a period, honest and
 * action-oriented. Keep terminology aligned with the backend `Messages` catalog.
 *
 * TERMINOLOGY (settled — the app used both nouns interchangeably, so one errand
 * could be a "booking" in the toast, an "errand" on the screen behind it and a
 * "Booking" in the Alerts row that linked to it):
 *   • The THING is an **errand**, always, on every customer-facing surface.
 *   • **book / booking** may be used as the VERB or the act of placing one
 *     ("Errand booked", "Couldn't book your errand"), never as the object.
 *   • **booking number** stays as-is — it is a literal identifier printed on
 *     receipts and the string support triages on.
 */
export const copy = {
  auth: {
    loginSuccess: 'Welcome back!',
    signupSuccess: 'Your account is ready.',
    loggedOut: 'You’ve been signed out.',
    otpResent: 'We’ve sent a new code.',
    otpResendFailed: 'Couldn’t send a new code. Please try again in a moment.',
    resetSent: 'If an account exists for that email, a reset link is on its way.',
  },
  booking: {
    created: 'Errand booked — finding you a runner.',
    createFailed: 'Couldn’t book your errand. Please try again.',
    cancelled: 'Errand cancelled.',
    cancelFailed: 'Couldn’t cancel this errand. Please try again.',
    rated: 'Thanks — your review has been submitted.',
    rateFailed: 'Couldn’t submit your review. Please try again.',
  },
  wallet: {
    topupStartFailed: 'Couldn’t start your top-up. Please try again in a moment.',
    payoutRequested: 'Payout requested — we’ll notify you when it’s sent.',
    payoutFailed: 'Couldn’t request your payout. Please try again.',
  },
  profile: {
    saved: 'Your changes have been saved.',
    saveFailed: 'Couldn’t save your changes. Please try again.',
    avatarUploadFailed: 'Couldn’t upload your photo. Please try again.',
    deleteAccountFailed: 'Couldn’t delete your account. Please try again or contact support.',
  },
  address: {
    saved: 'Address saved.',
    saveFailed: 'Couldn’t save this address. Please try again.',
    updateFailed: 'Couldn’t update this address. Please try again.',
    deleteFailed: 'Couldn’t remove this address. Please try again.',
  },
  runner: {
    statusUpdateFailed: 'Couldn’t update the errand status. Please try again.',
    receiptSubmitFailed: 'Couldn’t submit the receipt. Please try again.',
    acceptFailed: 'Couldn’t accept this errand — it may have been taken.',
    toggleFailed: 'Couldn’t change your online status. Please try again.',
    documentUploadFailed: 'Couldn’t upload your document. Please try again.',
    vehicleSaveFailed: 'Couldn’t update your vehicle details. Please try again.',
  },
  chat: {
    sendFailed: 'Message didn’t send. Tap to retry.',
    imageSendFailed: 'Couldn’t send your image. Please try again.',
  },
  support: {
    createFailed: 'Couldn’t open your support ticket. Please try again.',
    messageSendFailed: 'Couldn’t send your message. Please try again.',
  },
  promo: {
    applyFailed: 'Couldn’t apply that promo code. Check it and try again.',
  },
  payment: {
    linkFailed: 'Couldn’t start linking that payment method. Please try again.',
  },
  safety: {
    sosFailed: 'Couldn’t trigger SOS. Please try again, or call for help directly.',
    shareTripFailed: 'Couldn’t share your trip. Please try again.',
    contactSaveFailed: 'Couldn’t save this contact. Please try again.',
    contactRemoveFailed: 'Couldn’t remove this contact. Please try again.',
  },
  generic: {
    saveFailed: 'Couldn’t save your changes. Please try again.',
    loadMoreFailed: 'Couldn’t load more. Pull to refresh or try again.',
    tryAgain: 'Please try again.',
  },
} as const;
