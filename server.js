// Minimal Production HTTP API Layer — Step 93, hardened for public
// deployment in Step 105. A thin transport wrapper around the existing,
// unmodified intelligence functions. It adds no new intelligence logic,
// no new request/response schema beyond what those functions already
// define, and no new provider behavior — it only receives an HTTP
// request, authenticates/rate-limits it, parses its JSON body, calls
// the existing function, and serializes the existing return value
// verbatim.
//
// Uses only Node's built-in `http`/`crypto` modules — no Express or
// other framework, no rate-limiting/auth package. This project has
// zero dependencies today; a framework would be the first one, and
// nothing here needs more than routing on (method, pathname), a JSON
// body, a bearer-token check, and an in-memory per-IP counter — all of
// which Node's standard library already provides.
//
// Calls exactly two existing, unmodified functions:
//   - runApplicationRequest(request, options)  from ./app.js
//   - runPortfolioIntelligenceRequest(request) from ./portfolioIntelligence.js
// Neither is reimplemented, extended, or bypassed here.
//
// Step 105 — security design:
//   - Authentication: a single shared secret, API_AUTH_TOKEN, read
//     from the environment only — never hard-coded, never logged, and
//     never echoed back in any response (every failure returns the
//     identical generic `{ error: "Unauthorized" }`, regardless of
//     whether the header was missing, malformed, wrong, or the server
//     itself has no token configured at all — a caller can never learn
//     which case applied). Comparison is length-normalized (both sides
//     hashed to a fixed-size digest first) and done with
//     crypto.timingSafeEqual() so response timing can't be used to
//     guess the token character by character. FAILS CLOSED: if
//     API_AUTH_TOKEN is unset/blank, every intelligence request is
//     rejected — a forgotten secret must never silently become an
//     open API.
//   - Rate limiting: a basic in-memory fixed-window counter per client
//     IP (RATE_LIMIT_WINDOW_MS / RATE_LIMIT_MAX_REQUESTS, both
//     env-configurable with sane defaults), applied to every request
//     EXCEPT /health, and applied BEFORE route lookup/method/auth
//     checks — so a client cannot dodge the limiter by hitting an
//     unknown path, the wrong method, or a malformed body; every one
//     of those still counts against its IP first.
//
//     CLIENT IP / X-Forwarded-For (fixed in Step 106): this previously
//     ALWAYS preferred X-Forwarded-For's first entry. That header is
//     caller-suppliable, so any client could send a different fake
//     value on every request and land in a fresh rate-limit bucket
//     each time — the limiter was fully bypassable. Verified in
//     practice, not in theory: with a limit of 3/min, six requests
//     carrying six different X-Forwarded-For values all returned 200.
//     X-Forwarded-For is now read ONLY when TRUST_PROXY is explicitly
//     enabled in the environment, which is a promise by the operator
//     that a proxy in front of this process OVERWRITES that header
//     (Railway, nginx, a cloud load balancer all do). Default is OFF —
//     fail-closed: with it off, a forged header is ignored and every
//     direct client is counted by its real socket address. The cost of
//     the safe default is that behind a proxy WITHOUT TRUST_PROXY set,
//     all traffic shares the proxy's single IP bucket (over-limiting,
//     never under-limiting), which is the correct direction to fail.
//     Set TRUST_PROXY=1 on Railway or any similar platform.
//   - /health stays completely open (no auth, no rate limit) — Step
//     105 requirement 1/8 — so Railway's own health checks are never
//     blocked or throttled by either mechanism.

const http = require("http");
const crypto = require("crypto");
const { runApplicationRequest } = require("./app");
const { runPortfolioIntelligenceRequest } = require("./portfolioIntelligence");
const { runMarketIntelligenceRequest } = require("./providers/marketIntelligenceApplicationService");
const { logEvent } = require("./logs/logger");

const PORT = process.env.PORT || 3000;

// Step 106: the network interface this process binds to. Defaults to
// loopback ONLY — a server carrying real API credentials must never
// become reachable from the whole network just because someone ran
// `npm start` on a machine with a public IP. Container and cloud
// platforms (Railway included) route to the container's external
// interface and therefore REQUIRE HOST=0.0.0.0; that is a deliberate,
// one-line, documented opt-in (.env.example, HOW_TO_RUN.md) rather
// than an unsafe default. The startup banner below says so explicitly
// so the requirement can never be discovered only by a failed deploy.
const HOST = process.env.HOST || "127.0.0.1";

// Step 106: where data/runStore.js writes this server's run records.
// Production leaves it unset (data/runs.jsonl, runStore.js's own
// default). It exists because server.test.js's "empty POST body" case
// has no body in which to carry options.runStore — so before this,
// running `npm test` appended one real record to the production run
// store, quietly mixing synthetic test rows into the very history the
// store exists to make measurable. That test now sets this variable
// instead. Also genuinely useful in deployment: it lets an operator
// point run records at a mounted volume without touching code.
function getRunStoreOptions() {
  const filePath = process.env.RUN_STORE_FILE;
  return typeof filePath === "string" && filePath.trim() ? { runStore: { filePath: filePath.trim() } } : {};
}

// A generous but bounded limit — protects the process from an
// unbounded-body request without imposing any new limit on the
// intelligence functions themselves (they never see a raw body, only
// the already-parsed JSON object).
const MAX_BODY_BYTES = 1024 * 1024; // 1 MiB

// --- Step 105: authentication ---

// Read fresh on every check (never cached at module load) so a token
// configured/rotated via the environment takes effect without a
// restart in environments that support live env reloads, and so tests
// can set/unset process.env.API_AUTH_TOKEN per-case without needing a
// fresh module load. Blank/whitespace-only counts as "not configured."
function getConfiguredAuthToken() {
  const token = process.env.API_AUTH_TOKEN;
  return typeof token === "string" && token.trim() ? token : null;
}

function extractBearerToken(req) {
  const header = req.headers["authorization"];
  if (typeof header !== "string") return null;
  const match = header.match(/^Bearer\s+(.+)$/);
  return match ? match[1].trim() : null;
}

// Fixed-length-digest comparison: crypto.timingSafeEqual() itself
// requires equal-length buffers (a raw length mismatch would throw,
// and handling that specially would leak the correct length through
// timing/behavior); hashing both sides to the same fixed size first
// removes that leak entirely and makes the whole check constant-time
// regardless of the provided token's length.
function tokensMatch(provided, configured) {
  const providedDigest = crypto.createHash("sha256").update(String(provided)).digest();
  const configuredDigest = crypto.createHash("sha256").update(String(configured)).digest();
  return crypto.timingSafeEqual(providedDigest, configuredDigest);
}

// True only for a present, well-formed, matching bearer token AND a
// configured server-side secret. Every failure path is indistinguishable
// from every other at the call site — callers only ever see a boolean.
function isAuthorized(req) {
  const configuredToken = getConfiguredAuthToken();
  if (!configuredToken) return false;
  const providedToken = extractBearerToken(req);
  if (!providedToken) return false;
  return tokensMatch(providedToken, configuredToken);
}

// --- Step 105: per-IP rate limiting ---

function readPositiveIntEnv(name, defaultValue) {
  const parsed = parseInt(process.env[name], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

const RATE_LIMIT_WINDOW_MS = readPositiveIntEnv("RATE_LIMIT_WINDOW_MS", 60_000); // 1 minute
const RATE_LIMIT_MAX_REQUESTS = readPositiveIntEnv("RATE_LIMIT_MAX_REQUESTS", 30); // 30 requests/IP/window

// ip -> { count, windowStart }. Each entry self-expires the next time
// that IP is seen after its window has passed; a periodic sweep
// (below) additionally reclaims memory from IPs never seen again, so
// this can't grow without bound over a long-running process.
const rateLimitBuckets = new Map();

// TRUST_PROXY is read fresh on every call (never cached at module
// load) for the same reason the auth token is: a test — and an
// operator on a platform with live env reload — can flip it without a
// process restart. Accepted truthy spellings are explicit; anything
// else, including an unset value, means "do not trust the header".
const TRUSTED_PROXY_VALUES = new Set(["1", "true", "yes", "on"]);

function isProxyTrusted() {
  const raw = process.env.TRUST_PROXY;
  return typeof raw === "string" && TRUSTED_PROXY_VALUES.has(raw.trim().toLowerCase());
}

// The raw socket address is the only value a client cannot forge, so
// it is the default and the fallback. X-Forwarded-For is consulted
// ONLY under an explicit operator opt-in (see the Step 106 note in the
// module header) and only for its first, left-most entry — the
// original client as every standard proxy writes it.
function getClientIp(req) {
  if (isProxyTrusted()) {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.trim()) {
      const firstEntry = forwarded.split(",")[0].trim();
      if (firstEntry) return firstEntry;
    }
  }
  return (req.socket && req.socket.remoteAddress) || "unknown";
}

// Returns { limited, retryAfterSeconds }. A window is a fixed
// (non-sliding) RATE_LIMIT_WINDOW_MS bucket per IP — simple and
// dependency-free, appropriate for "basic" per-spec rate limiting; a
// client could in principle send a burst straddling two windows, a
// known, accepted trade-off of the simplest correct fixed-window
// design over a sliding one.
function checkRateLimit(ip) {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(ip);
  if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateLimitBuckets.set(ip, { count: 1, windowStart: now });
    return { limited: false };
  }
  bucket.count += 1;
  if (bucket.count > RATE_LIMIT_MAX_REQUESTS) {
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000));
    return { limited: true, retryAfterSeconds };
  }
  return { limited: false };
}

// Bounds total memory across many distinct IPs over time; not needed
// for correctness (each bucket already self-expires on next use).
// unref()'d so it never keeps the process — or a test — alive.
const rateLimitSweepInterval = setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of rateLimitBuckets) {
    if (now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) rateLimitBuckets.delete(ip);
  }
}, RATE_LIMIT_WINDOW_MS);
rateLimitSweepInterval.unref();

// Step 104: one operational log line per HTTP request/response, coarse
// enough to stay genuinely useful without needing a taxonomy of HTTP
// error codes — SUCCESS covers 2xx/3xx, the rest split only on whether
// the caller or this server is at fault.
function classifyOutcome(statusCode) {
  if (statusCode >= 500) return "SERVER_ERROR";
  if (statusCode >= 400) return "CLIENT_ERROR";
  return "SUCCESS";
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
  // Stashed only so requestListener's single logging hook (below) can
  // read the run_id a successful /api/intelligence response already
  // carries (result.persistence.run_id, Step 102) — never re-sent,
  // never logged as the full payload itself (that could be large and
  // would just re-embed whatever the caller's own request/response
  // already contains).
  res.__loggedPayload = payload;
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
  if (!isAuthorized(req)) {
    return sendJson(res, 401, { error: "Unauthorized" });
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

  // Step 106: a server-level RUN_STORE_FILE (when configured) supplies
  // the default run-store path; an explicit body-supplied
  // options.runStore still wins, so no existing caller changes
  // behavior.
  const result = await runApplicationRequest(requestArg, { ...getRunStoreOptions(), ...optionsArg });
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
  if (!isAuthorized(req)) {
    return sendJson(res, 401, { error: "Unauthorized" });
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

// POST /api/market-intelligence — body: { request?: object, options?: object }.
// Calls the existing, unmodified runMarketIntelligenceRequest() and
// returns its existing { pipelineResult, diagnostics } shape verbatim.
// Every provider domain (macro/market/news) is only ever touched if the
// caller's own options.{macro,market,news}.enabled === true — identical
// disabled-by-default rule as /api/intelligence's options.macro.enabled.
// This endpoint has no persistence and no LLM annotation — it reuses
// runMarketIntelligenceRequest() exactly as runLive.js already does,
// and that function does neither of those things today.
async function handleMarketIntelligence(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method Not Allowed", allowed: ["POST"] });
  }
  if (!isAuthorized(req)) {
    return sendJson(res, 401, { error: "Unauthorized" });
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

  const result = await runMarketIntelligenceRequest(requestArg, optionsArg);
  return sendJson(res, 200, result);
}

const ROUTES = {
  "/health": handleHealth,
  "/api/intelligence": handleIntelligence,
  "/api/portfolio-intelligence": handlePortfolioIntelligence,
  "/api/market-intelligence": handleMarketIntelligence,
};

// One request-level log entry per HTTP request, regardless of which
// handler (or none) served it — route, run ID when the response
// carries one, and a coarse success/failure outcome (Step 104's
// "preserve useful operational information" goal). This is the single
// place that calls logEvent() for HTTP traffic; individual handlers
// never need their own logging call. Never logs headers, the request
// body, or the response payload itself — only the method, route,
// status, and (for a failure) the short error message already meant
// for the client, which never contains a credential (server.js never
// echoes request content back on error).
function logRequestOutcome(req, pathname, res) {
  const statusCode = res.statusCode;
  const payload = res.__loggedPayload;
  const runId = payload && payload.persistence && payload.persistence.run_id;
  logEvent({
    agent: "http-server",
    route: pathname,
    runId: runId || null,
    dataSource: "http",
    responseStatus: classifyOutcome(statusCode),
    errors: statusCode >= 400 ? [(payload && payload.error) || `HTTP ${statusCode}`] : [],
    request: { method: req.method, statusCode },
  });
}

async function requestListener(req, res) {
  const host = req.headers.host || `localhost:${PORT}`;
  let pathname;
  try {
    ({ pathname } = new URL(req.url, `http://${host}`));
  } catch {
    pathname = req.url || "UNKNOWN";
  }

  try {
    // Rate limiting runs BEFORE route lookup/method/auth checks, and
    // for every path except /health — so it can't be bypassed by
    // hitting an unknown route, the wrong method, or a malformed body
    // (Step 105 requirement 9); all of those still count against the
    // caller's IP first.
    if (pathname !== "/health") {
      const ip = getClientIp(req);
      const { limited, retryAfterSeconds } = checkRateLimit(ip);
      if (limited) {
        res.setHeader("Retry-After", String(retryAfterSeconds));
        sendJson(res, 429, { error: "Too Many Requests" });
        return;
      }
    }

    const handler = ROUTES[pathname];

    if (!handler) {
      sendJson(res, 404, { error: "Not Found" });
      return;
    }
    await handler(req, res);
  } catch (err) {
    // Never leak an internal error message, stack trace, or any
    // credential-shaped value to the caller — a generic 500 only.
    sendJson(res, 500, { error: "Internal Server Error" });
  } finally {
    logRequestOutcome(req, pathname, res);
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
  server.listen(PORT, HOST, () => {
    console.log(`Server listening on ${HOST}:${PORT}`);
    if (HOST === "127.0.0.1" || HOST === "localhost") {
      console.log("Bound to loopback only. Set HOST=0.0.0.0 to accept connections from outside this machine (required on Railway and other container platforms).");
    }
    if (!isProxyTrusted()) {
      console.log("TRUST_PROXY is off: X-Forwarded-For is ignored and rate limiting counts the direct socket address. Set TRUST_PROXY=1 only when a proxy in front of this process overwrites that header.");
    }
  });
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

module.exports = { server, requestListener, shutdown, getClientIp, isProxyTrusted, getRunStoreOptions, MAX_BODY_BYTES, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_REQUESTS, HOST };
