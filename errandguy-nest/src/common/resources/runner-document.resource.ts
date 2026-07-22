import type { RunnerDocument } from '@prisma/client';
import { iso } from '../serialization';

/** Mirrors RunnerDocumentResource. */
export function runnerDocumentResource(d: RunnerDocument): Record<string, unknown> {
  return {
    id: d.id,
    document_type: d.documentType,
    file_url: d.fileUrl,
    status: d.status,
    rejection_reason: d.rejectionReason,
    reviewed_at: iso(d.reviewedAt),
    created_at: iso(d.createdAt),
  };
}
