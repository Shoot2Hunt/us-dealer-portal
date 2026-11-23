import "server-only";
import { getSecuritySettings } from "@/sanity/content";
import { MIN_PASSWORD_LENGTH } from "./session";

/** Most-used passwords from public breach lists (lower-cased), plus portal-specific guesses. */
const COMMON = new Set(
  `123456789012 1234567890 12345678910 0123456789 1111111111 0000000000 1234512345 9876543210 1q2w3e4r5t
  qwertyuiop qwerty12345 qwerty123456 1qaz2wsx3edc asdfghjkl1 zxcvbnm123 password12 password123 password1234
  password12345 passw0rd123 p@ssword123 p@ssw0rd123 iloveyou12 iloveyou123 sunshine123 princess123 football123
  baseball123 basketball dragon1234 monkey1234 letmein123 welcome123 welcome1234 welcome2024 welcome2025 welcome2026
  abc1234567 abcdefghij abcd123456 trustno1234 superman123 batman1234 starwars12 whatever123 changeme123
  administrator admin12345 admin123456 adminadmin qwertyqwerty michael123 jennifer123 charlie123 jordan1234
  summer2024 summer2025 summer2026 winter2024 winter2025 winter2026 spring2025 autumn2025 spring2026 autumn2026
  password2024 password2025 password2026 dealer1234 dealer12345 dealerportal portal12345 firearms123 shooting123
  hunting123 suppressor ammunition 2ndamendment secondamendment remington12 winchester1 smithwesson glock19glock`
    .split(/\s+/)
    .filter(Boolean),
);

/** An error message, or null when the password meets the policy set in Sanity → Security. */
export async function passwordProblem(password: string, context: { email?: string; name?: string } = {}): Promise<string | null> {
  const policy = await getSecuritySettings();
  const min = Math.max(MIN_PASSWORD_LENGTH, policy.passwordMinLength);
  if (password.length < min) return `Use at least ${min} characters.`;
  if (password.length > 200) return "Use 200 characters or fewer.";
  if (policy.blockCommonPasswords) {
    const lower = password.toLowerCase();
    const emailName = context.email?.split("@")[0]?.toLowerCase();
    if (COMMON.has(lower) || /^(.)\1+$/.test(password) || /^(0123456789|1234567890)+/.test(password)) {
      return "That password is too common. Try a short sentence or a few unrelated words.";
    }
    if ((emailName && emailName.length >= 4 && lower.includes(emailName)) || (context.email && lower === context.email.toLowerCase())) {
      return "Don't use your email address in your password.";
    }
  }
  return null;
}
