{{-- ErrandGuy admin theme — a bold, cohesive modern design injected at
     panels::head.end (NO Vite build step). Dark is the default (hero); light is
     fully styled too. Goals: clear depth, a distinctive branded sidebar with
     obvious active navigation, elevated cards, and premium data surfaces. --}}
<style>
    :root {
        --eg-brand: #1e88ff;
        --eg-brand-2: #0f6fe6;
        --eg-accent: #f59e0b;
        --eg-r-sm: .5rem; --eg-r: .85rem; --eg-r-lg: 1.15rem; --eg-r-xl: 1.4rem;
        --eg-s1: .25rem; --eg-s2: .5rem; --eg-s3: .75rem; --eg-s4: 1rem; --eg-s5: 1.25rem; --eg-s6: 1.5rem; --eg-s8: 2rem;

        /* LIGHT palette (page is tinted so white cards float) */
        --eg-page: #eef2f8;
        --eg-surface: #ffffff;
        --eg-sidebar: #ffffff;
        --eg-border: #e3e9f2;
        --eg-shadow: 0 1px 2px rgb(15 23 42 / .05), 0 2px 8px -2px rgb(15 23 42 / .08);
        --eg-shadow-lg: 0 12px 32px -8px rgb(15 23 42 / .16), 0 4px 12px -4px rgb(15 23 42 / .10);
        --eg-glow: 0 8px 20px -6px rgb(37 99 235 / .5);
    }
    .dark, :root.dark {
        /* DARK palette (default) — layered navy so sidebar / page / cards read distinctly */
        --eg-page: #0a1120;
        --eg-surface: #141d31;
        --eg-sidebar: #0d1526;
        --eg-border: rgb(148 163 184 / .14);
        --eg-shadow: 0 1px 2px rgb(0 0 0 / .4), 0 4px 14px -4px rgb(0 0 0 / .5);
        --eg-shadow-lg: 0 20px 48px -12px rgb(0 0 0 / .7);
        --eg-glow: 0 8px 22px -6px rgb(37 99 235 / .6);
    }

    /* ===== base / depth ================================================== */
    .fi-body { background: var(--eg-page); font-feature-settings: "cv01","ss01"; -webkit-font-smoothing: antialiased; }
    .fi-main { background: var(--eg-page) !important; padding: var(--eg-s6) var(--eg-s6) var(--eg-s8) !important; }
    @media (max-width: 640px) { .fi-main { padding: var(--eg-s4) var(--eg-s4) var(--eg-s6) !important; } }
    .fi-ta-table, .fi-in-entry-value, .fi-wi-stats-overview-stat-value, .fi-ta-text-item-label {
        font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1;
    }

    /* ===== page header =================================================== */
    .fi-page > *, .fi-page-content { row-gap: var(--eg-s6) !important; }
    .fi-header { align-items: center; gap: var(--eg-s4); margin-bottom: var(--eg-s1); }
    .fi-header-heading { line-height: 1.15; letter-spacing: -.025em; font-weight: 800; }
    .fi-header-subheading { margin-top: var(--eg-s1); }

    /* ===== SIDEBAR — the navigation identity ============================= */
    .fi-sidebar, .fi-sidebar-nav { background: var(--eg-sidebar) !important; }
    .fi-sidebar { border-inline-end: 1px solid var(--eg-border); }
    .dark .fi-sidebar { box-shadow: inset -1px 0 0 rgb(255 255 255 / .02); }
    .fi-sidebar-header { border-bottom: 1px solid var(--eg-border); }

    .fi-sidebar-group { margin-bottom: var(--eg-s2); }
    .fi-sidebar-group-label {
        text-transform: uppercase; letter-spacing: .08em; font-size: .66rem; font-weight: 700;
        opacity: .55; padding-inline: var(--eg-s3);
    }
    .fi-sidebar-item { margin: 2px var(--eg-s2); }
    .fi-sidebar-item-button {
        border-radius: var(--eg-r-sm) !important; font-weight: 500; gap: var(--eg-s3);
        transition: background .15s ease, color .15s ease, box-shadow .15s ease;
    }
    .fi-sidebar-item-button:hover { background: rgb(37 99 235 / .09) !important; }
    .dark .fi-sidebar-item-button:hover { background: rgb(96 165 250 / .1) !important; }
    /* ACTIVE = filled brand pill with glow (unmistakable) */
    .fi-sidebar-item-active > .fi-sidebar-item-button,
    .fi-sidebar-item.fi-active > .fi-sidebar-item-button {
        background: linear-gradient(135deg, var(--eg-brand), var(--eg-brand-2)) !important;
        color: #fff !important; font-weight: 600; box-shadow: var(--eg-glow);
    }
    .fi-sidebar-item-active .fi-sidebar-item-icon,
    .fi-sidebar-item.fi-active .fi-sidebar-item-icon,
    .fi-sidebar-item-active .fi-sidebar-item-label,
    .fi-sidebar-item.fi-active .fi-sidebar-item-label { color: #fff !important; }
    .fi-sidebar-item-badge { font-variant-numeric: tabular-nums; font-weight: 700; }

    /* ===== TOPBAR — frosted, elevated =================================== */
    .fi-topbar > nav, .fi-topbar {
        background: color-mix(in srgb, var(--eg-surface) 82%, transparent) !important;
        backdrop-filter: blur(10px); border-bottom: 1px solid var(--eg-border);
        box-shadow: 0 1px 3px rgb(15 23 42 / .04);
    }
    .fi-global-search-field .fi-input-wrp { border-radius: 9999px; }

    /* ===== CARDS / SECTIONS — elevated, rounded ========================= */
    .fi-section, .fi-wi-stats-overview-stat, .fi-ta-ctn, .fi-fo-component-ctn > .fi-section {
        background: var(--eg-surface);
        border: 1px solid var(--eg-border);
        border-radius: var(--eg-r-lg) !important;
        box-shadow: var(--eg-shadow);
    }
    .fi-section-content { padding: var(--eg-s5) var(--eg-s6) !important; }
    .fi-section-header { padding: var(--eg-s5) var(--eg-s6) !important; align-items: center; gap: var(--eg-s3); }
    .fi-section-header-heading { font-weight: 700; letter-spacing: -.01em; }
    /* section icon chip */
    .fi-section-header .fi-icon { color: var(--eg-brand); }

    .fi-grid, .fi-schema, .fi-fo-component-ctn, .fi-in-component-ctn { gap: var(--eg-s5) !important; }

    /* ===== STAT / KPI CARDS — premium ==================================== */
    .fi-wi { gap: var(--eg-s5) !important; align-items: stretch; }
    .fi-wi > * { min-width: 0; }
    .fi-wi-stats-overview-stats-ctn { gap: var(--eg-s5) !important; }
    .fi-wi-stats-overview-stat {
        padding: var(--eg-s5) !important; display: flex; flex-direction: column; gap: var(--eg-s2);
        justify-content: space-between; min-height: 122px; position: relative; overflow: hidden;
        transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease;
    }
    .fi-wi-stats-overview-stat::after {
        content: ""; position: absolute; inset: 0 0 auto 0; height: 3px;
        background: linear-gradient(90deg, var(--eg-brand), var(--eg-accent)); opacity: 0; transition: opacity .18s ease;
    }
    .fi-wi-stats-overview-stat:hover { transform: translateY(-3px); box-shadow: var(--eg-shadow-lg); border-color: rgb(37 99 235 / .35); }
    .fi-wi-stats-overview-stat:hover::after { opacity: 1; }
    .fi-wi-stats-overview-stat-label { font-weight: 600; font-size: .8rem; opacity: .85; }
    .fi-wi-stats-overview-stat-value { font-weight: 800; letter-spacing: -.02em; font-size: 1.75rem; line-height: 1.1; }
    .fi-wi-stats-overview-stat-description { margin-top: auto; font-weight: 500; }
    .fi-wi-chart { display: flex; flex-direction: column; }
    .fi-wi-chart canvas { flex: 1; }

    /* ===== TABLES ======================================================== */
    .fi-ta-header-cell { text-transform: uppercase; letter-spacing: .04em; font-size: .68rem; font-weight: 700; opacity: .7; }
    .fi-ta-header-cell, .fi-ta-cell { padding-top: var(--eg-s3) !important; padding-bottom: var(--eg-s3) !important; }
    .fi-ta-cell { vertical-align: middle; }
    .fi-ta-row { transition: background .12s ease; }
    .fi-ta-row:hover { background: rgb(37 99 235 / .045) !important; }
    .dark .fi-ta-row:hover { background: rgb(96 165 250 / .06) !important; }
    .fi-ta-header-toolbar { padding: var(--eg-s4) var(--eg-s5) !important; gap: var(--eg-s3); align-items: center; }

    /* ===== BUTTONS ======================================================= */
    .fi-btn { border-radius: var(--eg-r-sm); font-weight: 600; align-items: center; gap: var(--eg-s2);
        transition: transform .05s ease, box-shadow .15s ease, filter .15s ease; }
    .fi-btn.fi-color-primary, .fi-btn-color-primary {
        background: linear-gradient(135deg, var(--eg-brand), var(--eg-brand-2)) !important;
        box-shadow: var(--eg-glow); border: 0;
    }
    .fi-btn.fi-color-primary:hover, .fi-btn-color-primary:hover { filter: brightness(1.06); }
    .fi-btn:active { transform: translateY(.5px); }

    /* ===== BADGES / TABS / INPUTS ======================================= */
    .fi-badge { font-weight: 600; border-radius: 9999px; vertical-align: middle; }
    .fi-tabs { gap: var(--eg-s1); padding: var(--eg-s1); background: var(--eg-page); border-radius: var(--eg-r); border: 1px solid var(--eg-border); }
    .fi-tabs-item { border-radius: var(--eg-r-sm) !important; padding: var(--eg-s2) var(--eg-s4) !important; gap: var(--eg-s2); font-weight: 600; }
    .fi-tabs-item-active { background: var(--eg-surface) !important; color: var(--eg-brand) !important; box-shadow: var(--eg-shadow); }
    .fi-input-wrp { border-radius: var(--eg-r-sm); }
    .fi-input-wrp:focus-within { box-shadow: 0 0 0 3px rgb(37 99 235 / .18); border-color: var(--eg-brand); }

    /* ===== INFOLIST entries ============================================= */
    .fi-in-entry-label { margin-bottom: var(--eg-s1); line-height: 1.3; font-weight: 600; opacity: .75; }
    .fi-in-repeatable-item { padding: var(--eg-s4) !important; border-radius: var(--eg-r) !important; }

    /* ===== BRAND lockup (topbar) ======================================== */
    .eg-brand { display: inline-flex; align-items: center; line-height: 1; }
    /* Inline SVG lockup (frosted-parcel mark + custom "ErrandGuy"). Badge is
       self-coloured; wordmark letters are themed here so they read on both grounds. */
    .eg-brand .eg-lockup { height: 2.1rem; width: auto; display: block; filter: drop-shadow(0 2px 5px rgb(15 111 230 / .35)); }
    .eg-lockup .w-a { fill: #0f6fe6; stroke: #0f6fe6; }
    .eg-lockup .w-b { fill: #f59e0b; stroke: #f59e0b; }
    .dark .eg-lockup .w-a { fill: #bad8ff; stroke: #bad8ff; }
    .dark .eg-lockup .w-b { fill: #fbbf24; stroke: #fbbf24; }

    /* ===== SIDEBAR FOOTER =============================================== */
    .eg-sidebar-footer { padding: .75rem 1rem; font-size: .68rem; color: rgb(100 116 139); border-top: 1px solid var(--eg-border); display: flex; align-items: center; gap: .4rem; }
    .eg-sidebar-footer__dot { height: .5rem; width: .5rem; border-radius: 9999px; flex: none; background: #22c55e; box-shadow: 0 0 0 3px rgb(34 197 94 / .18); }
    .dark .eg-sidebar-footer { color: rgb(148 163 184); }

    /* ===== LOGIN — cinematic, branded, dark-first ======================= */
    .fi-simple-layout {
        min-height: 100dvh; background-color: var(--eg-page);
        background-image:
            radial-gradient(42rem 42rem at 12% -8%, rgb(37 99 235 / .18), transparent 55%),
            radial-gradient(38rem 38rem at 112% 8%, rgb(234 88 12 / .12), transparent 52%),
            radial-gradient(rgb(37 99 235 / .06) 1px, transparent 1px);
        background-size: auto, auto, 22px 22px;
    }
    .dark .fi-simple-layout {
        background-color: #060b16;
        background-image:
            radial-gradient(46rem 46rem at 10% -10%, rgb(37 99 235 / .32), transparent 55%),
            radial-gradient(40rem 40rem at 115% 6%, rgb(234 88 12 / .18), transparent 52%),
            radial-gradient(rgb(96 165 250 / .07) 1px, transparent 1px);
        background-size: auto, auto, 24px 24px;
    }
    .fi-simple-main { border-radius: var(--eg-r-xl) !important; padding: 2.25rem 2rem !important; box-shadow: var(--eg-shadow-lg), 0 0 0 1px rgb(37 99 235 / .10); backdrop-filter: blur(6px); }
    .dark .fi-simple-main { background: rgb(17 26 44 / .84) !important; box-shadow: 0 24px 60px -18px rgb(0 0 0 / .7), 0 0 0 1px rgb(96 165 250 / .14); }
    .eg-login-hero { text-align: center; margin: -.25rem 0 1.25rem; }
    .eg-login-mascot { height: 84px; width: auto; margin: 0 auto .5rem; display: block; filter: drop-shadow(0 10px 20px rgb(37 99 235 / .35)); }
    .eg-login-title { margin: 0; font-size: 1.5rem; font-weight: 800; letter-spacing: -.02em; }
    .eg-login-sub { margin: .35rem auto 0; max-width: 22rem; font-size: .82rem; line-height: 1.5; color: rgb(100 116 139); }
    .dark .eg-login-sub { color: rgb(148 163 184); }
    .fi-simple-main .fi-form-actions .fi-btn { width: 100%; justify-content: center; }
    .eg-login-foot { margin-top: 1.25rem; padding-top: 1rem; border-top: 1px solid var(--eg-border); display: flex; align-items: center; justify-content: center; gap: .4rem; font-size: .72rem; color: rgb(100 116 139); }
    .dark .eg-login-foot { color: rgb(148 163 184); }
    .eg-login-foot__lock { display: inline-flex; opacity: .8; }

    /* ===== MAP embeds =================================================== */
    .eg-map { width: 100%; height: 260px; border: 0; border-radius: var(--eg-r); box-shadow: var(--eg-shadow); }
    .eg-map-caption { margin-top: .4rem; font-size: .75rem; color: rgb(100 116 139); }
    .dark .eg-map-caption { color: rgb(148 163 184); }

    /* ===== scrollbars =================================================== */
    .fi-sidebar-nav::-webkit-scrollbar, .fi-main::-webkit-scrollbar { width: 10px; height: 10px; }
    .fi-sidebar-nav::-webkit-scrollbar-thumb, .fi-main::-webkit-scrollbar-thumb {
        background: rgb(148 163 184 / .35); border-radius: 9999px; border: 2px solid transparent; background-clip: content-box;
    }

    /* ===== reduced motion ============================================== */
    @media (prefers-reduced-motion: reduce) {
        .fi-wi-stats-overview-stat, .fi-btn, .fi-ta-row, .fi-sidebar-item-button { transition: none !important; }
        .fi-wi-stats-overview-stat:hover { transform: none; }
    }
</style>
