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
import { CreateAddressDto, UpdateAddressDto } from './dto/user.dto';
import { savedAddressResource } from './user.resources';

@Controller('user/addresses')
@UseGuards(SanctumAuthGuard, ActiveGuard)
export class SavedAddressController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async index(@CurrentUser() user: User): Promise<{ data: unknown[] }> {
    const rows = await this.prisma.savedAddress.findMany({
      where: { userId: user.id },
      orderBy: [{ isDefault: 'desc' }, { label: 'asc' }],
    });
    return { data: rows.map(savedAddressResource) };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async store(
    @CurrentUser() user: User,
    @Body() dto: CreateAddressDto,
  ): Promise<Record<string, unknown>> {
    const count = await this.prisma.savedAddress.count({ where: { userId: user.id } });
    if (count >= 10) {
      throw new HttpException(
        { message: 'Maximum of 10 saved addresses reached.' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (dto.is_default) {
      await this.prisma.savedAddress.updateMany({
        where: { userId: user.id },
        data: { isDefault: false },
      });
    }
    const address = await this.prisma.savedAddress.create({
      data: {
        userId: user.id,
        label: dto.label,
        address: dto.address,
        lat: dto.lat,
        lng: dto.lng,
        isDefault: dto.is_default ?? false,
      },
    });
    return { data: savedAddressResource(address), message: 'Address saved successfully.' };
  }

  @Put(':id')
  async update(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: UpdateAddressDto,
  ): Promise<Record<string, unknown>> {
    const address = await this.prisma.savedAddress.findUnique({ where: { id } });
    if (!address) throw new HttpException({ message: 'Not found.' }, HttpStatus.NOT_FOUND);
    if (address.userId !== user.id) {
      throw new HttpException({ message: 'This action is unauthorized.' }, HttpStatus.FORBIDDEN);
    }
    if (dto.is_default) {
      await this.prisma.savedAddress.updateMany({
        where: { userId: user.id, NOT: { id } },
        data: { isDefault: false },
      });
    }
    const data: Record<string, unknown> = {};
    if (dto.label !== undefined) data.label = dto.label;
    if (dto.address !== undefined) data.address = dto.address;
    if (dto.lat !== undefined) data.lat = dto.lat;
    if (dto.lng !== undefined) data.lng = dto.lng;
    if (dto.is_default !== undefined) data.isDefault = dto.is_default;

    const updated = await this.prisma.savedAddress.update({ where: { id }, data });
    return { data: savedAddressResource(updated), message: 'Address updated successfully.' };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async destroy(@CurrentUser() user: User, @Param('id') id: string): Promise<{ message: string }> {
    const address = await this.prisma.savedAddress.findUnique({ where: { id } });
    if (!address) throw new HttpException({ message: 'Not found.' }, HttpStatus.NOT_FOUND);
    if (address.userId !== user.id) {
      throw new HttpException({ message: 'This action is unauthorized.' }, HttpStatus.FORBIDDEN);
    }
    await this.prisma.savedAddress.delete({ where: { id } });
    return { message: 'Address deleted successfully.' };
  }
}
