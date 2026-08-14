import { NextResponse } from "next/server";
import { ADMIN_COOKIE, getAdminToken, isValidPassword } from "../../../../lib/adminAuth";

export async function POST(request) {
  let body = {};
  try {
    body = await request.json();
  } catch {}

  if (!isValidPassword(body.password)) {
    return NextResponse.json(
      { ok: false, error: "Invalid admin password." },
      { status: 401 }
    );
  }

  const response = NextResponse.json({ ok: true });

  response.cookies.set({
    name: ADMIN_COOKIE,
    value: getAdminToken(),
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7
  });

  return response;
}
