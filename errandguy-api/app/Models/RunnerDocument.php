<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class RunnerDocument extends Model
{
    use HasUuids;

    protected $keyType = 'string';
    public $incrementing = false;
    public $timestamps = false;

    protected $fillable = [
        'runner_id',
        'document_type',
        'file_path',
        'file_url',
        'status',
        'rejection_reason',
        'reviewed_by',
        'reviewed_at',
    ];

    protected function casts(): array
    {
        return [
            'reviewed_at' => 'datetime',
            'created_at' => 'datetime',
        ];
    }

    public function runnerProfile(): BelongsTo
    {
        return $this->belongsTo(RunnerProfile::class, 'runner_id');
    }

    /**
     * Is there a retrievable file — either the private-disk path (new) or a
     * legacy public URL (pre-migration)?
     */
    public function hasFile(): bool
    {
        return filled($this->file_path) || filled($this->file_url);
    }

    /**
     * URL the Filament admin panel uses to view this KYC document. Points at the
     * session-guarded streaming route (never the raw private path / public URL),
     * so the browser's admin session cookie authorizes the load.
     */
    public function adminFileUrl(): ?string
    {
        return $this->hasFile() ? route('admin.runner-documents.file', $this) : null;
    }

    public function scopePending($query)
    {
        return $query->where('status', 'pending');
    }

    public function scopeApproved($query)
    {
        return $query->where('status', 'approved');
    }
}
