@extends('layouts.public')

@section('title', 'Delete your account')

{{-- Public page (no sign-in) linked from the Play Store listing: Google Play
     requires a web route that explains how to delete an account and ask for it
     to be deleted without the app. --}}
@section('content')
    @php($support = config('app.support_email'))
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
        <li>Your saved addresses, trusted contacts and notifications.</li>
        <li>Runner ID documents, selfies, payout details, vehicle plate and last known location.</li>
        <li>The contact names and numbers you entered on your errands.</li>
        <li>What you wrote in chats, support messages and review comments (the star ratings stay).</li>
        <li>The locations recorded with any SOS you raised.</li>
        <li>Your sign-in sessions and push-notification devices.</li>
    </ul>

    <h2>What is kept</h2>
    <p>
        Records of errands, payments, payouts and wallet transactions are kept, because the law requires us to
        keep financial records. They no longer carry your name, email address or mobile number, but they do still
        hold:
    </p>
    <ul>
        <li>each errand&rsquo;s addresses, what was asked for (including a shopping list) and its photos and signature;</li>
        <li>for a runner, where they were at each step of an errand they did;</li>
        <li>for each payout sent to you, the account it was sent to and the name on that account;</li>
        <li>amounts and dates.</li>
    </ul>
    <p class="muted">
        Questions about your data: email <a href="mailto:{{ $support }}">{{ $support }}</a>.
    </p>
@endsection
