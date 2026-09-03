<?php

namespace Tests\Feature\Middleware;

use App\Http\Middleware\EnsureUserActive;
use App\Models\User;
use App\Support\ErrorCode;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Tests\TestCase;

/**
 * A dead account must be MACHINE-readable, not just human-readable.
 *
 * These three statuses used to return a bare `{success, message}` 403 with no
 * `code`. The app's response interceptor handles 401 only, so a suspended user
 * became a zombie session: auth stayed "valid", the route gate kept them inside
 * the app, and every tab failed with its own generic error toast while nothing
 * ever told them the account was gone. The client now ends the session on
 * ACCOUNT_SUSPENDED / ACCOUNT_INACTIVE — which it can only do if the code is
 * actually on the wire.
 *
 * Matching on the code (not the message) is the whole point: the copy below is
 * support-facing wording that will be reworded, and a client that string-matched
 * it would silently stop working the day it changed.
 */
class DeadAccountResponseTest extends TestCase
{
    use RefreshDatabase;

    private function handleAs(string $status): \Symfony\Component\HttpFoundation\Response
    {
        $user = User::factory()->create(['status' => $status]);
        $request = Request::create('/api/v1/bookings', 'GET');
        $request->setUserResolver(fn () => $user);

        return (new EnsureUserActive())->handle(
            $request,
            fn ($req) => response('should never be reached', 200),
        );
    }

    /**
     * @return array<string, array{0: string, 1: ErrorCode}>
     */
    public static function deadStatuses(): array
    {
        return [
            'suspended' => ['suspended', ErrorCode::ACCOUNT_SUSPENDED],
            'banned' => ['banned', ErrorCode::ACCOUNT_SUSPENDED],
            'deleted' => ['deleted', ErrorCode::ACCOUNT_INACTIVE],
        ];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('deadStatuses')]
    public function test_a_dead_account_is_rejected_with_a_machine_readable_code(
        string $status,
        ErrorCode $expected,
    ): void {
        $response = $this->handleAs($status);
        $body = json_decode((string) $response->getContent(), true);

        $this->assertSame(403, $response->getStatusCode());
        $this->assertSame($expected->value, $body['code'] ?? null, "status '{$status}' must carry a code the client can act on");
        $this->assertFalse($body['success']);
        // Still human-readable — the client shows this verbatim on the auth screen.
        $this->assertNotEmpty($body['message']);
    }

    public function test_an_active_account_passes_through(): void
    {
        $response = $this->handleAs('active');

        $this->assertSame(200, $response->getStatusCode());
    }

    /**
     * The client's teardown is keyed on these two literal strings. If the enum
     * is ever renamed, this fails here rather than silently re-stranding every
     * suspended user in a zombie session.
     */
    public function test_the_codes_the_client_matches_on_keep_their_names(): void
    {
        $this->assertSame('ACCOUNT_SUSPENDED', ErrorCode::ACCOUNT_SUSPENDED->value);
        $this->assertSame('ACCOUNT_INACTIVE', ErrorCode::ACCOUNT_INACTIVE->value);
        $this->assertSame(403, ErrorCode::ACCOUNT_SUSPENDED->httpStatus());
        $this->assertSame(403, ErrorCode::ACCOUNT_INACTIVE->httpStatus());
    }
}
