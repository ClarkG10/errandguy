<?php

namespace App\Exceptions;

use RuntimeException;

/**
 * A staff-account change that isn't allowed (e.g. disabling yourself, or
 * leaving the panel without an active super admin). The message is shown to
 * the super admin as is.
 */
class StaffAccountException extends RuntimeException
{
}
