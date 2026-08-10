<?php

namespace App\Console\Commands;

use App\Models\RunnerDocument;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

/**
 * One-off SEC-1 remediation: move EXISTING runner KYC documents off the
 * world-readable public disk onto the private disk, and repoint them at
 * `file_path` (served thereafter only through the authenticated
 * RunnerDocumentFileController route).
 *
 * New uploads already go straight to the private disk; this closes the window
 * for documents uploaded BEFORE that change — the ones actually exposed today.
 *
 * Idempotent: only touches rows that still have a legacy `file_url` and no
 * `file_path`, so it is safe to re-run. A row whose public file has already
 * gone has its dangling `file_url` cleared so nothing keeps pointing at a
 * public URL. Run once after deploy:  php artisan errandguy:migrate-kyc-docs-to-private
 */
class MigrateKycDocsToPrivate extends Command
{
    protected $signature = 'errandguy:migrate-kyc-docs-to-private {--dry-run : Report what would move without changing anything}';

    protected $description = 'SEC-1: move existing runner KYC documents from the public disk to the private disk.';

    public function handle(): int
    {
        $dryRun = (bool) $this->option('dry-run');
        $publicBase = Storage::disk('public')->url('');

        $query = RunnerDocument::whereNotNull('file_url')->whereNull('file_path');
        $total = $query->count();

        if ($total === 0) {
            $this->info('No legacy public KYC documents to migrate.');

            return self::SUCCESS;
        }

        $this->info(($dryRun ? '[dry-run] ' : '')."Migrating {$total} KYC document(s) to the private disk…");

        $moved = 0;
        $missing = 0;
        $failed = 0;

        $query->chunkById(200, function ($docs) use ($publicBase, $dryRun, &$moved, &$missing, &$failed) {
            foreach ($docs as $doc) {
                $path = str_replace($publicBase, '', (string) $doc->file_url);

                if ($path === '' || ! Storage::disk('public')->exists($path)) {
                    // Public file already gone — just clear the dangling URL so
                    // nothing keeps serving/pointing at a public location.
                    $missing++;
                    if (! $dryRun) {
                        $doc->update(['file_url' => null]);
                    }
                    continue;
                }

                if ($dryRun) {
                    $moved++;
                    continue;
                }

                try {
                    // Stream-copy public -> private at the same relative path,
                    // repoint the row, then remove the public copy.
                    $stream = Storage::disk('public')->readStream($path);
                    Storage::disk('local')->writeStream($path, $stream);
                    if (is_resource($stream)) {
                        fclose($stream);
                    }

                    $doc->update(['file_path' => $path, 'file_url' => null]);
                    Storage::disk('public')->delete($path);
                    $moved++;
                } catch (\Throwable $e) {
                    $failed++;
                    Log::error('SEC-1 KYC doc migration failed for a document', [
                        'document_id' => $doc->id,
                        'error' => $e->getMessage(),
                    ]);
                    $this->warn("  ! failed to migrate document {$doc->id}: {$e->getMessage()}");
                }
            }
        });

        $this->info(($dryRun ? '[dry-run] ' : '')."Done. moved={$moved} missing-file(url-cleared)={$missing} failed={$failed}");

        return $failed === 0 ? self::SUCCESS : self::FAILURE;
    }
}
