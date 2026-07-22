import { HttpException, HttpStatus } from '@nestjs/common';

export type ValidationErrors = Record<string, string[]>;

/**
 * Mirrors Laravel's ValidationException JSON:
 *   { "message": "<first error>", "errors": { "<field>": ["<msg>", ...] } }
 * with HTTP 422.
 */
export class LaravelValidationException extends HttpException {
  constructor(errors: ValidationErrors, message?: string) {
    const first = message ?? LaravelValidationException.firstMessage(errors) ?? 'The given data was invalid.';
    super({ message: first, errors }, HttpStatus.UNPROCESSABLE_ENTITY);
  }

  private static firstMessage(errors: ValidationErrors): string | null {
    for (const key of Object.keys(errors)) {
      if (errors[key]?.length) return errors[key][0];
    }
    return null;
  }

  /** Build from a single field + message (Laravel's `throw ValidationException::withMessages`). */
  static withMessages(errors: ValidationErrors): LaravelValidationException {
    return new LaravelValidationException(errors);
  }

  /** Convenience for a single field error. */
  static field(field: string, message: string): LaravelValidationException {
    return new LaravelValidationException({ [field]: [message] });
  }
}
