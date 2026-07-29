{{-- Reusable image gallery for infolists. Expects $images: array of
     ['label' => string, 'url' => string]. Each thumbnail links to the full-size
     original in a new tab (Filament's ImageEntry has no lightbox), so operators
     can actually inspect proof photos / IDs. Degrades to an empty state. --}}
@php($images = collect($images ?? [])->filter(fn ($i) => filled($i['url'] ?? null))->values())

@if ($images->isEmpty())
    <div style="font-size:.8125rem;color:rgb(100 116 139);">No images uploaded.</div>
@else
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:.75rem;">
        @foreach ($images as $img)
            <a href="{{ $img['url'] }}" target="_blank" rel="noopener noreferrer"
               title="{{ $img['label'] ?? 'Open image' }} — open full size"
               style="display:block;text-decoration:none;">
                <span style="display:block;position:relative;aspect-ratio:1;border-radius:.6rem;overflow:hidden;border:1px solid rgb(148 163 184 / .25);background:rgb(148 163 184 / .08);">
                    <img src="{{ $img['url'] }}" alt="{{ $img['label'] ?? '' }}" loading="lazy"
                         style="width:100%;height:100%;object-fit:cover;display:block;" />
                </span>
                @if (!empty($img['label']))
                    <span style="display:block;margin-top:.3rem;font-size:.6875rem;font-weight:600;color:rgb(100 116 139);">{{ $img['label'] }}</span>
                @endif
            </a>
        @endforeach
    </div>
@endif
