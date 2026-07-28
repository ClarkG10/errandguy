<x-filament-panels::page>
    @php($account = $this->getAccount())
    <div class="fi-section rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-950/5 dark:bg-gray-900 dark:ring-white/10">
        <dl class="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
                <dt class="text-sm text-gray-500">Name</dt>
                <dd class="mt-1 font-medium text-gray-950 dark:text-white">{{ $account['full_name'] ?? '—' }}</dd>
            </div>
            <div>
                <dt class="text-sm text-gray-500">Email</dt>
                <dd class="mt-1 font-medium text-gray-950 dark:text-white">{{ $account['email'] ?? '—' }}</dd>
            </div>
            <div>
                <dt class="text-sm text-gray-500">Role</dt>
                <dd class="mt-1 font-medium text-gray-950 dark:text-white">{{ $account['role'] ?? '—' }}</dd>
            </div>
        </dl>
        <p class="mt-4 text-sm text-gray-500">
            Use <span class="font-medium">Edit profile</span> or <span class="font-medium">Change password</span> above.
        </p>
    </div>
</x-filament-panels::page>
