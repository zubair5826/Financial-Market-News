// Minimal Production HTTP API Layer — Step 93. A thin transport wrapper
// around the existing, unmodified intelligence functions. It adds no new
// intelligence logic, no new request/response schema beyond what those
// functions already define, and no new provider behavior — it only
// receives an HTTP request, parses its JSON body, calls the existing
// function, and serializes the existing return value verbatim.
//
// Uses only Node's built-in `http` module — no Express or other
// framework. This project has zero dependencies today; a framework
// would be the first one, and nothing here needs more than routing on
// (method, pathname) and a JSON body, which `http` already provides.
//
// Calls exactly two existing, unmodified functions:
//   - runApplicationRequest(request, options)  from ./app.js
//   - runPortfolioIntelligenceRequest(request) from ./portfolioIntelligence.js
// Neither is reimplemented, extended, or bypassed here.

const http = require("http");
const { runApplicationRequest } = require("./app");
const { runPortfolioIntelligenceRequest } = require("./portfolioIntelligence");

const PORT = process.env.PORT || 3000;

// A generous but bounded limit — protects the process from an
// unbounded-body request without imposing any new limit on the
// intelligence functions themselves (they never see a raw body, only
// the already-parsed JSON object).
const MAX_BODY_BYTES = 1024 * 1024; // 1 MiB

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

// Reads and JSON-parses a request body, enforcing MAX_BODY_BYTES.
// Resolves with `undefined` for an empty body (treated as `{}` by
// callers) — never guesses a shape for missing input. Rejects with a
// typed error ({ status, message }) for a too-large or malformed body;
// never lets a raw parse exception escape to the generic 500 handler,
// since a malformed body is a normal 400, not a server defect.
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let received = 0;
    let settled = false;
    const chunks = [];

    req.on("data", (chunk) => {
      if (settled) return;
      received += chunk.length;
      if (received > MAX_BODY_BYTES) {
        // Never call req.destroy() here — it tears down the underlying
        // socket res also writes to, so the 400 response below would
        // never actually reach the client. Simply stop buffering and
        // let the caller send its response; the connection is closed
        // normally once that response completes.
        settled = true;
        reject({ status: 400, message: "Request body exceeds the maximum allowed size." });
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (settled) return;
      if (received === 0) {
        resolve(undefined);
        return;
      }
      const raw = Buffer.concat(chunks).toString("utf8");
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        reject({ status: 400, message: "Request body must be valid JSON." });
        return;
      }
      resolve(parsed);
    });

    req.on("error", () => {
      if (settled) return;
      settled = true;
      reject({ status: 400, message: "Error reading request body." });
    });
  });
}

// A parsed JSON body suitable as a request envelope must be a plain
// object (not an array, string, number, boolean, or null) — this is an
// HTTP-layer shape check only, never a business-rule validation; the
// underlying intelligence functions already validate/degrade safely on
// whatever object shape they receive.
function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function handleHealth(req, res) {
  if (req.method !== "GET") {
    return sendJson(res, 405, { error: "Method Not Allowed", allowed: ["GET"] });
  }
  return sendJson(res, 200, { status: "ok" });
}

// POST /api/intelligence — body: { request?: object, options?: object }.
// Calls the existing runApplicationRequest(request, options) unchanged
// and returns its existing { pipelineResult, fredDiagnostics } shape
// verbatim. FRED is only ever touched if the caller's own
// options.macro.enabled === true (runApplicationRequest's existing
// default) — this endpoint never makes FRED mandatory.
async function handleIntelligence(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method Not Allowed", allowed: ["POST"] });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendJson(res, err.status || 400, { error: err.message || "Invalid request." });
  }

  if (body !== undefined && !isPlainObject(body)) {
    return sendJson(res, 400, { error: "Request body must be a JSON object." });
  }

  const requestArg = (body && body.request) || {};
  const optionsArg = (body && body.options) || {};

  if (!isPlainObject(requestArg) || !isPlainObject(optionsArg)) {
    return sendJson(res, 400, { error: "\"request\" and \"options\", if present, must be JSON objects." });
  }

  const result = await runApplicationRequest(requestArg, optionsArg);
  return sendJson(res, 200, result);
}

// POST /api/portfolio-intelligence — body IS the request object,
// { text, options? }, passed straight into the existing, synchronous,
// never-throwing runPortfolioIntelligenceRequest(). No provider is
// ever touched by this endpoint, with or without a body.
async function handlePortfolioIntelligence(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method Not Allowed", allowed: ["POST"] });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendJson(res, err.status || 400, { error: err.message || "Invalid request." });
  }

  if (body !== undefined && !isPlainObject(body)) {
    return sendJson(res, 400, { error: "Request body must be a JSON object." });
  }

  const result = runPortfolioIntelligenceRequest(body || {});
  return sendJson(res, 200, result);
}

const ROUTES = {
  "/health": handleHealth,
  "/api/intelligence": handleIntelligence,
  "/api/portfolio-intelligence": handlePortfolioIntelligence,
};

async function requestListener(req, res) {
  try {
    const host = req.headers.host || `localhost:${PORT}`;
    const { pathname } = new URL(req.url, `http://${host}`);
    const handler = ROUTES[pathname];

    if (!handler) {
      return sendJson(res, 404, { error: "Not Found" });
    }
    return await handler(req, res);
  } catch (err) {
    // Never leak an internal error message, stack trace, or any
    // credential-shaped value to the caller — a generic 500 only.
    return sendJson(res, 500, { error: "Internal Server Error" });
  }
}

const server = http.createServer(requestListener);

// Graceful shutdown: stop accepting new connections, let in-flight
// requests finish, then exit. Falls back to a forced exit if close()
// hangs (e.g. a request that never completes) so the process doesn't
// linger indefinitely on shutdown.
function shutdown(signal) {
  return new Promise((resolve) => {
    console.log(`${signal} received: shutting down gracefully.`);
    const forceExit = setTimeout(() => {
      console.error("Graceful shutdown timed out; forcing exit.");
      resolve();
      if (require.main === module) process.exit(1);
    }, 10000);
    forceExit.unref();
    server.close(() => {
      clearTimeout(forceExit);
      resolve();
      if (require.main === module) process.exit(0);
    });
  });
}

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

module.exports = { server, requestListener, shutdown, MAX_BODY_BYTES };
