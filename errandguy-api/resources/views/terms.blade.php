@extends('layouts.public')

@section('title', 'Terms of Service')

@section('content')
    @php($support = config('app.support_email'))
    <h1>Terms of Service</h1>
    <p class="muted">Version {{ config('app.privacy_policy_version') }}</p>

    {{-- OWNER: replace everything below this notice with the Terms of Service
         your lawyer approved, then bump PRIVACY_POLICY_VERSION. --}}
    <div class="placeholder">
        <strong>Placeholder — not the final terms.</strong>
        This text is a temporary outline. It will be replaced with Terms of Service reviewed by a lawyer
        before ErrandGuy launches.
    </div>

    <h2>1. About ErrandGuy</h2>
    <p>[Placeholder] Who operates ErrandGuy, and that it connects customers with independent runners who do errands for them.</p>

    <h2>2. Your account</h2>
    <p>[Placeholder] Who may sign up, keeping your sign-in details safe, and when an account can be suspended.</p>

    <h2>3. Booking and paying for errands</h2>
    <p>[Placeholder] Fixed prices, payment by cash, GCash, Maya or ErrandGuy wallet, and when a GCash/Maya errand is sent to runners.</p>

    <h2>4. Cancellations and refunds</h2>
    <p>[Placeholder] Cancellation fees, and refunds to your ErrandGuy wallet when an errand is cancelled or no runner is available.</p>

    <h2>5. Runners</h2>
    <p>[Placeholder] Runner verification, conduct, earnings, cash collected on cash errands, and payouts.</p>

    <h2>6. Safety</h2>
    <p>[Placeholder] The SOS button, trusted contacts, and what ErrandGuy staff do when it is pressed.</p>

    <h2>7. Liability, changes and contact</h2>
    <p>[Placeholder] Limits of liability, how these terms change, governing law, and how to reach us at
        <a href="mailto:{{ $support }}">{{ $support }}</a>.</p>
@endsection
