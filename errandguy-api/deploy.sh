#!/bin/bash
# ErrandGuy API — Laravel Forge Deployment Script
# $FORGE_SITE_PATH resolves to the root directory you set in Forge (includes /errandguy-api)

cd $FORGE_SITE_PATH

git pull origin $FORGE_SITE_BRANCH

$FORGE_COMPOSER install --no-dev --no-interaction --prefer-dist --optimize-autoloader

$FORGE_PHP artisan optimize
$FORGE_PHP artisan storage:link
$FORGE_PHP artisan migrate --force

$FORGE_PHP artisan queue:restart

( flock -w 10 9 || exit 1
    sudo -S service $FORGE_PHP_FPM reload ) 9>/tmp/fpmrestart.lock
