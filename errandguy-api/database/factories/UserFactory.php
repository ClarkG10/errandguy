<?php

namespace Database\Factories;

use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Facades\Hash;

/**
 * @extends Factory<User>
 */
class UserFactory extends Factory
{
    protected $model = User::class;

    protected static ?string $password;

    public function definition(): array
    {
        return [
            'phone' => '+639' . fake()->numerify('#########'),
            'email' => fake()->unique()->safeEmail(),
            'password_hash' => static::$password ??= Hash::make('Password1!'),
            'full_name' => fake()->name(),
            'role' => 'customer',
            'status' => 'active',
            'email_verified' => false,
            'phone_verified' => false,
            'wallet_balance' => 0.00,
            'avg_rating' => 0.00,
            'total_ratings' => 0,
        ];
    }

    public function runner(): static
    {
        return $this->state(fn (array $attributes) => [
            'role' => 'runner',
        ]);
    }

    public function suspended(): static
    {
        return $this->state(fn (array $attributes) => [
            'status' => 'suspended',
        ]);
    }

    public function banned(): static
    {
        return $this->state(fn (array $attributes) => [
            'status' => 'banned',
        ]);
    }
}
