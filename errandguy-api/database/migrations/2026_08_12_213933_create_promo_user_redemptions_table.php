<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Per-(user, promo) anchor row used purely as a SERIALIZATION POINT for the
 * per-user promo limit. It carries no counter: the per-user cap remains "the
 * number of non-cancelled bookings this user has with this promo" (a
 * self-correcting count that frees a slot on cancellation), and this row is only
 * ever SELECT ... FOR UPDATE'd so two concurrent bookings by the same user for
 * the same promo can't both pass the check-then-create limit test. The UNIQUE
 * index is what makes the insertOrIgnore that materialises the anchor race-safe.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('promo_user_redemptions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('user_id');
            $table->uuid('promo_code_id');
            $table->timestampTz('created_at')->useCurrent();

            $table->unique(['user_id', 'promo_code_id'], 'uq_promo_user_redemptions');
            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
            $table->foreign('promo_code_id')->references('id')->on('promo_codes')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('promo_user_redemptions');
    }
};
