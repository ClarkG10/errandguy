import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import type { IntegrationsConfig } from '../config/configuration';

/** A multipart file (Express.Multer.File subset). */
export interface UploadFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

/** Port of SupabaseStorageService — same buckets, paths, and public-URL shape. */
@Injectable()
export class SupabaseStorageService {
  private readonly logger = new Logger('SupabaseStorage');

  constructor(private readonly config: ConfigService) {}

  private get supa(): { url: string; serviceKey: string } {
    return this.config.get<IntegrationsConfig>('integrations')!.supabase;
  }

  private ext(file: UploadFile): string {
    const dot = file.originalname.lastIndexOf('.');
    const ext = dot >= 0 ? file.originalname.slice(dot + 1) : '';
    return ext || 'jpg';
  }

  async upload(bucket: string, path: string, file: UploadFile): Promise<string | null> {
    const { url, serviceKey } = this.supa;
    if (!url) return null;
    try {
      const res = await axios.post(`${url}/storage/v1/object/${bucket}/${path}`, file.buffer, {
        headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': file.mimetype },
        timeout: 30_000,
        validateStatus: () => true,
        maxBodyLength: Infinity,
      });
      if (res.status < 200 || res.status >= 300) {
        this.logger.error(`Supabase Storage upload failed bucket=${bucket} path=${path} status=${res.status}`);
        return null;
      }
      return `${url}/storage/v1/object/public/${bucket}/${path}`;
    } catch (e) {
      this.logger.error(`Supabase Storage upload error: ${(e as Error).message}`);
      return null;
    }
  }

  async uploadAvatar(userId: string, file: UploadFile): Promise<string | null> {
    const path = `${userId}/avatar.${this.ext(file)}`;
    await this.delete('avatars', path); // upsert
    return this.upload('avatars', path, file);
  }

  async uploadRunnerDocument(userId: string, documentType: string, file: UploadFile): Promise<string | null> {
    const filename = `${documentType}_${Math.floor(Date.now() / 1000)}.${this.ext(file)}`;
    return this.upload('runner-documents', `${userId}/${filename}`, file);
  }

  async uploadItemPhoto(bookingId: string, file: UploadFile): Promise<string | null> {
    return this.upload('item-photos', `${bookingId}/${uuidv4()}.${this.ext(file)}`, file);
  }

  async uploadDeliveryProof(bookingId: string, proofType: string, file: UploadFile): Promise<string | null> {
    const filename = `${proofType}_${Math.floor(Date.now() / 1000)}.${this.ext(file)}`;
    return this.upload('delivery-proofs', `${bookingId}/${filename}`, file);
  }

  async uploadChatImage(bookingId: string, file: UploadFile): Promise<string | null> {
    return this.upload('chat-images', `${bookingId}/${uuidv4()}.${this.ext(file)}`, file);
  }

  async delete(bucket: string, path: string): Promise<boolean> {
    const { url, serviceKey } = this.supa;
    if (!url) return false;
    try {
      const res = await axios.delete(`${url}/storage/v1/object/${bucket}/${path}`, {
        headers: { Authorization: `Bearer ${serviceKey}` },
        timeout: 15_000,
        validateStatus: () => true,
      });
      return res.status >= 200 && res.status < 300;
    } catch {
      return false;
    }
  }

  getPublicUrl(bucket: string, path: string): string {
    return `${this.supa.url}/storage/v1/object/public/${bucket}/${path}`;
  }
}
