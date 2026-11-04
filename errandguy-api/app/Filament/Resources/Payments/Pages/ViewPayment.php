<?php

namespace App\Filament\Resources\Payments\Pages;

use App\Filament\Resources\Payments\PaymentResource;
use App\Filament\Resources\Payments\Tables\PaymentsTable;
use Filament\Resources\Pages\ViewRecord;

class ViewPayment extends ViewRecord
{
    protected static string $resource = PaymentResource::class;

    /** Refund from the payment's own page — the same action as the list row. */
    protected function getHeaderActions(): array
    {
        return [PaymentsTable::refundAction()];
    }
}
