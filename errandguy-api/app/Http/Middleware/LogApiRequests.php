<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;

class LogApiRequests
{
    public function handle(Request $request, Closure $next): Response
    {
        $start = microtime(true);

        Log::info('API Request', [
            'method' => $request->method(),
            'url' => $request->fullUrl(),
            'ip' => $request->ip(),
            'user_id' => $request->user()?->id,
            'user_agent' => $request->header('User-Agent'),
        ]);

        $response = $next($request);

        $duration = round((microtime(true) - $start) * 1000, 2);

        $logData = [
            'method' => $request->method(),
            'url' => $request->fullUrl(),
            'status' => $response->getStatusCode(),
            'duration_ms' => $duration,
            'user_id' => $request->user()?->id,
        ];

        if ($response->getStatusCode() >= 400) {
            $content = $response->getContent();
            $decoded = json_decode($content, true);
            $logData['response_body'] = $decoded ?? mb_substr($content, 0, 500);

            Log::warning('API Error Response', $logData);
        } else {
            Log::info('API Response', $logData);
        }

        return $response;
    }
}
