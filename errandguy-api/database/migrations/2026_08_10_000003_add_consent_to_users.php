<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * PRIV-2: persist the Terms/Privacy consent the client already collects at
 * registration, so the platform can demonstrate DPA-compliant consent (WHEN it
 * was given and WHICH policy version) instead of it living only in the app.
 *
 * Both columns are nullable — a registration that doesn't supply consent (an
 * older app build) simply records none, so this is backward-compatible. Once
 * the consent-sending app build has propagated, the API can be tightened to
 * require it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->timestampTz('terms_accepted_at')->nullable()->after('status');
            $table->string('privacy_policy_version', 20)->nullable()->after('terms_accepted_at');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['terms_accepted_at', 'privacy_policy_version']);
        });
    }
};
