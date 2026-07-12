<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Payment Receipt</title>
    <style>
        * { box-sizing: border-box; }
        body {
            font-family: 'DejaVu Sans', sans-serif;
            color: #1f2937;
            font-size: 12px;
            margin: 0;
            padding: 32px 36px;
        }
        .brand-header {
            border-bottom: 3px solid #16a34a;
            padding-bottom: 12px;
            margin-bottom: 24px;
        }
        .brand-header .logo { font-size: 24px; font-weight: bold; color: #16a34a; }
        .brand-header .doc-title { font-size: 14px; color: #6b7280; margin-top: 2px; }
        .status {
            display: inline-block;
            padding: 3px 10px;
            border-radius: 12px;
            font-size: 10px;
            font-weight: bold;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .status.paid { background: #dcfce7; color: #15803d; }
        .status.other { background: #f3f4f6; color: #6b7280; }
        .amount-box {
            text-align: center;
            background: #f0fdf4;
            border: 1px solid #dcfce7;
            padding: 20px;
            margin: 20px 0;
        }
        .amount-box .val { font-size: 30px; font-weight: bold; color: #15803d; }
        .amount-box .lbl { font-size: 10px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; }
        table.detail { width: 100%; border-collapse: collapse; margin-top: 12px; }
        table.detail td { padding: 9px 4px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
        table.detail td.k { color: #6b7280; width: 40%; }
        table.detail td.v { font-weight: bold; text-align: right; }
        .footer {
            margin-top: 28px;
            padding-top: 12px;
            border-top: 1px solid #e5e7eb;
            color: #9ca3af;
            font-size: 10px;
            text-align: center;
        }
    </style>
</head>
<body>
    <div class="brand-header">
        <div class="logo">ErrandGuy</div>
        <div class="doc-title">Payment Receipt</div>
    </div>

    @php $isPaid = in_array($payment->status, ['paid', 'completed', 'succeeded']); @endphp
    <div>
        <span class="status {{ $isPaid ? 'paid' : 'other' }}">{{ $payment->status }}</span>
    </div>

    <div class="amount-box">
        <div class="val">&#8369;{{ number_format((float) $payment->amount, 2) }}</div>
        <div class="lbl">{{ $payment->currency ?? 'PHP' }} &middot; {{ ucfirst(str_replace('_', ' ', (string) $payment->method)) }}</div>
    </div>

    <table class="detail">
        <tr>
            <td class="k">Receipt ID</td>
            <td class="v">{{ $payment->id }}</td>
        </tr>
        <tr>
            <td class="k">Booking #</td>
            <td class="v">{{ $booking['booking_number'] ?? '—' }}</td>
        </tr>
        <tr>
            <td class="k">Errand Type</td>
            <td class="v">{{ $booking['errand_type'] ?? '—' }}</td>
        </tr>
        <tr>
            <td class="k">Pickup</td>
            <td class="v">{{ $booking['pickup_address'] ?? '—' }}</td>
        </tr>
        <tr>
            <td class="k">Dropoff</td>
            <td class="v">{{ $booking['dropoff_address'] ?? '—' }}</td>
        </tr>
        <tr>
            <td class="k">Runner</td>
            <td class="v">{{ $booking['runner_name'] ?? '—' }}</td>
        </tr>
        <tr>
            <td class="k">Paid at</td>
            <td class="v">{{ $payment->paid_at ? \Carbon\Carbon::parse($payment->paid_at)->format('M j, Y g:i A') : '—' }}</td>
        </tr>
        @if($payment->refund_amount)
        <tr>
            <td class="k">Refunded</td>
            <td class="v">&#8369;{{ number_format((float) $payment->refund_amount, 2) }}
                @if($payment->refunded_at)({{ \Carbon\Carbon::parse($payment->refunded_at)->format('M j, Y') }})@endif
            </td>
        </tr>
        @endif
    </table>

    <div class="footer">
        Generated {{ \Carbon\Carbon::parse($generated_at)->format('M j, Y g:i A') }} &middot;
        Thank you for using ErrandGuy.
    </div>
</body>
</html>
