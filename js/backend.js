(function () {
  'use strict';

  const config = window.CATALYST_BACKEND_CONFIG || {};
  let client = null;
  let currentUser = null;
  let startupError = '';
  let readyResolve;
  const ready = new Promise(resolve => { readyResolve = resolve; });

  function emit(status, error = null) {
    window.dispatchEvent(new CustomEvent('catalyst:auth', {
      detail: { status, user: currentUser, error }
    }));
  }

  function normalizeError(error) {
    return error?.message || 'Ocurrió un error de comunicación con el servicio.';
  }

  function profileLoadError(error) {
    if (error?.code === '42P01' || error?.code === 'PGRST205') {
      return new Error('Falta instalar el esquema de Catalyst en Supabase: no existe public.profiles. Aplica las migraciones del proyecto y vuelve a iniciar sesión.');
    }
    return new Error(`No se pudo validar tu perfil: ${normalizeError(error)}`);
  }

  async function loadProfile(authUser, authStatus = 'signed-in') {
    if (!authUser) {
      currentUser = null;
      emit('signed-out');
      return;
    }
    const { data: profile, error } = await client.from('profiles')
      .select('id,full_name,role,is_active,user_areas(area_code)')
      .eq('id', authUser.id).maybeSingle();
    if (error) {
      await client.auth.signOut();
      currentUser = null;
      const profileError = profileLoadError(error);
      throw new Error(`${profileError.message} Se cerró la sesión por seguridad.`);
    }
    if (!profile || !profile.is_active) {
      await client.auth.signOut();
      currentUser = null;
      const inactiveError = new Error('No existe un perfil activo para esta cuenta. Contacta con administración para que verifique el rol y habilite el acceso.');
      emit('signed-out', inactiveError);
      throw inactiveError;
    }
    currentUser = {
      id: profile.id,
      name: profile.full_name,
      email: authUser.email || '',
      role: profile.role,
      active: profile.is_active,
      areas: (profile.user_areas || []).map(item => item.area_code)
    };
    emit(authStatus);
  }

  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    startupError = 'Configura la URL del proyecto y la clave publishable/anon de Supabase en js/backend-config.js; no se permite el acceso local de demostración.';
    emit('unconfigured', new Error(startupError));
    readyResolve(false);
  } else if (!window.supabase?.createClient) {
    startupError = 'No se pudo cargar el SDK de Supabase. Comprueba la conexión y el bloqueo del CDN.';
    emit('unconfigured', new Error(startupError));
    readyResolve(false);
  } else {
    client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        currentUser = null;
        emit('signed-out');
      } else if (session?.user) {
        queueMicrotask(() => loadProfile(session.user, event === 'PASSWORD_RECOVERY' ? 'password-recovery' : 'signed-in')
          .catch(error => emit('error', error)));
      }
    });
    client.auth.getSession().then(({ data, error }) => {
      if (error) throw error;
      return loadProfile(data.session?.user || null);
    }).then(() => readyResolve(true)).catch(error => {
      emit('error', error);
      readyResolve(false);
    });
  }

  async function invokeAdmin(body) {
    await ready;
    if (!client || currentUser?.role !== 'admin') throw new Error('Se requieren permisos administrativos activos.');
    const { data, error } = await client.functions.invoke('admin-users', { body });
    if (error) {
      let responseBody = null;
      const httpResponse = error.context instanceof Response ? error.context : null;
      if (httpResponse) {
        try {
          responseBody = await httpResponse.clone().json();
        } catch {
          responseBody = null;
        }
      }
      const status = httpResponse?.status;
      const serverMessage = responseBody?.error;
      let message = serverMessage || normalizeError(error);
      if (httpResponse && !serverMessage) {
        if (status === 401) message = 'La sesión administrativa venció o no fue aceptada. Inicia sesión nuevamente.';
        else if (status === 403) message = 'La función rechazó la solicitud por origen o permisos administrativos. Verifica el origen configurado y que la cuenta siga siendo administradora activa.';
        else if (status === 404) message = 'No se encontró la Edge Function admin-users. Verifica que esté desplegada en el proyecto configurado.';
        else message = `La Edge Function respondió HTTP ${status || 'desconocido'} sin un mensaje legible. Revisa sus registros de ejecución.`;
      } else if (!httpResponse) {
        message = 'No se recibió una respuesta HTTP de la Edge Function admin-users. Puede deberse a URL del proyecto, origen/CORS, red o función inaccesible; este error no permite distinguir cuál ni confirmar si una invitación llegó a procesarse.';
      }
      const failure = new Error(message);
      failure.outcome = responseBody?.outcome || (httpResponse ? 'failure' : 'unknown');
      if (status) failure.httpStatus = status;
      throw failure;
    }
    if (data?.ok === false || data?.error) {
      const failure = new Error(data.error || 'La operación administrativa no pudo completarse.');
      failure.outcome = data.outcome || 'failure';
      throw failure;
    }
    return data;
  }

  window.CatalystBackend = {
    ready,
    isConfigured: () => !!client,
    getStartupError: () => startupError,
    getClient: () => client,
    getCurrentUser: () => currentUser,
    async signIn(email, password) {
      if (!client) throw new Error('El backend todavía no está configurado.');
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw new Error(normalizeError(error));
      const { data, error: userError } = await client.auth.getUser();
      if (userError || !data.user) throw new Error(userError ? normalizeError(userError) : 'No se encontró la sesión iniciada.');
      await loadProfile(data.user);
      return currentUser;
    },
    async signOut() {
      if (!client) return;
      const { error } = await client.auth.signOut();
      if (error) throw new Error(normalizeError(error));
    },
    async refreshProfile() {
      await ready;
      if (!client) return null;
      const { data, error } = await client.auth.getUser();
      if (error) throw new Error(normalizeError(error));
      await loadProfile(data.user || null);
      return currentUser;
    },
    async resetPassword(email) {
      await ready;
      if (!client) throw new Error('El backend todavía no está configurado.');
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/` });
      if (error) throw new Error(normalizeError(error));
    },
    async updatePassword(password) {
      await ready;
      if (!client) throw new Error('El backend todavía no está configurado.');
      const { error } = await client.auth.updateUser({ password });
      if (error) throw new Error(normalizeError(error));
    },
    async adminResetPassword(email) {
      return invokeAdmin({ action: 'reset', email });
    },
    async listUsers() {
      const result = await invokeAdmin({ action: 'list' });
      if (!Array.isArray(result.users)) throw new Error('El servicio administrativo devolvió un directorio con formato no válido.');
      return result.users;
    },
    async createUser(user) {
      return invokeAdmin({ action: 'create', ...user });
    },
    async updateUser(user) {
      return invokeAdmin({ action: 'update', ...user });
    },
    async setUserActive(id, active) {
      return invokeAdmin({ action: 'set-active', id, active });
    },
    async recoverPartialUser(id) {
      return invokeAdmin({ action: 'recover-partial', id });
    },
    async cleanupPartialUser(id) {
      return invokeAdmin({ action: 'cleanup-partial', id });
    },
    async uploadDocument(file, areas, processedData) {
      await ready;
      if (!client || !currentUser) throw new Error('Inicia sesión para guardar documentos.');
      if (!(file instanceof File) || file.size < 1 || file.size > 52428800) {
        throw new Error('El DOCX está vacío o supera el límite de 50 MB.');
      }
      const areaCodes = [...new Set(areas.filter(Boolean))];
      if (currentUser.role !== 'admin' && areaCodes.some(area => !currentUser.areas.includes(area))) {
        throw new Error('El documento contiene áreas fuera de tus permisos.');
      }
      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      if (sessionError || !sessionData.session?.user) throw new Error('La sesión expiró. Inicia sesión de nuevo.');
      const userId = sessionData.session.user.id;
      const id = crypto.randomUUID();
      const mimeType = file.type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      const safeFileName = file.name.replace(/[^\w.-]/g, '_').slice(0, 120) || 'documento.docx';
      const storagePath = `${userId}/private/${id}/${safeFileName}`;
      const { error: uploadError } = await client.storage.from('catalyst-private')
        .upload(storagePath, file, { contentType: mimeType, upsert: false });
      if (uploadError) throw new Error(`No se pudo guardar el documento original: ${normalizeError(uploadError)}`);
      const { data: document, error: insertError } = await client.from('documents').insert({
        id, owner_id: userId, file_name: file.name, storage_path: storagePath,
        mime_type: mimeType, file_size: file.size, areas: areaCodes
      }).select('id').single();
      if (insertError) {
        await client.storage.from('catalyst-private').remove([storagePath]);
        throw new Error(`No se pudo guardar el registro del documento: ${normalizeError(insertError)}`);
      }
      const uploadedPaths = [storagePath];
      try {
        if (processedData) {
          const processedPath = `${userId}/private/${id}/processed.json`;
          const processedFile = new Blob([JSON.stringify(await inlineBlobUrls(processedData))], { type: 'application/json' });
          const { error: processedError } = await client.storage.from('catalyst-private')
            .upload(processedPath, processedFile, { contentType: 'application/json' });
          if (processedError) throw new Error(`Falló el archivo procesado: ${normalizeError(processedError)}`);
          uploadedPaths.push(processedPath);
          const questions = await Promise.all((processedData.questionBlocks || []).map(async question => ({
            document_id: document.id,
            owner_id: userId,
            source_key: String(question.id),
            session_number: question.session,
            question_number: String(question.number),
            area_code: question.code,
            classification_confidence: question.confidence,
            classification_reason: question.reason,
            is_manual_classification: false,
            question_payload: await inlineBlobUrls(question)
          })));
          for (let start = 0; start < questions.length; start += 20) {
            const { error: questionsError } = await client.from('questions').insert(questions.slice(start, start + 20));
            if (questionsError) throw new Error(`Falló el registro de preguntas: ${normalizeError(questionsError)}`);
          }
          const { error: statusError } = await client.from('documents')
            .update({ status: 'processed', processed_storage_path: processedPath })
            .eq('id', document.id);
          if (statusError) throw new Error(`Falló el cambio a estado procesado: ${normalizeError(statusError)}`);
        }
      } catch (processingError) {
        const { error: removeError } = await client.storage.from('catalyst-private').remove(uploadedPaths);
        const { error: deleteError } = await client.from('documents').delete().eq('id', document.id);
        if (removeError || deleteError) {
          throw new Error(`${processingError.message} Además, la limpieza del registro incompleto falló: ${removeError?.message || deleteError?.message}`);
        }
        throw processingError;
      }
      const { error: logError } = await client.from('operation_logs').insert({
        actor_id: userId, operation: 'document.upload', entity_type: 'document',
        entity_id: document.id, area_code: areaCodes.length === 1 ? areaCodes[0] : null,
        status: 'success', details: { name: file.name, areaCount: areaCodes.length }
      });
      const warnings = logError
        ? [`El documento se guardó, pero no se pudo registrar en el historial: ${normalizeError(logError)}`]
        : [];
      const { data: questionRows, error: questionRowsError } = await client.from('questions')
        .select('id,source_key').eq('document_id', document.id);
      if (questionRowsError) {
        const { error: removeError } = await client.storage.from('catalyst-private')
          .remove([storagePath, `${userId}/private/${id}/processed.json`]);
        const { error: deleteError } = await client.from('documents').delete().eq('id', document.id);
        const cleanup = removeError || deleteError;
        throw new Error(`No se pudieron indexar las preguntas: ${normalizeError(questionRowsError)}${cleanup ? ` La limpieza también falló: ${cleanup.message}` : ''}`);
      }
      return {
        id: document.id,
        questionIds: Object.fromEntries(questionRows.map(item => [item.source_key, item.id])),
        warnings
      };
    },
    async setQuestionArea(documentId, question) {
      await ready;
      if (!client || !currentUser) throw new Error('Inicia sesión para guardar la clasificación.');
      const { error } = await client.from('questions')
        .update({
          area_code: question.code,
          is_manual_classification: true,
          classification_reason: question.reason,
          updated_at: new Date().toISOString()
        })
        .eq('document_id', documentId)
        .eq('source_key', String(question.id));
      if (error) throw new Error(`No se pudo guardar la clasificación: ${normalizeError(error)}`);
    },
    async recordOperation(entry) {
      await ready;
      if (!client || !currentUser) throw new Error('Inicia sesión para registrar la operación.');
      const outcome = ['success', 'failure', 'partial'].includes(entry.status) ? entry.status : 'success';
      const { error } = await client.from('operation_logs').insert({
        actor_id: currentUser.id,
        operation: entry.action,
        entity_type: entry.type,
        entity_id: entry.entityId || null,
        area_code: entry.area && entry.area !== 'all' ? entry.area : null,
        status: outcome === 'success' ? 'success' : 'failure',
        details: { ...entry, outcome }
      });
      if (error) throw new Error(`No se pudo registrar el historial: ${normalizeError(error)}`);
    },
    async saveCompilation(entry) {
      await ready;
      if (!client || !currentUser) throw new Error('Inicia sesión para guardar la compilación.');
      if (!(entry.pdf instanceof Blob) || entry.pdf.type !== 'application/pdf') {
        throw new Error('No se recibió un PDF válido para guardar.');
      }
      if (entry.area && currentUser.role !== 'admin' && !currentUser.areas.includes(entry.area)) {
        throw new Error('No tienes permiso para guardar materiales de esta área.');
      }
      const id = crypto.randomUUID();
      const storagePath = `${currentUser.id}/generated-pdfs/${id}/pdf-${crypto.randomUUID()}.pdf`;
      const pdfCreatedAt = new Date().toISOString();
      const { data, error } = await client.from('compilations').insert({
        id,
        owner_id: currentUser.id,
        compilation_type: entry.type,
        area_code: entry.area || null,
        title: entry.title,
        configuration: entry.configuration || {},
        question_ids: entry.questionIds || [],
        pdf_storage_path: storagePath,
        pdf_created_at: pdfCreatedAt
      }).select('id').single();
      if (error) throw new Error(`No se pudo registrar la compilación temporal: ${normalizeError(error)}`);
      const rollbackGeneratedPdf = async () => {
        const storage = client.storage.from('catalyst-private');
        const { error: removeError } = await storage.remove([storagePath]);
        const separator = storagePath.lastIndexOf('/');
        const { data: remainingFiles, error: verifyError } = await storage
          .list(storagePath.slice(0, separator), { limit: 100, search: storagePath.slice(separator + 1) });
        if (verifyError || !remainingFiles) {
          const verificationIssue = verifyError ? normalizeError(verifyError) : 'Storage no devolvió el listado.';
          throw new Error(`No se pudo verificar la ausencia del PDF${removeError ? ` (${normalizeError(removeError)})` : ''}: ${verificationIssue}`);
        }
        if (remainingFiles.some(file => file.name === storagePath.slice(separator + 1))) {
          throw new Error(`Storage aún conserva el PDF${removeError ? ` (${normalizeError(removeError)})` : ''}.`);
        }
        const { data: cleared, error: clearError } = await client.from('compilations')
          .update({ pdf_storage_path: null, pdf_created_at: null })
          .eq('id', data.id)
          .eq('owner_id', currentUser.id)
          .eq('pdf_storage_path', storagePath)
          .eq('pdf_created_at', pdfCreatedAt)
          .select('id,pdf_storage_path,pdf_created_at')
          .maybeSingle();
        if (clearError) {
          throw new Error(`El archivo ya no está en Storage, pero no se pudo desvincular la compilación: ${normalizeError(clearError)}`);
        }
        if (!cleared || cleared.pdf_storage_path !== null || cleared.pdf_created_at !== null) {
          throw new Error('El archivo ya no está en Storage, pero no se pudo confirmar la desvinculación de la compilación.');
        }
      };
      const { error: uploadError } = await client.storage.from('catalyst-private')
        .upload(storagePath, entry.pdf, { contentType: 'application/pdf', upsert: false });
      if (uploadError) {
        try {
          await rollbackGeneratedPdf();
        } catch (rollbackError) {
          throw new Error(`No se pudo guardar el PDF en el almacenamiento privado: ${normalizeError(uploadError)} La compilación quedó vinculada para recuperación segura: ${normalizeError(rollbackError)}`);
        }
        throw new Error(`No se pudo guardar el PDF en el almacenamiento privado: ${normalizeError(uploadError)}`);
      }
      const { error: logError } = await client.from('operation_logs').insert({
        actor_id: currentUser.id,
        operation: 'pdf.generated',
        entity_type: 'compilation',
        entity_id: data.id,
        area_code: entry.area || null,
        status: 'success',
        details: {
          pdfRetention: true,
          pdfStoragePath: storagePath,
          pdfCreatedAt,
          type: entry.type,
          title: entry.title
        }
      });
      if (logError) {
        try {
          await rollbackGeneratedPdf();
        } catch (rollbackError) {
          throw new Error(`El PDF se guardó, pero no se pudo registrar su historial: ${normalizeError(logError)} La compilación quedó vinculada para recuperación segura: ${normalizeError(rollbackError)}`);
        }
        throw new Error(`No se pudo registrar el historial del PDF: ${normalizeError(logError)}`);
      }
      return data.id;
    },
    async updateCompilation(id, entry) {
      await ready;
      if (!client || !currentUser) throw new Error('Inicia sesión para editar la compilación.');
      if (!(entry.pdf instanceof Blob) || entry.pdf.type !== 'application/pdf') {
        throw new Error('No se recibió un PDF válido para guardar.');
      }
      const questionIds = [...new Set(entry.questionIds || [])];
      if (questionIds.length !== (entry.questionIds || []).length) {
        throw new Error('La selección contiene preguntas duplicadas.');
      }
      if (entry.area && currentUser.role !== 'admin' && !currentUser.areas.includes(entry.area)) {
        throw new Error('No tienes permiso para guardar materiales de esta área.');
      }
      const { data: existing, error: lookupError } = await client.from('compilations')
        .select('id,owner_id,compilation_type,area_code,title,configuration,question_ids,pdf_storage_path,pdf_created_at')
        .eq('id', id).maybeSingle();
      if (lookupError) throw new Error(`No se pudo consultar la compilación: ${normalizeError(lookupError)}`);
      if (!existing) throw new Error('La compilación no existe o no tienes permiso para editarla.');
      if (existing.owner_id !== currentUser.id) {
        throw new Error('Solo quien creó la compilación puede reemplazar su PDF; no se modificó.');
      }

      const storagePath = `${currentUser.id}/generated-pdfs/${id}/pdf-${crypto.randomUUID()}.pdf`;
      const pdfCreatedAt = new Date().toISOString();
      const rollbackCompilation = async () => await client.from('compilations').update({
        compilation_type: existing.compilation_type,
        area_code: existing.area_code,
        title: existing.title,
        configuration: existing.configuration,
        question_ids: existing.question_ids,
        pdf_storage_path: existing.pdf_storage_path,
        pdf_created_at: existing.pdf_created_at
      }).eq('id', id).eq('owner_id', currentUser.id).select('id').maybeSingle();
      const { data: updated, error: updateError } = await client.from('compilations')
        .update({
          compilation_type: entry.type,
          area_code: entry.area || null,
          title: entry.title,
          configuration: entry.configuration || {},
          question_ids: questionIds,
          pdf_storage_path: storagePath,
          pdf_created_at: pdfCreatedAt
        })
        .eq('id', id).select('id').maybeSingle();
      if (updateError || !updated) {
        const { data: latest, error: verifyError } = await client.from('compilations')
          .select('pdf_storage_path').eq('id', id).maybeSingle();
        if (verifyError) {
          const partialError = new Error(`No se pudo confirmar la actualización: ${normalizeError(updateError || new Error('No se recibió confirmación'))} Tampoco se pudo verificar el estado guardado: ${normalizeError(verifyError)}.`);
          partialError.outcome = 'partial';
          throw partialError;
        }
        if (latest?.pdf_storage_path === storagePath) {
          const { data: restored, error: rollbackError } = await rollbackCompilation();
          if (rollbackError || !restored) {
            const partialError = new Error(`La actualización pudo haberse aplicado, pero no se pudo confirmar la restauración: ${normalizeError(rollbackError || new Error('No se confirmó la restauración'))}. No se cargó el PDF nuevo.`);
            partialError.outcome = 'partial';
            throw partialError;
          }
        }
        throw new Error(`No se pudo actualizar la compilación: ${normalizeError(updateError || new Error('No se confirmó el cambio'))}`);
      }
      const { error: uploadError } = await client.storage.from('catalyst-private')
        .upload(storagePath, entry.pdf, { contentType: 'application/pdf', upsert: false });
      if (uploadError) {
        const { data: rolledBack, error: rollbackError } = await rollbackCompilation();
        if (rollbackError || !rolledBack) {
          const partialError = new Error(`No se pudo guardar la nueva versión del PDF: ${normalizeError(uploadError)} La compilación quedó parcialmente actualizada y requiere revisión: ${normalizeError(rollbackError || new Error('No se confirmó la restauración de la versión anterior'))}`);
          partialError.outcome = 'partial';
          throw partialError;
        }
        throw new Error(`No se pudo guardar la nueva versión del PDF; se restauró la versión anterior: ${normalizeError(uploadError)}`);
      }

      const warnings = [];
      if (existing.pdf_storage_path && existing.pdf_storage_path !== storagePath) {
        const { error: cleanupError } = await client.storage.from('catalyst-private')
          .remove([existing.pdf_storage_path]);
        if (cleanupError) warnings.push(`La compilación se actualizó, pero no se pudo retirar su PDF anterior: ${normalizeError(cleanupError)}`);
      }
      const { error: logError } = await client.from('operation_logs').insert({
        actor_id: currentUser.id,
        operation: 'compilation.updated',
        entity_type: 'compilation',
        entity_id: id,
        area_code: entry.area || null,
        status: 'success',
        details: { type: entry.type, title: entry.title, questionCount: questionIds.length }
      });
      if (logError) warnings.push(`La compilación se actualizó, pero no se pudo registrar el historial: ${normalizeError(logError)}`);
      return { id, warning: warnings.join(' ') };
    },
    async loadCompilation(id) {
      await ready;
      if (!client || !currentUser) throw new Error('Inicia sesión para abrir la compilación.');
      const { data: compilation, error } = await client.from('compilations')
        .select('id,owner_id,compilation_type,area_code,title,configuration,question_ids,created_at')
        .eq('id', id).maybeSingle();
      if (error) throw new Error(`No se pudo abrir la compilación: ${normalizeError(error)}`);
      if (!compilation) throw new Error('La compilación no existe o no tienes permiso para abrirla.');
      const questionIds = compilation.question_ids || [];
      if (!questionIds.length) return { ...compilation, questions: [] };
      if (new Set(questionIds).size !== questionIds.length) {
        throw new Error('La compilación contiene referencias duplicadas a preguntas; no se abrió para evitar guardar duplicados.');
      }
      const { data: questions, error: questionsError } = await client.from('questions')
        .select('id,document_id,session_number,question_number,area_code,source_key,question_payload,documents(file_name)')
        .in('id', questionIds);
      if (questionsError) throw new Error(`No se pudieron cargar las preguntas: ${normalizeError(questionsError)}`);
      if (questions.length !== new Set(questionIds).size) {
        throw new Error('No se pudieron cargar todas las preguntas guardadas; comprueba tus permisos y la integridad de los datos.');
      }
      const documentIds = [...new Set(questions.map(question => question.document_id))];
      const contextByGroup = {};
      if (documentIds.length) {
        const { data: sourceQuestions, error: contextError } = await client.from('questions')
          .select('document_id,question_payload')
          .in('document_id', documentIds);
        if (contextError) throw new Error(`No se pudo recuperar el contexto compartido: ${normalizeError(contextError)}`);
        for (const question of sourceQuestions) {
          const payload = question.question_payload;
          const groupId = payload?.contextGroupId;
          const atoms = payload?.atoms;
          const groupKey = groupId ? `${question.document_id}:${groupId}` : null;
          if (!groupKey || !Array.isArray(atoms) || contextByGroup[groupKey]) continue;
          const promptIndex = atoms.findIndex(atom => atom.t === 'preg');
          if (promptIndex > 0) contextByGroup[groupKey] = atoms.slice(0, promptIndex).filter(atom => atom.t !== 'sep');
        }
      }
      const byId = new Map(questions.map(question => [question.id, question]));
      return { ...compilation, questions: questionIds.map(questionId => byId.get(questionId)), contextByGroup };
    },
    async listReusableQuestions() {
      await ready;
      if (!client || !currentUser) throw new Error('Inicia sesión para consultar preguntas guardadas.');
      const { data, error } = await client.from('questions')
        .select('id,document_id,session_number,question_number,area_code,source_key,question_payload,documents(file_name)')
        .order('document_id', { ascending: true })
        .order('session_number', { ascending: true })
        .order('source_key', { ascending: true });
      if (error) throw new Error(`No se pudieron consultar las preguntas disponibles: ${normalizeError(error)}`);
      return data;
    },
    async downloadCompilationPdf(id) {
      await ready;
      if (!client || !currentUser) throw new Error('Inicia sesión para descargar el PDF.');
      const { data: compilation, error } = await client.from('compilations')
        .select('title,pdf_storage_path,pdf_created_at')
        .eq('id', id).single();
      if (error) throw new Error(`No se pudo consultar el PDF: ${normalizeError(error)}`);
      const expiresAt = new Date(compilation.pdf_created_at).getTime() + 15 * 86400000;
      if (!compilation.pdf_storage_path || !Number.isFinite(expiresAt) || Date.now() >= expiresAt) {
        throw new Error('Este PDF ya no está disponible; su periodo de conservación es de 15 días.');
      }
      const { data, error: downloadError } = await client.storage.from('catalyst-private')
        .download(compilation.pdf_storage_path);
      if (downloadError) throw new Error(`No se pudo descargar el PDF privado: ${normalizeError(downloadError)}`);
      return { blob: data, title: compilation.title };
    },
    async listDocuments() {
      await ready;
      if (!client || !currentUser) return [];
      const { data, error } = await client.from('documents')
        .select('id,file_name,areas,status,created_at,owner_id').order('created_at', { ascending: false });
      if (error) throw new Error(`No se pudieron consultar los documentos: ${normalizeError(error)}`);
      return data;
    },
    async listCompilations() {
      await ready;
      if (!client || !currentUser) return [];
      const { data, error } = await client.from('compilations')
        .select('id,title,compilation_type,area_code,created_at,owner_id,pdf_storage_path,pdf_created_at,question_ids')
        .order('created_at', { ascending: false });
      if (error) throw new Error(`No se pudo consultar la biblioteca: ${normalizeError(error)}`);
      return data;
    },
    async listOperations() {
      await ready;
      if (!client || !currentUser) return [];
      const { data, error } = await client.from('operation_logs')
        .select('id,operation,entity_type,entity_id,area_code,status,details,created_at,actor_id')
        .order('created_at', { ascending: false }).limit(100);
      if (error) throw new Error(`No se pudo consultar el historial: ${normalizeError(error)}`);
      return data;
    }
  };

  async function inlineBlobUrls(value, seen = new WeakMap()) {
    const dataUrlFor = async url => {
      const response = await fetch(url);
      if (!response.ok) throw new Error('No se pudo conservar una imagen extraída del documento.');
      const blob = await response.blob();
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error('No se pudo conservar una imagen extraída.'));
        reader.readAsDataURL(blob);
      });
    };
    if (typeof value === 'string' && value.includes('blob:')) {
      const urls = [...new Set(value.match(/blob:[^"'\\s)]+/g) || [])];
      let result = value;
      for (const url of urls) result = result.replaceAll(url, await dataUrlFor(url));
      return result;
    }
    if (!value || typeof value !== 'object') return value;
    if (seen.has(value)) return seen.get(value);
    const result = Array.isArray(value) ? [] : {};
    seen.set(value, result);
    for (const [key, item] of Object.entries(value)) result[key] = await inlineBlobUrls(item, seen);
    return result;
  }
})();
