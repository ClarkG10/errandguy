import { Module } from '@nestjs/common';
import { RunnerEarningsExportController, PaymentReceiptPdfController } from './export.controller';

/**
 * PDF export endpoints (ExportController). Both controllers read directly via
 * the globally-provided PrismaService — mirroring ExportController's direct
 * Eloquent queries — and the auth guards come from the @Global AuthCommonModule,
 * so no additional module imports are required.
 */
@Module({
  controllers: [RunnerEarningsExportController, PaymentReceiptPdfController],
})
export class ExportModule {}
