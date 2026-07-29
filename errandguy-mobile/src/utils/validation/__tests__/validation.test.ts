import { zodResolver } from '../zodResolver';
import { applyServerErrors } from '../applyServerErrors';
import { loginSchema, registerSchema } from '../schemas';

describe('zodResolver', () => {
  it('returns parsed values on success and no errors', async () => {
    const resolve = zodResolver(loginSchema);
    const res = await resolve({ identifier: 'ana@example.com', password: 'secret12' } as any, undefined, {} as any);
    expect(res.errors).toEqual({});
    expect((res.values as any).identifier).toBe('ana@example.com');
  });

  it('maps each zod issue to a field error with a message', async () => {
    const resolve = zodResolver(registerSchema);
    const res = await resolve(
      { first_name: '', last_name: 'Cruz', email: 'nope', phone: '123', password: 'short' } as any,
      undefined,
      {} as any,
    );
    const errors = res.errors as Record<string, { message?: string }>;
    expect(errors.first_name?.message).toBeTruthy();
    expect(errors.email?.message).toContain('valid email');
    expect(errors.phone?.message).toContain('PH mobile');
    expect(errors.password?.message).toContain('8 characters');
  });
});

describe('applyServerErrors', () => {
  it('applies each server field error and reports it did', () => {
    const calls: Array<[string, { message: string }]> = [];
    const setError = ((field: string, err: { message: string }) => calls.push([field, err])) as any;

    const applied = applyServerErrors(
      { status: 422, errors: { email: ['This email is already registered.'], password: ['Too short.'] } },
      setError,
    );

    expect(applied).toBe(true);
    expect(calls).toContainEqual(['email', { type: 'server', message: 'This email is already registered.' }]);
    expect(calls).toContainEqual(['password', { type: 'server', message: 'Too short.' }]);
  });

  it('honors field aliases (combined login identifier)', () => {
    const calls: Array<[string, { message: string }]> = [];
    const setError = ((field: string, err: { message: string }) => calls.push([field, err])) as any;

    applyServerErrors(
      { status: 422, errors: { phone: ['No account with that number.'] } },
      setError,
      { phone: 'identifier', email: 'identifier' },
    );

    expect(calls[0][0]).toBe('identifier');
  });

  it('returns false when there are no field errors to map (caller can toast)', () => {
    const setError = (() => {}) as any;
    expect(applyServerErrors({ status: 500, message: 'boom' }, setError)).toBe(false);
    expect(applyServerErrors(null, setError)).toBe(false);
  });
});
