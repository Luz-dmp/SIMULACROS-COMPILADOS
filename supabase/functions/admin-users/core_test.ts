import {
  configureInvitation,
  createAdminPreflightResponse,
  createAdminResponse,
  isAllowedOrigin,
  invitationHttpResult,
  isInitialInactiveProfile,
  parseAllowedOrigins,
  RequestError,
  validateUserInput,
} from "./core.ts";

const localAdminOrigin = "http://127.0.0.1:3000";
const localAdminOrigins = [localAdminOrigin];

function assertCorsOrigin(response: Response, expected: string | null): void {
  const actual = response.headers.get("Access-Control-Allow-Origin");
  if (actual !== expected) {
    throw new Error(`Expected CORS origin ${expected}, got ${actual}.`);
  }
}

Deno.test("allows the configured local origin on preflight and POST responses", () => {
  const options = createAdminPreflightResponse(
    localAdminOrigin,
    localAdminOrigins,
  );
  const post = createAdminResponse(
    { ok: true },
    200,
    localAdminOrigin,
    localAdminOrigins,
  );
  if (options.status !== 204 || post.status !== 200) {
    throw new Error("Allowed CORS requests returned unexpected statuses.");
  }
  for (const response of [options, post]) {
    assertCorsOrigin(response, localAdminOrigin);
    if (response.headers.get("Access-Control-Allow-Methods") !== "POST, OPTIONS") {
      throw new Error("CORS methods are missing or incorrect.");
    }
    const allowedHeaders = response.headers.get("Access-Control-Allow-Headers") ?? "";
    for (const header of ["apikey", "authorization", "content-type", "x-client-info"]) {
      if (!allowedHeaders.split(",").map((value) => value.trim()).includes(header)) {
        throw new Error(`CORS does not allow the ${header} request header.`);
      }
    }
  }
});

Deno.test("rejects an unconfigured origin for preflight and POST responses", () => {
  const untrustedOrigin = "http://localhost:3000";
  if (isAllowedOrigin(untrustedOrigin, localAdminOrigins)) {
    throw new Error("An origin differing by host was authorized.");
  }
  for (const response of [
    createAdminPreflightResponse(untrustedOrigin, localAdminOrigins),
    createAdminResponse({ error: "Origen no autorizado." }, 403, untrustedOrigin, localAdminOrigins),
  ]) {
    assertCorsOrigin(response, null);
    if (response.headers.has("Access-Control-Allow-Headers")) {
      throw new Error("An untrusted origin received CORS permission headers.");
    }
  }
});

Deno.test("rejects the opaque null origin even if present in configuration", () => {
  const configuredOrigins = [...localAdminOrigins, "null"];
  if (isAllowedOrigin("null", configuredOrigins)) {
    throw new Error("The opaque null origin was authorized.");
  }
  for (const response of [
    createAdminPreflightResponse("null", configuredOrigins),
    createAdminResponse({ error: "Origen no autorizado." }, 403, "null", configuredOrigins),
  ]) {
    assertCorsOrigin(response, null);
    if (response.headers.has("Access-Control-Allow-Headers")) {
      throw new Error("The opaque null origin received CORS permission headers.");
    }
  }
});

Deno.test("parses configured origins as trimmed exact entries", () => {
  const parsed = parseAllowedOrigins(
    " http://127.0.0.1:3000, ,https://catalyst.example.org ",
  );
  if (
    parsed.length !== 2 ||
    parsed[0] !== localAdminOrigin ||
    parsed[1] !== "https://catalyst.example.org"
  ) {
    throw new Error("Configured origins were not parsed as exact entries.");
  }
});

const validTutor = {
  name: "  Tutor de prueba  ",
  role: "tutor",
  areas: ["Mat", "Mat", "Ing"],
};

Deno.test("validates and normalizes tutor name and areas", () => {
  const config = validateUserInput(validTutor);
  if (config.name !== "Tutor de prueba") {
    throw new Error("Name was not trimmed.");
  }
  if (config.areas.join(",") !== "Mat,Ing") {
    throw new Error("Areas were not deduplicated.");
  }
});

Deno.test("rejects invalid role, unknown area, and tutor without areas", () => {
  for (
    const input of [
      { ...validTutor, role: "owner" },
      { ...validTutor, areas: ["Unknown"] },
      { ...validTutor, areas: [] },
    ]
  ) {
    let rejected = false;
    try {
      validateUserInput(input);
    } catch (error) {
      rejected = error instanceof RequestError;
    }
    if (!rejected) throw new Error("Invalid user data was accepted.");
  }
});

Deno.test("does not allow recovery to change an already modified profile", () => {
  const initial = {
    full_name: "Tutor",
    role: "tutor",
    is_active: false,
    areas: [],
  };
  if (
    !isInitialInactiveProfile(initial, "Tutor") ||
    !isInitialInactiveProfile(null, "Tutor")
  ) {
    throw new Error(
      "Default profile or missing profile should be safe to inspect.",
    );
  }
  if (isInitialInactiveProfile({ ...initial, is_active: true }, "Tutor")) {
    throw new Error("Active profile was considered safe for partial recovery.");
  }
  if (isInitialInactiveProfile({ ...initial, role: "admin" }, "Tutor")) {
    throw new Error("Changed role was considered safe for partial recovery.");
  }
  if (isInitialInactiveProfile({ ...initial, areas: ["Mat"] }, "Tutor")) {
    throw new Error(
      "Assigned profile was considered safe for partial recovery.",
    );
  }
  if (
    isInitialInactiveProfile({ ...initial, full_name: "Otro nombre" }, "Tutor")
  ) {
    throw new Error("Changed name was considered safe for partial recovery.");
  }
});

Deno.test("configures an invitation and audits a confirmed success", async () => {
  const audits: Array<{ outcome: string; details: Record<string, unknown> }> =
    [];
  const result = await configureInvitation("tutor@example.test", {
    name: "Tutor",
    role: "tutor",
    areas: ["Mat"],
  }, {
    invite: () => Promise.resolve({ id: "test-user" }),
    configure: () => Promise.resolve(),
    remove: () =>
      Promise.reject(
        new Error("Removal must not run after configuration succeeds."),
      ),
    audit: (_id, entry) => {
      audits.push(entry);
      return Promise.resolve(null);
    },
  });
  if (result.outcome !== "success" || audits[0]?.outcome !== "success") {
    throw new Error("Successful invitation was not reported and audited.");
  }
  if (audits[0].details.email !== "tutor@example.test") {
    throw new Error("Audit record lost the invite identity.");
  }
  const http = invitationHttpResult(result);
  if (http.status !== 200 || http.body.ok !== true) {
    throw new Error("Successful invitation used an incorrect HTTP result.");
  }
  if ("password" in audits[0].details || "token" in audits[0].details) {
    throw new Error("Sensitive credentials must not enter the audit.");
  }
});

Deno.test("reports failure when configuration fails and compensation succeeds", async () => {
  let removed = false;
  let auditOutcome = "";
  const result = await configureInvitation("tutor@example.test", {
    name: "Tutor",
    role: "tutor",
    areas: ["Mat"],
  }, {
    invite: () => Promise.resolve({ id: "test-user" }),
    configure: () => Promise.reject(new Error("RPC unavailable")),
    remove: () => {
      removed = true;
      return Promise.resolve();
    },
    audit: (_id, entry) => {
      auditOutcome = entry.outcome;
      return Promise.resolve(null);
    },
  });
  if (!removed || auditOutcome !== "failure" || result.outcome !== "failure") {
    throw new Error("Compensated failure was not reported accurately.");
  }
  if (!result.error?.includes("cuenta se eliminó")) {
    throw new Error(
      "The UI response does not explain successful compensation.",
    );
  }
  if (invitationHttpResult(result).status !== 500) {
    throw new Error("Compensated failure must not return success HTTP status.");
  }
});

Deno.test("reports partial outcome and persists recovery data when compensation fails", async () => {
  const audits: Array<{ outcome: string; details: Record<string, unknown> }> =
    [];
  const result = await configureInvitation("tutor@example.test", {
    name: "Tutor",
    role: "tutor",
    areas: ["Mat", "Ing"],
  }, {
    invite: () => Promise.resolve({ id: "test-user" }),
    configure: () => Promise.reject(new Error("RPC unavailable")),
    remove: () => Promise.reject(new Error("Auth deletion unavailable")),
    audit: (_id, entry) => {
      audits.push(entry);
      return Promise.resolve(null);
    },
  });
  const audited = audits[0];
  if (result.outcome !== "partial" || audited?.outcome !== "partial") {
    throw new Error("Failed compensation was not classified as partial.");
  }
  if (
    audited.details.name !== "Tutor" ||
    audited.details.role !== "tutor" ||
    (audited.details.areas as string[]).join(",") !== "Mat,Ing"
  ) {
    throw new Error(
      "The partial audit lacks the safe profile recovery details.",
    );
  }
  if (!result.error?.includes("Revisión manual requerida")) {
    throw new Error("Partial failure was not clearly reported.");
  }
  if (invitationHttpResult(result).status !== 207) {
    throw new Error("Failed compensation must return HTTP 207.");
  }
  if ("password" in audited.details || "token" in audited.details) {
    throw new Error("Sensitive credentials must not enter the partial audit.");
  }
});

Deno.test("keeps confirmed invitation success explicit when audit persistence fails", async () => {
  const result = await configureInvitation("tutor@example.test", {
    name: "Tutor",
    role: "tutor",
    areas: ["Mat"],
  }, {
    invite: () => Promise.resolve({ id: "test-user" }),
    configure: () => Promise.resolve(),
    remove: () => Promise.resolve(),
    audit: () => Promise.resolve("audit unavailable"),
  });
  const http = invitationHttpResult(result);
  if (http.status !== 200 || http.body.ok !== true) {
    throw new Error("Confirmed changes must remain success-shaped.");
  }
  if (!http.body.warning?.toString().includes("audit unavailable")) {
    throw new Error("Audit persistence failure was not reported as a warning.");
  }
});

Deno.test("propagates Auth invitation failure without configuration or audit", async () => {
  let configured = false;
  let audited = false;
  let rejected = false;
  try {
    await configureInvitation("tutor@example.test", {
      name: "Tutor",
      role: "tutor",
      areas: ["Mat"],
    }, {
      invite: () => Promise.reject(new Error("Auth unavailable")),
      configure: () => {
        configured = true;
        return Promise.resolve();
      },
      remove: () => Promise.resolve(),
      audit: () => {
        audited = true;
        return Promise.resolve(null);
      },
    });
  } catch (error) {
    rejected = error instanceof Error && error.message === "Auth unavailable";
  }
  if (!rejected || configured || audited) {
    throw new Error(
      "Auth invitation failures must stop subsequent operations.",
    );
  }
});
