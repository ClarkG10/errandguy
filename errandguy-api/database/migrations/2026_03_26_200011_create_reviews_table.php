<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('reviews', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('booking_id');
            $table->uuid('reviewer_id');
            $table->uuid('reviewee_id');
            $table->smallInteger('rating');
            $table->text('comment')->nullable();
            $table->boolean('is_flagged')->default(false);
            $table->timestampTz('created_at')->useCurrent();

            $table->foreign('booking_id')->references('id')->on('bookings');
            $table->foreign('reviewer_id')->references('id')->on('users');
            $table->foreign('reviewee_id')->references('id')->on('users');
            $table->unique(['booking_id', 'reviewer_id']);
            $table->index('reviewee_id', 'idx_reviews_reviewee_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('reviews');
    }
};
