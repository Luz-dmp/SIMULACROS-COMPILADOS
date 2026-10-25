import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const bucket = "catalyst-private";
const retentionMs = 15 * 24 * 60 * 60 * 1000;
const signatureWindowSeconds = 300;
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

function sameInstant(left: string | null, right: string | null): boolean {
  const leftTime = left ? Date.parse(left) : Number.NaN;
  const rightTime = right ? Date.parse(right) : Number.NaN;
  return Number.isFinite(leftTime) && leftTime === rightTime;
}

function validPdfPath(ownerId: string, compilationId: string, path: unknown): path is string {
  if (typeof path !== "string") return false;
  const escapedOwner = ownerId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedCompilation = compilationId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escapedOwner}/generated-pdfs/${escapedCompilation}/pdf-${uuid}\\.pdf$`, "i").test(path);
}

function validHistoryReference(
  log: {
    actor_id: string | null;
    entity_id: string | null;
    operation: string;
    entity_type: string | null;
    status: string;
    details: Record<string, unknown> | null;
  },
  path: string,
  compilationId: string,
  ownerId: string,
  createdAt: string,
): boolean {
  return log.actor_id === ownerId
    && log.entity_id === compilationId
    && log.operation === "pdf.generated"
    && log.entity_type === "compilation"
    && log.status === "success"
    && log.details?.pdfRetention === true
    && log.details.pdfStoragePath === path
    && typeof log.details.pdfCreatedAt === "string"
    && sameInstant(log.details.pdfCreatedAt, createdAt);
}

async function isAuthorized(request: Request, secret: string): Promise<boolean> {
  const timestamp = request.headers.get("x-catalyst-timestamp") ?? "";
  const signature = request.headers.get("x-catalyst-signature") ?? "";
  if (!/^\d{10}$/.test(timestamp) || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > signatureWindowSeconds) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signatureBytes = new Uint8Array(signature.match(/.{2}/g)!.map((byte) => Number.parseInt(byte, 16)));
  return await crypto.subtle.verify("HMAC", key, signatureBytes, new TextEncoder().encode(timestamp));
}

async function checkReferences(
  service: ReturnType<typeof createClient>,
  path: string,
  compilationId: string,
  ownerId: string,
  createdAt: string,
  expectCompilationReference: boolean,
): Promise<{ ok: boolean; reason?: string; history?: Array<{
  id: number;
  actor_id: string | null;
  entity_id: string | null;
  operation: string;
  entity_type: string | null;
  status: string;
  details: Record<string, unknown> | null;
}> }> {
  const [sourcePath, processedPath, compilationReferences, history] = await Promise.all([
    service.from("documents").select("id").eq("storage_path", path).limit(1),
    service.from("documents").select("id").eq("processed_storage_path", path).limit(1),
    service.from("compilations").select("id,owner_id,pdf_storage_path,pdf_created_at")
      .eq("pdf_storage_path", path).limit(2),
    service.from("operation_logs")
      .select("id,actor_id,entity_id,operation,entity_type,status,details", { count: "exact" })
      .contains("details", { pdfStoragePath: path })
  ]);
  if (sourcePath.error) return { ok: false, reason: sourcePath.error.message };
  if (processedPath.error) return { ok: false, reason: processedPath.error.message };
  if (compilationReferences.error) return { ok: false, reason: compilationReferences.error.message };
  if (history.error) return { ok: false, reason: history.error.message };
  if (history.count === null || history.count !== (history.data?.length ?? 0)) {
    return { ok: false, reason: "The complete set of PDF history references could not be verified." };
  }
  if (sourcePath.data.length || processedPath.data.length) {
    return { ok: false, reason: "A document record also references the PDF path." };
  }
  const matchingCompilationReferences = compilationReferences.data ?? [];
  if (expectCompilationReference
    ? matchingCompilationReferences.length !== 1
      || matchingCompilationReferences[0].id !== compilationId
      || matchingCompilationReferences[0].owner_id !== ownerId
      || !sameInstant(matchingCompilationReferences[0].pdf_created_at, createdAt)
    : matchingCompilationReferences.length !== 0) {
    return { ok: false, reason: "The PDF compilation reference is missing, duplicated, or inconsistent." };
  }
  const historyRows = history.data ?? [];
  if (!historyRows.length || historyRows.some((log) =>
    !validHistoryReference(log, path, compilationId, ownerId, createdAt)
  )) {
    return { ok: false, reason: "The PDF history references are missing or inconsistent." };
  }
  return { ok: true, history: historyRows };
}

async function removePdfIfPresent(
  service: ReturnType<typeof createClient>,
  path: string,
): Promise<{ error: string | null; wasPresent: boolean }> {
  const separator = path.lastIndexOf("/");
  const folder = path.slice(0, separator);
  const name = path.slice(separator + 1);
  const storage = service.storage.from(bucket);
  const { data: files, error: listError } = await storage
    .list(folder, { limit: 100, search: name });
  if (listError) return { error: listError.message, wasPresent: false };
  if (!files) return { error: "Storage returned no file listing.", wasPresent: false };
  if (!files.some((file) => file.name === name)) return { error: null, wasPresent: false };

  const { error: removeError } = await storage.remove([path]);
  if (removeError && removeError.statusCode !== "404") {
    return { error: removeError.message, wasPresent: false };
  }
  const { data: remainingFiles, error: verifyError } = await storage
    .list(folder, { limit: 100, search: name });
  if (verifyError) return { error: verifyError.message, wasPresent: false };
  if (!remainingFiles) return { error: "Storage returned no verification listing.", wasPresent: false };
  if (remainingFiles.some((file) => file.name === name)) {
    return { error: "The PDF is still present after the storage removal request.", wasPresent: false };
  }
  return { error: null, wasPresent: true };
}

async function deletePdfHistory(
  service: ReturnType<typeof createClient>,
  history: Array<{
    id: number;
    actor_id: string | null;
    entity_id: string | null;
    operation: string;
    entity_type: string | null;
    status: string;
    details: Record<string, unknown> | null;
  }>,
  path: string,
  compilationId: string,
  ownerId: string,
  createdAt: string,
): Promise<{ removed: number; error: string | null }> {
  let removed = 0;
  for (const log of history) {
    if (!validHistoryReference(log, path, compilationId, ownerId, createdAt)) {
      return { removed, error: `History entry ${log.id} no longer matches the PDF reference.` };
    }
    const logCreatedAt = log.details?.pdfCreatedAt;
    if (typeof logCreatedAt !== "string") {
      return { removed, error: `History entry ${log.id} has no valid creation timestamp.` };
    }
    const { data, error } = await service.from("operation_logs").delete()
      .eq("id", log.id)
      .eq("actor_id", ownerId)
      .eq("entity_id", compilationId)
      .eq("operation", "pdf.generated")
      .eq("entity_type", "compilation")
      .eq("status", "success")
      .contains("details", {
        pdfRetention: true,
        pdfStoragePath: path,
        pdfCreatedAt: logCreatedAt,
      })
      .select("id");
    if (error) return { removed, error: error.message };
    removed += data?.length ?? 0;
  }
  const { data: remaining, error: verificationError } = await service.from("operation_logs")
    .select("id")
    .contains("details", { pdfStoragePath: path })
    .limit(1);
  if (verificationError) return { removed, error: verificationError.message };
  if (remaining?.length) {
    return { removed, error: "One or more PDF history references remain after deleting the validated events." };
  }
  return { removed, error: null };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed." }, { status: 405 });
  const cleanupSecret = Deno.env.get("CATALYST_PDF_CLEANUP_SECRET");
  if (!cleanupSecret) {
    return Response.json({ error: "Required cleanup authentication configuration is missing." }, { status: 500 });
  }
  if (!(await isAuthorized(request, cleanupSecret))) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const url = Deno.env.get("SUPABASE_URL");
  let fallbackServiceKey: string | undefined;
  if (!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) {
    try {
      const configuredKeys: unknown = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
      if (typeof configuredKeys === "object" && configuredKeys !== null && !Array.isArray(configuredKeys)) {
        const defaultKey = Reflect.get(configuredKeys, "default");
        if (typeof defaultKey === "string") fallbackServiceKey = defaultKey;
      }
    } catch {
      return Response.json({ error: "Supabase service configuration is invalid." }, { status: 500 });
    }
  }
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? fallbackServiceKey;
  if (!url || !serviceKey) {
    return Response.json({ error: "Required Supabase service configuration is missing." }, { status: 500 });
  }

  const service = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const cutoff = new Date(Date.now() - retentionMs).toISOString();
  const failures: string[] = [];
  let pdfsRemoved = 0;
  let historyRowsRemoved = 0;

  const { data: expired, error: expiredError } = await service.from("compilations")
    .select("id,owner_id,pdf_storage_path,pdf_created_at")
    .not("pdf_storage_path", "is", null)
    .lte("pdf_created_at", cutoff)
    .order("pdf_created_at", { ascending: true })
    .limit(100);
  if (expiredError) {
    return Response.json({ error: `Could not query expired PDFs: ${expiredError.message}` }, { status: 500 });
  }

  for (const compilation of expired ?? []) {
    const path = compilation.pdf_storage_path;
    const createdAt = compilation.pdf_created_at;
    const createdTime = createdAt ? Date.parse(createdAt) : Number.NaN;
    if (!validPdfPath(compilation.owner_id, compilation.id, path)
      || !createdAt
      || !Number.isFinite(createdTime)
      || createdTime > Date.now() - retentionMs) {
      failures.push(`Compilation ${compilation.id} has an unexpected PDF path.`);
      continue;
    }
    const references = await checkReferences(
      service,
      path,
      compilation.id,
      compilation.owner_id,
      createdAt,
      true,
    );
    if (!references.ok) {
      failures.push(`Compilation ${compilation.id}: ${references.reason}`);
      continue;
    }
    const { data: updated, error: updateError } = await service.from("compilations")
      .update({ pdf_storage_path: null, pdf_created_at: null })
      .eq("id", compilation.id)
      .eq("owner_id", compilation.owner_id)
      .eq("pdf_storage_path", path)
      .eq("pdf_created_at", createdAt)
      .lte("pdf_created_at", cutoff)
      .select("id,pdf_storage_path,pdf_created_at")
      .maybeSingle();
    let detached = Boolean(updated
      && updated.id === compilation.id
      && updated.pdf_storage_path === null
      && updated.pdf_created_at === null);
    if (updateError || !detached) {
      const { data: current, error: currentError } = await service.from("compilations")
        .select("pdf_storage_path,pdf_created_at")
        .eq("id", compilation.id)
        .eq("owner_id", compilation.owner_id)
        .maybeSingle();
      if (currentError) {
        failures.push(`Compilation ${compilation.id}: could not verify the updated reference after ${updateError?.message ?? "an empty update response"}: ${currentError.message}`);
        continue;
      }
      detached = Boolean(current
        && current.pdf_storage_path === null
        && current.pdf_created_at === null);
      if (!detached) {
        failures.push(`Compilation ${compilation.id}: ${updateError?.message ?? "the PDF reference was not cleared."}`);
        continue;
      }
    }

    const detachedReferences = await checkReferences(
      service,
      path,
      compilation.id,
      compilation.owner_id,
      createdAt,
      false,
    );
    if (!detachedReferences.ok || !detachedReferences.history) {
      failures.push(`Compilation ${compilation.id}: ${detachedReferences.reason ?? "PDF dependencies could not be revalidated."}`);
      continue;
    }

    const removal = await removePdfIfPresent(service, path);
    if (removal.error) {
      failures.push(`Compilation ${compilation.id}: ${removal.error}`);
      continue;
    }
    if (removal.wasPresent) pdfsRemoved++;

    const historyRemoval = await deletePdfHistory(
      service,
      detachedReferences.history,
      path,
      compilation.id,
      compilation.owner_id,
      createdAt,
    );
    if (historyRemoval.error) {
      historyRowsRemoved += historyRemoval.removed;
      failures.push(`Compilation ${compilation.id}: PDF removed, but its matching history could not be fully cleaned: ${historyRemoval.error}`);
      continue;
    }
    historyRowsRemoved += historyRemoval.removed;
  }

  const { data: oldPdfHistory, error: historyQueryError } = await service.from("operation_logs")
    .select("id,actor_id,entity_id,operation,entity_type,status,details")
    .eq("operation", "pdf.generated")
    .eq("entity_type", "compilation")
    .eq("status", "success")
    .contains("details", { pdfRetention: true })
    .lt("details->>pdfCreatedAt", cutoff)
    .order("created_at", { ascending: true })
    .limit(100);
  if (historyQueryError) {
    return Response.json({
      pdfsRemoved,
      historyRowsRemoved,
      failures: [...failures, `Could not query PDF history: ${historyQueryError.message}`]
    }, { status: 500 });
  }

  for (const log of oldPdfHistory ?? []) {
    const compilationId = log.entity_id;
    const path = log.details?.pdfStoragePath;
    const createdAt = log.details?.pdfCreatedAt;
    const ownerId = log.actor_id;
    if (!compilationId || typeof ownerId !== "string" || typeof createdAt !== "string"
      || !validPdfPath(ownerId, compilationId, path)
      || !Number.isFinite(Date.parse(createdAt))
      || Date.parse(createdAt) > Date.now() - retentionMs
      || !validHistoryReference(log, path, compilationId, ownerId, createdAt)) {
      failures.push(`History entry ${log.id} has an unexpected PDF reference.`);
      continue;
    }
    const { data: compilation, error: compilationError } = await service.from("compilations")
      .select("id,owner_id,pdf_storage_path,pdf_created_at")
      .eq("id", compilationId)
      .eq("owner_id", ownerId)
      .maybeSingle();
    if (compilationError) {
      failures.push(`History entry ${log.id}: ${compilationError.message}`);
      continue;
    }
    if (!compilation) {
      failures.push(`History entry ${log.id} has no verifiable compilation dependency.`);
      continue;
    }
    if (compilation.pdf_storage_path !== null || compilation.pdf_created_at !== null) {
      failures.push(`History entry ${log.id} still has an active or changed compilation reference.`);
      continue;
    }
    const references = await checkReferences(
      service,
      path,
      compilationId,
      ownerId,
      createdAt,
      false,
    );
    if (!references.ok || !references.history) {
      failures.push(`History entry ${log.id}: ${references.reason ?? "PDF dependencies could not be verified."}`);
      continue;
    }
    const removal = await removePdfIfPresent(service, path);
    if (removal.error) {
      failures.push(`History entry ${log.id}: ${removal.error}`);
      continue;
    }
    if (removal.wasPresent) pdfsRemoved++;
    const historyRemoval = await deletePdfHistory(
      service,
      references.history,
      path,
      compilationId,
      ownerId,
      createdAt,
    );
    historyRowsRemoved += historyRemoval.removed;
    if (historyRemoval.error) failures.push(`History entry ${log.id}: ${historyRemoval.error}`);
  }

  return Response.json({
    cutoff,
    pdfsRemoved,
    historyRowsRemoved,
    failures
  }, { status: failures.length ? 500 : 200 });
});
