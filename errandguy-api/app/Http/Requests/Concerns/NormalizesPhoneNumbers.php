<?php

namespace App\Http\Requests\Concerns;

use App\Support\PhilippinePhone;

/**
 * Rewrites phone fields to +639XXXXXXXXX before validation, so a number is
 * stored and looked up in one shape however it was typed ("0917 123 4567",
 * "639171234567", "+63 917…"). A value that isn't a PH mobile number is left
 * as sent, for the field's own rule to reject.
 */
trait NormalizesPhoneNumbers
{
    /**
     * @param  array<int, string>  $fields  top-level names, or "list.*.field"
     */
    protected function normalizePhoneFields(array $fields): void
    {
        foreach ($fields as $field) {
            if (str_contains($field, '.*.')) {
                [$list, $key] = explode('.*.', $field, 2);
                $items = $this->input($list);
                if (! is_array($items)) {
                    continue;
                }
                foreach ($items as $i => $item) {
                    if (is_array($item) && is_string($item[$key] ?? null)) {
                        $items[$i][$key] = PhilippinePhone::canonical($item[$key]) ?? $item[$key];
                    }
                }
                $this->merge([$list => $items]);

                continue;
            }

            $value = $this->input($field);
            if (is_string($value) && $value !== '') {
                $this->merge([$field => PhilippinePhone::canonical($value) ?? $value]);
            }
        }
    }
}
