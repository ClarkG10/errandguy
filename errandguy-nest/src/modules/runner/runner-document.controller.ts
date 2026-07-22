import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SupabaseStorageService } from '../../integrations/supabase-storage.service';
import { SanctumAuthGuard } from '../../common/auth/auth.guard';
import { ActiveGuard } from '../../common/auth/active.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { runnerDocumentResource } from '../../common/resources/runner-document.resource';
import { LaravelValidationException, ValidationErrors } from '../../common/exceptions/validation.exception';

const DOCUMENT_TYPES = ['government_id', 'selfie', 'vehicle_registration', 'vehicle_photo', 'drivers_license'];
const ALLOWED_MIME = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];

interface Multipart {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

@Controller('runner')
@UseGuards(SanctumAuthGuard, ActiveGuard, RolesGuard)
@Roles('runner')
export class RunnerDocumentController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: SupabaseStorageService,
  ) {}

  @Post('documents')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 12 * 1024 * 1024 } }))
  async store(
    @CurrentUser() user: User,
    @Body('document_type') documentType: string | undefined,
    @UploadedFile() file?: Multipart,
  ): Promise<Record<string, unknown>> {
    const errors: ValidationErrors = {};
    if (documentType === undefined || documentType === null || documentType === '') {
      errors.document_type = ['The document type field is required.'];
    } else if (!DOCUMENT_TYPES.includes(documentType)) {
      errors.document_type = ['The selected document type is invalid.'];
    }
    if (!file) {
      errors.file = ['The file field is required.'];
    } else {
      if (!ALLOWED_MIME.includes(file.mimetype)) {
        errors.file = ['The file field must be a file of type: jpg, jpeg, png, pdf.'];
      } else if (file.size > 10240 * 1024) {
        errors.file = ['The file field must not be greater than 10240 kilobytes.'];
      }
    }
    if (Object.keys(errors).length) throw new LaravelValidationException(errors);

    let profile = await this.prisma.runnerProfile.findUnique({ where: { userId: user.id } });
    if (!profile) {
      profile = await this.prisma.runnerProfile.create({ data: { userId: user.id, verificationStatus: 'pending' } });
    }

    // Same-type doc: replace only if it was rejected; otherwise block.
    const existing = await this.prisma.runnerDocument.findFirst({
      where: { runnerId: profile.id, documentType: documentType! },
    });
    if (existing && existing.status === 'rejected') {
      await this.deleteStoredFile(existing.fileUrl);
      await this.prisma.runnerDocument.delete({ where: { id: existing.id } });
    } else if (existing && existing.status !== 'rejected') {
      throw new HttpException(
        { message: 'A document of this type is already submitted and pending/approved.' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const fileUrl = await this.storage.uploadRunnerDocument(user.id, documentType!, {
      buffer: file!.buffer,
      mimetype: file!.mimetype,
      originalname: file!.originalname,
    });

    const document = await this.prisma.runnerDocument.create({
      data: { runnerId: profile.id, documentType: documentType!, fileUrl: fileUrl ?? '', status: 'pending' },
    });

    await this.prisma.notification.create({
      data: {
        userId: user.id,
        title: 'Document Submitted',
        body: `Your ${documentType} document has been submitted for review.`,
        type: 'document_update',
        data: { document_id: document.id },
        isRead: false,
      },
    });

    return { data: runnerDocumentResource(document), message: 'Document uploaded successfully.' };
  }

  /** Best-effort removal of a previously-uploaded runner document from storage. */
  private async deleteStoredFile(fileUrl: string | null): Promise<void> {
    if (!fileUrl) return;
    const marker = '/runner-documents/';
    const idx = fileUrl.indexOf(marker);
    if (idx < 0) return;
    const path = fileUrl.slice(idx + marker.length);
    await this.storage.delete('runner-documents', path).catch(() => undefined);
  }
}
