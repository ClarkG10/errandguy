<x-filament-panels::page>
    <div class="fi-section rounded-xl bg-white shadow-sm ring-1 ring-gray-950/5 dark:bg-gray-900 dark:ring-white/10">
        <table class="w-full text-sm">
            <thead>
                <tr class="border-b border-gray-200 dark:border-white/10 text-left text-gray-500">
                    <th class="px-4 py-3 font-medium">Method</th>
                    <th class="px-4 py-3 font-medium">Description</th>
                    <th class="px-4 py-3 font-medium">Type</th>
                    <th class="px-4 py-3 font-medium">Status</th>
                </tr>
            </thead>
            <tbody>
                @foreach ($this->getCatalog() as $method)
                    <tr class="border-b border-gray-100 dark:border-white/5">
                        <td class="px-4 py-3 font-medium text-gray-950 dark:text-white">{{ $method['label'] }}</td>
                        <td class="px-4 py-3 text-gray-500">{{ $method['description'] }}</td>
                        <td class="px-4 py-3 text-gray-500">{{ $method['online'] ? 'Online' : 'Offline' }}</td>
                        <td class="px-4 py-3">
                            @if ($method['enabled'])
                                <span class="inline-flex items-center rounded-md bg-success-50 px-2 py-1 text-xs font-medium text-success-700 ring-1 ring-success-600/20">Enabled</span>
                            @else
                                <span class="inline-flex items-center rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600 ring-1 ring-gray-500/20">Disabled</span>
                            @endif
                        </td>
                    </tr>
                @endforeach
            </tbody>
        </table>
    </div>
</x-filament-panels::page>
