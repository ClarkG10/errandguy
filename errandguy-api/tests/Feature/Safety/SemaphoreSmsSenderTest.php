<?php

namespace Tests\Feature\Safety;

use App\Services\Sms\LogSmsSender;
use App\Services\Sms\SemaphoreSmsSender;
use App\Services\Sms\SmsSender;
use App\Support\PhilippinePhone;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * The Semaphore SMS sender (semaphore.co API v4, as documented at
 * https://semaphore.co/docs): form-encoded POST with apikey / number (comma
 * separated) / message / sendername, answered by one JSON object per message.
 * Only messages the provider accepted count as sent; nothing ever throws.
 */
class SemaphoreSmsSenderTest extends TestCase
{
    private function sender(bool $priority = true): SemaphoreSmsSender
    {
        return new SemaphoreSmsSender('test-key', 'ErrandGuy', $priority, 'https://api.semaphore.co/api/v4', 5);
    }

    private function message(string $recipient, string $status = 'Pending'): array
    {
        return [
            'message_id' => random_int(1000, 9999), 'user_id' => 1, 'user' => 'ops', 'account_id' => 1,
            'account' => 'ErrandGuy', 'recipient' => $recipient, 'message' => 'x', 'sender_name' => 'ErrandGuy',
            'network' => 'Globe', 'status' => $status, 'type' => 'priority', 'source' => 'api',
            'created_at' => '2026-10-31 10:00:00', 'updated_at' => '2026-10-31 10:00:00',
        ];
    }

    public function test_it_posts_the_documented_form_to_the_priority_endpoint(): void
    {
        Http::fake(['api.semaphore.co/*' => Http::response([
            $this->message('639170000001'),
            $this->message('639170000002', 'Queued'),
        ])]);

        $result = $this->sender()->send(['+63 917 000 0001', '09170000002', 'not a number'], 'Help is needed');

        $this->assertSame(['09170000001', '09170000002'], $result->accepted);
        $this->assertNull($result->error);
        $this->assertTrue($result->wasAccepted('+639170000001'));

        Http::assertSent(function (Request $request): bool {
            return $request->url() === 'https://api.semaphore.co/api/v4/priority'
                && $request->method() === 'POST'
                && $request->isForm()
                && $request['apikey'] === 'test-key'
                && $request['number'] === '09170000001,09170000002'
                && $request['message'] === 'Help is needed'
                && $request['sendername'] === 'ErrandGuy';
        });
    }

    public function test_the_normal_queue_is_used_when_priority_is_off(): void
    {
        Http::fake(['api.semaphore.co/*' => Http::response([$this->message('639170000001')])]);

        $this->sender(priority: false)->send(['09170000001'], 'Hi');

        Http::assertSent(fn (Request $request): bool => $request->url() === 'https://api.semaphore.co/api/v4/messages');
    }

    public function test_a_failed_message_is_not_counted_as_sent(): void
    {
        Http::fake(['api.semaphore.co/*' => Http::response([
            $this->message('639170000001', 'Failed'),
            $this->message('639170000002', 'Sent'),
        ])]);

        $result = $this->sender()->send(['09170000001', '09170000002'], 'Hi');

        $this->assertSame(['09170000002'], $result->accepted);
        $this->assertFalse($result->wasAccepted('09170000001'));
    }

    public function test_a_refused_request_sends_nothing_and_does_not_throw(): void
    {
        Http::fake(['api.semaphore.co/*' => Http::response(['apikey' => ['The apikey is invalid.']], 401)]);

        $result = $this->sender()->send(['09170000001'], 'Hi');

        $this->assertSame([], $result->accepted);
        $this->assertStringContainsString('HTTP 401', (string) $result->error);
    }

    public function test_an_unreachable_provider_sends_nothing_and_does_not_throw(): void
    {
        Http::fake(['api.semaphore.co/*' => Http::failedConnection('timed out')]);

        $result = $this->sender()->send(['09170000001'], 'Hi');

        $this->assertSame([], $result->accepted);
        $this->assertSame('Could not reach the SMS provider.', $result->error);
    }

    public function test_an_unexpected_answer_counts_as_nothing_sent(): void
    {
        Http::fake(['api.semaphore.co/*' => Http::response('<html>oops</html>', 200)]);

        $this->assertSame([], $this->sender()->send(['09170000001'], 'Hi')->accepted);
    }

    public function test_no_valid_number_means_no_request(): void
    {
        Http::fake();

        $result = $this->sender()->send(['12345', ''], 'Hi');

        $this->assertSame([], $result->accepted);
        Http::assertNothingSent();
    }

    public function test_the_app_texts_through_semaphore_only_once_a_key_is_set(): void
    {
        config(['services.semaphore.api_key' => null]);
        $this->assertInstanceOf(LogSmsSender::class, app(SmsSender::class));
        $this->assertFalse(app(SmsSender::class)->isConfigured());

        config(['services.semaphore.api_key' => 'live-key']);
        $this->assertInstanceOf(SemaphoreSmsSender::class, app(SmsSender::class));
        $this->assertTrue(app(SmsSender::class)->isConfigured());
    }

    public function test_the_inert_sender_never_claims_a_text_went_out(): void
    {
        Http::fake();

        $result = (new LogSmsSender())->send(['09170000001'], 'Hi');

        $this->assertSame([], $result->accepted);
        $this->assertSame(LogSmsSender::NOT_CONFIGURED, $result->error);
        Http::assertNothingSent();
    }

    public function test_philippine_numbers_are_normalised(): void
    {
        $this->assertSame('09171234567', PhilippinePhone::normalize('+639171234567'));
        $this->assertSame('09171234567', PhilippinePhone::normalize('639171234567'));
        $this->assertSame('09171234567', PhilippinePhone::normalize('0917-123-4567'));
        $this->assertSame('09171234567', PhilippinePhone::normalize('9171234567'));
        $this->assertSame('09171234567', PhilippinePhone::normalize('(0917) 123 4567'));
        $this->assertNull(PhilippinePhone::normalize('0217123456'));
        $this->assertNull(PhilippinePhone::normalize('+1 415 555 0100'));
        $this->assertNull(PhilippinePhone::normalize(null));
        $this->assertSame(['09171234567', '09181234567'], PhilippinePhone::list('0917 123 4567, junk, +639181234567, 09171234567'));
    }
}
