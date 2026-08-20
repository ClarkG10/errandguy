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
            // Either a pre-hosted URL OR an inline upload. The url-form is
            // documented as server-issued only (system messages / future
            // server-issued images); an inline image from a client always goes
            // through the `image` upload below onto the private, participant-
            // gated media disk. Restrict image_url to our own host: an external
            // URL persisted here and rendered by the counterparty's <Image>
            // would beacon their IP/UA/view-time to an attacker server and
            // bypass the private-media hardening. Anything not on config('app.url')
            // is rejected; the client only ever sends null here.
            'image_url' => [
                'nullable', 'string', 'url', 'max:500',
                function ($attribute, $value, $fail) {
                    if ($value && !str_starts_with($value, rtrim((string) config('app.url'), '/'))) {
                        $fail('The image URL host is not allowed.');
                    }
                },
            ],
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
