import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.js";
import {
  ADMIN_AUTH,
  createAdminSessionToken,
  verifyAdminSessionToken,
} from "../src/admin-auth.js";

const env = {
  ADMIN_PASSWORD: "synthetic-admin-password",
  SESSION_SECRET: "synthetic-session-secret-with-at-least-thirty-two-bytes",
};

function request(path, options = {}) {
  return new Request(`https://survey.example${path}`, options);
}

function cookiePair(response) {
  return response.headers.get("Set-Cookie").split(";", 1)[0];
}

async function login(password = env.ADMIN_PASSWORD) {
  return worker.fetch(
    request("/api/admin/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    }),
    env,
  );
}

test("creates a secure administrator session for valid credentials", async () => {
  const response = await login();
  const setCookie = response.headers.get("Set-Cookie");

  assert.equal(response.status, 204);
  assert.match(setCookie, new RegExp(`^${ADMIN_AUTH.cookieName}=`));
  assert.match(setCookie, /Max-Age=28800/);
  assert.match(setCookie, /Path=\/api\/admin/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.equal(setCookie.includes(env.ADMIN_PASSWORD), false);
  assert.equal(setCookie.includes(env.SESSION_SECRET), false);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("accepts a valid signed session", async () => {
  const loginResponse = await login();
  const response = await worker.fetch(
    request("/api/admin/session", {
      headers: { Cookie: cookiePair(loginResponse) },
    }),
    env,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { authenticated: true });
});

const invalidLoginBodies = [
  {
    description: "wrong password",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "incorrect-password" }),
  },
  {
    description: "missing password",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  },
  {
    description: "invalid JSON",
    headers: { "Content-Type": "application/json" },
    body: "{",
  },
  {
    description: "wrong content type",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ password: env.ADMIN_PASSWORD }),
  },
];

for (const { description, headers, body } of invalidLoginBodies) {
  test(`returns the same error for invalid credentials: ${description}`, async () => {
    const response = await worker.fetch(
      request("/api/admin/session", { method: "POST", headers, body }),
      env,
    );

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Invalid credentials" });
  });
}

test("rejects missing, invalid, tampered, and expired sessions", async () => {
  const expiredToken = await createAdminSessionToken(
    env,
    Date.now() - (ADMIN_AUTH.sessionTtlSeconds + 1) * 1000,
  );
  const validToken = await createAdminSessionToken(env);
  const tamperedToken = `${validToken.slice(0, -1)}${validToken.endsWith("a") ? "b" : "a"}`;
  const cookies = [
    null,
    `${ADMIN_AUTH.cookieName}=invalid-token`,
    `${ADMIN_AUTH.cookieName}=${tamperedToken}`,
    `${ADMIN_AUTH.cookieName}=${expiredToken}`,
  ];

  for (const cookie of cookies) {
    const headers = cookie === null ? {} : { Cookie: cookie };
    const response = await worker.fetch(
      request("/api/admin/session", { headers }),
      env,
    );

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Unauthorized" });
  }
});

test("protects every administrator route", async () => {
  const rejected = await worker.fetch(
    request("/api/admin/questionnaires"),
    env,
  );
  assert.equal(rejected.status, 401);

  const loginResponse = await login();
  const allowed = await worker.fetch(
    request("/api/admin/unknown", {
      headers: { Cookie: cookiePair(loginResponse) },
    }),
    env,
  );
  assert.equal(allowed.status, 404);
});

test("clears the administrator session on logout", async () => {
  const response = await worker.fetch(
    request("/api/admin/session", { method: "DELETE" }),
    env,
  );
  const setCookie = response.headers.get("Set-Cookie");

  assert.equal(response.status, 204);
  assert.match(setCookie, /Max-Age=0/);
  assert.match(setCookie, /Expires=Thu, 01 Jan 1970 00:00:00 GMT/);
});

test("returns a generic error when authentication secrets are unavailable", async () => {
  const response = await worker.fetch(
    request("/api/admin/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: env.ADMIN_PASSWORD }),
    }),
    {},
  );
  const body = await response.text();

  assert.equal(response.status, 500);
  assert.equal(body.includes("ADMIN_PASSWORD"), false);
  assert.equal(body.includes("SESSION_SECRET"), false);
  assert.deepEqual(JSON.parse(body), { error: "Authentication unavailable" });
});

test("rejects unsupported session methods", async () => {
  const response = await worker.fetch(
    request("/api/admin/session", { method: "PUT" }),
    env,
  );

  assert.equal(response.status, 405);
  assert.equal(response.headers.get("Allow"), "GET, POST, DELETE");
});

test("invalidates sessions when the signing secret changes", async () => {
  const token = await createAdminSessionToken(env);
  const changedEnv = {
    ...env,
    SESSION_SECRET: "different-synthetic-session-secret-with-thirty-two-bytes",
  };

  assert.equal(await verifyAdminSessionToken(token, changedEnv), false);
});

test("keeps the public health endpoint available", async () => {
  const response = await worker.fetch(request("/api/health"), {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});
