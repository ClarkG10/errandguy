import { SetMetadata } from '@nestjs/common';

export const IDEMPOTENT_KEY = 'eg_idempotent';

/**
 * Marks a route as money-mutation idempotent (booking create, wallet top-up,
 * payout request). `successStatus` is the HTTP code the handler returns on
 * success (used when persisting the replayable outcome). Mirrors the
 * `idempotent` middleware.
 */
export const Idempotent = (successStatus = 200) => SetMetadata(IDEMPOTENT_KEY, { successStatus });
