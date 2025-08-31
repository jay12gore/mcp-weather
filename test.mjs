// test.mjs
const base = "http://127.0.0.1:3000/mcp";

async function readResponse(res) {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    return await res.json();
  }
  // Parse simple SSE (server-sent events)
  const text = await res.text();
  // Each SSE event is like:
  // event: message
  // data: {"jsonrpc":"2.0","id":1,"result":{...}}
  // 
  // Collect all data: lines and parse the last JSON object
  const dataLines = text
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim())
    .filter(Boolean);

  if (dataLines.length === 0) {
    return { sseRaw: text };
  }

  // Some transports send multiple data frames; try parsing each
  let lastJson = null;
  for (const d of dataLines) {
    try {
      lastJson = JSON.parse(d);
    } catch {
      // ignore non-JSON data frames
    }
  }
  return lastJson ?? { sseRaw: text };
}

async function main() {
  // 1) initialize — include protocolVersion + clientInfo and Accept both types
  const initBody = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      clientInfo: { name: "local-test", version: "1.0.0" },
      capabilities: {}
    }
  };

  let r = await fetch(base, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream"
    },
    body: JSON.stringify(initBody)
  });

  const sid = r.headers.get("mcp-session-id");
  const initObj = await readResponse(r);
  console.log("initialize:", initObj, "session:", sid);

  if (!sid) {
    console.error("No session id header returned; cannot proceed to tool call.");
    return;
  }

  // 2) call the tool
  const callBody = {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "weather_by_city",
      arguments: { city: "Austin", units: "imperial" }
    }
  };

  r = await fetch(base, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "mcp-session-id": sid
    },
    body: JSON.stringify(callBody)
  });

  const callObj = await readResponse(r);
  console.log("tool result:", JSON.stringify(callObj, null, 2));
}

main().catch(console.error);
