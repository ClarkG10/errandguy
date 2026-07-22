import { Global, Module } from '@nestjs/common';
import { SanctumService } from './sanctum.service';
import { HashService } from './hash.service';
import { SanctumAuthGuard, OptionalAuthGuard } from './auth.guard';
import { ActiveGuard } from './active.guard';
import { RolesGuard } from './roles.guard';
import { AdminGuard } from './admin.guard';

/** Provides Sanctum auth + hashing + all route guards app-wide. */
@Global()
@Module({
  providers: [
    SanctumService,
    HashService,
    SanctumAuthGuard,
    OptionalAuthGuard,
    ActiveGuard,
    RolesGuard,
    AdminGuard,
  ],
  exports: [
    SanctumService,
    HashService,
    SanctumAuthGuard,
    OptionalAuthGuard,
    ActiveGuard,
    RolesGuard,
    AdminGuard,
  ],
})
export class AuthCommonModule {}
