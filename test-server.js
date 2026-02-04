const http = require("http");

const PORT = 3000;
const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json",
};

const server = http.createServer((req, res) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, HEADERS);
    res.end();
    return;
  }

  // Parse body
  let body = "";
  req.on("data", (chunk) => {
    body += chunk.toString();
  });

  req.on("end", () => {
    // Log Activity
    console.log(`\n📩 [${req.method}] ${req.url}`);

    // Check Authorization
    const authHeader = req.headers["authorization"];
    if (authHeader) {
      console.log(`🔑 Auth: ${authHeader}`);
    } else {
      console.log("⚠️  No Auth Header detected");
    }

    // Handle Routes
    if (req.url === "/api/status" && req.method === "GET") {
      console.log("✅ Connection check received");
      res.writeHead(200, HEADERS);
      res.end(JSON.stringify({ status: "ok", version: "2.1.0" }));
    } else if (req.url === "/api/health" && req.method === "POST") {
      const data = JSON.parse(body || "{}");
      console.log("❤️  Health Ping received:", data);
      res.writeHead(200, HEADERS);
      res.end(JSON.stringify({ received: true }));
    } else if (req.url === "/api/log" && req.method === "POST") {
      const parsed = JSON.parse(body || "{}");

      // Normalize to array for display (handle single log or batch)
      const data = Array.isArray(parsed) ? parsed : [parsed];

      console.log(`📦 RECEIVED: ${data.length} logs`);

      data.forEach((log, i) => {
        const title = log.title ? log.title.substring(0, 40) : "Untitled";
        const url = log.url || "No URL";
        console.log(`   ${i + 1}. [${url}] ${title}... (${log.duration}s)`);

        if (log.source) {
          console.log(
            `      Source: ${log.source.type} | Client: ${log.source.clientId}`,
          );
        }
      });

      // Return 201 Success matches new expectation
      res.writeHead(201, HEADERS);
      res.end(
        JSON.stringify({
          success: true,
          logId: "test-log-id-" + Date.now().toString(36),
          pageId: "test-page-id",
          projectId: "test-project-id",
        }),
      );
    } else {
      console.log("❓ Unknown endpoint");
      res.writeHead(404, HEADERS);
      res.end(JSON.stringify({ error: "Not found" }));
    }
  });
});

server.listen(PORT, () => {
  console.log(`
🚀 TEST SERVER RUNNING ON PORT ${PORT}
----------------------------------------
👉 Endpoint: http://localhost:${PORT}
👉 Listening for:
   - POST /api/log    (Syncs)
   - GET  /api/status (Connection Check)
   - POST /api/health (Telemetry)

waiting for extension data...
  `);
});
