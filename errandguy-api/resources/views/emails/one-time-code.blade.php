@if ($purpose === \App\Services\OTPService::PASSWORD_RESET)
Your ErrandGuy password reset code is: {{ $code }}

Enter this code in the app to choose a new password. It expires in {{ $minutes }} minutes.

If you didn't ask to reset your password, you can ignore this email. Your password has not been changed.
@elseif ($purpose === \App\Services\OTPService::EMAIL_VERIFICATION)
Your ErrandGuy email confirmation code is: {{ $code }}

Enter this code in the app to confirm your email address. It expires in {{ $minutes }} minutes.

If you didn't ask for this, you can ignore this email.
@else
Your ErrandGuy verification code is: {{ $code }}. It expires in {{ $minutes }} minutes.
@endif
