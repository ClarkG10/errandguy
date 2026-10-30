<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Delete your ErrandGuy account</title>
    @php($support = config('app.support_email'))
    {{-- Public page (no sign-in) linked from the Play Store listing: Google
         Play requires a web route that explains how to delete an account and
         ask for it to be deleted without the app. Plain HTML, no scripts. --}}
    <style>
        html, body { margin: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            color: #0F172A; background: #F8FAFC; padding: 32px 16px; line-height: 1.55;
        }
        .card {
            max-width: 640px; margin: 0 auto; background: #fff; border-radius: 16px;
            padding: 28px 24px; box-shadow: 0 1px 3px rgba(15, 23, 42, .08);
        }
        h1 { font-size: 22px; margin: 0 0 8px; }
        h2 { font-size: 16px; margin: 28px 0 8px; }
        p, li { font-size: 15px; color: #334155; }
        p { margin: 0 0 12px; }
        ol, ul { margin: 0 0 12px; padding-left: 22px; }
        li { margin-bottom: 6px; }
        .muted { color: #64748B; font-size: 14px; }
        a { color: #2563EB; }
        a.btn {
            display: inline-block; background: #2563EB; color: #fff; text-decoration: none;
            padding: 12px 24px; border-radius: 999px; font-weight: 600; font-size: 14px; margin-top: 4px;
        }
    </style>
</head>
<body>
    <main class="card">
        <h1>Delete your ErrandGuy account</h1>
        <p class="muted">For customers and runners of the ErrandGuy app.</p>

        <h2>In the app</h2>
        <ol>
            <li>Open ErrandGuy and sign in.</li>
            <li>Go to the <strong>Profile</strong> tab and scroll to the bottom.</li>
            <li>Tap <strong>Delete account</strong> and confirm.</li>
        </ol>
        <p>
            If your wallet still has money in it, the app asks where to send it (GCash or Maya, or your bank
            account if you are a runner). We send the full balance there as part of deleting your account.
            If you owe money from cash errands, it has to be cleared before the account can be deleted.
            You can&rsquo;t delete an account while an errand is in progress.
        </p>

        <h2>Without the app</h2>
        <p>
            Email <a href="mailto:{{ $support }}?subject=Delete%20my%20ErrandGuy%20account">{{ $support }}</a>
            from the email address on your account, or include the mobile number you signed up with.
            Put &ldquo;Delete my ErrandGuy account&rdquo; in the subject. If your wallet has money in it, tell us
            the GCash or Maya number (and account name) to send it to.
        </p>
        <p>We&rsquo;ll check that the request comes from you, then delete the account and email you when it&rsquo;s done.</p>
        <a class="btn" href="mailto:{{ $support }}?subject=Delete%20my%20ErrandGuy%20account">Email {{ $support }}</a>

        <h2>What is deleted</h2>
        <ul>
            <li>Your name, email address, mobile number and profile photo.</li>
            <li>Your saved addresses and trusted contacts.</li>
            <li>Runner ID documents, selfies and payout details.</li>
            <li>The contact names and numbers you entered on your errands.</li>
            <li>Your sign-in sessions and push-notification devices.</li>
        </ul>

        <h2>What is kept</h2>
        <p>
            Records of errands, payments, payouts and wallet transactions are kept, because the law requires us to
            keep financial records: amounts and dates, and for a payout the account the money was sent to. They
            are kept without your name, email address or mobile number.
        </p>
    </main>
</body>
</html>
