import crypto from "crypto";

export const ADMIN_COOKIE = "donut_city_admin";

export function getAdminToken() {
  const secret = process.env.ADMIN_SESSION_SECRET || "local-development-secret";
  return crypto
    .createHmac("sha256", secret)
    .update("donut-city-admin-session")
    .digest("hex");
}

export function isValidPassword(password) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || typeof password !== "string") return false;

  const a = Buffer.from(password);
  const b = Buffer.from(expected);

  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function isValidAdminCookie(value) {
  if (!value) return false;
  const expected = getAdminToken();

  const a = Buffer.from(value);
  const b = Buffer.from(expected);

  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
