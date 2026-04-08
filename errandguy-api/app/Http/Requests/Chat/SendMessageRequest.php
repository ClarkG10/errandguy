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
            'image_url' => ['nullable', 'string', 'url', 'max:500'],
        ];
    }

    public function after(): array
    {
        return [
            function ($validator) {
                $content = $this->input('content');
                $imageUrl = $this->input('image_url');

                if (empty($content) && empty($imageUrl)) {
                    $validator->errors()->add(
                        'content',
                        'Either content or image_url must be provided.'
                    );
                }
            },
        ];
    }
}
