<?php

namespace Tests\Feature\Admin;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Guards the login-page brand fixes:
 *  - the brand logo renders as INLINE SVG, not a broken <img src="<svg…>">
 *    (regression from passing a rendered string to ->brandLogo()).
 *  - the mascot illustration was removed from the sign-in hero.
 */
class AdminLoginPageTest extends TestCase
{
    use RefreshDatabase;

    public function test_login_renders_inline_brand_svg_not_a_broken_image(): void
    {
        $res = $this->get('/admin/login');
        $res->assertOk();

        // The brand SVG's viewBox appears literally only when the SVG is rendered
        // inline. If brandLogo were a string, Filament would put the markup in an
        // <img src="…"> and the "<" would be URL/HTML-encoded, so this literal
        // wouldn't be present.
        $res->assertSee('viewBox="0 0 1123 340"', escape: false);
    }

    public function test_login_hero_no_longer_shows_the_mascot(): void
    {
        $this->get('/admin/login')
            ->assertOk()
            ->assertDontSee('mascot.png')
            ->assertSee('Welcome back'); // the rest of the hero stays
    }
}
