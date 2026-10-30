@extends('layouts.public')

@section('title', 'Errands, done for you')

@section('content')
    @php($support = config('app.support_email'))
    <h1>ErrandGuy</h1>
    <p>Errands done for you across the Philippines: book in the app, and a verified runner picks up, delivers, shops or lines up for you.</p>

    <h2>Information</h2>
    <ul>
        <li><a href="{{ route('terms') }}">Terms of Service</a></li>
        <li><a href="{{ route('privacy') }}">Privacy Policy</a></li>
        <li><a href="{{ route('account.delete') }}">Delete your account</a></li>
    </ul>

    <h2>Contact</h2>
    <p>Questions or problems? Email <a href="mailto:{{ $support }}">{{ $support }}</a>.</p>
@endsection
