import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, isValidAdminCookie } from "../../../../lib/adminAuth";

export async function GET() {
  const cookieStore = await cookies();
  const value = cookieStore.get(ADMIN_COOKIE)?.value;

  return NextResponse.json({
    authenticated: isValidAdminCookie(value)
  });
}
