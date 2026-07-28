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

# Run DDL on the DIRECT (session-mode) connection. Request traffic uses the
# `pgsql` connection (the transaction pooler in prod), which does not support
# the full session semantics migrations rely on. `pgsql_direct` falls back to
# the same DB_* vars until DB_DIRECT_* is set, so this is safe pre-pooler.
# See docs/scaling-tier0-rollout.md.
$FORGE_PHP artisan migrate --database=pgsql_direct --force --no-interaction

# Idempotent seeders only (ErrandTypeSeeder uses updateOrCreate, so it's
# safe to run on every deploy).
$FORGE_PHP artisan db:seed --database=pgsql_direct --class=ErrandTypeSeeder --force --no-interaction

$FORGE_PHP artisan queue:restart

( flock -w 10 9 || exit 1
    sudo -S service $FORGE_PHP_FPM reload ) 9>/tmp/fpmrestart.lock

