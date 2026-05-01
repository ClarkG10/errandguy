<?php

namespace App\Http\Requests\Chat;

use Illuminate\Foundation\Http\FormRequest;

class SendMessageRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'content' => ['nullable', 'string', 'max:2000'],
            // Either a pre-hosted URL OR an inline upload. We keep the
            // url-form for system messages / future server-issued images.
            'image_url' => ['nullable', 'string', 'url', 'max:500'],
            'image' => ['nullable', 'image', 'mimes:jpeg,jpg,png,webp', 'max:5120'], // 5 MB
        ];
    }

    public function after(): array
    {
        return [
            function ($validator) {
                $content = $this->input('content');
                $imageUrl = $this->input('image_url');
                $hasUpload = $this->hasFile('image');

                if (empty($content) && empty($imageUrl) && !$hasUpload) {
                    $validator->errors()->add(
                        'content',
                        'Either content or an image must be provided.'
                    );
                }
            },
        ];
    }
}
