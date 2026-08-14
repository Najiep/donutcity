import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const LOCAL_BASE_URL = "http://127.0.0.1:30120";
const DEFAULT_JOIN_CODE = "alq4yz";

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: { Accept: "application/json" }
    });

    if (!response.ok) {
      throw new Error(`${url} returned HTTP ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function offlineResponse(joinCode, source, error) {
  return NextResponse.json(
    {
      online: false,
      hostname: "Donut City",
      players: [],
      clients: 0,
      maxClients: 0,
      joinCode,
      source,
      error
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate"
      }
    }
  );
}

export async function GET() {
  const configuredBaseUrl = process.env.FIVEM_SERVER_BASE_URL?.trim();
  const baseUrl = (
    configuredBaseUrl ||
    (process.env.NODE_ENV === "development" ? LOCAL_BASE_URL : "")
  ).replace(/\/+$/, "");

  const joinCode = process.env.NEXT_PUBLIC_FIVEM_JOIN_CODE || DEFAULT_JOIN_CODE;

  if (!baseUrl) {
    return offlineResponse(
      joinCode,
      null,
      "Live FiveM status is not configured for production yet."
    );
  }

  try {
    const [dynamicResult, playersResult, infoResult] = await Promise.allSettled([
      fetchJson(`${baseUrl}/dynamic.json`),
      fetchJson(`${baseUrl}/players.json`),
      fetchJson(`${baseUrl}/info.json`)
    ]);

    if (
      dynamicResult.status === "rejected" &&
      playersResult.status === "rejected" &&
      infoResult.status === "rejected"
    ) {
      return offlineResponse(
        joinCode,
        baseUrl,
        "Unable to reach the configured FiveM server endpoint."
      );
    }

    const dynamic =
      dynamicResult.status === "fulfilled" && dynamicResult.value
        ? dynamicResult.value
        : {};

    const info =
      infoResult.status === "fulfilled" && infoResult.value
        ? infoResult.value
        : {};

    const rawPlayers =
      playersResult.status === "fulfilled" && Array.isArray(playersResult.value)
        ? playersResult.value
        : [];

    const players = rawPlayers.map((player, index) => ({
      id: player.id ?? index,
      name: player.name || `Player ${player.id ?? index}`,
      ping: player.ping ?? null
    }));

    const hostname =
      dynamic.hostname ||
      info.vars?.sv_projectName ||
      info.vars?.sv_projectDesc ||
      "Donut City";

    const clients =
      Number(dynamic.clients ?? dynamic.Clients ?? players.length) || players.length;

    const maxClients =
      Number(
        dynamic.sv_maxclients ??
        dynamic.svMaxclients ??
        info.vars?.sv_maxClients ??
        info.vars?.sv_maxclients ??
        0
      ) || 0;

    return NextResponse.json(
      {
        online: true,
        hostname,
        players,
        clients,
        maxClients,
        joinCode,
        source: baseUrl,
        error: null
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate"
        }
      }
    );
  } catch (error) {
    return offlineResponse(
      joinCode,
      baseUrl,
      error?.name === "AbortError"
        ? "Timed out connecting to the configured FiveM server."
        : error?.message || "Unable to reach the configured FiveM server."
    );
  }
}
