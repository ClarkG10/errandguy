<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Payment complete</title>
    {{-- Forward straight to the app's deep link. The in-app payment sheet
         watches for this URL and closes itself the instant we hit it, so the
         customer lands back in ErrandGuy without tapping anything. --}}
    <script>
        (function () {
            var target = 'errandguy://payment-complete';
            // replace() so the bridge page doesn't sit in history.
            window.location.replace(target);
            // Fallback for browsers that ignore replace() to a custom scheme.
            setTimeout(function () { window.location.href = target; }, 400);
        })();
    </script>
    <style>
        html, body { height: 100%; margin: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            text-align: center; padding: 24px; color: #0F172A; background: #F8FAFC;
        }
        .card { max-width: 360px; }
        h1 { font-size: 20px; margin: 0 0 8px; }
        p { font-size: 14px; color: #64748B; margin: 0 0 20px; line-height: 1.5; }
        a.btn {
            display: inline-block; background: #2563EB; color: #fff; text-decoration: none;
            padding: 12px 24px; border-radius: 999px; font-weight: 600; font-size: 14px;
        }
        .check {
            width: 56px; height: 56px; border-radius: 50%; background: #DCFCE7;
            display: flex; align-items: center; justify-content: center; margin: 0 auto 16px;
            font-size: 28px; color: #16A34A;
        }
    </style>
</head>
<body>
    <div class="card">
        <div class="check">&checkmark;</div>
        <h1>Payment received</h1>
        <p>Returning you to ErrandGuy&hellip; Your balance updates once the payment is confirmed.</p>
        <a class="btn" href="errandguy://payment-complete">Back to ErrandGuy</a>
    </div>
</body>
</html>
