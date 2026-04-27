<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Real-world adjustments for booking flexibility:
 *
 *  - Single-location errands (Queue, Bills Payment, Document filing,
 *    Custom done-on-site) don't have a separate dropoff. Make the
 *    dropoff_* columns nullable so we don't have to fake them.
 *
 *  - Shopping errands (Food, Grocery, Purchase) don't know the final
 *    item cost up front. The customer pre-authorizes a `shopping_budget`,
 *    the runner uploads a receipt and reports `actual_item_cost`, and the
 *    difference is reconciled at completion (refund or charge).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            // Make dropoff optional for single-location errands.
            $table->text('dropoff_address')->nullable()->change();
            $table->decimal('dropoff_lat', 10, 7)->nullable()->change();
            $table->decimal('dropoff_lng', 10, 7)->nullable()->change();

            // Pre-authorized shopping budget the runner can spend on items.
            $table->decimal('shopping_budget', 10, 2)->nullable()->after('estimated_item_value');

            // Actual cost of items reported by runner (with receipt photo).
            $table->decimal('actual_item_cost', 10, 2)->nullable()->after('shopping_budget');

            // URL to the receipt photo the runner uploaded.
            $table->text('receipt_photo_url')->nullable()->after('actual_item_cost');
        });
    }

    public function down(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            $table->dropColumn(['shopping_budget', 'actual_item_cost', 'receipt_photo_url']);
            // Note: we leave dropoff_* nullable on rollback to avoid breaking
            // any rows created in the meantime that legitimately have no dropoff.
        });
    }
};
