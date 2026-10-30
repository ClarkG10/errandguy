<?php

namespace Tests\Feature;

use Tests\TestCase;

/**
 * The public web pages: an ErrandGuy home page instead of the framework
 * welcome page, and /terms and /privacy carrying clearly marked placeholder
 * text (until the owner publishes the lawyer-approved versions) and the
 * current policy version.
 */
class PublicPagesTest extends TestCase
{
    public function test_the_home_page_is_errandguys_not_the_frameworks(): void
    {
        config(['app.support_email' => 'support@errandguyph.com']);

        $this->get('/')
            ->assertOk()
            ->assertSee('ErrandGuy')
            ->assertSee(route('terms'), false)
            ->assertSee(route('privacy'), false)
            ->assertSee(route('account.delete'), false)
            ->assertSee('mailto:support@errandguyph.com', false)
            ->assertDontSee('Laravel');
    }

    public function test_terms_and_privacy_are_public_marked_as_placeholders_and_versioned(): void
    {
        config(['app.privacy_policy_version' => '2.3']);

        foreach (['/terms' => 'Terms of Service', '/privacy' => 'Privacy Policy'] as $url => $title) {
            $this->get($url)
                ->assertOk()
                ->assertSee($title)
                ->assertSee('Version 2.3')
                ->assertSee('Placeholder');
        }
    }

    public function test_the_delete_account_page_is_still_public(): void
    {
        $this->get('/delete-account')->assertOk()->assertSee('Delete your ErrandGuy account');
    }
}
