{{-- Uses Filament's native <x-filament::section> (styled by Filament's shipped
     CSS) + inline styles for layout. The admin has NO Tailwind build step, so
     utility classes like grid-cols-3/px-4 do NOT resolve — inline styles do. --}}
<x-filament-panels::page>
    @php($account = $this->getAccount())
    <x-filament::section>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1.25rem;">
            <div>
                <div style="font-size:.78rem;letter-spacing:.02em;text-transform:uppercase;opacity:.55;">Name</div>
                <div style="font-weight:600;margin-top:.35rem;">{{ $account['full_name'] ?? '—' }}</div>
            </div>
            <div>
                <div style="font-size:.78rem;letter-spacing:.02em;text-transform:uppercase;opacity:.55;">Email</div>
                <div style="font-weight:600;margin-top:.35rem;">{{ $account['email'] ?? '—' }}</div>
            </div>
            <div>
                <div style="font-size:.78rem;letter-spacing:.02em;text-transform:uppercase;opacity:.55;">Role</div>
                <div style="font-weight:600;margin-top:.35rem;">{{ $account['role'] ?? '—' }}</div>
            </div>
        </div>
        <p style="margin-top:1.25rem;font-size:.875rem;opacity:.6;">
            Use <strong>Edit profile</strong> or <strong>Change password</strong> (top right) to make changes.
        </p>
    </x-filament::section>
</x-filament-panels::page>
