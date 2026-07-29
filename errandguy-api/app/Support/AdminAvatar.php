<?php

namespace App\Support;

/**
 * Generates an inline SVG initials-avatar as a data URI, used as the fallback
 * for ImageEntry avatars in the admin panel so a user with no photo shows a
 * tidy branded monogram instead of a broken-image glyph. No external service,
 * no network call — CSP-safe and works offline.
 */
class AdminAvatar
{
    /** Brand-family background colours, chosen deterministically per name. */
    private const COLORS = ['#2563eb', '#0ea5e9', '#10b981', '#8b5cf6', '#ea580c', '#f59e0b'];

    public static function dataUri(?string $name): string
    {
        $name = trim((string) $name);
        $initials = 'EG';

        if ($name !== '') {
            $parts = preg_split('/\s+/', $name) ?: [];
            $initials = strtoupper(mb_substr($parts[0] ?? '', 0, 1).(count($parts) > 1 ? mb_substr(end($parts), 0, 1) : ''));
            $initials = $initials === '' ? 'U' : $initials;
        }

        $bg = self::COLORS[abs(crc32($name ?: 'EG')) % count(self::COLORS)];

        $svg = '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">'
            .'<rect width="96" height="96" rx="48" fill="'.$bg.'"/>'
            .'<text x="50%" y="52%" dy=".35em" text-anchor="middle" '
            .'font-family="Inter,Helvetica,Arial,sans-serif" font-size="38" font-weight="600" fill="#ffffff">'
            .htmlspecialchars($initials, ENT_QUOTES).'</text></svg>';

        return 'data:image/svg+xml;base64,'.base64_encode($svg);
    }
}
