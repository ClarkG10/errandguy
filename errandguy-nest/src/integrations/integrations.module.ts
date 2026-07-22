import { Global, Module } from '@nestjs/common';
import { SupabaseStorageService } from './supabase-storage.service';
import { MailService } from './mail.service';
import { XenditService } from './xendit.service';

/** App-wide third-party clients (storage, email, payments gateway). */
@Global()
@Module({
  providers: [SupabaseStorageService, MailService, XenditService],
  exports: [SupabaseStorageService, MailService, XenditService],
})
export class IntegrationsModule {}
