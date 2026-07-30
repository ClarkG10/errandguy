<?php

namespace App\Providers\Filament;

use Filament\Http\Middleware\Authenticate;
use Filament\Http\Middleware\AuthenticateSession;
use Filament\Http\Middleware\DisableBladeIconComponents;
use Filament\Http\Middleware\DispatchServingFilamentEvent;
use App\Filament\Pages\Dashboard;
use Filament\Navigation\NavigationGroup;
use Filament\Panel;
use Filament\PanelProvider;
use Filament\Enums\ThemeMode;
use Filament\Support\Colors\Color;
use Filament\Support\Enums\Width;
use Filament\Support\Facades\FilamentColor;
use Filament\Support\Icons\Heroicon;
use Filament\View\PanelsRenderHook;
use Illuminate\Cookie\Middleware\AddQueuedCookiesToResponse;
use Illuminate\Cookie\Middleware\EncryptCookies;
use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Routing\Middleware\SubstituteBindings;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\View\Middleware\ShareErrorsFromSession;

class AdminPanelProvider extends PanelProvider
{
    public function panel(Panel $panel): Panel
    {
        // Delivery-orange accent registered as a named colour so it can be used
        // on badges / "attention" states across the panel (Color::hex builds the
        // full 50→950 shade ramp from the single brand hex).
        FilamentColor::register([
            'accent' => Color::hex('#f59e0b'),
        ]);

        return $panel
            ->default()
            ->id('admin')
            ->path('admin')
            // Authenticate against the existing `admin` session guard
            // (config/auth.php -> admins provider -> App\Models\AdminUser).
            ->authGuard('admin')
            ->login()
            ->brandName('ErrandGuy Admin')
            // Mode-adaptive lockup (icon + CSS wordmark) instead of a raster that
            // only reads on one background — see resources/views/filament/brand.
            ->brandLogo(fn (): string => view('filament.brand')->render())
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
            ->authMiddleware([
                Authenticate::class,
            ]);
    }
}
