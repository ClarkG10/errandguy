{{--
    SOS alarm for every admin page (panels::body.end render hook; only rendered
    for staff who handle safety — see AdminPanelProvider).

    Polls the open SOS alerts every 15 seconds. When an alert this tab has not
    seen appears, it beeps (repeating every 5 seconds until someone clicks
    "Silence" or opens the alert), shows a red banner, and raises a browser
    notification. Each tab rings once per alert (sessionStorage), so a reload
    does not ring again for the same alert.

    Browsers block sound until the page has been clicked, and ask before
    showing notifications. Until both are allowed, a small "Turn on SOS alarm"
    button sits in the corner; any click on the page also unlocks the sound.

    data-navigate-once: the panel navigates without full reloads (SPA mode), so
    the script must run once per page load, and re-draw its banner after each
    navigation swaps the page body.
--}}
<script data-navigate-once>
(function () {
    if (window.__egSosAlarm) return;
    window.__egSosAlarm = true;

    var FEED = @json(route('admin.sos-alarm', [], false));
    var POLL_MS = 15000;
    var REPEAT_MS = 5000;
    var SEEN_KEY = 'eg_sos_seen';

    var seen = {};
    try { (JSON.parse(sessionStorage.getItem(SEEN_KEY) || '[]') || []).forEach(function (id) { seen[id] = true; }); } catch (e) {}

    var ctx = null;
    var alerts = [];
    var ringing = null;
    var repeatTimer = null;

    function audio() {
        if (!ctx) {
            var Ctor = window.AudioContext || window.webkitAudioContext;
            if (!Ctor) return null;
            try { ctx = new Ctor(); } catch (e) { return null; }
        }
        return ctx;
    }

    function soundReady() {
        var c = audio();
        // No Web Audio in this browser: nothing to unlock, so don't nag.
        return !c || c.state === 'running';
    }

    function notificationsPending() {
        return ('Notification' in window) && Notification.permission === 'default';
    }

    function beep() {
        var c = audio();
        if (!c || c.state !== 'running') return;
        var t = c.currentTime;
        for (var i = 0; i < 6; i++) {
            var osc = c.createOscillator();
            var gain = c.createGain();
            var start = t + i * 0.25;
            osc.type = 'square';
            osc.frequency.value = i % 2 ? 660 : 880;
            gain.gain.setValueAtTime(0.0001, start);
            gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
            osc.connect(gain);
            gain.connect(c.destination);
            osc.start(start);
            osc.stop(start + 0.24);
        }
    }

    function unlock() {
        var c = audio();
        var steps = [];
        if (c && c.state !== 'running') steps.push(c.resume());
        if (notificationsPending()) steps.push(Notification.requestPermission());
        Promise.all(steps).catch(function () {}).then(function () {
            if (ringing) beep();
            render();
        });
    }

    function silence() {
        ringing = null;
        if (repeatTimer) { clearInterval(repeatTimer); repeatTimer = null; }
        render();
    }

    function remember(id) {
        seen[id] = true;
        try { sessionStorage.setItem(SEEN_KEY, JSON.stringify(Object.keys(seen).slice(-200))); } catch (e) {}
    }

    function ring(alert) {
        ringing = alert;
        beep();
        if (repeatTimer) clearInterval(repeatTimer);
        repeatTimer = setInterval(beep, REPEAT_MS);
        if (('Notification' in window) && Notification.permission === 'granted') {
            try {
                var n = new Notification(alert.title, { body: alert.body, tag: 'eg-sos-' + alert.id, requireInteraction: true });
                n.onclick = function () { window.focus(); silence(); window.location.href = alert.url; };
            } catch (e) {}
        }
    }

    function box() {
        var node = document.getElementById('eg-sos-alarm');
        if (!node) {
            node = document.createElement('div');
            node.id = 'eg-sos-alarm';
            node.setAttribute('role', 'alert');
            node.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483000;display:flex;flex-direction:column;gap:8px;max-width:360px;font:500 14px/1.4 Inter,system-ui,sans-serif;';
            document.body.appendChild(node);
        }
        return node;
    }

    function button(label, styles, onClick) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.style.cssText = 'border:0;border-radius:8px;padding:8px 12px;cursor:pointer;font:inherit;' + styles;
        b.addEventListener('click', function (e) { e.preventDefault(); onClick(); });
        return b;
    }

    function render() {
        var node = box();
        node.innerHTML = '';

        if (ringing || alerts.length) {
            var a = ringing || alerts[0];
            var banner = document.createElement('div');
            banner.style.cssText = 'background:#dc2626;color:#fff;border-radius:12px;padding:12px 14px;box-shadow:0 10px 30px rgba(0,0,0,.35);';
            var title = document.createElement('div');
            title.style.cssText = 'font-weight:700;';
            title.textContent = a.title + (alerts.length > 1 ? ' (+' + (alerts.length - 1) + ' more open)' : '');
            var body = document.createElement('div');
            body.style.cssText = 'opacity:.9;margin:2px 0 8px;';
            body.textContent = a.body;
            var row = document.createElement('div');
            row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;';
            row.appendChild(button('Open alert', 'background:#fff;color:#b91c1c;font-weight:700;', function () { silence(); window.location.href = a.url; }));
            if (ringing) row.appendChild(button('Silence', 'background:rgba(255,255,255,.18);color:#fff;', silence));
            banner.appendChild(title);
            banner.appendChild(body);
            banner.appendChild(row);
            node.appendChild(banner);
        }

        if (!soundReady() || notificationsPending()) {
            node.appendChild(button(
                ringing ? 'Click to hear the SOS alarm' : 'Turn on SOS alarm sound',
                'background:#111827;color:#fff;box-shadow:0 6px 20px rgba(0,0,0,.3);align-self:flex-end;',
                unlock
            ));
        }
    }

    function poll() {
        fetch(FEED, { headers: { Accept: 'application/json' }, credentials: 'same-origin', cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (data) {
                if (!data) return;
                alerts = data.alerts || [];
                var fresh = alerts.filter(function (a) { return !seen[a.id]; });
                fresh.forEach(function (a) { remember(a.id); });
                if (fresh.length) ring(fresh[0]);
                if (ringing && !alerts.some(function (a) { return a.id === ringing.id; })) silence();
                render();
            })
            .catch(function () {})
            .then(function () { setTimeout(poll, POLL_MS); });
    }

    // Any click or key press on the page also unlocks the sound.
    ['pointerdown', 'keydown'].forEach(function (type) {
        document.addEventListener(type, function () {
            var c = audio();
            if (c && c.state !== 'running') c.resume().then(render).catch(function () {});
        }, true);
    });
    document.addEventListener('livewire:navigated', render);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) render(); });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { render(); poll(); });
    } else {
        render();
        poll();
    }
})();
</script>
