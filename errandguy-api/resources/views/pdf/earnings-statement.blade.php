<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Earnings Statement</title>
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
        .brand-header .logo {
            font-size: 24px;
            font-weight: bold;
            color: #16a34a;
        }
        .brand-header .doc-title {
            font-size: 14px;
            color: #6b7280;
            margin-top: 2px;
        }
        .meta-row { width: 100%; margin-bottom: 20px; }
        .meta-row td { vertical-align: top; padding: 2px 0; }
        .meta-label { color: #6b7280; width: 120px; }
        .meta-value { font-weight: bold; }
        .summary {
            width: 100%;
            margin-bottom: 24px;
            border-collapse: collapse;
        }
        .summary td {
            width: 33.33%;
            padding: 14px;
            background: #f0fdf4;
            border: 1px solid #dcfce7;
            text-align: center;
        }
        .summary .val { font-size: 18px; font-weight: bold; color: #15803d; }
        .summary .lbl { font-size: 10px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px; }
        table.items { width: 100%; border-collapse: collapse; margin-top: 8px; }
        table.items th {
            background: #16a34a;
            color: #fff;
            text-align: left;
            padding: 8px 10px;
            font-size: 11px;
        }
        table.items td { padding: 7px 10px; border-bottom: 1px solid #e5e7eb; }
        table.items tr:nth-child(even) td { background: #f9fafb; }
        .num { text-align: right; }
        .totals td { font-weight: bold; border-top: 2px solid #16a34a; }
        .footer {
            margin-top: 28px;
            padding-top: 12px;
            border-top: 1px solid #e5e7eb;
            color: #9ca3af;
            font-size: 10px;
            text-align: center;
        }
        .empty { padding: 20px; text-align: center; color: #9ca3af; }
    </style>
</head>
<body>
    <div class="brand-header">
        <div class="logo">ErrandGuy</div>
        <div class="doc-title">Runner Earnings Statement</div>
    </div>

    <table class="meta-row">
        <tr>
            <td class="meta-label">Runner</td>
            <td class="meta-value">{{ $runner['name'] }}</td>
            <td class="meta-label">Period</td>
            <td class="meta-value">{{ ucfirst(str_replace('_', ' ', $period)) }}</td>
        </tr>
        <tr>
            <td class="meta-label">Phone</td>
            <td class="meta-value">{{ $runner['phone'] }}</td>
            <td class="meta-label">Date range</td>
            <td class="meta-value">
                @if($range_start){{ \Carbon\Carbon::parse($range_start)->format('M j, Y') }}@else&mdash;@endif
                &ndash;
                @if($range_end){{ \Carbon\Carbon::parse($range_end)->format('M j, Y') }}@else&mdash;@endif
            </td>
        </tr>
    </table>

    <table class="summary">
        <tr>
            <td>
                <div class="val">&#8369;{{ number_format($total_earnings, 2) }}</div>
                <div class="lbl">Total Earnings</div>
            </td>
            <td>
                <div class="val">{{ $total_errands }}</div>
                <div class="lbl">Errands Completed</div>
            </td>
            <td>
                <div class="val">&#8369;{{ number_format($avg_per_errand, 2) }}</div>
                <div class="lbl">Avg / Errand</div>
            </td>
        </tr>
    </table>

    <table class="items">
        <thead>
            <tr>
                <th>Date</th>
                <th>Booking #</th>
                <th>Errand Type</th>
                <th class="num">Payout</th>
            </tr>
        </thead>
        <tbody>
            @forelse($line_items as $item)
                <tr>
                    <td>{{ $item->completed_at ? \Carbon\Carbon::parse($item->completed_at)->format('M j, Y g:i A') : '—' }}</td>
                    <td>{{ $item->booking_number }}</td>
                    <td>{{ $item->errandType->name ?? '—' }}</td>
                    <td class="num">&#8369;{{ number_format((float) $item->runner_payout, 2) }}</td>
                </tr>
            @empty
                <tr><td colspan="4" class="empty">No completed errands in this period.</td></tr>
            @endforelse
            @if($line_items->isNotEmpty())
                <tr class="totals">
                    <td colspan="3">Total ({{ $total_errands }} errands)</td>
                    <td class="num">&#8369;{{ number_format($total_earnings, 2) }}</td>
                </tr>
                {{-- Tips print as their own line, never summed into the payout
                     total above, so the statement reconciles against the same
                     figure commission and settlement use. --}}
                @if(($total_tips ?? 0) > 0)
                    <tr class="totals">
                        <td colspan="3">Tips received</td>
                        <td class="num">&#8369;{{ number_format($total_tips, 2) }}</td>
                    </tr>
                @endif
            @endif
            @if($line_items_truncated ?? false)
                <tr>
                    <td colspan="4" style="font-size: 11px; color: #64748B; padding-top: 8px;">
                        Showing the most recent {{ $line_item_cap }} of {{ $total_errands }} errands. The total above reflects all {{ $total_errands }}.
                    </td>
                </tr>
            @endif
        </tbody>
    </table>

    <div class="footer">
        Generated {{ \Carbon\Carbon::parse($generated_at)->format('M j, Y g:i A') }} &middot;
        This statement is provided for informational purposes and is not a tax document.
    </div>
</body>
</html>
