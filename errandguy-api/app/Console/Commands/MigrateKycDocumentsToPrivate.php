<?php

namespace App\Console\Commands;

use App\Models\RunnerDocument;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

/**
 * One-time (idempotent) migration of legacy runner KYC documents off the PUBLIC
 * disk onto the private 'kyc' disk, backfilling runner_documents.file_path.
 *
 * New uploads already go straight to the private disk (RunnerDocumentController);
 * this closes the exposure for documents uploaded BEFORE that change, which still
 * carry a public file_url and are reachable by URL. For each such row it copies
 * the file to the kyc disk at the same relative path, points file_path at it,
 * nulls file_url, and — unless --keep-public — deletes the now-private original
 * from the public disk. The copy is verified before the original is removed.
 *
 * Idempotent: rows that already have a file_path are excluded, so it is safe to
 * re-run. Use --dry-run to preview first.
 */
class MigrateKycDocumentsToPrivate extends Command
{
    protected $signature = 'errandguy:migrate-kyc-to-private
        {--dry-run : Report what would change without writing anything}
        {--keep-public : Copy to the private disk but do NOT delete the public original}';

    protected $description = 'Move legacy public-disk runner KYC documents onto the private kyc disk and backfill file_path.';

    public function handle(): int
    {
        $dryRun = (bool) $this->option('dry-run');
        $keepPublic = (bool) $this->option('keep-public');

        // Only legacy rows: a public file_url and no private file_path yet.
        $docs = RunnerDocument::whereNull('file_path')
            ->whereNotNull('file_url')
            ->orderBy('created_at')
            ->get();

        if ($docs->isEmpty()) {
            $this->info('No legacy public-disk KYC documents to migrate.');

            return self::SUCCESS;
        }

        $this->line(($dryRun ? '[DRY RUN] ' : '')."Migrating {$docs->count()} legacy KYC document(s)...");

        $migrated = 0;
        $missing = 0;
        $errors = 0;

        foreach ($docs as $doc) {
            $relativePath = $this->publicDiskPath((string) $doc->file_url);

            if ($relativePath === null || ! Storage::disk('public')->exists($relativePath)) {
                $this->warn("  missing on public disk — skipped: doc {$doc->id} ({$doc->file_url})");
                $missing++;

                continue;
            }

            if ($dryRun) {
                $this->line("  would move: {$relativePath}");
                $migrated++;

                continue;
            }

            try {
                // Stream-copy to the private disk at the same relative path
                // (avoids loading a large scan fully into memory).
                $stream = Storage::disk('public')->readStream($relativePath);
                Storage::disk('kyc')->writeStream($relativePath, $stream);
                if (is_resource($stream)) {
                    fclose($stream);
                }

                if (! Storage::disk('kyc')->exists($relativePath)) {
                    throw new \RuntimeException('private-disk copy could not be verified');
                }

                $doc->update(['file_path' => $relativePath, 'file_url' => null]);

                // Only remove the public original AFTER the private copy is
                // verified and the row is repointed.
                if (! $keepPublic) {
                    Storage::disk('public')->delete($relativePath);
                }

                $this->line("  moved: {$relativePath}");
                $migrated++;
            } catch (\Throwable $e) {
                $this->error("  ERROR doc {$doc->id}: {$e->getMessage()}");
                $errors++;
            }
        }

        $this->newLine();
        $this->info(($dryRun ? '[DRY RUN] ' : '')."Migrated: {$migrated}   Missing file: {$missing}   Errors: {$errors}");

        return $errors === 0 ? self::SUCCESS : self::FAILURE;
    }

    /**
     * Turn a public-disk file URL into a disk-relative path, independent of the
     * APP_URL it was generated under (public URLs are always ".../storage/{path}").
     */
    private function publicDiskPath(string $url): ?string
    {
        $path = parse_url($url, PHP_URL_PATH);
        if (! is_string($path) || $path === '') {
            return null;
        }

        return preg_replace('#^storage/#', '', ltrim($path, '/'));
    }
}
