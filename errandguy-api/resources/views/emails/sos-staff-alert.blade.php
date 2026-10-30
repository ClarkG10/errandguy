{{--
    Staff email for App\Mail\SosStaffAlert — sent the moment someone presses
    SOS. Inline styles only: mail clients ignore <style> blocks.
--}}
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{ config('app.name', 'ErrandGuy') }} SOS</title>
</head>
<body style="margin:0;padding:24px;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2933;">
<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px;border-top:6px solid #dc2626;">

    <p style="margin:0 0 4px;font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:#dc2626;font-weight:700;">
        SOS — someone needs help
    </p>
    <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;">
        {{ $facts['name'] }} ({{ strtolower($facts['role']) }}) pressed the SOS button
    </h1>

    <table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.5;">
        <tr>
            <td style="padding:6px 0;color:#6b7280;width:120px;vertical-align:top;">Who</td>
            <td style="padding:6px 0;">{{ $facts['name'] }} · {{ $facts['role'] }}</td>
        </tr>
        <tr>
            <td style="padding:6px 0;color:#6b7280;vertical-align:top;">Phone</td>
            <td style="padding:6px 0;">
                @if (filled($facts['phone']))
                    <a href="tel:{{ $facts['phone'] }}" style="color:#1467c8;font-weight:600;">{{ $facts['phone'] }}</a>
                @else
                    No phone number on the account
                @endif
            </td>
        </tr>
        <tr>
            <td style="padding:6px 0;color:#6b7280;vertical-align:top;">Errand</td>
            <td style="padding:6px 0;">{{ $facts['errand'] ?? '—' }}</td>
        </tr>
        <tr>
            <td style="padding:6px 0;color:#6b7280;vertical-align:top;">Where</td>
            <td style="padding:6px 0;">
                @if (filled($facts['map_url']))
                    <a href="{{ $facts['map_url'] }}" style="color:#1467c8;font-weight:600;">Open the map</a><br>
                @endif
                <span style="color:#4b5563;">{{ $facts['location'] }}</span>
                @if (filled($facts['live_url']))
                    <br><a href="{{ $facts['live_url'] }}" style="color:#1467c8;">Live location page</a>
                    <span style="color:#6b7280;">(works for 1 hour)</span>
                @endif
            </td>
        </tr>
        <tr>
            <td style="padding:6px 0;color:#6b7280;vertical-align:top;">When</td>
            <td style="padding:6px 0;">{{ $facts['time'] }}</td>
        </tr>
    </table>

    <p style="margin:20px 0 0;font-size:14px;">
        <a href="{{ $facts['panel_url'] }}" style="display:inline-block;background:#dc2626;color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:8px;font-weight:600;">
            Open the SOS alert
        </a>
    </p>

    <p style="margin:16px 0 0;font-size:14px;line-height:1.6;color:#4b5563;">
        Call them first. The alert page lists their trusted contacts and shows
        who has been texted. The other person on the errand has not been told
        about this alert.
    </p>

    <hr style="border:0;border-top:1px solid #e5e7eb;margin:24px 0 12px;">
    <p style="margin:0;font-size:12px;line-height:1.6;color:#9ca3af;">
        Sent to the addresses in the admin panel setting <code>ops_alert_emails</code>.
    </p>

</div>
</body>
</html>
