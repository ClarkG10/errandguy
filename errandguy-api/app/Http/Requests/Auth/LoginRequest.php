<?php

namespace App\Http\Requests\Auth;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Cache;
use Illuminate\Validation\ValidationException;

class LoginRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'phone' => ['required_without:email', 'nullable', 'string'],
            'email' => ['required_without:phone', 'nullable', 'string', 'email'],
            'password' => ['required', 'string'],
            'device_name' => ['sometimes', 'string', 'max:255'],
        ];
    }

    public function ensureIsNotRateLimited(): void
    {
        $key = 'login_attempts:' . ($this->input('phone') ?? $this->input('email'));
        $attempts = (int) Cache::get($key, 0);

        if ($attempts >= 5) {
            $seconds = Cache::get($key . ':lockout_ttl', 0);
            throw ValidationException::withMessages([
                'email' => [
                    'Too many login attempts. Please try again in ' . ceil($seconds / 60) . ' minutes.',
                ],
            ]);
        }
    }

    public function incrementAttempts(): void
    {
        $key = 'login_attempts:' . ($this->input('phone') ?? $this->input('email'));
        $attempts = (int) Cache::get($key, 0) + 1;
        Cache::put($key, $attempts, now()->addMinutes(15));
        Cache::put($key . ':lockout_ttl', 900, now()->addMinutes(15));
    }

    public function clearAttempts(): void
    {
        $key = 'login_attempts:' . ($this->input('phone') ?? $this->input('email'));
        Cache::forget($key);
        Cache::forget($key . ':lockout_ttl');
    }
}
