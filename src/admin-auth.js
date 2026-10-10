export const ADMIN_AUTH = Object.freeze({
  cookieName: "__Secure-survey_admin_session",
  sessionPath: "/api/admin",
  sessionTtlSeconds: 8 * 60 * 60,
  maxLoginBodyBytes: 4096,
  minimumPasswordCharacters: 12,
  minimumSessionSecretBytes: 32,
});

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class AdminAuthConfigurationError extends Error {
  constructor() {
    super("Administrator authentication is not configured correctly");
    this.name = "AdminAuthConfigurationError";
  }
}

function jsonResponse(body, status, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

function emptyResponse(status, headers = {}) {
  return new Response(null, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

function getAuthConfig(env) {
  const adminPassword = env?.ADMIN_PASSWORD;
  const sessionSecret = env?.SESSION_SECRET;

  if (
    typeof adminPassword !== "string" ||
    Array.from(adminPassword).length < ADMIN_AUTH.minimumPasswordCharacters ||
    typeof sessionSecret !== "string" ||
    encoder.encode(sessionSecret).byteLength < ADMIN_AUTH.minimumSessionSecretBytes
  ) {
    throw new AdminAuthConfigurationError();
  }

  return { adminPassword, sessionSecret };
}

function encodeBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function decodeBase64Url(value) {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    return null;
  }

  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");

  try {
    return Uint8Array.from(atob(padded), (character) =>
      character.charCodeAt(0),
    );
  } catch {
    return null;
  }
}

async function importHmacKey(sessionSecret, keyUsage) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(sessionSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [keyUsage],
  );
}

async function passwordsMatch(providedPassword, expectedPassword) {
  const provided =
    typeof providedPassword === "string" ? providedPassword : "invalid";
  const [providedKey, expectedKey] = await Promise.all([
    importHmacKey(provided, "sign"),
    importHmacKey(expectedPassword, "verify"),
  ]);
  const comparisonValue = encoder.encode("cloudflare-survey-admin-password");
  const providedSignature = await crypto.subtle.sign(
    "HMAC",
    providedKey,
    comparisonValue,
  );

  return crypto.subtle.verify(
    "HMAC",
    expectedKey,
    providedSignature,
    comparisonValue,
  );
}

function readCookie(request, name) {
  const cookieHeader = request.headers.get("Cookie");
  if (cookieHeader === null) {
    return null;
  }

  for (const cookie of cookieHeader.split(";")) {
    const separator = cookie.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const cookieName = cookie.slice(0, separator).trim();
    if (cookieName === name) {
      return cookie.slice(separator + 1).trim();
    }
  }

  return null;
}

function sessionCookie(token) {
  return [
    `${ADMIN_AUTH.cookieName}=${token}`,
    `Max-Age=${ADMIN_AUTH.sessionTtlSeconds}`,
    `Path=${ADMIN_AUTH.sessionPath}`,
    "Secure",
    "HttpOnly",
    "SameSite=Strict",
  ].join("; ");
}

function expiredSessionCookie() {
  return [
    `${ADMIN_AUTH.cookieName}=`,
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    `Path=${ADMIN_AUTH.sessionPath}`,
    "Secure",
    "HttpOnly",
    "SameSite=Strict",
  ].join("; ");
}

async function readPassword(request) {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return null;
  }

  const body = await request.text();
  if (encoder.encode(body).byteLength > ADMIN_AUTH.maxLoginBodyBytes) {
    return null;
  }

  try {
    const value = JSON.parse(body);
    return value !== null && typeof value === "object" ? value.password : null;
  } catch {
    return null;
  }
}

export async function createAdminSessionToken(env, now = Date.now()) {
  const { sessionSecret } = getAuthConfig(env);
  const payload = {
    version: 1,
    expires_at: Math.floor(now / 1000) + ADMIN_AUTH.sessionTtlSeconds,
  };
  const encodedPayload = encodeBase64Url(
    encoder.encode(JSON.stringify(payload)),
  );
  const key = await importHmacKey(sessionSecret, "sign");
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(encodedPayload),
  );

  return `${encodedPayload}.${encodeBase64Url(new Uint8Array(signature))}`;
}

export async function verifyAdminSessionToken(token, env, now = Date.now()) {
  const { sessionSecret } = getAuthConfig(env);
  if (typeof token !== "string") {
    return false;
  }

  const parts = token.split(".");
  if (parts.length !== 2 || parts.some((part) => part === "")) {
    return false;
  }

  const [encodedPayload, encodedSignature] = parts;
  const payloadBytes = decodeBase64Url(encodedPayload);
  const signature = decodeBase64Url(encodedSignature);
  if (payloadBytes === null || signature === null) {
    return false;
  }

  const key = await importHmacKey(sessionSecret, "verify");
  const verified = await crypto.subtle.verify(
    "HMAC",
    key,
    signature,
    encoder.encode(encodedPayload),
  );
  if (!verified) {
    return false;
  }

  try {
    const payload = JSON.parse(decoder.decode(payloadBytes));
    return (
      payload !== null &&
      typeof payload === "object" &&
      payload.version === 1 &&
      Number.isSafeInteger(payload.expires_at) &&
      payload.expires_at > Math.floor(now / 1000)
    );
  } catch {
    return false;
  }
}

function unavailableResponse() {
  return jsonResponse({ error: "Authentication unavailable" }, 500);
}

function unauthorizedResponse(clearCookie = false) {
  const headers = clearCookie
    ? { "Set-Cookie": expiredSessionCookie() }
    : undefined;
  return jsonResponse({ error: "Unauthorized" }, 401, headers);
}

export async function requireAdminSession(request, env, now = Date.now()) {
  const token = readCookie(request, ADMIN_AUTH.cookieName);

  try {
    if (await verifyAdminSessionToken(token, env, now)) {
      return null;
    }
    return unauthorizedResponse(token !== null);
  } catch (error) {
    if (error instanceof AdminAuthConfigurationError) {
      return unavailableResponse();
    }
    throw error;
  }
}

export async function handleAdminSessionRequest(
  request,
  env,
  now = Date.now(),
) {
  if (request.method === "DELETE") {
    return emptyResponse(204, { "Set-Cookie": expiredSessionCookie() });
  }

  if (request.method === "GET") {
    const rejected = await requireAdminSession(request, env, now);
    return rejected ?? jsonResponse({ authenticated: true }, 200);
  }

  if (request.method !== "POST") {
    return jsonResponse(
      { error: "Method not allowed" },
      405,
      { Allow: "GET, POST, DELETE" },
    );
  }

  try {
    const { adminPassword } = getAuthConfig(env);
    const providedPassword = await readPassword(request);
    if (!(await passwordsMatch(providedPassword, adminPassword))) {
      return jsonResponse({ error: "Invalid credentials" }, 401);
    }

    const token = await createAdminSessionToken(env, now);
    return emptyResponse(204, { "Set-Cookie": sessionCookie(token) });
  } catch (error) {
    if (error instanceof AdminAuthConfigurationError) {
      return unavailableResponse();
    }
    throw error;
  }
}
