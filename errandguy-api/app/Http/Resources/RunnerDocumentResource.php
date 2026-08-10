<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class RunnerDocumentResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'document_type' => $this->document_type,
            // Authenticated serve URL for the runner's OWN document (SEC-1). The
            // file is on the private disk; the mobile client must fetch this with
            // its Sanctum bearer (image requests must carry the Authorization
            // header — see the mobile handover note). Legacy public docs are
            // streamed through the same route.
            'file_url' => route('runner.documents.file', ['document' => $this->id]),
            'status' => $this->status,
            'rejection_reason' => $this->rejection_reason,
            'created_at' => $this->created_at,
        ];
    }
}
