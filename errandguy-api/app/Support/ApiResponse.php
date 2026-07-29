<?php

namespace App\Support;

use Illuminate\Http\JsonResponse;
use Illuminate\Pagination\LengthAwarePaginator;

/**
 * Controller-facing helpers that emit the standardized {@see ApiPayload}
 * envelope. Applied once on the base App\Http\Controllers\Controller, so every
 * controller inherits `ok()/created()/fail()/paginated()`.
 *
 * Backward-compatibility contract (see plan): each helper keeps the exact
 * top-level keys and values the mobile app reads today (`data`, `message`,
 * `errors`, `links`, `meta`) and only ADDS `success`, `code`, and
 * `meta.request_id`. Endpoint-specific top-level keys the app also reads
 * (`checkout_url`, `attempts_remaining`, `idempotent`) are re-attached via the
 * `$merge` parameter so nothing is lost in the migration.
 */
trait ApiResponse
{
    /**
     * A 200 success envelope. `data` lands at `response.data.data`, exactly
     * where the app reads it today.
     *
     * @param array<string,mixed> $merge Extra top-level keys to preserve.
     * @param array<string,mixed> $meta
     */
    protected function ok(
        mixed $data = null,
        ?string $message = null,
        ?string $code = null,
        array $merge = [],
        array $meta = [],
    ): JsonResponse {
        return response()->json(ApiPayload::success($data, $message, $code, $meta) + $merge);
    }

    /**
     * A 201 success envelope for resource creation.
     *
     * @param array<string,mixed> $merge
     * @param array<string,mixed> $meta
     */
    protected function created(
        mixed $data = null,
        ?string $message = null,
        ?string $code = null,
        array $merge = [],
        array $meta = [],
    ): JsonResponse {
        return response()->json(ApiPayload::success($data, $message, $code, $meta) + $merge, 201);
    }

    /**
     * An error envelope. Status defaults to the code's own {@see ErrorCode::httpStatus()}
     * and message to its {@see ErrorCode::defaultMessage()} — pass either to override
     * (e.g. a context-rich money message).
     *
     * @param array<string,array<int,string>|string> $errors
     * @param array<string,mixed> $merge
     * @param array<string,mixed> $meta
     */
    protected function fail(
        ErrorCode $code,
        ?string $message = null,
        ?int $status = null,
        array $errors = [],
        array $merge = [],
        array $meta = [],
    ): JsonResponse {
        return response()->json(
            ApiPayload::error($code->value, $message ?? $code->defaultMessage(), $errors, $meta) + $merge,
            $status ?? $code->httpStatus(),
        );
    }

    /**
     * Emit the canonical `{data, links, meta}` pagination envelope. This
     * centralizes the block that was copy-pasted across list endpoints
     * (originally in WalletController::transactions). Pagination fields stay
     * nested under `meta` exactly as before (so assertJsonMissingPath('current_page')
     * still holds); only `success` and `meta.request_id` are added.
     *
     * @param  LengthAwarePaginator<int,mixed>  $paginator
     * @param  mixed|null  $items  Transformed rows to emit instead of $paginator->items()
     *                             (e.g. a resource collection). Defaults to raw items.
     */
    protected function paginated(LengthAwarePaginator $paginator, mixed $items = null): JsonResponse
    {
        return response()->json([
            'success' => true,
            'data' => $items ?? $paginator->items(),
            'links' => [
                'first' => $paginator->url(1),
                'last' => $paginator->url($paginator->lastPage()),
                'prev' => $paginator->previousPageUrl(),
                'next' => $paginator->nextPageUrl(),
            ],
            'meta' => [
                'current_page' => $paginator->currentPage(),
                'from' => $paginator->firstItem(),
                'last_page' => $paginator->lastPage(),
                'path' => $paginator->path(),
                'per_page' => $paginator->perPage(),
                'to' => $paginator->lastItem(),
                'total' => $paginator->total(),
                'request_id' => request()?->attributes->get('request_id'),
            ],
        ]);
    }
}
