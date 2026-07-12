<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Shopping-checklist sync.
 *
 * Shopping errands (Food, Grocery, Purchase) let the customer attach an
 * itemized list at booking time. The assigned runner then ticks items off
 * as they shop, and those ticks stream back to the customer in real time.
 *
 * Each element is a small object:
 *   { id: string, name: string, qty: int, checked: bool, checked_at: string|null }
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            $table->jsonb('shopping_items')->nullable()->after('shopping_budget');
        });
    }

    public function down(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            $table->dropColumn('shopping_items');
        });
    }
};
