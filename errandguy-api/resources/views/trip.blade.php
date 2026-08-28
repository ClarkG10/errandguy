{{--
    PUBLIC TRIP PAGE — the destination of the "share my trip" link and of the
    SOS live link. The recipient is typically a family member on a cheap phone
    on mobile data, in a hurry, possibly during an emergency. So:

      * everything is inline — no external CSS/JS/font/tile requests at all
        (also means nothing third-party learns the token or the viewer's IP);
      * the first paint is fully server-rendered, so the page is useful with
        JavaScript off (a <noscript> meta refresh keeps it fresh);
      * with JS on it re-polls the SAME public JSON endpoint every 10s and
        re-renders in place, pausing while the tab is hidden and backing off
        on errors;
      * noindex + no-referrer so the tokenised URL never leaks to a search
        engine or via the Referer header of the "Open in Maps" links.

    It renders ONLY $trip, which is PublicTripController's sanitized payload
    (short runner name, vehicle, status, coordinates) — never the customer,
    contact numbers, or money.
--}}
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <meta name="referrer" content="no-referrer">
    <title>{{ $trip ? 'Live trip · ErrandGuy' : 'Trip ended · ErrandGuy' }}</title>
    @if ($trip && ! $trip['is_ended'])
        {{-- No-JS fallback: refresh the whole page instead of polling. --}}
        <noscript><meta http-equiv="refresh" content="30"></noscript>
    @endif
    <style>
        :root {
            --bg: #F8FAFC; --card: #FFFFFF; --text: #0F172A; --muted: #64748B;
            --border: #E2E8F0; --line: #CBD5E1; --primary: #2563EB;
            --primary-soft: #EFF6FF; --ok: #16A34A; --danger: #DC2626;
            --danger-soft: #FEF2F2; --gold: #F59E0B;
        }
        @media (prefers-color-scheme: dark) {
            :root {
                --bg: #0B1220; --card: #111A2B; --text: #E7EDF6; --muted: #94A3B8;
                --border: #1F2A3C; --line: #2C3A50; --primary: #60A5FA;
                --primary-soft: #16233A; --ok: #34D399; --danger: #F87171;
                --danger-soft: #2A1618; --gold: #FBBF24;
            }
        }
        * { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; }
        body {
            background: var(--bg); color: var(--text);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 15px; line-height: 1.45;
            -webkit-text-size-adjust: 100%;
        }
        .wrap { max-width: 480px; margin: 0 auto; padding: 16px 16px 40px; }
        .brand {
            display: flex; align-items: center; gap: 8px;
            font-weight: 700; font-size: 15px; letter-spacing: -0.01em;
            padding: 4px 0 14px;
        }
        .brand .b1 { color: var(--primary); }
        .brand .b2 { color: var(--gold); }
        .card {
            background: var(--card); border: 1px solid var(--border);
            border-radius: 16px; padding: 18px 16px; margin-bottom: 12px;
        }
        .livebar {
            display: flex; align-items: center; gap: 7px;
            font-size: 12px; color: var(--muted); margin-bottom: 10px;
        }
        .dot {
            width: 8px; height: 8px; border-radius: 50%;
            background: var(--ok); flex: 0 0 auto;
            animation: pulse 1.8s ease-in-out infinite;
        }
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .25; } }
        @media (prefers-reduced-motion: reduce) { .dot { animation: none; } }
        h1 { font-size: 21px; line-height: 1.25; margin: 0 0 6px; letter-spacing: -0.02em; }
        .eta { margin: 0; font-size: 14px; color: var(--muted); }
        .eta strong { color: var(--text); }
        .runner {
            display: flex; align-items: center; gap: 12px;
            margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border);
        }
        .avatar {
            width: 42px; height: 42px; border-radius: 50%; flex: 0 0 auto;
            background: var(--primary-soft); color: var(--primary);
            display: flex; align-items: center; justify-content: center;
            font-weight: 700; font-size: 17px;
        }
        .runner .who { min-width: 0; }
        .runner .nm { font-weight: 600; }
        .runner .sub { font-size: 13px; color: var(--muted); }
        ol.ladder { list-style: none; margin: 18px 0 0; padding: 0; }
        ol.ladder li {
            position: relative; display: flex; align-items: flex-start; gap: 12px;
            padding-bottom: 14px; font-size: 14px; color: var(--muted);
        }
        ol.ladder li:last-child { padding-bottom: 0; }
        ol.ladder li::before {
            content: ""; position: absolute; left: 6px; top: 16px; bottom: 0;
            width: 2px; background: var(--line);
        }
        ol.ladder li:last-child::before { display: none; }
        ol.ladder li.done::before { background: var(--primary); }
        .mark {
            position: relative; z-index: 1; flex: 0 0 auto;
            width: 14px; height: 14px; border-radius: 50%; margin-top: 3px;
            background: var(--bg); border: 2px solid var(--line);
        }
        li.done .mark { background: var(--primary); border-color: var(--primary); }
        li.current .mark {
            background: var(--card); border-color: var(--primary);
            box-shadow: 0 0 0 4px var(--primary-soft);
        }
        li.current { color: var(--text); font-weight: 600; }
        li.done { color: var(--text); }
        .rows { margin-top: 4px; }
        .row {
            display: flex; gap: 10px; padding: 11px 0;
            border-top: 1px solid var(--border); font-size: 14px;
        }
        .row .k { flex: 0 0 78px; color: var(--muted); font-size: 13px; }
        .row .v { min-width: 0; word-break: break-word; }
        a { color: var(--primary); }
        a.maps {
            display: inline-block; margin-top: 4px; font-size: 13px;
            text-decoration: none; font-weight: 600;
        }
        .banner {
            border-radius: 14px; padding: 12px 14px; margin-bottom: 12px;
            font-size: 14px; border: 1px solid transparent;
        }
        .banner.sos {
            background: var(--danger-soft); border-color: var(--danger);
            color: var(--danger); font-weight: 600;
        }
        .banner.closed {
            background: var(--card); border-color: var(--border); color: var(--muted);
        }
        .note { font-size: 12px; color: var(--muted); margin: 14px 2px 0; }
        .hidden { display: none !important; }
        .empty { text-align: center; padding: 34px 18px; }
        .empty .ic {
            width: 52px; height: 52px; border-radius: 50%; margin: 0 auto 14px;
            background: var(--primary-soft); color: var(--primary);
            display: flex; align-items: center; justify-content: center; font-size: 24px;
        }
        .empty h1 { font-size: 19px; }
        .empty p { color: var(--muted); font-size: 14px; margin: 0; }
    </style>
</head>
<body>
@php
    /**
     * Age formatter, mirrored by fmtAge() in the script below so the no-JS
     * first paint and the polled updates read identically.
     */
    $fmtAge = function ($s) {
        if ($s === null) { return 'waiting for GPS'; }
        if ($s < 15) { return 'just now'; }
        if ($s < 60) { return $s . 's ago'; }
        if ($s < 3600) { return intdiv($s, 60) . ' min ago'; }
        return intdiv($s, 3600) . ' h ago';
    };
@endphp
{{-- The token and the "keep polling?" flag ride on data-attributes rather than
     being interpolated into the script, so no request-derived value is ever
     written into a JS literal. --}}
<div class="wrap" id="root"
     data-token="{{ $token }}"
     data-live="{{ $trip && ! $trip['is_ended'] ? '1' : '0' }}">
    <div class="brand"><span class="b1">Errand</span><span class="b2">Guy</span></div>

    @if (! $trip)
        {{-- Link revoked, expired, or the errand is over. Deliberately NOT a
             404: the recipient did nothing wrong and deserves a sentence they
             can understand. Carries no trip data, so it is not an oracle for
             whether the token ever existed. --}}
        <div class="card empty">
            <div class="ic">&#10003;</div>
            <h1>This trip has ended</h1>
            <p>The live link is no longer active. Trip links stop working once the
               errand finishes, when the sender stops sharing, or after they expire.</p>
        </div>
        <p class="note">If you still need to reach the person who shared this, contact them directly.</p>
    @else
        @php
            $runner = $trip['runner'];
            $loc = $trip['runner_location'];
            $eta = $trip['eta'];
            $initial = $runner ? mb_strtoupper(mb_substr($runner['name'], 0, 1)) : '?';
        @endphp

        {{-- SOS banner only when the TOKEN itself was an emergency live link. --}}
        <div id="sosBanner" class="banner sos{{ $trip['sos_active'] ? '' : ' hidden' }}">
            Emergency alert active &mdash; this person triggered SOS in the ErrandGuy app.
            Their live location is below. Call them, and local emergency services if needed.
        </div>

        <div id="closedNote" class="banner closed{{ $trip['is_ended'] ? '' : ' hidden' }}">
            This errand has ended. You are seeing the final status.
        </div>

        <div class="card">
            <div id="liveBar" class="livebar {{ $trip['is_ended'] ? 'hidden' : '' }}">
                <span class="dot"></span>
                <span>Live &middot; location updated <span id="updated">{{ $fmtAge($loc['age_seconds'] ?? null) }}</span></span>
            </div>

            <h1 id="statusLabel">{{ $trip['status_label'] }}</h1>

            <p id="eta" class="eta {{ $eta ? '' : 'hidden' }}">
                @if ($eta)
                    About <strong>{{ $eta['minutes'] }} min</strong> from the
                    {{ $eta['target'] === 'dropoff' ? 'drop-off' : 'pick-up' }} point
                    &middot; {{ $eta['distance_km'] }} km away
                @endif
            </p>
            <p id="etaFallback" class="eta {{ $eta ? 'hidden' : '' }}">
                {{ $trip['errand_type_name'] ? $trip['errand_type_name'] . ' errand' : 'Errand' }} in progress.
            </p>

            <div id="runnerBlock" class="runner {{ $runner ? '' : 'hidden' }}">
                <div id="avatar" class="avatar">{{ $initial }}</div>
                <div class="who">
                    <div id="runnerName" class="nm">{{ $runner['name'] ?? '' }}</div>
                    <div id="runnerSub" class="sub">
                        @if ($runner)
                            {{ collect([
                                $runner['vehicle_type'] ? ucfirst(str_replace('_', ' ', $runner['vehicle_type'])) : null,
                                $runner['plate_number'] ?: null,
                                ((float) $runner['rating']) > 0 ? '★ ' . number_format((float) $runner['rating'], 1) : null,
                            ])->filter()->implode(' · ') ?: 'Your runner' }}
                        @endif
                    </div>
                </div>
            </div>

            <ol id="ladder" class="ladder">
                @foreach ($trip['status_steps'] as $step)
                    <li class="{{ $step['state'] }}">
                        <span class="mark" aria-hidden="true"></span>
                        <span class="lab">{{ $step['label'] }}</span>
                    </li>
                @endforeach
            </ol>
        </div>

        <div class="card rows">
            @if ($trip['pickup_address'])
                <div class="row" style="border-top: none;">
                    <div class="k">Pick-up</div>
                    <div class="v">{{ $trip['pickup_address'] }}</div>
                </div>
            @endif
            @if ($trip['dropoff_address'])
                <div class="row">
                    <div class="k">Drop-off</div>
                    <div class="v">{{ $trip['dropoff_address'] }}</div>
                </div>
            @endif
            <div id="posRow" class="row {{ $loc ? '' : 'hidden' }}">
                <div class="k">Runner now</div>
                <div class="v">
                    <span id="posCoords">{{ $loc ? number_format((float) $loc['lat'], 5) . ', ' . number_format((float) $loc['lng'], 5) : '' }}</span>
                    <br>
                    <a id="posMaps" class="maps" rel="noreferrer noopener" target="_blank"
                       href="{{ $loc ? 'https://www.google.com/maps/search/?api=1&query=' . $loc['lat'] . ',' . $loc['lng'] : '#' }}">Open in Maps &rarr;</a>
                </div>
            </div>
            <div id="noPosRow" class="row {{ $loc ? 'hidden' : '' }}">
                <div class="k">Runner now</div>
                <div class="v" style="color: var(--muted);">Waiting for the runner&rsquo;s first GPS update&hellip;</div>
            </div>
        </div>

        <p class="note">
            This page updates by itself. It was shared with you from the ErrandGuy app and
            stops working when the errand ends &mdash; there is nothing to install and nothing to reply to here.
        </p>
    @endif
</div>

<script>
(function () {
    var root = document.getElementById('root');
    if (!root || root.getAttribute('data-live') !== '1') { return; }

    var url = '/api/v1/trip/' + encodeURIComponent(root.getAttribute('data-token') || '');
    var BASE = 10000, MAXD = 60000;
    var delay = BASE, timer = null, stopped = false;

    function el(id) { return document.getElementById(id); }
    function show(node, on) { if (node) { node.classList[on ? 'remove' : 'add']('hidden'); } }

    // Mirror of the $fmtAge closure in the Blade above.
    function fmtAge(s) {
        if (s === null || s === undefined) { return 'waiting for GPS'; }
        if (s < 15) { return 'just now'; }
        if (s < 60) { return s + 's ago'; }
        if (s < 3600) { return Math.floor(s / 60) + ' min ago'; }
        return Math.floor(s / 3600) + ' h ago';
    }

    function stopLive(message) {
        stopped = true;
        clearTimeout(timer);
        show(el('liveBar'), false);
        var note = el('closedNote');
        if (note) {
            if (message) { note.textContent = message; }
            show(note, true);
        }
    }

    function renderLadder(steps) {
        var ol = el('ladder');
        if (!ol || !steps || !steps.length) { return; }
        ol.innerHTML = '';
        for (var i = 0; i < steps.length; i++) {
            var li = document.createElement('li');
            li.className = steps[i].state || 'upcoming';
            var mark = document.createElement('span');
            mark.className = 'mark';
            mark.setAttribute('aria-hidden', 'true');
            var lab = document.createElement('span');
            lab.className = 'lab';
            // textContent, never innerHTML — labels are ours but addresses and
            // names below are user-authored, so the whole renderer stays safe.
            lab.textContent = steps[i].label || '';
            li.appendChild(mark);
            li.appendChild(lab);
            ol.appendChild(li);
        }
    }

    function render(d) {
        if (d.status_label) { el('statusLabel').textContent = d.status_label; }
        renderLadder(d.status_steps);

        var eta = el('eta'), etaFb = el('etaFallback');
        if (d.eta) {
            eta.textContent = 'About ' + d.eta.minutes + ' min from the '
                + (d.eta.target === 'dropoff' ? 'drop-off' : 'pick-up') + ' point · '
                + d.eta.distance_km + ' km away';
            show(eta, true); show(etaFb, false);
        } else {
            show(eta, false); show(etaFb, true);
        }

        if (d.runner && d.runner.name) {
            el('runnerName').textContent = d.runner.name;
            el('avatar').textContent = d.runner.name.charAt(0).toUpperCase();
            var bits = [];
            if (d.runner.vehicle_type) {
                var v = String(d.runner.vehicle_type).replace(/_/g, ' ');
                bits.push(v.charAt(0).toUpperCase() + v.slice(1));
            }
            if (d.runner.plate_number) { bits.push(d.runner.plate_number); }
            if (Number(d.runner.rating) > 0) { bits.push('★ ' + Number(d.runner.rating).toFixed(1)); }
            el('runnerSub').textContent = bits.join(' · ') || 'Your runner';
            show(el('runnerBlock'), true);
        } else {
            show(el('runnerBlock'), false);
        }

        var loc = d.runner_location;
        if (loc) {
            el('updated').textContent = fmtAge(loc.age_seconds);
            el('posCoords').textContent = Number(loc.lat).toFixed(5) + ', ' + Number(loc.lng).toFixed(5);
            el('posMaps').setAttribute(
                'href',
                'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(loc.lat + ',' + loc.lng)
            );
            show(el('posRow'), true); show(el('noPosRow'), false);
        } else {
            el('updated').textContent = fmtAge(null);
            show(el('posRow'), false); show(el('noPosRow'), true);
        }

        show(el('sosBanner'), !!d.sos_active);
    }

    function schedule(ms) {
        clearTimeout(timer);
        if (!stopped) { timer = setTimeout(tick, ms); }
    }

    function tick() {
        if (stopped) { return; }
        // Don't burn the viewer's data (or the public throttle) on a hidden tab.
        if (document.hidden) { schedule(BASE); return; }

        fetch(url, { headers: { 'Accept': 'application/json' }, cache: 'no-store' })
            .then(function (r) {
                if (r.status === 404) {
                    stopLive('This trip link is no longer active.');
                    return null;
                }
                if (!r.ok) { throw new Error('http ' + r.status); }
                return r.json();
            })
            .then(function (j) {
                if (!j || !j.data) { return; }
                delay = BASE;
                render(j.data);
                if (j.data.is_ended) {
                    stopLive('This errand has ended. You are seeing the final status.');
                    return;
                }
                schedule(delay);
            })
            .catch(function () {
                // Offline / throttled: keep the last known state on screen and
                // back off instead of blanking the page.
                delay = Math.min(delay * 2, MAXD);
                schedule(delay);
            });
    }

    document.addEventListener('visibilitychange', function () {
        if (!document.hidden && !stopped) { delay = BASE; schedule(500); }
    });

    schedule(BASE);
})();
</script>
</body>
</html>
