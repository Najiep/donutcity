import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const updatesPath = path.join(process.cwd(), "data", "updates.json");

export async function GET() {
  try {
    const raw = await fs.readFile(updatesPath, "utf8");
    const updates = JSON.parse(raw);

    return NextResponse.json(
      { updates: Array.isArray(updates) ? updates : [] },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate"
        }
      }
    );
  } catch (error) {
    return NextResponse.json(
      { updates: [], error: error?.message || "Unable to load updates." },
      { status: 500 }
    );
  }
}
