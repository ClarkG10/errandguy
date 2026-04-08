<?php

namespace App\Http\Requests\Runner;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UploadDocumentRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'document_type' => [
                'required',
                'string',
                Rule::in(['government_id', 'selfie', 'vehicle_registration', 'vehicle_photo', 'drivers_license']),
            ],
            'file' => ['required', 'file', 'mimes:jpg,jpeg,png,pdf', 'max:10240'],
        ];
    }
}
