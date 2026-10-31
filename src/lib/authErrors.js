/* Turns a Supabase Auth error into a message a person can act on. */
const REASONS = {
  invalid_credentials: "Wrong email or password. If you haven't registered yet, click Register first.",
  email_not_confirmed: "This email hasn't been confirmed yet. Open the confirmation email Supabase sent you, then sign in.",
  user_already_exists: "An account with this email already exists. Sign in instead.",
  email_exists: "An account with this email already exists. Sign in instead.",
  weak_password: "That password is too weak. Use at least 6 characters.",
  validation_failed: "Enter a valid email address and password.",
  email_address_invalid: "That email address isn't valid.",
  signup_disabled: "Registration is turned off for this project. Enable it in Supabase > Authentication > Sign In / Providers.",
  email_provider_disabled: "Email sign-in is turned off. Enable it in Supabase > Authentication > Sign In / Providers.",
  over_request_rate_limit: "Too many attempts. Wait a few minutes and try again.",
  over_email_send_rate_limit: "Too many emails were sent. Wait a few minutes and try again.",
  user_banned: "This account has been disabled.",
};

export function describeAuthError(err, register) {
  const code = (err && err.code) || "";
  const name = (err && err.name) || "";
  const base = register ? "Registration failed. " : "Sign in failed. ";
  if (REASONS[code]) return base + REASONS[code] + " (" + code + ")";
  if (/fetch/i.test(name + " " + ((err && err.message) || ""))) return base + "Network error. Check your connection.";
  if (/invalid api key|apikey/i.test((err && err.message) || "")) return base + "The Supabase key in .env is invalid.";
  return base + ((err && err.message) || "Check your email and password.") + (code ? " (" + code + ")" : "");
}
