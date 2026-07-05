<?php

namespace Tests\Unit;

use App\Services\CacheService;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

class CacheServiceSwrTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
    }

    public function test_cold_read_computes_and_caches(): void
    {
        $calls = 0;
        $val = CacheService::swr('k1', 60, 600, function () use (&$calls) {
            $calls++;
            return 'computed';
        });

        $this->assertSame('computed', $val);
        $this->assertSame(1, $calls);
    }

    public function test_fresh_read_serves_cache_without_recomputing(): void
    {
        $calls = 0;
        $cb = function () use (&$calls) {
            $calls++;
            return "v{$calls}";
        };

        $first = CacheService::swr('k2', 60, 600, $cb);
        $second = CacheService::swr('k2', 60, 600, $cb);

        $this->assertSame('v1', $first);
        $this->assertSame('v1', $second); // served from cache
        $this->assertSame(1, $calls); // callback ran only once
    }

    public function test_stale_read_returns_stale_value_immediately(): void
    {
        $calls = 0;
        $cb = function () use (&$calls) {
            $calls++;
            return "v{$calls}";
        };

        // Seed, then manually age the entry past its soft TTL.
        CacheService::swr('k3', 60, 600, $cb);
        $entry = Cache::get('k3');
        $entry['fresh_until'] = time() - 5; // now stale (but < hard TTL)
        Cache::put('k3', $entry, 600);

        // Stale read must return the OLD value instantly (background refresh
        // is scheduled via afterResponse and does not run inside the request).
        $stale = CacheService::swr('k3', 60, 600, $cb);
        $this->assertSame('v1', $stale);
    }
}
