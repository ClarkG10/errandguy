<?php

namespace App\Providers\Filament;

use App\Filament\Pages\Auth\StaffLogin;
use App\Filament\Pages\Dashboard;
use App\Http\Middleware\AuthenticateStaff;
use App\Models\AdminUser;
use App\Notifications\StaffPasswordLink;
use App\Notifications\StaffSignInCode;
use Filament\Auth\MultiFactor\App\AppAuthentication;
use Filament\Auth\MultiFactor\Email\EmailAuthentication;
use Filament\Auth\Notifications\ResetPassword as FilamentResetPasswordEmail;
use Filament\Http\Middleware\AuthenticateSession;
use Filament\Http\Middleware\DisableBladeIconComponents;
use Filament\Http\Middleware\DispatchServingFilamentEvent;
use Filament\Navigation\NavigationGroup;
use Filament\Panel;
use Filament\PanelProvider;
use Filament\Enums\ThemeMode;
use Filament\Support\Colors\Color;
use Filament\Support\Enums\Width;
use Filament\Support\Facades\FilamentColor;
use Filament\Support\Icons\Heroicon;
use Filament\View\PanelsRenderHook;
use Illuminate\Auth\Events\PasswordReset;
use Illuminate\Cookie\Middleware\AddQueuedCookiesToResponse;
use Illuminate\Cookie\Middleware\EncryptCookies;
use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Routing\Middleware\SubstituteBindings;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\Support\Facades\Event;
use Illuminate\View\Middleware\ShareErrorsFromSession;

class AdminPanelProvider extends PanelProvider
{
    public function boot(): void
    {
        // The "Forgot password?" email: ours, sent straight away (not queued)
        // and worded for staff. Filament builds it through the container.
        $this->app->bind(FilamentResetPasswordEmail::class, StaffPasswordLink::class);

        Event::listen(PasswordReset::class, function (PasswordReset $event): void {
            if (! $event->user instanceof AdminUser) {
                return;
            }

            activity('admin')
                ->event('auth.password_reset')
                ->performedOn($event->user)
                ->causedBy($event->user)
                ->withProperties(['ip' => request()->ip()])
                ->log('Staff password set from an emailed link');
        });
    }

    public function panel(Panel $panel): Panel
    {
        // Amber BRAND accent = the "Guy" half of the wordmark. Registered as a
        // named colour (Color::hex builds the full 50→950 ramp) so ratings,
        // rewards and money-highlight surfaces can opt into brand gold.
        // Pinned to #fbbf24 (amber-400) — deliberately ONE RUNG LIGHTER than
        // `warning` (Color::Amber = amber-500 #f59e0b) so a gold rating star and
        // an amber "pending" badge stay distinguishable. accent = brand, never
        // a status; keep it off single-series/status charts (see BookingStatusChart,
        // whose "pending" segment already owns amber).
        FilamentColor::register([
            'accent' => Color::hex('#fbbf24'),
        ]);

        return $panel
            ->default()
            ->id('admin')
            ->path('admin')
            // Authenticate against the existing `admin` session guard
            // (config/auth.php -> admins provider -> App\Models\AdminUser).
            ->authGuard('admin')
            // Password + per-account lock + audit (StaffLogin), then a second
            // step every staff role must set up: an authenticator app (with
            // recovery codes) or a code emailed to them. Staff without one are
            // sent to set it up right after the password, before any page.
            ->login(StaffLogin::class)
            ->multiFactorAuthentication([
                AppAuthentication::make()
                    ->recoverable()
                    ->brandName('ErrandGuy Admin'),
                EmailAuthentication::make()
                    ->codeNotification(StaffSignInCode::class)
                    ->codeExpiryMinutes(10),
            ], isRequired: true)
            // "Forgot password?" and the set-password link a new staff member
            // gets, through the staff-only `admins` broker.
            ->passwordReset()
            ->authPasswordBroker('admins')
            ->brandName('ErrandGuy Admin')
            // Mode-adaptive lockup (icon + CSS wordmark) instead of a raster that
            // only reads on one background — see resources/views/filament/brand.
            // MUST return an Htmlable (not a plain string): Filament renders a
            // string brandLogo as an <img src="…"> — passing raw SVG markup as a
            // string produced a broken image with alt "ErrandGuy Admin logo".
            // HtmlString makes Filament emit the SVG inline.
            ->brandLogo(fn (): \Illuminate\Support\HtmlString => new \Illuminate\Support\HtmlString(view('filament.brand')->render()))
            ->brandLogoHeight('2.1rem')
            ->favicon(asset('brand/logo.png'))
            ->font('Inter')
            ->colors([
                // Brand primary = Tailwind blue-600 (#2563EB), matching the mobile app.
                'primary' => Color::Blue,
                'gray' => Color::Slate,
                'info' => Color::Blue,
                'success' => Color::Emerald,
                'warning' => Color::Amber,
                'danger' => Color::Rose,
            ])
            // Dark as the default (cinematic ops look), manual toggle still available.
            ->darkMode(true)
            ->defaultThemeMode(ThemeMode::Dark)
            ->sidebarCollapsibleOnDesktop()
            ->sidebarWidth('17rem')
            ->maxContentWidth(Width::SevenExtraLarge)
            ->globalSearchKeyBindings(['command+k', 'ctrl+k'])
            // SPA mode: navigate between pages client-side (wire:navigate) so
            // switching pages doesn't do a full reload / re-download assets —
            // makes the panel feel instant instead of server-round-tripping
            // every navigation.
            ->spa()
            ->navigationGroups([
                NavigationGroup::make('Operations')->icon(Heroicon::OutlinedTruck),
                NavigationGroup::make('People')->icon(Heroicon::OutlinedUsers),
                NavigationGroup::make('Money')->icon(Heroicon::OutlinedBanknotes),
                NavigationGroup::make('Safety & Support')->icon(Heroicon::OutlinedLifebuoy),
                NavigationGroup::make('System')->icon(Heroicon::OutlinedCog6Tooth),
            ])
            // Inject the branded theme + login/sidebar chrome with NO Vite build
            // step — pure render hooks so the deploy pipeline is unchanged.
            ->renderHook(PanelsRenderHook::HEAD_END, fn (): string => view('filament.admin-theme')->render())
            ->renderHook(PanelsRenderHook::AUTH_LOGIN_FORM_BEFORE, fn (): string => view('filament.login-hero')->render())
            ->renderHook(PanelsRenderHook::AUTH_LOGIN_FORM_AFTER, fn (): string => view('filament.login-footer')->render())
            ->renderHook(PanelsRenderHook::SIDEBAR_FOOTER, fn (): string => view('filament.sidebar-footer')->render())
            // SOS alarm: every admin page of staff who handle safety beeps and
            // raises a browser notification when a new SOS comes in.
            ->renderHook(PanelsRenderHook::BODY_END, fn (): string => (auth('admin')->user()?->canHandleSupport() ?? false)
                ? view('filament.sos-alarm')->render()
                : '')
            ->discoverResources(in: app_path('Filament/Resources'), for: 'App\Filament\Resources')
            ->discoverPages(in: app_path('Filament/Pages'), for: 'App\Filament\Pages')
            ->pages([
                Dashboard::class,
            ])
            // Widgets are auto-discovered from app/Filament/Widgets. Dashboard
            // placement/order is controlled per-widget via $sort + $columnSpan.
            ->discoverWidgets(in: app_path('Filament/Widgets'), for: 'App\Filament\Widgets')
            ->widgets([])
            ->middleware([
                EncryptCookies::class,
                AddQueuedCookiesToResponse::class,
                StartSession::class,
                AuthenticateSession::class,
                ShareErrorsFromSession::class,
                PreventRequestForgery::class,
                SubstituteBindings::class,
                DisableBladeIconComponents::class,
                DispatchServingFilamentEvent::class,
            ])
            // Filament's sign-in check, plus: a disabled staff member is
            // signed out on their next request (also on Livewire calls).
            ->authMiddleware([
                AuthenticateStaff::class,
            ], isPersistent: true);
    }
}
