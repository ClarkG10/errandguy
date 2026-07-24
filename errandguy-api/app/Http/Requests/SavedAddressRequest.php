<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class SavedAddressRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        $isUpdate = $this->isMethod('PUT') || $this->isMethod('PATCH');
        $prefix = $isUpdate ? 'sometimes|' : '';

        return [
            'label' => [$isUpdate ? 'sometimes' : 'required', 'string', 'max:50'],
            'address' => [$isUpdate ? 'sometimes' : 'required', 'string', 'max:500'],
            'lat' => [$isUpdate ? 'sometimes' : 'required', 'numeric', 'between:-90,90'],
            'lng' => [$isUpdate ? 'sometimes' : 'required', 'numeric', 'between:-180,180'],
            'is_default' => ['sometimes', 'boolean'],
        ];
    }
}
