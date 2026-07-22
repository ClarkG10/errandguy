import { ValidationPipe, ValidationError } from '@nestjs/common';
import { LaravelValidationException, ValidationErrors } from '../exceptions/validation.exception';

/** Flatten class-validator errors into Laravel's `{field: [messages]}` shape. */
function flatten(errors: ValidationError[], parent = ''): ValidationErrors {
  const out: ValidationErrors = {};
  for (const err of errors) {
    const key = parent ? `${parent}.${err.property}` : err.property;
    if (err.constraints) {
      out[key] = Object.values(err.constraints);
    }
    if (err.children && err.children.length) {
      Object.assign(out, flatten(err.children, key));
    }
  }
  return out;
}

/**
 * Global ValidationPipe configured to emit Laravel-compatible 422 bodies.
 * DTOs are whitelisted + transformed; unknown props are stripped (not rejected)
 * to match Laravel's "only validated fields" posture.
 */
export function buildValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: false,
    transformOptions: { enableImplicitConversion: false },
    stopAtFirstError: false,
    exceptionFactory: (errors: ValidationError[]) => {
      return new LaravelValidationException(flatten(errors));
    },
  });
}
