import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SanctumAuthGuard } from '../../common/auth/auth.guard';
import { ActiveGuard } from '../../common/auth/active.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { TrustedContactDto } from './dto/user.dto';
import { trustedContactResource } from './user.resources';

@Controller('user/trusted-contacts')
@UseGuards(SanctumAuthGuard, ActiveGuard)
export class TrustedContactController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async index(@CurrentUser() user: User): Promise<{ data: unknown[] }> {
    const rows = await this.prisma.trustedContact.findMany({
      where: { userId: user.id },
      orderBy: { priority: 'asc' },
    });
    return { data: rows.map(trustedContactResource) };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async store(
    @CurrentUser() user: User,
    @Body() dto: TrustedContactDto,
  ): Promise<Record<string, unknown>> {
    const count = await this.prisma.trustedContact.count({ where: { userId: user.id } });
    if (count >= 5) {
      throw new HttpException(
        { message: 'Maximum of 5 trusted contacts reached.' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const contact = await this.prisma.trustedContact.create({
      data: {
        userId: user.id,
        name: dto.name,
        phone: dto.phone,
        relationship: dto.relationship,
        priority: dto.priority ?? 1,
        isActive: dto.is_active ?? true,
      },
    });
    return { data: trustedContactResource(contact), message: 'Trusted contact added successfully.' };
  }

  @Put(':id')
  async update(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: TrustedContactDto,
  ): Promise<Record<string, unknown>> {
    const contact = await this.prisma.trustedContact.findUnique({ where: { id } });
    if (!contact) throw new HttpException({ message: 'Not found.' }, HttpStatus.NOT_FOUND);
    if (contact.userId !== user.id) {
      throw new HttpException({ message: 'This action is unauthorized.' }, HttpStatus.FORBIDDEN);
    }
    const updated = await this.prisma.trustedContact.update({
      where: { id },
      data: {
        name: dto.name,
        phone: dto.phone,
        relationship: dto.relationship,
        ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
        ...(dto.is_active !== undefined ? { isActive: dto.is_active } : {}),
      },
    });
    return { data: trustedContactResource(updated), message: 'Trusted contact updated successfully.' };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async destroy(@CurrentUser() user: User, @Param('id') id: string): Promise<{ message: string }> {
    const contact = await this.prisma.trustedContact.findUnique({ where: { id } });
    if (!contact) throw new HttpException({ message: 'Not found.' }, HttpStatus.NOT_FOUND);
    if (contact.userId !== user.id) {
      throw new HttpException({ message: 'This action is unauthorized.' }, HttpStatus.FORBIDDEN);
    }
    await this.prisma.trustedContact.delete({ where: { id } });
    return { message: 'Trusted contact deleted successfully.' };
  }
}
