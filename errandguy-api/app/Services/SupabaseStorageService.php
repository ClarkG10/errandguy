<?php

namespace App\Services;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class SupabaseStorageService
{
    private string $supabaseUrl;
    private string $serviceKey;

    public function __construct()
    {
        $this->supabaseUrl = config('services.supabase.url');
        $this->serviceKey = config('services.supabase.service_key');
    }

    /**
     * Upload a file to a Supabase Storage bucket.
     *
     * @return string|null The public URL of the uploaded file, or null on failure.
     */
    public function upload(string $bucket, string $path, UploadedFile $file): ?string
    {
        $response = Http::withHeaders([
            'Authorization' => "Bearer {$this->serviceKey}",
            'Content-Type' => $file->getMimeType(),
        ])->withBody(
            file_get_contents($file->getRealPath()),
            $file->getMimeType()
        )->post("{$this->supabaseUrl}/storage/v1/object/{$bucket}/{$path}");

        if (!$response->successful()) {
            Log::error("Supabase Storage upload failed", [
                'bucket' => $bucket,
                'path' => $path,
                'status' => $response->status(),
                'body' => $response->body(),
            ]);
            return null;
        }

        return "{$this->supabaseUrl}/storage/v1/object/public/{$bucket}/{$path}";
    }

    /**
     * Upload a user avatar, replacing any existing one.
     */
    public function uploadAvatar(string $userId, UploadedFile $file): ?string
    {
        $extension = $file->getClientOriginalExtension() ?: 'jpg';
        $path = "{$userId}/avatar.{$extension}";

        // Try to delete existing avatar first (upsert)
        $this->delete('avatars', $path);

        return $this->upload('avatars', $path, $file);
    }

    /**
     * Upload a runner document (ID, selfie, vehicle photo, etc.).
     */
    public function uploadRunnerDocument(string $userId, string $documentType, UploadedFile $file): ?string
    {
        $extension = $file->getClientOriginalExtension() ?: 'jpg';
        $filename = $documentType . '_' . time() . '.' . $extension;
        $path = "{$userId}/{$filename}";

        return $this->upload('runner-documents', $path, $file);
    }

    /**
     * Upload an item photo for a booking.
     */
    public function uploadItemPhoto(string $bookingId, UploadedFile $file): ?string
    {
        $extension = $file->getClientOriginalExtension() ?: 'jpg';
        $filename = Str::uuid() . '.' . $extension;
        $path = "{$bookingId}/{$filename}";

        return $this->upload('item-photos', $path, $file);
    }

    /**
     * Upload a delivery proof photo (pickup, delivery, signature).
     */
    public function uploadDeliveryProof(string $bookingId, string $proofType, UploadedFile $file): ?string
    {
        $extension = $file->getClientOriginalExtension() ?: 'jpg';
        $filename = $proofType . '_' . time() . '.' . $extension;
        $path = "{$bookingId}/{$filename}";

        return $this->upload('delivery-proofs', $path, $file);
    }

    /**
     * Upload a chat image.
     */
    public function uploadChatImage(string $bookingId, UploadedFile $file): ?string
    {
        $extension = $file->getClientOriginalExtension() ?: 'jpg';
        $filename = Str::uuid() . '.' . $extension;
        $path = "{$bookingId}/{$filename}";

        return $this->upload('chat-images', $path, $file);
    }

    /**
     * Delete a file from a bucket.
     */
    public function delete(string $bucket, string $path): bool
    {
        $response = Http::withHeaders([
            'Authorization' => "Bearer {$this->serviceKey}",
        ])->delete("{$this->supabaseUrl}/storage/v1/object/{$bucket}/{$path}");

        return $response->successful();
    }

    /**
     * Get the public URL for a file.
     */
    public function getPublicUrl(string $bucket, string $path): string
    {
        return "{$this->supabaseUrl}/storage/v1/object/public/{$bucket}/{$path}";
    }
}
