{{-- Native <x-filament::section> + inline cell padding. The admin has NO Tailwind
     build, so `px-4 py-3` never resolved — the columns rendered jammed together.
     Inline styles fix the spacing regardless of compiled CSS. --}}
<x-filament-panels::page>
    <x-filament::section>
        <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:.875rem;">
                <thead>
                    <tr style="text-align:left;opacity:.55;border-bottom:1px solid var(--eg-border, rgba(120,120,120,.25));">
                        <th style="padding:.6rem 1rem;font-weight:600;">Method</th>
                        <th style="padding:.6rem 1rem;font-weight:600;">Description</th>
                        <th style="padding:.6rem 1rem;font-weight:600;">Type</th>
                        <th style="padding:.6rem 1rem;font-weight:600;">Status</th>
                    </tr>
                </thead>
                <tbody>
                    @foreach ($this->getCatalog() as $method)
                        <tr style="border-bottom:1px solid var(--eg-border, rgba(120,120,120,.12));">
                            <td style="padding:.7rem 1rem;font-weight:600;white-space:nowrap;">{{ $method['label'] }}</td>
                            <td style="padding:.7rem 1rem;opacity:.7;">{{ $method['description'] }}</td>
                            <td style="padding:.7rem 1rem;opacity:.7;white-space:nowrap;">{{ $method['online'] ? 'Online' : 'Offline' }}</td>
                            <td style="padding:.7rem 1rem;">
                                <x-filament::badge :color="$method['enabled'] ? 'success' : 'gray'">
                                    {{ $method['enabled'] ? 'Enabled' : 'Disabled' }}
                                </x-filament::badge>
                            </td>
                        </tr>
                    @endforeach
                </tbody>
            </table>
        </div>
    </x-filament::section>
</x-filament-panels::page>
