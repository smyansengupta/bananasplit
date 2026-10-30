/**
 * Where to go once an email is confirmed: the page that was waiting on it
 * (a join link, an invite, creating a club). The "Check your email" notice
 * remembers its own page here; confirming the link reads it back (and
 * passes it through safeCallbackUrl, so only a path on this site counts).
 * A day, like the link itself.
 */
export const AFTER_VERIFY_COOKIE = "bs_after_verify";
export const AFTER_VERIFY_MAX_AGE = 60 * 60 * 24;
