import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import fs from "fs/promises";
import path from "path";
import { ADMIN_COOKIE, isValidAdminCookie } from "../../../../lib/adminAuth";

export const dynamic = "force-dynamic";

const updatesPath = path.join(process.cwd(), "data", "updates.json");

async function requireAdmin() {
  const cookieStore = await cookies();
  return isValidAdminCookie(cookieStore.get(ADMIN_COOKIE)?.value);
}

function cleanText(value, max = 180) {
  return String(value ?? "").trim().slice(0, max);
}

function sanitizeUpdates(value) {
  if (!Array.isArray(value)) return [];

  return value.slice(0, 100).map((item, index) => {
    const notes = Array.isArray(item?.notes)
      ? item.notes
      : String(item?.notes || "").split("\n");

    return {
      id: cleanText(item?.id, 80) || `update-${Date.now()}-${index}`,
      version: cleanText(item?.version, 40) || "Update",
      title: cleanText(item?.title, 120) || "Untitled Update",
      date: cleanText(item?.date, 60) || "Coming Soon",
      type: cleanText(item?.type, 50) || "Update",
      featured: Boolean(item?.featured),
      notes: notes
        .map((note) => cleanText(note, 220))
        .filter(Boolean)
        .slice(0, 50)
    };
  });
}

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const raw = await fs.readFile(updatesPath, "utf8");
    const updates = JSON.parse(raw);
    return NextResponse.json({ updates: Array.isArray(updates) ? updates : [] });
  } catch (error) {
    return NextResponse.json(
      { updates: [], error: error?.message || "Unable to load updates." },
      { status: 500 }
    );
  }
}

export async function PUT(request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const updates = sanitizeUpdates(body.updates);

  try {
    await fs.writeFile(
      updatesPath,
      `${JSON.stringify(updates, null, 2)}\n`,
      "utf8"
    );

    return NextResponse.json({ ok: true, updates });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Unable to save updates." },
      { status: 500 }
    );
  }
}
