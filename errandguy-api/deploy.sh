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

