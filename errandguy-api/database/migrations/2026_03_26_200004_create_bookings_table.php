<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('bookings', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('booking_number', 20)->unique();
            $table->uuid('customer_id');
            $table->uuid('runner_id')->nullable();
            $table->uuid('errand_type_id');
            $table->string('status', 25)->default('pending');
            $table->text('pickup_address');
            $table->decimal('pickup_lat', 10, 7);
            $table->decimal('pickup_lng', 10, 7);
            $table->string('pickup_contact_name', 100)->nullable();
            $table->string('pickup_contact_phone', 20)->nullable();
            $table->text('dropoff_address');
            $table->decimal('dropoff_lat', 10, 7);
            $table->decimal('dropoff_lng', 10, 7);
            $table->string('dropoff_contact_name', 100)->nullable();
            $table->string('dropoff_contact_phone', 20)->nullable();
            $table->text('description')->nullable();
            $table->text('special_instructions')->nullable();
            $table->jsonb('item_photos')->default('[]');
            $table->decimal('estimated_item_value', 10, 2)->nullable();
            $table->string('schedule_type', 10)->default('now');
            $table->timestampTz('scheduled_at')->nullable();
            $table->string('pricing_mode', 10)->default('fixed');
            $table->string('vehicle_type_rate', 15)->nullable();
            $table->decimal('distance_km', 8, 2)->nullable();
            $table->decimal('base_fee', 8, 2);
            $table->decimal('distance_fee', 8, 2);
            $table->decimal('service_fee', 8, 2);
            $table->decimal('surcharge', 8, 2)->default(0.00);
            $table->decimal('promo_discount', 8, 2)->default(0.00);
            $table->decimal('total_amount', 10, 2);
            $table->decimal('customer_offer', 10, 2)->nullable();
            $table->decimal('recommended_min', 10, 2)->nullable();
            $table->decimal('recommended_max', 10, 2)->nullable();
            $table->decimal('runner_payout', 10, 2)->nullable();
            $table->timestampTz('negotiate_expires_at')->nullable();
            $table->text('pickup_photo_url')->nullable();
            $table->text('delivery_photo_url')->nullable();
            $table->text('signature_url')->nullable();
            $table->timestampTz('matched_at')->nullable();
            $table->timestampTz('accepted_at')->nullable();
            $table->timestampTz('picked_up_at')->nullable();
            $table->timestampTz('completed_at')->nullable();
            $table->timestampTz('cancelled_at')->nullable();
            $table->text('cancellation_reason')->nullable();
            $table->uuid('cancelled_by')->nullable();
            $table->uuid('promo_code_id')->nullable();
            $table->string('ride_pin', 4)->nullable();
            $table->boolean('ride_pin_verified')->default(false);
            $table->boolean('is_transportation')->default(false);
            $table->boolean('sos_triggered')->default(false);
            $table->string('trip_share_token', 64)->unique()->nullable();
            $table->boolean('trip_share_active')->default(false);
            $table->timestampsTz();

            $table->foreign('customer_id')->references('id')->on('users');
            $table->foreign('runner_id')->references('id')->on('users');
            $table->foreign('errand_type_id')->references('id')->on('errand_types');
            $table->index('customer_id', 'idx_bookings_customer_id');
            $table->index('runner_id', 'idx_bookings_runner_id');
            $table->index('status', 'idx_bookings_status');
            $table->index('booking_number', 'idx_bookings_booking_number');
            $table->index('created_at', 'idx_bookings_created_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('bookings');
    }
};
