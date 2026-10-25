export class RequestError extends Error {}

export type UserConfiguration = {
  name: string;
  role: "admin" | "tutor";
  areas: string[];
};

const areaCodes = new Set(["Mat", "Lec", "Soc", "Nat", "Ing"]);
const publicAppUrl =
  "https://luz-dmp.github.io/SIMULACROS-COMPILADOS/";

export function publicAuthRedirectUrl(flow?: "invite"): string {
  const url = new URL(publicAppUrl);
  if (flow) url.searchParams.set("flow", flow);
  return url.toString();
}

export function parseAllowedOrigins(value: string | undefined): string[] {
  return (value ?? "").split(",").map((origin) => origin.trim()).filter(
    Boolean,
  );
}

export function isAllowedOrigin(
  origin: string | null,
  allowedOrigins: readonly string[],
): origin is string {
  return origin !== null && origin !== "null" &&
    allowedOrigins.includes(origin);
}

export function createAdminCorsHeaders(
  origin: string | null,
  allowedOrigins: readonly string[],
): Headers {
  const headers = new Headers({ "Vary": "Origin" });
  if (isAllowedOrigin(origin, allowedOrigins)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set(
      "Access-Control-Allow-Headers",
      "authorization, x-client-info, apikey, content-type",
    );
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  }
  return headers;
}

export function createAdminResponse(
  body: Record<string, unknown>,
  status: number,
  origin: string | null,
  allowedOrigins: readonly string[],
): Response {
  const headers = createAdminCorsHeaders(origin, allowedOrigins);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers });
}

export function createAdminPreflightResponse(
  origin: string | null,
  allowedOrigins: readonly string[],
): Response {
  return new Response(null, {
    status: 204,
    headers: createAdminCorsHeaders(origin, allowedOrigins),
  });
}

export function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Error inesperado en la operación administrativa.";
}

export function validateUserInput(
  body: Record<string, unknown>,
): UserConfiguration {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const role = body.role;
  const areas = body.areas;
  if (name.length < 2 || name.length > 80) {
    throw new RequestError("El nombre debe tener entre 2 y 80 caracteres.");
  }
  if (role !== "admin" && role !== "tutor") {
    throw new RequestError("El rol no es válido.");
  }
  if (
    !Array.isArray(areas) ||
    areas.some((area) => typeof area !== "string" || !areaCodes.has(area))
  ) {
    throw new RequestError("La selección de áreas no es válida.");
  }
  const uniqueAreas = [...new Set(areas as string[])];
  if (role === "tutor" && !uniqueAreas.length) {
    throw new RequestError("Un tutor debe tener al menos un área asignada.");
  }
  return { name, role, areas: role === "admin" ? [] : uniqueAreas };
}

type AuditOutcome = "success" | "failure" | "partial";
type InvitationAudit = {
  outcome: AuditOutcome;
  details: Record<string, unknown>;
};

export function isInitialInactiveProfile(
  profile: {
    full_name: string;
    role: string;
    is_active: boolean;
    areas: string[];
  } | null,
  expectedName: string,
): boolean {
  return !profile || (
    profile.full_name === expectedName &&
    profile.role === "tutor" &&
    profile.is_active === false &&
    profile.areas.length === 0
  );
}

export function invitationHttpResult(result: {
  outcome: AuditOutcome;
  error?: string;
  warning?: string;
}): { status: number; body: Record<string, unknown> } {
  if (result.outcome !== "success") {
    return {
      status: result.outcome === "partial" ? 207 : 500,
      body: { ok: false, outcome: result.outcome, error: result.error },
    };
  }
  return {
    status: 200,
    body: {
      ok: true,
      outcome: "success",
      ...(result.warning ? { warning: result.warning } : {}),
    },
  };
}

export async function configureInvitation(
  email: string,
  configuration: UserConfiguration,
  dependencies: {
    invite: () => Promise<{ id: string }>;
    configure: (id: string, config: UserConfiguration) => Promise<void>;
    remove: (id: string) => Promise<void>;
    audit: (id: string, entry: InvitationAudit) => Promise<string | null>;
  },
): Promise<{
  id: string;
  outcome: AuditOutcome;
  error?: string;
  warning?: string;
}> {
  const { id } = await dependencies.invite();
  try {
    await dependencies.configure(id, configuration);
  } catch (configurationError) {
    const configurationMessage = messageOf(configurationError);
    let compensationError: string | null = null;
    try {
      await dependencies.remove(id);
    } catch (error) {
      compensationError = messageOf(error);
    }
    const outcome = compensationError ? "partial" : "failure";
    const details = {
      email,
      name: configuration.name,
      role: configuration.role,
      areas: configuration.areas,
      error: configurationMessage,
      compensationError,
      outcome,
    };
    const auditError = await dependencies.audit(id, { outcome, details });
    const error = compensationError
      ? `La invitación se creó, pero no se pudo configurar el perfil ni retirar la cuenta. Revisión manual requerida: ${configurationMessage}; limpieza: ${compensationError}.`
      : `No se pudo configurar el perfil; la invitación se canceló y la cuenta se eliminó: ${configurationMessage}`;
    return {
      id,
      outcome,
      error: `${error}${
        auditError
          ? ` Además, no se pudo registrar en el historial: ${auditError}`
          : ""
      }`,
    };
  }

  const auditError = await dependencies.audit(id, {
    outcome: "success",
    details: {
      email,
      name: configuration.name,
      role: configuration.role,
      areas: configuration.areas,
      outcome: "success",
    },
  });
  return {
    id,
    outcome: "success",
    ...(auditError
      ? {
        warning:
          `La invitación y el perfil se confirmaron, pero no se pudo registrar el historial: ${auditError}`,
      }
      : {}),
  };
}
