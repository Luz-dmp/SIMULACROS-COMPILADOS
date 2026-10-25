import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import {
  configureInvitation,
  createAdminPreflightResponse,
  createAdminResponse,
  isAllowedOrigin,
  invitationHttpResult,
  isInitialInactiveProfile,
  messageOf,
  parseAllowedOrigins,
  RequestError,
  validateUserInput,
} from "./core.ts";

type ServiceClient = SupabaseClient;

class OperationConflictError extends Error {}

function partialAccountFields(
  profile: {
    full_name: string;
    role: string;
    is_active: boolean;
    user_areas?: Array<{ area_code: string }>;
  } | null,
  details?: Record<string, unknown>,
): {
  partialRecovery: boolean;
  canRecoverConfiguration: boolean;
  canCleanupPartial: boolean;
} {
  if (!details) {
    return {
      partialRecovery: false,
      canRecoverConfiguration: false,
      canCleanupPartial: false,
    };
  }
  let validConfiguration = false;
  try {
    validateUserInput(details);
    validConfiguration = true;
  } catch (error) {
    if (!(error instanceof RequestError)) throw error;
  }
  const expectedAreas = Array.isArray(details.areas)
    ? [
      ...new Set(
        details.areas.filter((area): area is string =>
          typeof area === "string"
        ),
      ),
    ].sort()
    : [];
  const currentAreas = (profile?.user_areas ?? []).map((area) => area.area_code)
    .sort();
  const alreadyConfigured = !!profile &&
    profile.full_name === details.name &&
    profile.role === details.role &&
    profile.is_active === false &&
    currentAreas.length === expectedAreas.length &&
    currentAreas.every((area, index) => area === expectedAreas[index]);
  const safeInitialState = isInitialInactiveProfile(
    profile
      ? {
        full_name: profile.full_name,
        role: profile.role,
        is_active: profile.is_active,
        areas: currentAreas,
      }
      : null,
    typeof details.name === "string" ? details.name : "",
  );
  return {
    partialRecovery: !alreadyConfigured,
    canRecoverConfiguration: !alreadyConfigured && safeInitialState &&
      validConfiguration && !!profile,
    canCleanupPartial: !alreadyConfigured && safeInitialState,
  };
}

async function listAllAuthUsers(service: ServiceClient): Promise<User[]> {
  const users: User[] = [];
  for (let page = 1;; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({
      page,
      perPage: 100,
    });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 100) return users;
  }
}

async function recordOperation(
  service: ServiceClient,
  actorId: string,
  operation: string,
  entityId: string | null,
  outcome: "success" | "failure" | "partial",
  details: Record<string, unknown>,
): Promise<string | null> {
  try {
    const { error } = await service.from("operation_logs").insert({
      actor_id: actorId,
      operation,
      entity_type: "user",
      entity_id: entityId,
      status: outcome === "success" ? "success" : "failure",
      details: { ...details, outcome },
    });
    return error ? error.message : null;
  } catch (error) {
    return messageOf(error);
  }
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("Origin");
  const allowedOrigins = parseAllowedOrigins(
    Deno.env.get("CATALYST_APP_ORIGINS"),
  );
  const response = (
    body: Record<string, unknown>,
    status: number,
  ): Response => createAdminResponse(body, status, origin, allowedOrigins);
  if (origin !== null && !isAllowedOrigin(origin, allowedOrigins)) {
    return response({ error: "Origen no autorizado." }, 403);
  }
  if (request.method === "OPTIONS") {
    return createAdminPreflightResponse(origin, allowedOrigins);
  }
  if (request.method !== "POST") {
    return response({ error: "Método no permitido." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const secretKeysEnv = Deno.env.get("SUPABASE_SECRET_KEYS");
  let secretKey: string | undefined;
  if (secretKeysEnv) {
    try {
      const secretKeys: unknown = JSON.parse(secretKeysEnv);
      if (
        secretKeys && typeof secretKeys === "object" &&
        "default" in secretKeys &&
        typeof secretKeys.default === "string"
      ) {
        secretKey = secretKeys.default;
      }
    } catch {
      return response(
        {
          error:
            "La configuración de claves secretas de Supabase no es válida.",
        },
        500,
      );
    }
  }
  const adminApiKey = secretKey || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !adminApiKey) {
    return response(
      { error: "Falta configurar la función administrativa en el servidor." },
      500,
    );
  }

  const authorization = request.headers.get("Authorization") ?? "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) {
    return response(
      { error: "Se requiere una sesión administrativa válida." },
      401,
    );
  }

  const service = createClient(supabaseUrl, adminApiKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } = await service.auth.getUser(
    token,
  );
  if (authError || !authData.user) {
    return response(
      { error: "La sesión administrativa no es válida." },
      401,
    );
  }
  const actorId = authData.user.id;
  const { data: actor, error: actorError } = await service.from("profiles")
    .select("id,role,is_active").eq("id", actorId).maybeSingle();
  if (actorError) {
    return response(
      {
        error:
          `No se pudo validar el perfil administrador: ${actorError.message}`,
      },
      500,
    );
  }
  if (!actor || actor.role !== "admin" || actor.is_active !== true) {
    return response(
      { error: "Se requieren permisos administrativos activos." },
      403,
    );
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("El cuerpo de la solicitud no es válido.");
    }
    body = parsed as Record<string, unknown>;
  } catch (error) {
    return response({ error: messageOf(error) }, 400);
  }

  const action = body.action;
  if (action === "list") {
    try {
      const [users, profilesResult, partialLogs, resolutions] = await Promise
        .all([
          listAllAuthUsers(service),
          service.from("profiles").select(
            "id,full_name,role,is_active,user_areas(area_code)",
          ).order("full_name"),
          service.from("operation_logs").select("entity_id,actor_id,details")
            .eq("operation", "admin.user.create")
            .eq("status", "failure").contains("details", { outcome: "partial" })
            .order("created_at", { ascending: false }).limit(1000),
          service.from("operation_logs").select("entity_id,operation,actor_id")
            .eq("status", "success")
            .in("operation", [
              "admin.user.recover-partial",
              "admin.user.cleanup-partial",
            ])
            .limit(1000),
        ]);
      if (profilesResult.error) throw profilesResult.error;
      if (partialLogs.error) throw partialLogs.error;
      if (resolutions.error) throw resolutions.error;
      const authUsers = new Map(users.map((user) => [user.id, user]));
      const profileIds = new Set(
        profilesResult.data.map((profile) => profile.id),
      );
      const administratorIds = new Set(
        profilesResult.data.filter((profile) => profile.role === "admin").map((
          profile,
        ) => profile.id),
      );
      const resolvedIds = new Set(
        (resolutions.data ?? []).filter((entry) =>
          administratorIds.has(entry.actor_id)
        ).map((entry) => `${entry.entity_id}:${entry.operation}`),
      );
      const pendingRecovery = new Map<string, Record<string, unknown>>();
      for (const log of partialLogs.data ?? []) {
        if (!administratorIds.has(log.actor_id)) continue;
        const isResolved = [
          "admin.user.recover-partial",
          "admin.user.cleanup-partial",
        ]
          .some((resolution) =>
            resolvedIds.has(`${log.entity_id}:${resolution}`)
          );
        if (
          log.entity_id && !isResolved && !pendingRecovery.has(log.entity_id)
        ) {
          pendingRecovery.set(log.entity_id, log.details ?? {});
        }
      }
      return response(
        {
          ok: true,
          users: [
            ...profilesResult.data.map((profile) => {
              const authUser = authUsers.get(profile.id);
              return {
                id: profile.id,
                name: profile.full_name,
                email: authUser?.email ?? "",
                role: profile.role,
                active: profile.is_active === true && !!authUser,
                authAccountMissing: !authUser,
                emailConfirmed: authUser ? !!authUser.email_confirmed_at : null,
                areas: (profile.user_areas ?? []).map((
                  area: { area_code: string },
                ) => area.area_code),
                ...partialAccountFields(
                  profile,
                  pendingRecovery.get(profile.id),
                ),
              };
            }),
            ...users.filter((user) => !profileIds.has(user.id)).map((user) => ({
              id: user.id,
              name: typeof user.user_metadata?.full_name === "string"
                ? user.user_metadata.full_name
                : "Perfil pendiente",
              email: user.email ?? "",
              role: "sin-perfil",
              active: false,
              profileMissing: true,
              emailConfirmed: !!user.email_confirmed_at,
              areas: [],
              ...partialAccountFields(null, pendingRecovery.get(user.id)),
            })),
          ],
        },
        200,
      );
    } catch (error) {
      return response(
        {
          error: `No se pudo cargar el directorio de usuarios: ${
            messageOf(error)
          }`,
        },
        500,
      );
    }
  }

  let operation = "";
  let targetId: string | null = null;
  let operationDetails: Record<string, unknown> = {};
  try {
    if (action === "recover-partial" || action === "cleanup-partial") {
      operation = action === "recover-partial"
        ? "admin.user.recover-partial"
        : "admin.user.cleanup-partial";
      operationDetails = { sourceOperation: "admin.user.create" };
      targetId = typeof body.id === "string" ? body.id : null;
      if (!targetId) {
        throw new RequestError("Falta el identificador de la invitación.");
      }
      const { data: partialLog, error: partialLogError } = await service.from(
        "operation_logs",
      )
        .select("actor_id,details").eq("operation", "admin.user.create").eq(
          "entity_id",
          targetId,
        )
        .eq("status", "failure").contains("details", { outcome: "partial" })
        .maybeSingle();
      if (partialLogError) throw partialLogError;
      if (!partialLog) {
        throw new OperationConflictError(
          "No se encontró un registro de invitación parcialmente completada que puedas recuperar.",
        );
      }
      const { data: originalActor, error: originalActorError } = await service
        .from("profiles").select("role").eq("id", partialLog.actor_id)
        .maybeSingle();
      if (originalActorError) throw originalActorError;
      if (originalActor?.role !== "admin") {
        throw new OperationConflictError(
          "El registro parcial no procede de una operación administrativa verificable.",
        );
      }

      const { data: targetAuth, error: targetAuthError } = await service.auth
        .admin.getUserById(targetId);
      if (targetAuthError) throw targetAuthError;
      if (!targetAuth.user) {
        throw new OperationConflictError(
          "La cuenta Auth ya no existe; no queda ninguna invitación que recuperar.",
        );
      }

      const { data: profile, error: profileError } = await service.from(
        "profiles",
      )
        .select("id,full_name,role,is_active,user_areas(area_code)").eq(
          "id",
          targetId,
        )
        .maybeSingle();
      if (profileError) throw profileError;
      if (
        !isInitialInactiveProfile(
          profile
            ? {
              full_name: profile.full_name,
              role: profile.role,
              is_active: profile.is_active,
              areas: (profile.user_areas ?? []).map((
                area: { area_code: string },
              ) => area.area_code),
            }
            : null,
          typeof partialLog.details?.name === "string"
            ? partialLog.details.name
            : "",
        )
      ) {
        throw new OperationConflictError(
          "El perfil ya no coincide con el estado inicial inactivo y sin áreas; no se modificó.",
        );
      }

      if (action === "recover-partial") {
        if (!profile) {
          throw new OperationConflictError(
            "No existe un perfil que se pueda configurar. Puedes cancelar la invitación desde la acción de limpieza.",
          );
        }
        const configuration = validateUserInput(partialLog.details ?? {});
        if (
          typeof partialLog.details?.email !== "string" ||
          partialLog.details.email.toLowerCase() !==
            targetAuth.user.email?.toLowerCase()
        ) {
          throw new OperationConflictError(
            "El correo del registro parcial no coincide con la cuenta Auth.",
          );
        }
        const { error } = await service.rpc("catalyst_admin_configure_user", {
          actor_id: actorId,
          target_id: targetId,
          new_name: configuration.name,
          new_role: configuration.role,
          new_areas: configuration.areas,
        });
        if (error) throw error;
        const auditError = await recordOperation(
          service,
          actorId,
          operation,
          targetId,
          "success",
          {
            sourceOperation: "admin.user.create",
            name: configuration.name,
            role: configuration.role,
            areas: configuration.areas,
            active: false,
          },
        );
        return response(
          {
            ok: true,
            outcome: "success",
            ...(auditError
              ? {
                warning:
                  `El perfil se configuró, pero no se pudo registrar la recuperación en el historial: ${auditError}`,
              }
              : {}),
          },
          200,
        );
      }
      const email = targetAuth.user.email?.toLowerCase() ?? "";
      if (
        typeof partialLog.details?.email !== "string" ||
        partialLog.details.email.toLowerCase() !== email
      ) {
        throw new OperationConflictError(
          "El correo del registro parcial no coincide con la cuenta Auth.",
        );
      }
      operationDetails = { sourceOperation: "admin.user.create", email };
      const { error: deleteError } = await service.auth.admin.deleteUser(
        targetId,
      );
      if (deleteError) {
        const auditError = await recordOperation(
          service,
          actorId,
          operation,
          targetId,
          "partial",
          {
            email,
            sourceOperation: "admin.user.create",
            error: deleteError.message,
          },
        );
        return response(
          {
            ok: false,
            outcome: "partial",
            error:
              `La cuenta sigue pendiente; no se pudo cancelar la invitación: ${deleteError.message}${
                auditError
                  ? ` Además, no se pudo registrar en el historial: ${auditError}`
                  : ""
              }`,
          },
          207,
        );
      }
      const auditError = await recordOperation(
        service,
        actorId,
        operation,
        targetId,
        "success",
        {
          email,
          sourceOperation: "admin.user.create",
        },
      );
      return response(
        {
          ok: true,
          outcome: "success",
          ...(auditError
            ? {
              warning:
                `La invitación se canceló, pero no se pudo registrar la limpieza en el historial: ${auditError}`,
            }
            : {}),
        },
        200,
      );
    }

    if (action === "create") {
      operation = "admin.user.create";
      const { name, role, areas } = validateUserInput(body);
      const email = typeof body.email === "string"
        ? body.email.trim().toLowerCase()
        : "";
      if (
        !email || email.length > 160 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      ) {
        throw new RequestError("Escribe un correo electrónico válido.");
      }
      operationDetails = { email, name, role, areas };
      const redirectTo = origin ? `${origin}/` : undefined;
      const result = await configureInvitation(email, { name, role, areas }, {
        invite: async () => {
          const { data, error } = await service.auth.admin.inviteUserByEmail(
            email,
            {
              data: { full_name: name },
              ...(redirectTo ? { redirectTo } : {}),
            },
          );
          if (error) throw error;
          if (!data.user) {
            throw new Error("Auth no devolvió la cuenta invitada.");
          }
          return { id: data.user.id };
        },
        configure: async (id, configuration) => {
          const { error } = await service.rpc(
            "catalyst_admin_configure_user",
            {
              actor_id: actorId,
              target_id: id,
              new_name: configuration.name,
              new_role: configuration.role,
              new_areas: configuration.areas,
            },
          );
          if (error) throw new Error(error.message);
        },
        remove: async (id) => {
          const { error } = await service.auth.admin.deleteUser(id);
          if (error) throw new Error(error.message);
        },
        audit: (id, { outcome, details }) =>
          recordOperation(service, actorId, operation, id, outcome, details),
      });
      targetId = result.id;
      const inviteResult = invitationHttpResult(result);
      return response(
        inviteResult.body,
        inviteResult.status,
      );
    }

    if (action === "update") {
      operation = "admin.user.update";
      targetId = typeof body.id === "string" ? body.id : null;
      if (!targetId) {
        throw new RequestError("Falta el identificador del usuario.");
      }
      const { name, role, areas } = validateUserInput(body);
      operationDetails = { name, role, areas };
      const { data: previousProfile, error: previousProfileError } =
        await service.from("profiles")
          .select("full_name").eq("id", targetId).maybeSingle();
      if (previousProfileError) throw previousProfileError;
      if (!previousProfile) {
        throw new RequestError(
          "No existe el perfil del usuario que se quiere editar.",
        );
      }
      operationDetails = {
        ...operationDetails,
        previousName: previousProfile.full_name,
      };
      const { error } = await service.rpc("catalyst_admin_configure_user", {
        actor_id: actorId,
        target_id: targetId,
        new_name: name,
        new_role: role,
        new_areas: areas,
      });
      if (error) throw error;
      const auditError = await recordOperation(
        service,
        actorId,
        operation,
        targetId,
        "success",
        {
          previousName: previousProfile.full_name,
          name,
          role,
          areas,
        },
      );
      return response(
        {
          ok: true,
          outcome: "success",
          ...(auditError
            ? {
              warning:
                `Los cambios se confirmaron, pero no se pudo registrar el historial: ${auditError}`,
            }
            : {}),
        },
        200,
      );
    }

    if (action === "set-active") {
      operation = "admin.user.set-active";
      targetId = typeof body.id === "string" ? body.id : null;
      if (!targetId || typeof body.active !== "boolean") {
        throw new RequestError(
          "El usuario o el estado solicitado no son válidos.",
        );
      }
      operationDetails = { active: body.active };
      const { error } = await service.rpc("catalyst_admin_set_user_active", {
        actor_id: actorId,
        target_id: targetId,
        active_state: body.active,
      });
      if (error) throw error;
      const auditError = await recordOperation(
        service,
        actorId,
        operation,
        targetId,
        "success",
        { active: body.active },
      );
      return response(
        {
          ok: true,
          outcome: "success",
          ...(auditError
            ? {
              warning:
                `El cambio de estado se confirmó, pero no se pudo registrar el historial: ${auditError}`,
            }
            : {}),
        },
        200,
      );
    }

    if (action === "reset") {
      operation = "admin.user.password-reset";
      const email = typeof body.email === "string"
        ? body.email.trim().toLowerCase()
        : "";
      if (!email) {
        throw new RequestError("Falta el correo electrónico de la cuenta.");
      }
      operationDetails = { email };
      const authUsers = await listAllAuthUsers(service);
      const target = authUsers.find((user) =>
        user.email?.toLowerCase() === email
      );
      if (!target) throw new Error("No existe una cuenta Auth con ese correo.");
      targetId = target.id;
      const { error } = await service.auth.resetPasswordForEmail(email, {
        ...(origin ? { redirectTo: `${origin}/` } : {}),
      });
      if (error) throw error;
      const auditError = await recordOperation(
        service,
        actorId,
        operation,
        targetId,
        "success",
        { email },
      );
      return response(
        {
          ok: true,
          outcome: "success",
          ...(auditError
            ? {
              warning:
                `La solicitud de recuperación se aceptó, pero no se pudo registrar el historial: ${auditError}`,
            }
            : {}),
        },
        200,
      );
    }

    return response(
      { error: "La acción administrativa solicitada no está soportada." },
      400,
    );
  } catch (error) {
    const reason = messageOf(error);
    const auditError = operation
      ? await recordOperation(
        service,
        actorId,
        operation,
        targetId,
        "failure",
        { ...operationDetails, error: reason },
      )
      : null;
    return response(
      {
        ok: false,
        outcome: "failure",
        error: `${reason}${
          auditError
            ? ` Además, no se pudo registrar en el historial: ${auditError}`
            : ""
        }`,
      },
      error instanceof OperationConflictError
        ? 409
        : error instanceof RequestError
        ? 400
        : 500,
    );
  }
});
