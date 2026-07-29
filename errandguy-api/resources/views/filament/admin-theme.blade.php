{{-- ErrandGuy admin theme — injected at panels::head.end so we get a fully
     branded, modern look with NO Vite/Tailwind build step in the deploy
     pipeline. Everything here is additive: it enhances Filament's own
     components and degrades gracefully if a selector ever changes.
     Brand: primary blue #2563EB, delivery-orange accent #EA580C. --}}
<style>
    :root {
        --eg-brand: #2563eb;
        --eg-brand-600: #2563eb;
        --eg-brand-700: #1d4ed8;
        --eg-accent: #ea580c;      /* delivery orange — live/attention accent */
        --eg-navy: #1e3a8a;
        --eg-radius: 0.75rem;
        --eg-ring: 0 0 0 1px rgb(37 99 235 / 0.12);
        --eg-shadow-card: 0 1px 2px rgb(15 23 42 / 0.04), 0 1px 3px rgb(15 23 42 / 0.06);
        --eg-shadow-lift: 0 4px 12px -2px rgb(15 23 42 / 0.10), 0 2px 6px -2px rgb(15 23 42 / 0.08);
    }

    /* Tabular figures everywhere numbers line up in columns — money, counts,
       timers, ratings — so the eye can scan a ledger without jitter. */
    .fi-ta-table,
    .fi-in-entry-value,
    .fi-wi-stats-overview-stat-value,
    .fi-ta-text-item-label {
        font-variant-numeric: tabular-nums;
        font-feature-settings: "tnum" 1, "cv01" 1, "ss01" 1;
    }

    /* ---- Stat / KPI cards: quiet border + soft shadow + hover lift -------- */
    .fi-wi-stats-overview-stat {
        border-radius: var(--eg-radius);
        box-shadow: var(--eg-shadow-card);
        transition: box-shadow .18s ease, transform .18s ease;
    }
    .fi-wi-stats-overview-stat:hover {
        box-shadow: var(--eg-shadow-lift);
        transform: translateY(-1px);
    }
    .fi-wi-stats-overview-stat-value {
        font-weight: 700;
        letter-spacing: -0.01em;
    }

    /* ---- Section cards ---------------------------------------------------- */
    .fi-section {
        border-radius: var(--eg-radius);
    }
    .fi-section-header-heading {
        letter-spacing: -0.01em;
    }

    /* ---- Sidebar: brand-accented active item ------------------------------ */
    .fi-sidebar-item-active > .fi-sidebar-item-button {
        position: relative;
        font-weight: 600;
    }
    .fi-sidebar-item-active > .fi-sidebar-item-button::before {
        content: "";
        position: absolute;
        inset-inline-start: -0.5rem;
        top: 50%;
        transform: translateY(-50%);
        height: 1.15rem;
        width: 3px;
        border-radius: 9999px;
        background: var(--eg-brand);
    }
    .fi-sidebar-group-label {
        text-transform: uppercase;
        letter-spacing: 0.06em;
        font-size: 0.6875rem;
        font-weight: 700;
        opacity: 0.7;
    }

    /* ---- Nav badges: make attention counts pop --------------------------- */
    .fi-sidebar-item-badge {
        font-variant-numeric: tabular-nums;
        font-weight: 700;
    }

    /* ---- Tables: denser rhythm + crisp header (density dial = 8) ---------- */
    .fi-ta-header-cell {
        text-transform: uppercase;
        letter-spacing: 0.04em;
        font-size: 0.6875rem;
    }

    /* ---- Buttons / primary actions: subtle depth ------------------------- */
    .fi-btn {
        transition: box-shadow .15s ease, transform .05s ease;
    }
    .fi-btn:active {
        transform: translateY(0.5px);
    }

    /* ---- Brand lockup (topbar + login) ----------------------------------- */
    .eg-brand {
        display: inline-flex;
        align-items: center;
        gap: 0.55rem;
        line-height: 1;
    }
    .eg-brand__mark {
        height: 2rem;
        width: 2rem;
        object-fit: contain;
        flex: none;
        filter: drop-shadow(0 1px 1px rgb(37 99 235 / 0.25));
    }
    .eg-brand__word {
        font-size: 1.2rem;
        font-weight: 800;
        letter-spacing: -0.02em;
        white-space: nowrap;
    }
    .eg-brand__word-a { color: #1e3a8a; }
    .eg-brand__word-b { color: #2563eb; }
    .dark .eg-brand__word-a { color: #e2e8f0; }
    .dark .eg-brand__word-b { color: #60a5fa; }

    /* ---- Login (simple layout): centred brand + soft gradient canvas ----- */
    .fi-simple-layout {
        background:
            radial-gradient(60rem 60rem at 15% -10%, rgb(37 99 235 / 0.10), transparent 55%),
            radial-gradient(48rem 48rem at 110% 10%, rgb(234 88 12 / 0.08), transparent 50%);
    }
    .dark .fi-simple-layout {
        background:
            radial-gradient(60rem 60rem at 15% -10%, rgb(37 99 235 / 0.18), transparent 55%),
            radial-gradient(48rem 48rem at 110% 10%, rgb(234 88 12 / 0.12), transparent 50%);
    }
    .fi-simple-main {
        box-shadow: var(--eg-shadow-lift);
        border-radius: 1rem;
    }
    .eg-login-tagline {
        margin-top: 0.25rem;
        text-align: center;
        font-size: 0.8125rem;
        color: rgb(100 116 139);
    }
    .dark .eg-login-tagline { color: rgb(148 163 184); }

    /* ---- Sidebar footer signature ---------------------------------------- */
    .eg-sidebar-footer {
        padding: 0.75rem 1rem;
        font-size: 0.6875rem;
        color: rgb(100 116 139);
        border-top: 1px solid rgb(148 163 184 / 0.15);
        display: flex;
        align-items: center;
        gap: 0.4rem;
    }
    .eg-sidebar-footer__dot {
        height: 0.5rem; width: 0.5rem; border-radius: 9999px; flex: none;
        background: #22c55e;
        box-shadow: 0 0 0 3px rgb(34 197 94 / 0.15);
    }
    .dark .eg-sidebar-footer { color: rgb(148 163 184); }

    /* ---- Nicer scrollbars ------------------------------------------------- */
    .fi-sidebar-nav::-webkit-scrollbar,
    .fi-main::-webkit-scrollbar { width: 10px; height: 10px; }
    .fi-sidebar-nav::-webkit-scrollbar-thumb,
    .fi-main::-webkit-scrollbar-thumb {
        background: rgb(148 163 184 / 0.35);
        border-radius: 9999px;
        border: 2px solid transparent;
        background-clip: content-box;
    }
    .fi-sidebar-nav::-webkit-scrollbar-thumb:hover,
    .fi-main::-webkit-scrollbar-thumb:hover { background: rgb(148 163 184 / 0.55); background-clip: content-box; }

    /* ---- Map embeds inside infolists ------------------------------------- */
    .eg-map {
        width: 100%;
        height: 260px;
        border: 0;
        border-radius: var(--eg-radius);
        box-shadow: var(--eg-shadow-card);
    }
    .eg-map-caption {
        margin-top: 0.4rem;
        font-size: 0.75rem;
        color: rgb(100 116 139);
    }
    .dark .eg-map-caption { color: rgb(148 163 184); }

    /* ---- Respect reduced motion ------------------------------------------ */
    @media (prefers-reduced-motion: reduce) {
        .fi-wi-stats-overview-stat,
        .fi-btn { transition: none !important; }
        .fi-wi-stats-overview-stat:hover { transform: none; }
    }
</style>
