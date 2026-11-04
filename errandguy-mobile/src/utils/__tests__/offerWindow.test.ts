import {
  OFFER_ACCEPT_SECONDS_FALLBACK,
  offerAcceptSeconds,
  offerWindowPhrase,
} from '../offerWindow';

/**
 * The runner help page said "about 90 seconds" whatever staff set
 * `matched_acceptance_timeout_seconds` to. It now reads `offer_accept_seconds`
 * off the runner's own profile, with 90 (the server default) as the fallback.
 */
describe('the offer window on the runner help page', () => {
  it('reads offer_accept_seconds off the profile', () => {
    expect(offerAcceptSeconds({ offer_accept_seconds: 120 })).toBe(120);
    expect(offerAcceptSeconds({ offer_accept_seconds: '45' })).toBe(45);
  });

  it('falls back to 90 seconds when the profile has not loaded or sends nothing usable', () => {
    expect(OFFER_ACCEPT_SECONDS_FALLBACK).toBe(90);
    expect(offerAcceptSeconds(null)).toBe(90);
    expect(offerAcceptSeconds(undefined)).toBe(90);
    expect(offerAcceptSeconds({})).toBe(90);
    expect(offerAcceptSeconds({ offer_accept_seconds: 0 })).toBe(90);
    expect(offerAcceptSeconds({ offer_accept_seconds: 'soon' })).toBe(90);
  });

  it('says it the way the copy always has, in minutes once it is whole minutes from two up', () => {
    expect(offerWindowPhrase(90)).toBe('about 90 seconds');
    expect(offerWindowPhrase(60)).toBe('about 60 seconds');
    expect(offerWindowPhrase(150)).toBe('about 150 seconds');
    expect(offerWindowPhrase(120)).toBe('about 2 minutes');
    expect(offerWindowPhrase(600)).toBe('about 10 minutes');
  });
});
