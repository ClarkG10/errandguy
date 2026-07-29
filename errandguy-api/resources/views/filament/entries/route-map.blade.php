{{-- Pickup + drop-off maps for a booking, using OpenStreetMap embeds (no API
     key, no external JS — CSP-safe). Falls back gracefully when a leg has no
     coordinates. $getRecord() is injected by Filament's ViewEntry. --}}
@php
    $b = $getRecord();
    $legs = [
        ['Pickup', $b->pickup_lat, $b->pickup_lng, $b->pickup_address],
        ['Drop-off', $b->dropoff_lat, $b->dropoff_lng, $b->dropoff_address],
    ];
    $hasRoute = filled($b->pickup_lat) && filled($b->pickup_lng) && filled($b->dropoff_lat) && filled($b->dropoff_lng);
    $distanceSuffix = filled($b->distance_km) ? ' · '.number_format((float) $b->distance_km, 1).' km' : '';
@endphp

<div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:1rem;">
        @foreach ($legs as $leg)
            @php([$label, $lat, $lng, $addr] = $leg)
            <div>
                <div style="font-size:.6875rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:rgb(100 116 139);margin-bottom:.35rem;">{{ $label }}</div>
                @if (filled($lat) && filled($lng))
                    <iframe class="eg-map" loading="lazy" referrerpolicy="no-referrer"
                        src="https://www.openstreetmap.org/export/embed.html?bbox={{ $lng - 0.006 }},{{ $lat - 0.004 }},{{ $lng + 0.006 }},{{ $lat + 0.004 }}&layer=mapnik&marker={{ $lat }},{{ $lng }}"></iframe>
                    <div class="eg-map-caption">{{ $addr ?: '—' }}</div>
                    <a href="https://www.google.com/maps/search/?api=1&query={{ $lat }},{{ $lng }}" target="_blank" rel="noopener noreferrer"
                       style="font-size:.75rem;font-weight:600;color:#2563eb;">Open in Maps &rarr;</a>
                @else
                    <div class="eg-map" style="display:flex;align-items:center;justify-content:center;color:rgb(100 116 139);font-size:.8125rem;">No coordinates</div>
                    <div class="eg-map-caption">{{ $addr ?: '—' }}</div>
                @endif
            </div>
        @endforeach
    </div>

    @if ($hasRoute)
        <div style="margin-top:.85rem;">
            <a href="https://www.google.com/maps/dir/?api=1&origin={{ $b->pickup_lat }},{{ $b->pickup_lng }}&destination={{ $b->dropoff_lat }},{{ $b->dropoff_lng }}"
               target="_blank" rel="noopener noreferrer"
               style="display:inline-flex;align-items:center;gap:.4rem;font-size:.8125rem;font-weight:600;color:#fff;background:#2563eb;padding:.45rem .85rem;border-radius:.55rem;text-decoration:none;">
                Get directions{{ $distanceSuffix }} &rarr;
            </a>
        </div>
    @endif
</div>
