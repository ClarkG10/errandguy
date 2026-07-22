import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'eg_required_role';

/** Equivalent of `role:{role}` middleware — pin an endpoint/controller to a role. */
export const Roles = (role: 'customer' | 'runner') => SetMetadata(ROLES_KEY, role);
