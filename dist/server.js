// src/server.ts
import express from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
// MCP SDK
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
/**
 * Build the MCP server with a single tool: weather_by_city
 * Uses Open-Meteo (no API key) for geocoding + forecast.
 */
function buildServer() {
    const server = new McpServer({
        name: "weather-mcp",
        version: "1.0.0",
    });
    // IMPORTANT: Provide a Zod *raw shape* (not z.object) for inputSchema
    const InputShape = {
        city: z.string().min(2, "city is required"),
        units: z.enum(["metric", "imperial"]).default("metric"),
    };
    server.registerTool("weather_by_city", {
        title: "Weather by City",
        description: "Get current weather and a 6-hour hourly forecast for a city via Open-Meteo",
        inputSchema: InputShape, // ZodRawShape expected by the SDK
    }, async ({ city, units }) => {
        // 1) Geocode city -> lat/lon
        const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`);
        if (!geoRes.ok) {
            throw new Error(`Geocoding failed: ${geoRes.status}`);
        }
        const geo = (await geoRes.json());
        const loc = geo.results?.[0];
        if (!loc) {
            return {
                content: [
                    {
                        type: "text",
                        text: `No match for "${city}". Try including state/country (e.g., "Nashik, IN").`,
                    },
                ],
            };
        }
        const latitude = loc.latitude;
        const longitude = loc.longitude;
        const isMetric = units !== "imperial";
        const tempUnit = isMetric ? "celsius" : "fahrenheit";
        const windUnit = isMetric ? "kmh" : "mph";
        // 2) Fetch forecast
        const url = new URL("https://api.open-meteo.com/v1/forecast");
        url.searchParams.set("latitude", String(latitude));
        url.searchParams.set("longitude", String(longitude));
        url.searchParams.set("current", "temperature_2m,wind_speed_10m,precipitation");
        url.searchParams.set("hourly", "temperature_2m,precipitation_probability");
        url.searchParams.set("temperature_unit", tempUnit);
        url.searchParams.set("wind_speed_unit", windUnit);
        url.searchParams.set("forecast_days", "1");
        url.searchParams.set("timezone", "auto");
        const wxRes = await fetch(url.toString());
        if (!wxRes.ok) {
            throw new Error(`Forecast failed: ${wxRes.status}`);
        }
        const wx = (await wxRes.json());
        const name = `${loc.name}, ${loc.admin1 ?? ""} ${loc.country_code ?? ""}`.trim();
        const current = wx.current ?? wx.current_weather ?? {};
        const currTemp = current.temperature_2m ?? current.temperature ?? "n/a";
        const currWind = current.wind_speed_10m ?? current.windspeed ?? "n/a";
        const currPrec = current.precipitation ?? "n/a";
        let text = `Weather for ${name} (${latitude.toFixed(2)}, ${longitude.toFixed(2)})\n` +
            `Now: ${currTemp}°${isMetric ? "C" : "F"}, wind ${currWind} ${isMetric ? "km/h" : "mph"}, precip ${currPrec}\n` +
            `Next 6 hours (temp, pop%):`;
        const hours = wx.hourly?.time?.slice(0, 6) ?? [];
        const temps = wx.hourly?.temperature_2m?.slice(0, 6) ?? [];
        const pops = wx.hourly?.precipitation_probability?.slice(0, 6) ?? [];
        for (let i = 0; i < hours.length; i++) {
            const t = new Date(hours[i]).toLocaleTimeString("en-US", {
                hour: "numeric",
            });
            text += `\n  ${t}: ${temps[i]}°, ${pops[i]}%`;
        }
        return {
            content: [
                { type: "text", text },
                {
                    type: "resource_link",
                    uri: url.toString(),
                    name: "Open-Meteo API call",
                    mimeType: "application/json",
                    description: "Raw forecast JSON",
                },
            ],
        };
    });
    return server;
}
/**
 * HTTP entrypoint using session-aware Streamable HTTP transport.
 */
async function main() {
    const app = express();
    app.use(express.json());
    // Keep transports per active session
    const transports = {};
    app.post("/mcp", async (req, res) => {
        try {
            const sessionId = req.headers["mcp-session-id"];
            let transport = sessionId ? transports[sessionId] : undefined;
            // New session? Only create on an initialize request
            if (!transport && isInitializeRequest(req.body)) {
                transport = new StreamableHTTPServerTransport({
                    sessionIdGenerator: () => randomUUID(),
                    // NOTE: callback is all lowercase in current SDKs
                    onsessioninitialized: (sid) => {
                        transports[sid] = transport;
                    },
                    // Optional hardening when exposing publicly:
                    // enableDnsRebindingProtection: true,
                    // allowedHosts: ["127.0.0.1", "your.domain.com"],
                });
                // Clean up on close
                transport.onclose = () => {
                    if (transport?.sessionId)
                        delete transports[transport.sessionId];
                };
                // Start an MCP server instance and connect it to this transport
                const mcp = buildServer();
                await mcp.connect(transport);
            }
            if (!transport) {
                res.status(400).json({
                    jsonrpc: "2.0",
                    error: { code: -32000, message: "Bad Request: No valid session ID provided" },
                    id: null,
                });
                return;
            }
            // Delegate the HTTP request to the transport
            await transport.handleRequest(req, res, req.body);
        }
        catch (e) {
            console.error(e);
            res.status(500).send(e?.message ?? "Internal error");
        }
    });
    // Optional: explicit session close
    app.delete("/mcp", async (req, res) => {
        const sessionId = req.headers["mcp-session-id"];
        const transport = sessionId ? transports[sessionId] : undefined;
        if (transport) {
            transport.close();
            delete transports[sessionId];
        }
        res.status(204).end();
    });
    const port = Number(process.env.PORT) || 3000;
    app.listen(port, () => {
        console.log(`✅ MCP Weather server on http://localhost:${port}/mcp`);
    });
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
