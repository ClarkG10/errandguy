<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Operator alert feed for the /admin "Live alerts" widget. Deliberately a
 * SEPARATE table from the customer-facing `notifications` table (which has its
 * own custom schema) and from Laravel's database-notifications, so there is no
 * collision. Rows are raised by the app on time-critical events (SOS, stuck
 * errand) and dismissed by operators.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('admin_alerts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('type');                       // sos | no_runner | dispute | …
            $table->string('severity')->default('warning'); // critical | warning | info
            $table->string('title');
            $table->text('body')->nullable();
            $table->uuid('subject_id')->nullable();       // related record id for the deep-link
            $table->timestamp('read_at')->nullable();
            $table->timestamps();

            $table->index(['read_at', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('admin_alerts');
    }
};
