{{-- Reusable vertical timeline for infolists. Expects $events: array of
     ['label' => string, 'time' => Carbon|string|null, 'note' => ?string,
      'color' => ?string(hex)]. Renders newest-at-bottom chronological rail. --}}
@php($events = collect($events ?? [])->filter(fn ($e) => filled($e['label'] ?? null))->values())

@if ($events->isEmpty())
    <div style="font-size:.8125rem;color:rgb(100 116 139);">No timeline events recorded.</div>
@else
    <ol style="list-style:none;margin:0;padding:0;position:relative;">
        @foreach ($events as $i => $e)
            @php($color = $e['color'] ?? '#2563eb')
            <li style="position:relative;padding:0 0 {{ $loop->last ? '0' : '1.15rem' }} 1.6rem;">
                @unless ($loop->last)
                    <span aria-hidden="true" style="position:absolute;left:.34rem;top:1rem;bottom:0;width:2px;background:rgb(148 163 184 / .3);"></span>
                @endunless
                <span aria-hidden="true" style="position:absolute;left:0;top:.15rem;height:.72rem;width:.72rem;border-radius:9999px;background:{{ $color }};box-shadow:0 0 0 3px {{ $color }}22;"></span>
                <div style="display:flex;flex-wrap:wrap;align-items:baseline;gap:.5rem;">
                    <span style="font-size:.8125rem;font-weight:600;">{{ $e['label'] }}</span>
                    @if (filled($e['time'] ?? null))
                        <span style="font-size:.6875rem;color:rgb(100 116 139);font-variant-numeric:tabular-nums;">
                            {{ $e['time'] instanceof \Illuminate\Support\Carbon ? $e['time']->format('j M Y, g:i A') : $e['time'] }}
                        </span>
                    @endif
                </div>
                @if (filled($e['note'] ?? null))
                    <div style="font-size:.75rem;color:rgb(100 116 139);margin-top:.1rem;">{{ $e['note'] }}</div>
                @endif
            </li>
        @endforeach
    </ol>
@endif
