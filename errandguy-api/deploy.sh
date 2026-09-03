#!/bin/bash
# ErrandGuy API — Laravel Forge Deployment Script
# $FORGE_SITE_PATH resolves to the root directory you set in Forge (includes /errandguy-api)

set -e

cd $FORGE_SITE_PATH

git pull origin $FORGE_SITE_BRANCH

$FORGE_COMPOSER install --no-dev --no-interaction --prefer-dist --optimize-autoloader

# --no-interaction (-n) prevents Laravel's "APPLICATION IN PRODUCTION"
# confirmation from cancelling the deploy if any sub-command forgets
# --force.
$FORGE_PHP artisan optimize --no-interaction
# Filament-specific caches (component registry + Blade icon set). `optimize`
# above does NOT cover these; without them Filament resolves its icon set and
# component list from disk on every render — noticeable on a large panel.
$FORGE_PHP artisan filament:optimize --no-interaction
$FORGE_PHP artisan storage:link --no-interaction || true

# Fresh logical backup BEFORE the irreversible `migrate --force`, so a bad
# migration is recoverable immediately (not just from the 02:30 nightly job).
# BLOCKING by design (set -e at the top): if the backup fails, the migration
# does NOT run. Set DB_BACKUP_DISK=s3 in the Forge env so the copy is off-box. (audit DR)
$FORGE_PHP artisan errandguy:backup-database --no-interaction

# Run migrations on the app's default DB connection (MySQL in production).
$FORGE_PHP artisan migrate --force --no-interaction

# Idempotent seeders only (ErrandTypeSeeder uses updateOrCreate, so it's
# safe to run on every deploy).
$FORGE_PHP artisan db:seed --class=ErrandTypeSeeder --force --no-interaction

$FORGE_PHP artisan queue:restart

( flock -w 10 9 || exit 1
    sudo -S service $FORGE_PHP_FPM reload ) 9>/tmp/fpmrestart.lock

# Reverb holds its code in memory exactly like the queue worker, so a deploy
# leaves the WebSocket server running the previous release until it is
# signalled. Restarted LAST — after composer, optimize and the FPM reload — so
# it can never come up on a half-deployed release: the known failure there is a
# bootstrap/cache written before package:discover finished, which surfaces in
# the daemon log as `There are no commands defined in the "reverb" namespace`
# and takes realtime down until someone notices.
#
# `reverb:restart` is a cache-signalled graceful restart (the same mechanism as
# queue:restart), so it needs no sudo and no Forge daemon id.
#
# NON-BLOCKING on purpose: at this point the release is already live and
# migrated, and realtime degrades to polling — so a restart hiccup must never
# fail an otherwise-good deploy.
$FORGE_PHP artisan reverb:restart --no-interaction || true

# Report unsafe/degraded production config into the deploy log (APP_DEBUG,
# queue driver, Reverb credentials, Sentry DSN, TRUSTED_PROXIES). It normally
# runs on the daily schedule, but the scheduler is the one thing that cannot
# report its own death — so surfacing it per-deploy means a broken cron doesn't
# also hide the config warnings. Exits non-zero when it finds something, hence
# `|| true`: this is visibility, not a gate.
$FORGE_PHP artisan errandguy:check-prod-config --no-interaction || true

