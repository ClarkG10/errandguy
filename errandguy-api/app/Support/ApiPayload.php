<?php

namespace App\Support;

/**
 * Pure builder for the standardized API response envelope. Shared by both entry
 * points so the shape is defined once:
 *   • {@see ApiResponse} trait — how controllers emit success/error responses.
 *   • the `bootstrap/app.php` exception render map — how thrown exceptions are
 *     rendered to the same envelope.
 *
 * The envelope is STRICTLY ADDITIVE over what the mobile app reads today. The
 * live client reads `data`, `message`, `errors`, `links`, `meta` (and a few
 * endpoint-specific top-level keys re-attached via ApiResponse's `$merge`). It
 * reads no `success` and no top-level `code`, so adding them — plus
 * `meta.request_id` — cannot break any existing client or test (the PHPUnit
 * suite has zero assertExactJson).
 *
 *   { success, message, code, data, errors, meta: { request_id, ... } }
 */
final class ApiPayload
{
    /** @param array<string,mixed> $meta */
    public static function success(
        mixed $data = null,
        ?string $message = null,
        ?string $code = null,
        array $meta = [],
    ): array {
        return [
            'success' => true,
            'message' => $message,
            'code' => $code,
            'data' => $data,
            // Cast to object so it serializes as {} not [] — a stable shape the
            // app can read without an isArray branch.
            'errors' => (object) [],
            'meta' => array_merge(self::baseMeta(), $meta),
        ];
    }

    /**
     * @param array<string,array<int,string>|string> $errors
     * @param array<string,mixed> $meta
     */
    public static function error(
        string $code,
        ?string $message,
        array $errors = [],
        array $meta = [],
    ): array {
        return [
            'success' => false,
            'message' => $message,
            'code' => $code,
            'data' => null,
            'errors' => (object) $errors,
            'meta' => array_merge(self::baseMeta(), $meta),
        ];
    }

    /** @return array{request_id: string|null} */
    private static function baseMeta(): array
    {
        return [
            // Populated by App\Http\Middleware\AssignRequestId. Null-safe so the
            // builder still works in contexts without a request (queued jobs,
            // console) — those simply carry no id.
            'request_id' => request()?->attributes->get('request_id'),
        ];
    }
}
