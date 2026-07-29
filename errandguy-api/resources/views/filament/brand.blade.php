{{-- Mode-adaptive brand lockup for the topbar + login page.
     Uses the transparent running-figure mark (works on light & dark) plus a
     CSS-rendered wordmark so the colour adapts to the active theme instead of
     baking navy text into a raster that vanishes on a dark background. --}}
<span class="eg-brand" role="img" aria-label="ErrandGuy Admin">
    <img src="{{ asset('brand/logo.png') }}" alt="" class="eg-brand__mark" />
    <span class="eg-brand__word"><span class="eg-brand__word-a">Errand</span><span class="eg-brand__word-b">Guy</span></span>
</span>
