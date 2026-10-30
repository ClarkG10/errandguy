@extends('layouts.public')

@section('title', 'Privacy Policy')

@section('content')
    @php($support = config('app.support_email'))
    <h1>Privacy Policy</h1>
    <p class="muted">Version {{ config('app.privacy_policy_version') }}</p>

    {{-- OWNER: replace everything below this notice with the Privacy Policy
         your lawyer approved (Data Privacy Act of 2012), then bump
         PRIVACY_POLICY_VERSION. --}}
    <div class="placeholder">
        <strong>Placeholder — not the final policy.</strong>
        This text is a temporary outline. It will be replaced with a Privacy Policy reviewed by a lawyer
        under the Philippine Data Privacy Act of 2012 before ErrandGuy launches.
    </div>

    <h2>1. What we collect</h2>
    <p>[Placeholder] Account details (name, email, mobile number), errand addresses and contacts, location while an errand is
        active, payment and wallet records, chat messages and photos, runner ID documents, and trusted contacts.</p>

    <h2>2. Why we use it</h2>
    <p>[Placeholder] To run errands, take payments and pay runners, keep people safe (SOS), prevent fraud, and meet legal duties.</p>

    <h2>3. Who we share it with</h2>
    <p>[Placeholder] The customer or runner on the same errand, payment providers, SMS and email providers, and authorities when
        the law requires.</p>

    <h2>4. How long we keep it</h2>
    <p>[Placeholder] Runner locations for 24 hours, chats for 30 days after an errand ends, inbox messages for 90 days, and
        financial records as long as the law requires.</p>

    <h2>5. Your rights</h2>
    <p>[Placeholder] Access, correction, deletion (<a href="{{ route('account.delete') }}">delete your account</a>), and how to
        complain to the National Privacy Commission.</p>

    <h2>6. Contact</h2>
    <p>[Placeholder] Our Data Protection Officer can be reached at <a href="mailto:{{ $support }}">{{ $support }}</a>.</p>
@endsection
