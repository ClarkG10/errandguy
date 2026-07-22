import type { AdminUser, User } from '@prisma/client';

/** Who is behind the current request's bearer token. */
export type AuthPrincipal =
  | { type: 'user'; tokenId: bigint; user: User }
  | { type: 'admin'; tokenId: bigint; admin: AdminUser };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** The authenticated tokenable (User or AdminUser), or undefined on public routes. */
      user?: User | AdminUser;
      /** Discriminates which table the principal came from. */
      principalType?: 'user' | 'admin';
      /** The personal_access_tokens row id used to authenticate. */
      tokenId?: bigint;
    }
  }
}
