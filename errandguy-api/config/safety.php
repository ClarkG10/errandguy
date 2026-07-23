<?php

return [
    /*
    |--------------------------------------------------------------------------
    | Trip-share link TTL (hours)
    |--------------------------------------------------------------------------
    |
    | How long a customer's public "share my trip" link stays resolvable after
    | it is created. This is a privacy backstop: the link also dies the moment
    | the booking reaches a terminal status (completed/cancelled/no_runner) or
    | the customer revokes it. The TTL only bounds links on orphaned or
    | long-running non-terminal bookings so a forwarded URL can't watch a
    | location indefinitely. Generous by design — it should not cut off a
    | legitimately long errand mid-trip.
    |
    */
    'trip_share_ttl_hours' => (int) env('TRIP_SHARE_TTL_HOURS', 24),
];
