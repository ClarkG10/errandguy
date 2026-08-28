{{--
    Ops alert email for App\Console\Commands\AdminQueueAlertCommand.
    Plain, table-free-ish HTML with inline styles — mail clients ignore <style>
    blocks and the audience is a single ops mailbox, so readability beats polish.
--}}
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{ config('app.name', 'ErrandGuy') }} ops alert</title>
</head>
<body style="margin:0;padding:24px;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2933;">
<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px;">

    <p style="margin:0 0 4px;font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:#6b7280;">
        {{ config('app.name', 'ErrandGuy') }} operations
    </p>
    <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;">
        {{ count($queues) }} {{ \Illuminate\Support\Str::plural('queue', count($queues)) }} waiting on a human
    </h1>

    <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#4b5563;">
        Each queue below is non-empty and its oldest item has passed that queue's
        service target. Nobody has to be in the admin panel for this to be true —
        that is why this email exists.
    </p>

    @foreach ($queues as $queue)
        <div style="border:1px solid #e5e7eb;border-left:4px solid {{ $queue['key'] === 'sos' ? '#dc2626' : '#d99a0b' }};border-radius:8px;padding:14px 16px;margin:0 0 12px;">
            <p style="margin:0 0 6px;font-size:16px;font-weight:600;">
                {{ $queue['label'] }} — {{ number_format($queue['count']) }} waiting
            </p>
            <p style="margin:0 0 6px;font-size:14px;line-height:1.5;color:#4b5563;">
                {{ $queue['note'] }}
            </p>
            <p style="margin:0;font-size:13px;color:#6b7280;">
                Oldest: {{ $queue['oldest_human'] }} &middot; target: within {{ $queue['threshold_label'] }}
            </p>
        </div>
    @endforeach

    <p style="margin:20px 0 0;font-size:14px;">
        <a href="{{ $panelUrl }}" style="display:inline-block;background:#1467c8;color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:8px;font-weight:600;">
            Open the admin panel
        </a>
    </p>

    <hr style="border:0;border-top:1px solid #e5e7eb;margin:24px 0 12px;">
    <p style="margin:0;font-size:12px;line-height:1.6;color:#9ca3af;">
        Generated {{ $generatedAt }}. Each queue is alerted at most once per throttle
        window (system_config <code>admin_alert_throttle_hours</code>), so this is not
        a per-run repeat. Change the recipient with system_config
        <code>admin_alert_email</code>.
    </p>

</div>
</body>
</html>
