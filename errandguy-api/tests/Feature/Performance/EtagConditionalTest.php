<?php

namespace Tests\Feature\Performance;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The `etag` middleware turns the fat, frequently-polled read endpoints into
 * conditional GETs: a content ETag on the 200, and a bodyless 304 when the
 * client echoes it back in If-None-Match. This is the mobile client's main
 * bandwidth lever during a realtime outage (tight REST polling of unchanged
 * data), so lock the contract down.
 */
class EtagConditionalTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;

    protected function setUp(): void
    {
        parent::setUp();
        $this->customer = User::factory()->create([
            'role' => 'customer', 'status' => 'active',
        ]);
    }

    public function test_tagged_endpoint_returns_an_etag(): void
    {
        $res = $this->actingAs($this->customer)
            ->getJson('/api/v1/notifications')
            ->assertOk();

        $this->assertNotEmpty($res->headers->get('ETag'), 'expected an ETag on a tagged read');
    }

    public function test_matching_if_none_match_yields_304_with_no_body(): void
    {
        $etag = $this->actingAs($this->customer)
            ->getJson('/api/v1/notifications')
            ->assertOk()
            ->headers->get('ETag');

        $res = $this->actingAs($this->customer)
            ->getJson('/api/v1/notifications', ['If-None-Match' => $etag])
            ->assertStatus(304);

        $this->assertSame('', $res->getContent(), '304 must carry no body');
    }

    public function test_stale_if_none_match_still_serves_a_full_200(): void
    {
        $this->actingAs($this->customer)
            ->getJson('/api/v1/notifications', ['If-None-Match' => '"not-the-current-tag"'])
            ->assertOk()
            ->assertJsonStructure(['data']);
    }
}
