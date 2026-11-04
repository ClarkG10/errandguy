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
            // Images come ONLY as an inline upload (`image` below), which the
            // server stores on the private, participant-gated media disk and
            // links itself. A client-supplied link is refused outright: the
            // app never sends one, and a host check by prefix was beaten by
            // "https://<our-host>.evil.tld/internal/media/…" — rendered by the
            // other person's app, which then sent its login token there.
            // Server-issued system messages are written directly, not here.
            'image_url' => ['prohibited'],
            'image' => ['nullable', 'image', 'mimes:jpeg,jpg,png,webp', 'max:5120'], // 5 MB
        ];
    }

    public function after(): array
    {
        return [
            function ($validator) {
                $content = $this->input('content');
                $hasUpload = $this->hasFile('image');

                if (empty($content) && !$hasUpload) {
                    $validator->errors()->add(
                        'content',
                        'Either content or an image must be provided.'
                    );
                }
            },
        ];
    }
}
