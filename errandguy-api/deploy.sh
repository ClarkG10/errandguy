#!/bin/bash
# ErrandGuy API — Laravel Forge Deployment Script
# Paste this into Forge > Sites > Your Site > Deploy Script
# Forge automatically sets $FORGE_SITE_PATH

cd $FORGE_SITE_PATH

# Pull latest code
git pull origin $FORGE_SITE_BRANCH

# Install PHP dependencies (no dev packages in production)
$FORGE_COMPOSER install --no-dev --no-interaction --prefer-dist --optimize-autoloader

# Run database migrations
$FORGE_PHP artisan migrate --force

# Clear and rebuild all caches
$FORGE_PHP artisan config:cache
$FORGE_PHP artisan route:cache
$FORGE_PHP artisan view:cache
$FORGE_PHP artisan event:cache

# Restart queue workers to pick up new code
$FORGE_PHP artisan queue:restart

# Restart FPM for OPcache reset
( flock -w 10 9 || exit 1
    echo 'Restarting FPM...'; sudo -S service $FORGE_PHP_FPM reload ) 9>/tmp/fpmrestart.lock
