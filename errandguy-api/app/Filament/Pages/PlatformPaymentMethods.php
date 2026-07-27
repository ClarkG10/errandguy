<?php

namespace App\Filament\Pages;

use App\Services\PaymentMethodCatalog;
use App\Support\AdminActivity;
use BackedEnum;
use Filament\Actions\Action;
use Filament\Forms\Components\CheckboxList;
use Filament\Notifications\Notification;
use Filament\Pages\Page;
use Filament\Support\Icons\Heroicon;

/**
 * Toggle which payment methods the customer app offers. Persists to the
 * SystemConfig `enabled_payment_methods` key via PaymentMethodCatalog and
 * busts the derived caches so the app sees the change immediately.
 */
class PlatformPaymentMethods extends Page
{
    protected string $view = 'filament.pages.platform-payment-methods';

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedCreditCard;

    protected static string|\UnitEnum|null $navigationGroup = 'System';

    protected static ?int $navigationSort = 20;

    protected static ?string $title = 'Platform payment methods';

    public static function canAccess(): bool
    {
        return auth('admin')->user()?->canManageMoney() ?? false;
    }

    /** @return array<int, array{type:string,label:string,description:string,online:bool,enabled:bool}> */
    public function getCatalog(): array
    {
        return PaymentMethodCatalog::catalogWithState();
    }

    protected function getHeaderActions(): array
    {
        return [
            Action::make('edit')
                ->label('Edit enabled methods')
                ->icon(Heroicon::OutlinedCog)
                ->schema([
                    CheckboxList::make('methods')
                        ->label('Enabled methods')
                        ->options(collect(PaymentMethodCatalog::CATALOG)
                            ->mapWithKeys(fn ($m) => [$m['type'] => $m['label']])
                            ->all())
                        ->default(PaymentMethodCatalog::enabledTypes())
                        ->helperText('At least one method must stay enabled (enforced server-side).')
                        ->columns(1),
                ])
                ->action(function (array $data): void {
                    $saved = PaymentMethodCatalog::setEnabled(
                        $data['methods'] ?? [],
                        auth('admin')->id(),
                    );
                    AdminActivity::log('payment_methods.updated', null, ['enabled' => $saved]);
                    Notification::make()->title('Payment methods updated')->success()->send();
                }),
        ];
    }
}
