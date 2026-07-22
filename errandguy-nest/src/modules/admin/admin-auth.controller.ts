import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AdminUser } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SanctumService } from '../../common/auth/sanctum.service';
import { HashService } from '../../common/auth/hash.service';
import { SanctumAuthGuard } from '../../common/auth/auth.guard';
import { AdminGuard } from '../../common/auth/admin.guard';
import { CurrentAdmin, CurrentTokenId } from '../../common/auth/current-user.decorator';
import { AuthThrottle } from '../../common/throttling/throttle.decorators';
import { LaravelValidationException } from '../../common/exceptions/validation.exception';
import type { AuthConfig } from '../../config/configuration';
import { AdminLoginDto } from './admin.dto';

@Controller('admin')
export class AdminAuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sanctum: SanctumService,
    private readonly hash: HashService,
    private readonly config: ConfigService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @AuthThrottle()
  async login(@Body() dto: AdminLoginDto): Promise<{ data: unknown }> {
    const admin = await this.prisma.adminUser.findUnique({ where: { email: dto.email } });
    if (!admin || !this.hash.check(dto.password, admin.passwordHash)) {
      throw LaravelValidationException.field('email', 'Invalid credentials.');
    }
    if (!admin.isActive) throw new HttpException({ message: 'Account is deactivated' }, HttpStatus.FORBIDDEN);

    await this.prisma.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
    const tokenableAdminType = this.config.get<AuthConfig>('auth')!.tokenableAdminType;
    const { plainTextToken } = await this.sanctum.createToken(tokenableAdminType, admin.id, 'admin-token', ['admin']);

    return { data: { user: this.publicAdmin(admin), token: plainTextToken } };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SanctumAuthGuard, AdminGuard)
  async logout(@CurrentTokenId() tokenId?: bigint): Promise<{ message: string }> {
    if (tokenId !== undefined) await this.sanctum.deleteToken(tokenId);
    return { message: 'Logged out' };
  }

  @Get('me')
  @UseGuards(SanctumAuthGuard, AdminGuard)
  me(@CurrentAdmin() admin: AdminUser): { data: unknown } {
    return { data: this.publicAdmin(admin) };
  }

  private publicAdmin(a: AdminUser): Record<string, unknown> {
    return { id: a.id, email: a.email, full_name: a.fullName, role: a.role };
  }
}
