import type { FieldErrors, FieldValues, Resolver } from 'react-hook-form';
import type { ZodType } from 'zod';

/** Assign a value at a nested path (RHF expects nested error objects). */
function setPath(target: Record<string, any>, path: Array<string | number>, value: unknown): void {
  let node = target;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (node[key] == null || typeof node[key] !== 'object') node[key] = {};
    node = node[key];
  }
  node[path[path.length - 1]] = value;
}

/**
 * Dependency-free bridge from a zod v4 schema to a react-hook-form `Resolver`,
 * so we don't add `@hookform/resolvers` just for this. On success returns the
 * parsed values; on failure maps each zod issue to `{ type, message }` at its
 * field path (first issue per field wins, matching RHF's convention).
 *
 * Used by the auth/booking forms to replace three divergent validation styles
 * with one schema-driven source of truth.
 */
export function zodResolver<T extends FieldValues>(schema: ZodType<T>): Resolver<T> {
  return async (values) => {
    const result = schema.safeParse(values);
    if (result.success) {
      return { values: result.data, errors: {} };
    }

    const errors: Record<string, any> = {};
    const seen = new Set<string>();
    for (const issue of result.error.issues) {
      const path = (issue.path.length ? issue.path : ['root']) as Array<string | number>;
      const key = path.join('.');
      if (seen.has(key)) continue; // first message per field wins
      seen.add(key);
      setPath(errors, path, { type: issue.code ?? 'validation', message: issue.message });
    }

    return { values: {}, errors: errors as FieldErrors<T> };
  };
}
