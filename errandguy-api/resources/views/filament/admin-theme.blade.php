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

    /* ======================================================================
       LAYOUT · SPACING · ALIGNMENT — one rhythm across every page
       Scale: 4 / 8 / 12 / 16 / 20 / 24px. Everything below snaps to it so
       padding, margins and gaps are consistent dashboard → tables → forms.
       ====================================================================== */
    :root {
        --eg-s1: .25rem;  --eg-s2: .5rem;   --eg-s3: .75rem;
        --eg-s4: 1rem;    --eg-s5: 1.25rem; --eg-s6: 1.5rem;  --eg-s8: 2rem;
    }

    /* Comfortable, consistent page gutter + vertical rhythm between blocks. */
    .fi-main { padding: var(--eg-s6) var(--eg-s6) var(--eg-s8) !important; }
    @media (max-width: 640px) { .fi-main { padding: var(--eg-s4) var(--eg-s4) var(--eg-s6) !important; } }
    .fi-page > .fi-page-content,
    .fi-page .fi-page-content { row-gap: var(--eg-s6) !important; }

    /* Page header: heading + actions vertically aligned, tidy gap below. */
    .fi-header { align-items: center; gap: var(--eg-s4); margin-bottom: var(--eg-s2); }
    .fi-header-heading { line-height: 1.2; letter-spacing: -.02em; }
    .fi-header-subheading { margin-top: var(--eg-s1); }

    /* ---- Cards / sections: identical padding + internal rhythm ----------- */
    .fi-section { overflow: hidden; }
    .fi-section-content { padding: var(--eg-s5) var(--eg-s6) !important; }
    .fi-section-header { padding: var(--eg-s5) var(--eg-s6) !important; align-items: center; gap: var(--eg-s3); }
    /* section that has BOTH header and content: no double top padding */
    .fi-section-header + .fi-section-content-ctn .fi-section-content { padding-top: var(--eg-s2) !important; }

    /* ---- Grids: uniform gap so columns line up on every schema ----------- */
    .fi-grid { gap: var(--eg-s5) !important; }
    .fi-schema, .fi-fo-component-ctn, .fi-in-component-ctn { gap: var(--eg-s5) !important; }

    /* ---- Dashboard widget grid: equal gaps + equal-height cards ---------- */
    .fi-wi { gap: var(--eg-s5) !important; align-items: stretch; }
    .fi-wi > * { min-width: 0; }               /* prevent chart overflow blowing out columns */
    .fi-wi-stats-overview-stats-ctn { gap: var(--eg-s5) !important; }
    .fi-wi-stats-overview-stat {
        padding: var(--eg-s5) !important;
        display: flex; flex-direction: column; justify-content: space-between; gap: var(--eg-s2);
        min-height: 118px;                      /* uniform height whether or not a stat has a sparkline */
    }
    .fi-wi-stats-overview-stat-label { font-weight: 600; }
    .fi-wi-stats-overview-stat-description { margin-top: auto; }
    /* keep charts from stretching cards unevenly */
    .fi-wi-chart { display: flex; flex-direction: column; }
    .fi-wi-chart canvas { flex: 1; }

    /* ---- Infolist entries: label + value aligned on a tidy stack --------- */
    .fi-in-entry { align-content: start; }
    .fi-in-entry-label { margin-bottom: var(--eg-s1); line-height: 1.3; }
    .fi-in-entry .fi-in-entry-value, .fi-in-entry-value-ctn { line-height: 1.45; }
    /* repeatable rows (timeline logs, docs) get even vertical spacing */
    .fi-in-repeatable-item { padding: var(--eg-s4) !important; }
    .fi-in-repeatable > *, .fi-in-repeatable-items { gap: var(--eg-s3) !important; }

    /* ---- Tabs: even padding, aligned icons/labels ------------------------ */
    .fi-tabs { gap: var(--eg-s1); padding: var(--eg-s1); }
    .fi-tabs-item { padding: var(--eg-s2) var(--eg-s4) !important; gap: var(--eg-s2); border-radius: 8px; }
    /* space between the tab strip and the panel below it */
    .fi-tabs + * { margin-top: var(--eg-s5); }

    /* ---- Tables: consistent cell rhythm, middle-aligned, tidy header ----- */
    .fi-ta-header-cell, .fi-ta-cell { padding-top: var(--eg-s3) !important; padding-bottom: var(--eg-s3) !important; }
    .fi-ta-cell { vertical-align: middle; }
    .fi-ta-header-cell-label { line-height: 1.2; }
    .fi-ta-row > .fi-ta-cell:first-child { padding-left: var(--eg-s6) !important; }
    .fi-ta-row > .fi-ta-cell:last-child { padding-right: var(--eg-s6) !important; }
    .fi-ta-header-row > .fi-ta-header-cell:first-child { padding-left: var(--eg-s6) !important; }
    /* toolbar (search / filters / header actions) breathes + aligns */
    .fi-ta-header-toolbar { padding: var(--eg-s4) var(--eg-s6) !important; gap: var(--eg-s3); align-items: center; }
    .fi-ta-actions { gap: var(--eg-s2) !important; justify-content: flex-end; }

    /* ---- Forms: even field spacing --------------------------------------- */
    .fi-fo-field-wrp-label { margin-bottom: var(--eg-s1); }

    /* ---- Modals: consistent inner padding -------------------------------- */
    .fi-modal-content { gap: var(--eg-s4); }

    /* ---- Badges / buttons vertical alignment ----------------------------- */
    .fi-badge { vertical-align: middle; }
    .fi-btn { align-items: center; gap: var(--eg-s2); }

    /* ---- Custom entry views (gallery/timeline/map) share the card rhythm - */
    .eg-map { margin: 0; }

    /* ---- Respect reduced motion ------------------------------------------ */
    @media (prefers-reduced-motion: reduce) {
        .fi-wi-stats-overview-stat,
        .fi-btn { transition: none !important; }
        .fi-wi-stats-overview-stat:hover { transform: none; }
    }
</style>
