<?php

namespace App\Http\Requests\Runner;

use Illuminate\Foundation\Http\FormRequest;

class UpdateLocationRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'lat' => ['required', 'numeric', 'between:-90,90'],
            'lng' => ['required', 'numeric', 'between:-180,180'],
            // iOS / Android GPS use -1 to mean "unknown" for heading/speed.
            // We accept any numeric here and sanitize in prepareForValidation
            // so callers don't have to special-case the sentinel value.
            'heading' => ['nullable', 'numeric'],
            'speed' => ['nullable', 'numeric'],
            'accuracy' => ['nullable', 'numeric', 'min:0'],
            // Optional: the runner's app passes the active booking id so
            // the location row is written with booking_id immediately,
            // bypassing the 30s server-side cache lookup that used to
            // leave early-match pings tagged NULL and invisible to the
            // customer's realtime subscription. Validated as a UUID; the
            // controller still verifies the runner actually owns it.
            'booking_id' => ['nullable', 'uuid'],
        ];
    }

    protected function prepareForValidation(): void
    {
        $speed = $this->input('speed');
        $heading = $this->input('heading');
        $accuracy = $this->input('accuracy');
        $this->merge([
            // speed + heading share accuracy's decimal(5,2) ceiling (999.99).
            // Negatives are the iOS/Android "unknown" sentinel; a value ABOVE the
            // ceiling (a garbage/spoofed reading, or heading > 360) would overflow
            // the column and 500 the ping under strict MySQL — dropping the runner
            // off the live map, exactly like the accuracy case below. Null both
            // out-of-range ends so the lat/lng ping still lands. (heading is a
            // 0-360 compass bearing, so anything past 360 is invalid regardless.)
            'speed' => is_numeric($speed) && ($speed < 0 || $speed > 999.99) ? null : $speed,
            'heading' => is_numeric($heading) && ($heading < 0 || $heading > 360) ? null : $heading,
            // accuracy is stored in decimal(5,2) (ceiling 999.99 m). GPS on a
            // weak fix (indoors/tunnels/Wi-Fi) routinely reports 1000-5000 m;
            // inserting that OUT-OF-RANGE value 500s the ping under strict-mode
            // MySQL, dropping the runner off the customer's live map. An accuracy
            // worse than ~1 km carries no useful precision, so null it out — the
            // ping (lat/lng) still succeeds — rather than overflow the column.
            'accuracy' => is_numeric($accuracy) && $accuracy > 999.99 ? null : $accuracy,
        ]);
    }
}
