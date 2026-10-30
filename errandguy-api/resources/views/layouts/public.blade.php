<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>@yield('title') · ErrandGuy</title>
    {{-- Public pages (no sign-in): plain HTML, no scripts — same look as
         /delete-account. --}}
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
        .placeholder {
            background: #FEF3C7; border: 1px solid #F59E0B; border-radius: 12px;
            padding: 12px 16px; margin: 16px 0 20px; color: #78350F; font-size: 14px;
        }
        .placeholder strong { color: #78350F; }
        footer { max-width: 640px; margin: 16px auto 0; text-align: center; }
        footer a { margin: 0 8px; font-size: 14px; }
    </style>
</head>
<body>
    <main class="card">
        @yield('content')
    </main>
    <footer class="muted">
        <a href="{{ url('/') }}">ErrandGuy</a>
        <a href="{{ route('terms') }}">Terms</a>
        <a href="{{ route('privacy') }}">Privacy</a>
        <a href="{{ route('account.delete') }}">Delete account</a>
    </footer>
</body>
</html>
