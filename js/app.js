/* ============================================================
   Interfaz: subir Word → armar cuadernillo → PDF
   ============================================================ */
(function () {
  'use strict';
  const CFG = window.CATALYST_CONFIG;
  const Backend = window.CatalystBackend;
  const $ = id => document.getElementById(id);
  const S = { result: null, documentId: null, questionIds: {}, pendingFile: null, loading: false, savingImport: false, savingCompilation: false, central: {}, qr: null, wmSrc: CFG.watermark.file, zoom: 1, fit: true, token: 0, fileName: '', ing: { 1: '', 2: '', photos: {}, parts: {} }, reusableQuestions: [] };
  let managedUsers = [];
  let userDirectoryLoaded = false;
  let userDirectoryFailed = false;
  let userDirectoryRequest = 0;
  let userInviteNeedsVerification = false;
  let userOperationInProgress = false;
  let passwordRecovery = false;
  let invitationPasswordSetup = new URLSearchParams(location.search).get('flow') === 'invite';
  let invitationLinkError = false;
  let invitationPasswordSaved = false;
  let remoteDashboard = { documents: [], compilations: [], operations: [] };
  let dashboardRequest = 0;
  let dashboardLoadFailed = false;
  let dashboardLoading = false;

  /* ---------- ajustes recordados (opcional, no falla si no hay storage) ---------- */
  const store = {
    get(k) { try { return localStorage.getItem('catalyst.' + k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('catalyst.' + k, v); } catch (e) { /* sin storage */ } }
  };
  try {
    localStorage.removeItem('catalyst.userId');
    localStorage.removeItem('catalyst.demoUsers');
  } catch (error) {
    console.warn('No se pudieron limpiar claves antiguas de perfiles locales.', error);
  }

  const getManagedUsers = () => managedUsers;
  async function refreshManagedUsers() {
    managedUsers = await Backend.listUsers();
    renderUserManagement();
  }

  function setUserStatus(message, type = '') {
    const status = $('userStatus');
    if (!status) return;
    status.textContent = message;
    status.className = `form-status${type ? ` ${type}` : ''}`;
  }

  const getCurrentUser = () => Backend.getCurrentUser();

  function getAllowedAreas() {
    const user = getCurrentUser();
    if (!user) return [];
    if (user.role === 'admin') return Object.keys(CFG.areas);
    return Array.isArray(user.areas) ? user.areas : [];
  }

  function applyAreaTheme(code) {
    const def = CFG.areas[code] || CFG.areas.Mat;
    const root = document.body;
    root.dataset.area = code || 'Mat';
    root.style.setProperty('--area-a', def.A);
    root.style.setProperty('--area-b', def.B);
    root.style.setProperty('--area-accent', def.accent || def.A);
  }

  function notify(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2600);
  }

  function ensureAreaAccess(code) {
    const user = getCurrentUser();
    if (!user) {
      $('authOverlay').classList.remove('hidden');
      notify('Inicia sesión para continuar.', 'warning');
      return false;
    }
    if (!CFG.areas[code]) return false;
    if (user.role !== 'admin' && !getAllowedAreas().includes(code)) {
      notify(`El usuario ${user.name} no tiene acceso a ${CFG.areas[code]?.name || code}.`, 'error');
      return false;
    }
    return true;
  }

  async function renderUserManagement(refresh = false) {
    const section = $('adminUsers');
    const user = getCurrentUser();
    if (!section) return;
    section.hidden = user?.role !== 'admin';
    if (section.hidden) return;
    if (refresh || (!userDirectoryLoaded && !userDirectoryFailed && $('userDirectoryLoading').hidden)) {
      const request = ++userDirectoryRequest;
      userDirectoryFailed = false;
      $('userDirectoryLoading').hidden = false;
      $('userDirectoryError').hidden = true;
      $('userEmpty').hidden = true;
      $('userTableBody').replaceChildren();
      try {
        const users = await Backend.listUsers();
        if (request !== userDirectoryRequest) return false;
        managedUsers = users;
        userDirectoryLoaded = true;
        userDirectoryFailed = false;
      } catch (error) {
        if (request !== userDirectoryRequest) return false;
        managedUsers = [];
        userDirectoryLoaded = false;
        userDirectoryFailed = true;
        $('userTableBody').replaceChildren();
        $('userDirectoryLoading').hidden = true;
        $('userDirectoryErrorMessage').textContent = error.message;
        $('userDirectoryError').hidden = false;
        return false;
      }
      $('userDirectoryLoading').hidden = true;
      $('userDirectoryError').hidden = true;
    }
    if (!userDirectoryLoaded) return false;
    const query = ($('userSearch').value || '').trim().toLocaleLowerCase();
    const users = getManagedUsers().filter(account =>
      `${account.name} ${account.email || ''}`.toLocaleLowerCase().includes(query));
    const tbody = $('userTableBody');
    tbody.replaceChildren();
    $('userEmpty').hidden = users.length > 0;
    $('userEmpty').textContent = getManagedUsers().length === 0
      ? 'No hay usuarios registrados.'
      : 'No hay usuarios que coincidan con la búsqueda.';
    users.forEach(account => {
      const row = document.createElement('tr');
      const identity = document.createElement('td');
      const name = document.createElement('span');
      name.className = 'user-name'; name.textContent = account.name;
      const email = document.createElement('span');
      email.className = 'user-email'; email.textContent = account.email || 'Sin correo registrado';
      identity.append(name, email);
      const role = document.createElement('td');
      role.textContent = CFG.roles[account.role]?.label || account.role;
      const areas = document.createElement('td');
      const accountAreas = Array.isArray(account.areas) ? account.areas : [];
      const areaNames = account.role === 'admin' ? ['Todas las áreas'] : accountAreas.map(code => CFG.areas[code]?.short || code);
      const areaText = document.createElement('span');
      areaText.className = 'user-areas'; areaText.textContent = areaNames.join(' · ') || 'Sin áreas';
      areas.appendChild(areaText);
      const state = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = `user-status${account.active === false ? ' inactive' : ''}`;
      badge.textContent = `${account.active === false ? 'Inactiva' : 'Activa'}${account.emailConfirmed === false ? ' · correo pendiente' : ''}${account.partialRecovery ? ' · revisión pendiente' : ''}`;
      state.appendChild(badge);
      const actions = document.createElement('td');
      const actionWrap = document.createElement('div');
      actionWrap.className = 'user-row-actions';
      const edit = document.createElement('button');
      edit.type = 'button'; edit.dataset.userAction = 'edit'; edit.dataset.userId = account.id; edit.textContent = 'Editar';
      const toggle = document.createElement('button');
      toggle.type = 'button'; toggle.dataset.userAction = 'toggle'; toggle.dataset.userId = account.id;
      toggle.textContent = account.active === false ? 'Activar' : 'Desactivar';
      const reset = document.createElement('button');
      reset.type = 'button'; reset.dataset.userAction = 'reset'; reset.dataset.userId = account.id; reset.textContent = 'Restablecer acceso';
      if (account.partialRecovery) {
        if (account.canRecoverConfiguration) {
          const recover = document.createElement('button');
          recover.type = 'button'; recover.dataset.userAction = 'recover-partial'; recover.dataset.userId = account.id;
          recover.textContent = 'Reintentar configuración';
          actionWrap.appendChild(recover);
        }
        if (account.canCleanupPartial) {
          const cleanup = document.createElement('button');
          cleanup.type = 'button'; cleanup.dataset.userAction = 'cleanup-partial'; cleanup.dataset.userId = account.id;
          cleanup.textContent = 'Cancelar invitación pendiente';
          actionWrap.appendChild(cleanup);
        }
        if (!account.canRecoverConfiguration && !account.canCleanupPartial) {
          actionWrap.textContent = 'Revisión manual requerida; perfil distinto del estado inicial seguro.';
        }
      } else if (account.profileMissing || account.authAccountMissing) {
        actionWrap.textContent = account.profileMissing
          ? 'Sin perfil; requiere revisión administrativa.'
          : 'Sin cuenta Auth; requiere revisión administrativa.';
      } else {
        actionWrap.append(edit, toggle, reset);
      }
      actions.appendChild(actionWrap);
      row.append(identity, role, areas, state, actions);
      tbody.appendChild(row);
    });
    return true;
  }

  function openUserForm(account) {
    const form = $('userForm');
    form.reset();
    userInviteNeedsVerification = false;
    $('userEditId').value = account?.id || '';
    $('userFormTitle').textContent = account ? 'Editar usuario' : 'Crear usuario';
    $('userName').value = account?.name || '';
    $('userEmail').value = account?.email || '';
    $('userEmail').disabled = !!account;
    $('userRole').value = account?.role || 'tutor';
    document.querySelectorAll('#userAreas input[type=checkbox]').forEach(input => {
      input.checked = account?.role === 'admin' || account?.areas?.includes(input.value) || false;
      input.disabled = account?.role === 'admin';
    });
    $('userAreas').classList.toggle('areas-disabled', account?.role === 'admin');
    $('userStatus').textContent = '';
    $('userStatus').className = 'form-status';
    $('userSubmit').disabled = false;
    $('userSubmit').textContent = account ? 'Guardar usuario' : 'Enviar invitación';
    $('userVerifyInvite').hidden = true;
    $('userRetryInvite').hidden = true;
    form.hidden = false;
    $('userName').focus();
  }

  function closeUserForm() {
    userInviteNeedsVerification = false;
    $('userForm').hidden = true;
    $('userForm').reset();
    $('userEditId').value = '';
  }

  function addLibraryEntry(entry) {
    const payload = {
      type: entry.type,
      area: entry.area === 'all' ? null : entry.area,
      title: entry.name || entry.type,
      configuration: entry.configuration || {},
      questionIds: entry.questionIds || [],
      pdf: entry.pdf
    };
    const save = entry.id
      ? Backend.updateCompilation(entry.id, payload)
      : Backend.saveCompilation(payload).then(id => ({ id, warning: '' }));
    return save.then(result => {
      renderDashboard(true);
      if (result.warning) notify(result.warning, 'warning');
      return result.id;
    });
  }

  function downloadGeneratedPdf(blob, fileName) {
    PdfGenerator.download(blob, fileName);
  }

  async function downloadStoredPdf(compilationId, title) {
    try {
      const result = await Backend.downloadCompilationPdf(compilationId);
      downloadGeneratedPdf(result.blob, `${result.title || title || 'Catalyst'}.pdf`);
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  function addHistoryEntry(entry) {
    Backend.recordOperation(entry).then(() => renderDashboard(true))
      .catch(error => notify(`No se pudo guardar el historial: ${error.message}`, 'error'));
  }

  async function renderDashboard(refresh = false) {
    const user = getCurrentUser();
    const panel = $('userDashboard');
    if (!panel) return;
    if (!user) {
      panel.classList.add('hidden');
      return;
    }
    panel.classList.remove('hidden');
    $('dashboardTitle').textContent = `${user.name}`;
    $('dashboardRole').textContent = CFG.roles[user.role]?.label || user.role;
    $('dashboardAreas').textContent = getAllowedAreas().map(code => CFG.areas[code]?.short || code).join(' · ');
    let request = dashboardRequest;
    if (refresh || !remoteDashboard.loaded) {
      if (!refresh && dashboardLoading) return false;
      if (!refresh && dashboardLoadFailed) return false;
      request = ++dashboardRequest;
      dashboardLoading = true;
      $('dashboardLoadState').hidden = false;
      $('dashboardLoadState').classList.remove('error');
      $('dashboardRetry').hidden = true;
      $('dashboardLoadMessage').textContent = 'Actualizando biblioteca e historial…';
      $('libraryList').textContent = 'Cargando materiales…';
      $('historyList').textContent = 'Cargando actividad…';
      try {
        const [documents, compilations, operations] = await Promise.all([
          Backend.listDocuments(), Backend.listCompilations(), Backend.listOperations()
        ]);
        if (request !== dashboardRequest) return;
        remoteDashboard = { documents, compilations, operations, loaded: true };
        dashboardLoading = false;
        dashboardLoadFailed = false;
        $('dashboardLoadState').hidden = true;
      } catch (error) {
        if (request !== dashboardRequest) return;
        dashboardLoading = false;
        remoteDashboard = { documents: [], compilations: [], operations: [], loaded: false };
        dashboardLoadFailed = true;
        $('libraryList').textContent = 'Los materiales no están disponibles hasta recuperar la conexión.';
        $('historyList').textContent = 'La actividad no está disponible hasta recuperar la conexión.';
        $('dashboardLoadMessage').textContent = `No se pudo actualizar la biblioteca y el historial: ${error.message}`;
        $('dashboardRetry').hidden = false;
        $('dashboardLoadState').classList.add('error');
        return;
      }
    }
    const search = ($('librarySearch') && $('librarySearch').value || '').toLowerCase().trim();
    const areaFilter = $('libraryAreaFilter') ? $('libraryAreaFilter').value : 'all';
    const typeFilter = $('libraryTypeFilter') ? $('libraryTypeFilter').value : 'all';
    const dateFilter = $('libraryDateFilter') ? $('libraryDateFilter').value : 'all';
    const dateWindow = { all: null, '7d': 7, '30d': 30, '90d': 90 };
    const canViewArea = area => user.role === 'admin' || getAllowedAreas().includes(area);
    const matchesDate = item => {
      const days = dateWindow[dateFilter];
      if (!days) return true;
      const created = new Date(item.createdAt || Date.now());
      const ageDays = (Date.now() - created.getTime()) / 86400000;
      return Number.isFinite(ageDays) && ageDays >= 0 && ageDays <= days;
    };
    const storedLibrary = [
      ...remoteDashboard.documents.map(item => ({
        id: item.id, name: item.file_name, area: item.areas[0] || null, areas: item.areas,
        type: 'documento', status: item.status, createdAt: item.created_at, author: item.owner_id
      })),
      ...remoteDashboard.compilations.map(item => ({
        id: item.id, name: item.title, area: item.area_code, type: item.compilation_type,
        questionIds: item.question_ids || [],
        status: 'guardado', createdAt: item.created_at, author: item.owner_id,
        pdfStoragePath: item.pdf_storage_path, pdfCreatedAt: item.pdf_created_at
      }))
    ];
    const library = storedLibrary.filter(item => {
      if (item.areas?.length) {
        if (!item.areas.some(canViewArea)) return false;
      } else if (item.area && !canViewArea(item.area)) return false;
      if (areaFilter !== 'all' && item.area !== areaFilter && !(item.areas || []).includes(areaFilter)) return false;
      if (typeFilter !== 'all' && (item.type || 'material') !== typeFilter) return false;
      if (!matchesDate(item)) return false;
      if (!search) return true;
      const haystack = [item.name, item.type, ...(item.areas || []), CFG.areas[item.area]?.name || item.area, item.status].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(search);
    });
    const history = remoteDashboard.operations.filter(item => {
      if (item.area_code && !canViewArea(item.area_code)) return false;
      const itemType = item.details?.type || item.entity_type;
      if (areaFilter !== 'all' && item.area_code !== areaFilter) return false;
      if (typeFilter !== 'all' && itemType !== typeFilter) return false;
      if (!matchesDate({ createdAt: item.created_at })) return false;
      if (!search) return true;
      const haystack = [item.operation, itemType, CFG.areas[item.area_code]?.name || item.area_code, item.status].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(search);
    });
    $('dashboardDocs').textContent = String(library.length || 0);
    const libraryList = $('libraryList');
    libraryList.replaceChildren();
    if (!library.length) libraryList.textContent = 'Todavía no hay documentos ni compilaciones guardados.';
    library.forEach(item => {
      const row = document.createElement('div'); row.className = 'list-item';
      const details = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = item.name || item.type || 'Material';
      const metadata = document.createElement('small');
      metadata.textContent = `${(item.areas || [item.area]).filter(Boolean).map(code => CFG.areas[code]?.name || code).join(', ') || 'Sin área'} · ${item.type} · ${item.status}`;
      details.append(title, metadata);
      const date = document.createElement('small'); date.textContent = new Date(item.createdAt).toLocaleDateString();
      const rowActions = document.createElement('div');
      rowActions.className = 'history-actions';
      if (item.pdfStoragePath && item.pdfCreatedAt && Date.now() < new Date(item.pdfCreatedAt).getTime() + 15 * 86400000) {
        const download = document.createElement('button');
        download.type = 'button';
        download.textContent = 'Descargar PDF';
        download.addEventListener('click', () => downloadStoredPdf(item.id, item.name));
        rowActions.appendChild(download);
      }
      if (item.type === 'compilado' && item.questionIds.length && item.author === user.id) {
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.textContent = 'Editar';
        edit.addEventListener('click', () => {
          window.CatalystCompiledEditor.editExisting(item.id).catch(error =>
            notify(`No se pudo abrir el compilado para editarlo: ${error.message}`, 'error'));
        });
        rowActions.appendChild(edit);
      }
      row.append(details, date, rowActions); libraryList.append(row);
    });
    const historyList = $('historyList');
    historyList.replaceChildren();
    if (!history.length) historyList.textContent = 'Sin movimientos recientes.';
    history.forEach(item => {
      const row = document.createElement('div'); row.className = 'list-item';
      const details = document.createElement('div');
      const title = document.createElement('strong');
      const outcome = item.details?.outcome || item.status;
      const operationNames = {
        'admin.user.create': 'Invitación de usuario',
        'admin.user.update': 'Edición de usuario',
        'admin.user.set-active': 'Cambio de estado de usuario',
        'admin.user.password-reset': 'Solicitud de recuperación de contraseña',
        'admin.user.recover-partial': 'Recuperación de invitación parcial',
        'admin.user.cleanup-partial': 'Cancelación de invitación parcial',
        'pdf.generated': 'PDF generado',
        'compilation.updated': 'Compilado actualizado'
      };
      title.textContent = operationNames[item.operation] || item.operation;
      const outcomeLabels = { success: 'Correcta', failure: 'Fallida', partial: 'Parcialmente completada' };
      const metadata = document.createElement('small');
      const reasons = [...new Set([item.details?.error, item.details?.compensationError].filter(Boolean))];
      metadata.textContent = `${CFG.areas[item.area_code]?.name || item.area_code || 'General'} · ${item.details?.type || item.entity_type || 'operación'} · ${outcomeLabels[outcome] || 'Estado desconocido'}${reasons.length ? ` · ${reasons.join(' · ')}` : ''}`;
      metadata.className = `operation-outcome outcome-${outcome}`;
      details.append(title, metadata);
      const date = document.createElement('small'); date.textContent = new Date(item.created_at).toLocaleString();
      const rowActions = document.createElement('div');
      rowActions.className = 'history-actions';
      const compilation = item.operation === 'pdf.generated' && item.details?.pdfRetention === true
        ? remoteDashboard.compilations.find(candidate => candidate.id === item.entity_id)
        : null;
      if (compilation?.pdf_storage_path && compilation.pdf_created_at
        && Date.now() < new Date(compilation.pdf_created_at).getTime() + 15 * 86400000) {
        const download = document.createElement('button');
        download.type = 'button';
        download.textContent = 'Descargar PDF';
        download.addEventListener('click', () => downloadStoredPdf(compilation.id, compilation.title));
        rowActions.appendChild(download);
      }
      row.append(details, date, rowActions); historyList.append(row);
    });
    renderUserManagement();
  }

  function updateUserPanel() {
    const user = getCurrentUser();
    const chip = $('userChip');
    const overlay = $('authOverlay');
    const appShell = $('appShell');
    if (invitationPasswordSetup) {
      chip.textContent = 'Configuración de cuenta';
      overlay.classList.remove('hidden');
      $('authForm').hidden = true;
      $('forgotPassword').hidden = true;
      $('passwordRecoveryForm').hidden = invitationLinkError || invitationPasswordSaved;
      $('inviteReturnLogin').hidden = !invitationLinkError && !invitationPasswordSaved;
      $('authTitle').textContent = invitationPasswordSaved
        ? 'Contraseña configurada'
        : invitationLinkError
        ? 'Invitación no disponible'
        : 'Configura tu contraseña';
      $('authDescription').textContent = invitationPasswordSaved
        ? 'Tu contraseña quedó guardada. Un administrador debe activar tu cuenta antes de que puedas iniciar sesión.'
        : invitationLinkError
        ? 'El enlace no pudo validarse. Puede haber vencido o ya haber sido utilizado; solicita una nueva invitación al administrador.'
        : 'Elige una contraseña segura y confírmala. La cuenta seguirá pendiente de activación administrativa.';
      appShell.inert = true;
      appShell.style.filter = 'blur(1.5px)';
      renderDashboard();
      return;
    }
    if (!user) {
      chip.textContent = 'Invitado';
      overlay.classList.remove('hidden');
      $('authTitle').textContent = 'Ingresar al panel';
      $('authDescription').textContent = 'Usa las credenciales de tu cuenta institucional.';
      $('authForm').hidden = false;
      $('forgotPassword').hidden = false;
      $('passwordRecoveryForm').hidden = true;
      $('inviteReturnLogin').hidden = true;
      appShell.inert = true;
      appShell.style.filter = 'blur(1.5px)';
      renderDashboard();
      return;
    }
    if (passwordRecovery) {
      overlay.classList.remove('hidden');
      $('authForm').hidden = true;
      $('forgotPassword').hidden = true;
      $('passwordRecoveryForm').hidden = false;
      $('inviteReturnLogin').hidden = true;
      $('authTitle').textContent = 'Restablece tu contraseña';
      $('authDescription').textContent = 'Elige una contraseña nueva y confírmala para continuar.';
      appShell.inert = true;
      appShell.style.filter = 'blur(1.5px)';
      return;
    }
    $('authForm').hidden = false;
    $('forgotPassword').hidden = false;
    $('passwordRecoveryForm').hidden = true;
    $('inviteReturnLogin').hidden = true;
    $('authTitle').textContent = 'Ingresar al panel';
    $('authDescription').textContent = 'Usa las credenciales de tu cuenta institucional.';
    overlay.classList.add('hidden');
    appShell.inert = false;
    appShell.style.filter = '';
    const initialArea = getAllowedAreas()[0];
    if (initialArea) applyAreaTheme(initialArea);
    chip.textContent = `${user.name} · ${CFG.roles[user.role]?.label || user.role}`;
    const areaList = getAllowedAreas().map(code => CFG.areas[code]?.short || code).join(' · ');
    chip.title = `Áreas autorizadas: ${areaList}`;
    document.querySelectorAll('.acard').forEach(btn => {
      const area = CFG.areas[btn.dataset.area];
      if (area) {
        btn.style.setProperty('--card-area-a', area.A);
        btn.style.setProperty('--card-area-b', area.B);
      }
      const allowed = getAllowedAreas().includes(btn.dataset.area);
      btn.disabled = !allowed;
      btn.style.display = allowed ? '' : 'none';
      btn.title = allowed ? '' : 'Sin permiso para este área';
    });
    renderDashboard(true);
    if (user.role === 'admin') renderUserManagement(true);
  }

  $('authForm').addEventListener('submit', e => {
    e.preventDefault();
    const status = $('authStatus');
    const button = $('authForm').querySelector('button[type=submit]');
    status.textContent = '';
    button.disabled = true;
    Backend.signIn($('authEmail').value.trim(), $('authPassword').value)
      .then(user => {
        status.textContent = `Sesión iniciada para ${user.name}.`;
        status.className = 'form-status success';
        $('authPassword').value = '';
        updateUserPanel();
      })
      .catch(error => {
        status.textContent = error.message;
        status.className = 'form-status error';
      })
      .finally(() => { button.disabled = false; });
  });

  $('forgotPassword').addEventListener('click', async () => {
    const email = $('authEmail').value.trim();
    if (!email || !$('authEmail').validity.valid) {
      $('authStatus').textContent = 'Escribe primero un correo válido.';
      $('authStatus').className = 'form-status error';
      return;
    }
    try {
      await Backend.resetPassword(email);
      $('authStatus').textContent = 'Si la cuenta existe, recibirás instrucciones para restablecer la contraseña.';
      $('authStatus').className = 'form-status success';
    } catch (error) {
      $('authStatus').textContent = error.message;
      $('authStatus').className = 'form-status error';
    }
  });

  $('passwordRecoveryForm').addEventListener('submit', async event => {
    event.preventDefault();
    const password = $('newPassword').value;
    if (password !== $('confirmPassword').value) {
      $('authStatus').textContent = 'Las contraseñas no coinciden.';
      $('authStatus').className = 'form-status error';
      return;
    }
    try {
      await Backend.updatePassword(password);
      if (invitationPasswordSetup) {
        invitationPasswordSaved = true;
        $('newPassword').value = '';
        $('confirmPassword').value = '';
        let signOutWarning = '';
        try {
          await Backend.signOut();
        } catch (error) {
          signOutWarning = ` La contraseña se guardó, pero no se pudo cerrar la sesión: ${error.message}`;
        }
        history.replaceState(null, document.title, location.pathname);
        $('authStatus').textContent = `Contraseña configurada. Tu cuenta sigue pendiente de activación por un administrador; podrás iniciar sesión cuando esté habilitada.${signOutWarning}`;
        $('authStatus').className = `form-status ${signOutWarning ? 'warning' : 'success'}`;
        updateUserPanel();
        return;
      }
      passwordRecovery = false;
      $('newPassword').value = '';
      $('confirmPassword').value = '';
      $('authStatus').textContent = 'Contraseña actualizada. Ya puedes continuar.';
      $('authStatus').className = 'form-status success';
      updateUserPanel();
    } catch (error) {
      $('authStatus').textContent = error.message;
      $('authStatus').className = 'form-status error';
    }
  });

  $('btnLogout').addEventListener('click', async () => {
    try {
      await Backend.signOut();
      updateUserPanel();
      notify('Sesión cerrada.', 'info');
    } catch (error) {
      notify(`No se pudo cerrar la sesión: ${error.message}`, 'error');
    }
  });

  window.addEventListener('catalyst:auth', event => {
    if (event.detail.status === 'unconfigured') {
      $('authStatus').textContent = event.detail.error.message;
      $('authStatus').className = 'form-status error';
      $('authForm').querySelector('button[type=submit]').disabled = true;
      $('forgotPassword').disabled = true;
      return;
    }
    if (event.detail.status === 'error') {
      $('authStatus').textContent = `No se pudo validar la sesión: ${event.detail.error?.message || 'error desconocido'}`;
      $('authStatus').className = 'form-status error';
      updateUserPanel();
      return;
    }
    if (event.detail.status === 'invite-password-setup') {
      invitationPasswordSetup = true;
      invitationLinkError = false;
      if (!invitationPasswordSaved) {
        $('authStatus').textContent = '';
        $('authStatus').className = 'form-status';
      }
      updateUserPanel();
      return;
    }
    if (event.detail.status === 'invite-link-error') {
      invitationPasswordSetup = true;
      invitationLinkError = true;
      $('authStatus').textContent = event.detail.error?.message || 'No se pudo validar el enlace de invitación.';
      $('authStatus').className = 'form-status error';
      updateUserPanel();
      return;
    }
    if (event.detail.status === 'password-recovery') passwordRecovery = true;
    if (event.detail.status === 'signed-out') passwordRecovery = false;
    updateUserPanel();
  });
  window.addEventListener('focus', () => Backend.refreshProfile().catch(error => {
    $('authStatus').textContent = `No se pudo actualizar la sesión: ${error.message}`;
    $('authStatus').className = 'form-status error';
  }));
  window.setInterval(() => Backend.refreshProfile().catch(error => {
    $('authStatus').textContent = `No se pudo actualizar la sesión: ${error.message}`;
    $('authStatus').className = 'form-status error';
  }), 60000);

  $('dashboardClose').addEventListener('click', () => $('userDashboard').classList.add('hidden'));
  $('dashboardRetry').addEventListener('click', () => renderDashboard(true));

  $('userCreateNew').addEventListener('click', () => openUserForm());
  $('userFormCancel').addEventListener('click', closeUserForm);
  $('userRetryLoad').addEventListener('click', () => renderUserManagement(true));
  $('userSearch').addEventListener('input', () => renderUserManagement());
  $('userVerifyInvite').addEventListener('click', async () => {
    if (!userInviteNeedsVerification || userOperationInProgress) return;
    userOperationInProgress = true;
    $('userVerifyInvite').disabled = true;
    setUserStatus('Comprobando el directorio antes de permitir otro intento…', 'info');
    try {
      const loaded = await renderUserManagement(true);
      if (!loaded) {
        setUserStatus('No se pudo verificar el directorio. No reintentes todavía; vuelve a intentarlo cuando la carga funcione.', 'error');
        return;
      }
      const email = $('userEmail').value.trim().toLowerCase();
      const existing = getManagedUsers().find(account => account.email?.toLowerCase() === email);
      if (existing) {
        userInviteNeedsVerification = false;
        $('userVerifyInvite').hidden = true;
        $('userRetryInvite').hidden = true;
        setUserStatus('La cuenta ya aparece en el directorio. No se enviará otra invitación; revisa su estado y usa la acción correspondiente.', 'warning');
      } else {
        $('userVerifyInvite').hidden = true;
        $('userRetryInvite').hidden = false;
        setUserStatus('La cuenta no aparece en el directorio. La solicitud anterior sigue siendo incierta; solo confirma un nuevo intento si has comprobado también el correo y el estado en el panel administrativo.', 'warning');
      }
    } finally {
      userOperationInProgress = false;
      $('userVerifyInvite').disabled = false;
    }
  });
  $('userRetryInvite').addEventListener('click', () => {
    if (!userInviteNeedsVerification || userOperationInProgress) return;
    if (!confirm('La solicitud anterior no tuvo respuesta y el directorio no muestra la cuenta. ¿Confirmas que revisaste el correo y la consola administrativa y deseas volver a intentarlo?')) return;
    userInviteNeedsVerification = false;
    $('userRetryInvite').hidden = true;
    $('userSubmit').disabled = false;
    setUserStatus('Reintento manual habilitado. No se garantiza que el intento anterior no haya sido procesado.', 'warning');
  });
  $('userRole').addEventListener('change', () => {
    const adminRole = $('userRole').value === 'admin';
    document.querySelectorAll('#userAreas input[type=checkbox]').forEach(input => {
      input.checked = adminRole;
      input.disabled = adminRole;
    });
    $('userAreas').classList.toggle('areas-disabled', adminRole);
  });
  $('userForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (userOperationInProgress || userInviteNeedsVerification) return;
    const current = getCurrentUser();
    if (current?.role !== 'admin') {
      setUserStatus('Solo una cuenta administrativa activa puede gestionar usuarios.', 'error');
      return;
    }
    const id = $('userEditId').value;
    const name = $('userName').value.trim();
    const email = $('userEmail').value.trim().toLowerCase();
    const role = $('userRole').value;
    const areas = [...document.querySelectorAll('#userAreas input[type=checkbox]:checked')].map(input => input.value);
    if (name.length < 2) return setUserStatus('Escribe un nombre de al menos 2 caracteres.', 'error');
    if (!email || !$('userEmail').validity.valid) return setUserStatus('Escribe un correo electrónico válido.', 'error');
    if (!['admin', 'tutor'].includes(role)) return setUserStatus('Selecciona un rol válido.', 'error');
    if (role === 'tutor' && !areas.length) return setUserStatus('Selecciona al menos un área para el tutor.', 'error');
    if (areas.some(code => !CFG.areas[code])) return setUserStatus('Hay un área no válida en la selección.', 'error');
    const submit = $('userSubmit');
    userOperationInProgress = true;
    submit.disabled = true;
    submit.textContent = id ? 'Guardando…' : 'Enviando invitación…';
    try {
      const result = await (id
        ? Backend.updateUser({ id, name, role, areas: role === 'admin' ? Object.keys(CFG.areas) : areas })
        : Backend.createUser({ name, email, role, areas: role === 'admin' ? Object.keys(CFG.areas) : areas }));
      closeUserForm();
      const refreshed = await renderUserManagement(true);
      renderDashboard(true);
      if (id === current.id) updateUserPanel();
      const listNote = refreshed ? '' : ' No se pudo actualizar el listado; vuelve a cargarlo.';
      setUserStatus((result?.warning || (id ? 'Usuario actualizado.' : 'Invitación enviada. Tras confirmar el correo y establecer su contraseña, activa la cuenta para permitir el acceso.')) + listNote, result?.warning || !refreshed ? 'warning' : 'success');
    } catch (error) {
      if (!id && error.outcome === 'unknown') {
        userInviteNeedsVerification = true;
        $('userVerifyInvite').hidden = false;
        $('userRetryInvite').hidden = true;
        submit.disabled = true;
        submit.textContent = 'Resultado de invitación incierto';
        setUserStatus(`${error.message} Comprueba el directorio antes de cualquier reintento.`, 'warning');
      } else {
        setUserStatus(error.message, error.outcome === 'partial' ? 'warning' : 'error');
      }
    } finally {
      userOperationInProgress = false;
      if (!userInviteNeedsVerification) {
        submit.disabled = false;
        submit.textContent = $('userEditId').value ? 'Guardar usuario' : 'Enviar invitación';
      }
    }
  });
  $('userTableBody').addEventListener('click', event => {
    const button = event.target.closest('button[data-user-action]');
    if (!button || getCurrentUser()?.role !== 'admin') return;
    const account = getManagedUsers().find(item => item.id === button.dataset.userId);
    if (!account) return;
    if (button.dataset.userAction === 'recover-partial') {
      if (!confirm(`¿Reintentar la configuración registrada para ${account.email}? El perfil quedará inactivo; después podrás activarlo por separado.`)) return;
      Backend.recoverPartialUser(account.id).then(async result => {
        const refreshed = await renderUserManagement(true);
        renderDashboard(true);
        const note = refreshed ? '' : ' No se pudo actualizar el directorio.';
        setUserStatus((result?.warning || 'Perfil configurado con las áreas originales y todavía inactivo. Actívalo solo después de confirmar el correo.') + note, result?.warning || !refreshed ? 'warning' : 'success');
      }).catch(error => setUserStatus(error.message, error.outcome === 'partial' ? 'warning' : 'error'));
      return;
    }
    if (button.dataset.userAction === 'cleanup-partial') {
      if (!confirm(`¿Cancelar la invitación y eliminar la cuenta pendiente de ${account.email}? Esta acción no se puede deshacer.`)) return;
      Backend.cleanupPartialUser(account.id).then(async result => {
        const refreshed = await renderUserManagement(true);
        renderDashboard(true);
        const note = refreshed ? '' : ' No se pudo actualizar el directorio.';
        setUserStatus((result?.warning || 'La invitación pendiente se canceló y la cuenta se eliminó.') + note, result?.warning || !refreshed ? 'warning' : 'success');
      }).catch(error => setUserStatus(error.message, error.outcome === 'partial' ? 'warning' : 'error'));
      return;
    }
    if (button.dataset.userAction === 'edit') {
      openUserForm(account);
      return;
    }
    if (button.dataset.userAction === 'reset') {
      if (!confirm(`¿Enviar instrucciones de restablecimiento a ${account.email}?`)) return;
      Backend.adminResetPassword(account.email).then(result => {
        const inactiveNote = account.active === false ? ' La cuenta sigue inactiva; el restablecimiento no la activa.' : '';
        setUserStatus((result?.warning || 'Se solicitó el envío del correo de restablecimiento.') + inactiveNote, result?.warning ? 'warning' : 'success');
      }).catch(error => setUserStatus(error.message, error.outcome === 'partial' ? 'warning' : 'error'));
      return;
    }
    if (button.dataset.userAction === 'toggle') {
      const activating = account.active === false;
      const sessionNote = activating ? '' : ' Las sesiones existentes pueden conservar el token de Auth, pero las políticas de datos bloquean el acceso al quedar inactiva; la interfaz cerrará la sesión en su siguiente comprobación.';
      if (!confirm(`${activating ? '¿Activar' : '¿Desactivar'} la cuenta de ${account.name}?${sessionNote}`)) return;
      Backend.setUserActive(account.id, activating).then(result => {
        return renderUserManagement(true).then(refreshed => {
          const listNote = refreshed ? '' : ' No se pudo actualizar el listado; vuelve a cargarlo.';
          setUserStatus((result?.warning || `Cuenta ${activating ? 'activada' : 'desactivada'}.`) + listNote, result?.warning || !refreshed ? 'warning' : 'success');
        });
      }).catch(error => setUserStatus(error.message, error.outcome === 'partial' ? 'warning' : 'error'));
    }
  });

  ['librarySearch', 'libraryAreaFilter', 'libraryTypeFilter', 'libraryDateFilter'].forEach(id => {
    const el = $(id);
    if (el) el.addEventListener('input', renderDashboard);
    if (el) el.addEventListener('change', renderDashboard);
  });

  /* ---------- valores iniciales de la portada ---------- */
  const C = CFG.cover;
  const lines = t => t.split('\n').map(s => s.trim()).filter(Boolean);
  $('code1').value = store.get('code1') || C.codePattern.replace('{n}', 1);
  $('code2').value = store.get('code2') || C.codePattern.replace('{n}', 2);
  $('txtTen').value = store.get('ten') || C.tenEnCuenta.join('\n');
  $('txtComo').value = store.get('como') || C.comoRealizar.join('\n');
  $('txtCA').value = store.get('ca') || C.contactoA.join('\n');
  $('txtCB').value = store.get('cb') || C.contactoB.join('\n');
  $('tagHoras').value = store.get('horas') || C.tags.horas;
  $('tagExtra').value = store.get('extra') || C.tags.extra;
  if (store.get('wmop')) { $('wmOp').value = store.get('wmop'); }
  $('wmVal').textContent = $('wmOp').value;

  /* ---------- carga del Word ---------- */
  const dz = $('dz'), fileIn = $('file');
  dz.addEventListener('click', () => fileIn.click());
  dz.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileIn.click(); });
  fileIn.addEventListener('change', () => fileIn.files[0] && load(fileIn.files[0]));
  ['dragover', 'dragenter'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('over'); }));
  dz.addEventListener('drop', e => {
    e.stopPropagation();
    const f = e.dataTransfer.files[0];
    if (f) load(f);
  });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => e.preventDefault());
  $('btnSaveQuestions').addEventListener('click', async () => {
    if (!S.pendingFile || !S.result || S.loading || S.savingImport) return;
    const button = $('btnSaveQuestions');
    S.savingImport = true;
    let saveCompleted = false;
    button.disabled = true;
    $('importReviewStatus').textContent = 'Guardando el documento y las preguntas revisadas…';
    try {
      const areas = [...new Set(S.result.questionBlocks.map(question => question.code).filter(Boolean))];
      const saved = await Backend.uploadDocument(S.pendingFile, areas, S.result);
      S.documentId = saved.id;
      S.questionIds = saved.questionIds;
      S.pendingFile = null;
      saveCompleted = true;
      $('importReviewStatus').textContent = 'Documento y preguntas guardados. Ya puedes generar el simulacro.';
      (saved.warnings || []).forEach(message => notify(message, 'warning'));
    } catch (error) {
      $('importReviewStatus').textContent = saveCompleted
        ? `La importación se guardó, pero no se pudo actualizar la vista previa: ${error.message}`
        : `No se guardó la importación: ${error.message}`;
      notify(saveCompleted
        ? 'Las preguntas se guardaron; revisa la vista previa antes de continuar.'
        : 'No se guardaron las preguntas. Puedes corregir el problema e intentarlo de nuevo.', saveCompleted ? 'warning' : 'error');
    } finally {
      S.savingImport = false;
      button.hidden = !S.pendingFile;
      button.disabled = false;
      const unresolved = S.result?.questionBlocks?.some(question => !question.code);
      $('btnPrint').disabled = !$('stage').children.length || unresolved || !!S.pendingFile || S.savingCompilation;
      if (saveCompleted) {
        try {
          await render();
        } catch (error) {
          $('importReviewStatus').textContent = `La importación se guardó, pero no se pudo actualizar la vista previa: ${error.message}`;
          notify('Las preguntas se guardaron; vuelve a actualizar la vista antes de continuar.', 'warning');
        }
      }
    }
  });

  const AREA_OPTIONS = [['Mat', 'Matemáticas'], ['Lec', 'Lectura Crítica'], ['Nat', 'Ciencias Naturales'], ['Soc', 'Sociales y Ciudadanas'], ['Ing', 'Inglés']];
  function renderClassification(result) {
    const blocks = result.questionBlocks || [];
    const counts = Object.fromEntries(AREA_OPTIONS.map(([code]) => [code, blocks.filter(q => q.code === code).length]));
    const unresolved = blocks.filter(q => !q.code).length;
    const text = [...AREA_OPTIONS.map(([code, name]) => `${name}: ${counts[code]}`), `Por revisar: ${unresolved}`].join(' · ');
    ['classificationSummary'].forEach(id => {
      const summary = $(id);
      summary.hidden = !blocks.length;
      summary.textContent = blocks.length ? `Preguntas detectadas: ${blocks.length}. ${text}.` : '';
    });
    const review = $('classificationReview');
    review.hidden = !blocks.length;
    const list = $('questionReviewList');
    list.innerHTML = '';
    const user = getCurrentUser();
    const canCorrect = !!user;
    blocks.forEach(block => {
      const row = document.createElement('label');
      row.className = 'question-review-item';
      const title = document.createElement('span');
      const areaName = CFG.areas[block.code]?.name || 'POR REVISAR';
      title.textContent = `Sesión ${block.session} · Pregunta ${block.number} — ${areaName} (${Math.round(block.confidence * 100)}%)`;
      const select = document.createElement('select');
      select.setAttribute('aria-label', `Área de sesión ${block.session}, pregunta ${block.number}`);
      const allowed = user?.role === 'admin' ? AREA_OPTIONS : AREA_OPTIONS.filter(([code]) => user?.areas.includes(code));
      select.innerHTML = '<option value="">Por revisar</option>' + allowed.map(([code, name]) => `<option value="${code}">${name}</option>`).join('');
      select.value = block.code || '';
      select.disabled = !canCorrect;
      select.title = block.reason;
      select.addEventListener('change', async () => {
        if (!canCorrect) return;
        const previousCode = block.code;
        if (!result.setQuestionArea(result, block.id, select.value || null)) return;
        try {
          if (S.documentId) await Backend.setQuestionArea(S.documentId, block);
          renderClassification(result);
          renderWarnings(result.warnings);
          updateImportSummary(result);
          render();
        } catch (error) {
          result.setQuestionArea(result, block.id, previousCode);
          select.value = previousCode || '';
          notify(error.message, 'error');
        }
      });
      row.append(title, select);
      list.appendChild(row);
    });
  }

  function renderWarnings(warnings) {
    const list = $('warns');
    list.innerHTML = '';
    (warnings || []).forEach(text => {
      const li = document.createElement('li');
      li.textContent = text;
      list.appendChild(li);
    });
  }

  function updateImportSummary(result) {
    const parts = [];
    [1, 2].forEach(session => {
      const areas = result.sessions[session].filter(area => area.code);
      const questions = result.questionBlocks.filter(q => q.session === session && q.code).length;
      if (areas.length || result.questionBlocks.some(q => q.session === session))
        parts.push(`<b>Sesión ${session}:</b> ${questions} preguntas clasificadas en ${[...new Set(areas.map(area => area.name.toLowerCase()))].join(', ') || 'ningún área'}`);
    });
    $('info').innerHTML = parts.join('<br>') || '<b>No encontré preguntas numeradas.</b> Revisa encabezados, numeración y contenido del Word.';
  }

  async function load(file) {
    if (!/\.docx$/i.test(file.name)) { alert('Sube un archivo Word .docx (si es .doc, ábrelo en Word y guárdalo como .docx).'); return; }
    if (!getCurrentUser()) {
      ensureAreaAccess('Mat');
      return;
    }
    if (S.loading || S.savingImport || S.savingCompilation) return;
    if (S.pendingFile && !confirm('La importación actual todavía no está guardada. ¿Descartarla y abrir este archivo?')) return;
    S.loading = true;
    S.result = null;
    S.documentId = null;
    S.questionIds = {};
    S.pendingFile = null;
    S.token++;
    $('stage').innerHTML = '';
    $('empty').style.display = '';
    $('btnPrint').disabled = true;
    $('importReview').hidden = true;
    $('btnSaveQuestions').hidden = false;
    $('btnSaveQuestions').disabled = false;
    $('importReviewStatus').textContent = '';
    $('info').textContent = '';
    $('warns').innerHTML = '';
    S.fileName = file.name; $('fname').textContent = file.name;
    fileIn.value = '';
    busy(true, 'Leyendo el Word…');
    try {
      const buf = await file.arrayBuffer();
      S.result = await DocxParser.parse(buf, CFG);
    } catch (err) {
      S.loading = false;
      busy(false); console.error(err); alert('No pude leer el archivo: ' + err.message); return;
    }
    const user = getCurrentUser();
    const allowedAreas = getAllowedAreas();
    const r = S.result;
    renderClassification(r);
    updateImportSummary(r);
    const unauthorized = [...new Set([...(r.sessions[1] || []), ...(r.sessions[2] || [])].map(a => a.code).filter(code => code && user && user.role !== 'admin' && !allowedAreas.includes(code)))];
    if (user && user.role !== 'admin' && unauthorized.length) {
      S.result = null;
      S.loading = false;
      busy(false); $('fname').textContent = ''; $('info').innerHTML = '<b>Acceso no autorizado.</b> El Word contiene áreas fuera de tus permisos.'; notify(`No tienes permisos para ${unauthorized.map(code => CFG.areas[code]?.name || code).join(', ')}.`, 'error'); return;
    }
    S.pendingFile = file;
    S.loading = false;
    let anyIng = false;
    [1, 2].forEach(s => {
      const area = r.sessions[s].find(a => a.code === 'Ing');
      const conv = area && area.raw ? CatalystIngles.fromWord(area.raw) : null;
      S.ing[s] = conv ? conv.text : '';
      $('txtIng' + s).value = S.ing[s];
      $('ingWrap' + s).style.display = area ? '' : 'none';
      if (conv) { anyIng = true; r.warnings.push(...conv.warnings); }
    });
    $('ingBox').style.display = anyIng ? '' : 'none';
    if (anyIng) $('ingBox').open = true;
    $('nq1').value = r.stats[1] || ''; $('nq2').value = r.stats[2] || '';
    $('chkS1').checked = r.sessions[1].length > 0; $('chkS1').disabled = !r.sessions[1].length;
    $('chkS2').checked = r.sessions[2].length > 0; $('chkS2').disabled = !r.sessions[2].length;
    renderWarnings(r.warnings);
    if (!r.warnings.length && r.questionBlocks.length) {
      const li = document.createElement('li'); li.className = 'ok'; li.textContent = '✓ Preguntas detectadas y áreas asignadas; revisa y guarda la importación antes de generar.';
      $('warns').appendChild(li);
    }
    $('importReview').hidden = false;
    $('importReviewStatus').textContent = r.questionBlocks.length
      ? 'Revisa las preguntas y corrige la clasificación antes de guardar. Aún no se ha guardado ningún dato.'
      : 'No se detectaron preguntas. Revisa el documento; no se guardará automáticamente.';
    $('btnSaveQuestions').disabled = !r.questionBlocks.length;
    await render();
  }

  function questionPayload(row) {
    return row.question_payload && Array.isArray(row.question_payload.atoms)
      ? row.question_payload.atoms
      : [];
  }

  function questionOrder(row) {
    const match = String(row.source_key || '').match(/^s(\d+)-q(\d+)-/);
    return match ? [Number(match[1]), Number(match[2])] : [Number(row.session_number) || 0, Number(row.question_number) || 0];
  }

  function questionText(row) {
    const atom = questionPayload(row).find(item => item.t === 'preg');
    const template = document.createElement('template');
    template.innerHTML = atom?.html || '';
    return (template.content.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function renderQuestionBank() {
    const list = $('questionBankList');
    if (!list) return;
    const filter = $('questionBankSearch').value.trim().toLocaleLowerCase();
    list.replaceChildren();
    const rows = S.reusableQuestions.filter(row => {
      const documentInfo = Array.isArray(row.documents) ? row.documents[0] : row.documents;
      return `${documentInfo?.file_name || ''} ${questionText(row)} ${CFG.areas[row.area_code]?.name || row.area_code}`.toLocaleLowerCase().includes(filter);
    });
    if (!rows.length) {
      $('questionBankStatus').textContent = S.reusableQuestions.length
        ? 'No hay preguntas que coincidan con la búsqueda.'
        : 'Carga las preguntas permitidas para seleccionar algunas.';
      return;
    }
    $('questionBankStatus').textContent = `${rows.length} pregunta${rows.length === 1 ? '' : 's'} disponible${rows.length === 1 ? '' : 's'}.`;
    rows.forEach(row => {
      const label = document.createElement('label');
      label.className = 'question-option';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = row.id;
      checkbox.checked = !!row.selected;
      checkbox.addEventListener('change', () => {
        row.selected = checkbox.checked;
        $('buildFromQuestionBank').disabled = !S.reusableQuestions.some(item => item.selected);
      });
      const text = document.createElement('span');
      text.style.display = 'grid';
      text.style.gap = '3px';
      const documentInfo = Array.isArray(row.documents) ? row.documents[0] : row.documents;
      const name = document.createElement('strong');
      name.textContent = `${CFG.areas[row.area_code]?.short || row.area_code} · Sesión ${row.session_number} · Pregunta ${row.question_number}`;
      const source = document.createElement('small');
      source.textContent = documentInfo?.file_name || `Documento ${row.document_id}`;
      const prompt = document.createElement('span');
      prompt.textContent = questionText(row) || 'Sin enunciado de texto; puede incluir elementos gráficos.';
      text.append(name, source, prompt);
      label.append(checkbox, text);
      list.appendChild(label);
    });
  }

  $('loadQuestionBank').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    $('questionBankStatus').textContent = 'Cargando preguntas permitidas…';
    try {
      S.reusableQuestions = await Backend.listReusableQuestions();
      S.reusableQuestions.forEach(row => { row.selected = false; });
      renderQuestionBank();
      $('buildFromQuestionBank').disabled = true;
    } catch (error) {
      $('questionBankStatus').textContent = `No se pudieron cargar las preguntas: ${error.message}`;
      $('questionBankStatus').className = 'hint error';
    } finally {
      button.disabled = false;
    }
  });
  $('questionBankSearch').addEventListener('input', renderQuestionBank);
  $('buildFromQuestionBank').addEventListener('click', async () => {
    const selected = S.reusableQuestions.filter(row => row.selected);
    if (!selected.length) return;
    const ids = selected.map(row => row.id);
    if (new Set(ids).size !== ids.length) {
      $('questionBankStatus').textContent = 'La selección contiene preguntas duplicadas; actualiza la lista e inténtalo de nuevo.';
      return;
    }
    if (selected.some(row => !questionPayload(row).some(atom => atom.t === 'preg'))) {
      $('questionBankStatus').textContent = 'Una o más preguntas guardadas no tienen un enunciado estructurado; no se generó el simulacro para evitar perder contenido.';
      return;
    }
    const ordered = [...selected].sort((a, b) =>
      a.document_id.localeCompare(b.document_id) ||
      (Number(a.session_number) - Number(b.session_number)) ||
      (questionOrder(a)[1] - questionOrder(b)[1]));
    const groupContexts = new Map();
    S.reusableQuestions.forEach(row => {
      const rawGroupId = row.question_payload?.contextGroupId;
      const groupId = rawGroupId ? `${row.document_id}:${rawGroupId}` : null;
      if (!groupId || groupContexts.has(groupId)) return;
      const atoms = questionPayload(row);
      const promptIndex = atoms.findIndex(atom => atom.t === 'preg');
      if (promptIndex > 0) groupContexts.set(groupId, atoms.slice(0, promptIndex).filter(atom => atom.t !== 'sep'));
    });
    const seenContexts = new Set();
    const sessions = { 1: [], 2: [] };
    const questionBlocks = [];
    S.questionIds = {};
    for (const row of ordered) {
      const session = Number(row.session_number);
      const area = row.area_code;
      if (![1, 2].includes(session) || !CFG.areas[area]) continue;
      const atoms = questionPayload(row);
      const promptIndex = atoms.findIndex(atom => atom.t === 'preg');
      const rawGroupId = row.question_payload?.contextGroupId;
      const groupId = rawGroupId ? `${row.document_id}:${rawGroupId}` : null;
      const ownContext = promptIndex > 0 ? atoms.slice(0, promptIndex).filter(atom => atom.t !== 'sep') : [];
      const context = groupId
        ? (!seenContexts.has(groupId) ? groupContexts.get(groupId) || ownContext : [])
        : ownContext;
      if (groupId) seenContexts.add(groupId);
      const questionAtoms = promptIndex >= 0 ? atoms.slice(promptIndex) : atoms;
      let areaEntry = sessions[session].find(item => item.code === area);
      if (!areaEntry) {
        areaEntry = { code: area, name: CFG.areas[area].name, atoms: [] };
        sessions[session].push(areaEntry);
      }
      areaEntry.atoms.push(...context, ...questionAtoms.filter(atom => atom.t !== 'sep'), { t: 'sep' });
      questionBlocks.push({
        id: row.id,
        session,
        number: row.question_number,
        code: area,
        confidence: 1,
        reason: 'Pregunta reutilizada desde un documento guardado.',
        explicit: true,
        atoms: [...context, ...questionAtoms]
      });
      S.questionIds[row.id] = row.id;
    }
    if (!questionBlocks.length) {
      $('questionBankStatus').textContent = 'Las preguntas seleccionadas no tienen una sesión o área válida; no se creó la vista previa.';
      return;
    }
    S.result = {
      sessions,
      questionBlocks,
      stats: {
        1: questionBlocks.filter(question => question.session === 1).length,
        2: questionBlocks.filter(question => question.session === 2).length
      },
      warnings: [],
      documentId: null
    };
    S.documentId = null;
    S.pendingFile = null;
    S.fileName = 'Preguntas reutilizadas';
    S.ing = { 1: '', 2: '', photos: {}, parts: {} };
    $('fname').textContent = `${questionBlocks.length} preguntas seleccionadas de documentos existentes`;
    $('importReview').hidden = true;
    $('classificationReview').hidden = true;
    $('classificationSummary').hidden = true;
    $('info').textContent = `${questionBlocks.length} preguntas de documentos guardados. Los documentos originales permanecen intactos.`;
    $('warns').replaceChildren();
    $('ingBox').style.display = 'none';
    $('chkS1').checked = S.result.stats[1] > 0;
    $('chkS2').checked = S.result.stats[2] > 0;
    $('chkS1').disabled = !S.result.stats[1];
    $('chkS2').disabled = !S.result.stats[2];
    $('nq1').value = S.result.stats[1];
    $('nq2').value = S.result.stats[2];
    const legacyContextNotice = selected.some(row => !row.question_payload?.contextGroupId)
      ? ' Algunos registros antiguos no guardan identificadores de contexto; revisa la vista previa para confirmar la asociación.'
      : '';
    $('questionBankStatus').textContent = `${questionBlocks.length} preguntas listas para vista previa. Las fuentes originales no se modificaron ni duplicaron.${legacyContextNotice}`;
    await render();
  });

  /* ---------- armado ---------- */
  function busy(on, msg) { $('busy').classList.toggle('on', on); if (msg) $('busy').textContent = msg; }
  const frame = () => new Promise(r => setTimeout(r, 0));

  async function render() {
    if (!S.result) return;
    const my = ++S.token;
    const stage = $('stage');
    $('empty').style.display = 'none';
    busy(true, 'Armando páginas…');
    await frame();
    stage.innerHTML = ''; stage.style.zoom = 1;
    try {
      await document.fonts.ready;
    } catch (e) { /* ok */ }
    const lcfg = { areas: CFG.areas, watermarkSrc: S.wmSrc, watermarkOpacity: $('wmOp').value / 100 };
    S.ing.parts = {};
    for (const s of [1, 2]) {
      lcfg.renderIngles = (area, start, st) => {
        const txt = ($('txtIng' + s).value || '').trim();
        if (!txt) return null;
        const res = CatalystIngles.build(txt, S.ing.photos, st, { src: lcfg.watermarkSrc, opacity: lcfg.watermarkOpacity });
        S.ing.parts[s] = res.parts;
        return res.pages;
      };
      if (!$('chkS' + s).checked || !S.result.sessions[s].length) continue;
      if ($('chkCover').checked) {
        stage.appendChild(CatalystCover.build({
          code: $('code' + s).value, nQuestions: $('nq' + s).value || S.result.stats[s],
          sessionName: C.sessionNames[s], centralImage: S.central[s] || C.centralImages[s],
          qrImage: S.qr || C.qrImage, tags: { horas: $('tagHoras').value, extra: $('tagExtra').value },
          tenEnCuenta: lines($('txtTen').value), comoRealizar: lines($('txtComo').value),
          contactoA: lines($('txtCA').value), contactoB: lines($('txtCB').value)
        }));
      }
      CatalystLayout.layoutSession(S.result.sessions[s].filter(area => area.code), lcfg, stage);
      await frame();
      if (my !== S.token) return;                      // llegó una orden más nueva
    }
    const names = { p1: '1', p2: '2', p3: '3', p4a: '4A', p4b: '4B', p5: '5', p6: '6', p7: '7', p7a: '7A', p7b: '7B' };
    $('ingParts').textContent = [1, 2].filter(s => S.ing.parts[s]).map(s => `Sesión ${s}: Partes ${S.ing.parts[s].map(k => names[k]).join(', ')} (${S.ing.parts[s].length} páginas).`).join(' ');
    busy(false);
    const unresolved = S.result.questionBlocks?.some(question => !question.code);
    $('btnPrint').disabled = !stage.children.length || unresolved || !!S.pendingFile || S.savingImport || S.savingCompilation;
    if (unresolved) notify('Hay preguntas «Por revisar». Administración debe clasificarlas antes de descargar.', 'warning');
    if (S.fit) fit(); else applyZoom();
  }

  let timer = null;
  const later = () => { clearTimeout(timer); timer = setTimeout(render, 350); };

  /* ---------- controles ---------- */
  ['chkS1', 'chkS2', 'chkCover'].forEach(id => $(id).addEventListener('change', later));
  const persist = { code1: 'code1', code2: 'code2', txtTen: 'ten', txtComo: 'como', txtCA: 'ca', txtCB: 'cb', tagHoras: 'horas', tagExtra: 'extra' };
  Object.keys(persist).forEach(id => $(id).addEventListener('input', () => { store.set(persist[id], $(id).value); later(); }));
  ['nq1', 'nq2'].forEach(id => $(id).addEventListener('input', later));
  $('wmOp').addEventListener('input', () => { $('wmVal').textContent = $('wmOp').value; store.set('wmop', $('wmOp').value); document.querySelectorAll('.wm').forEach(w => { w.style.opacity = $('wmOp').value / 100; }); });
  $('ingGuide').textContent = CatalystIngles.GUIDE;
  ['txtIng1', 'txtIng2'].forEach(id => $(id).addEventListener('input', later));
  document.querySelectorAll('[data-ph]').forEach(inp => inp.addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    const label = document.querySelector(`[data-file-for="${inp.dataset.ph}"]`);
    if (label) {
      label.textContent = `Leyendo ${f.name}…`;
      label.classList.remove('error');
    }
    const rd = new FileReader();
    rd.onload = () => {
      if (typeof rd.result !== 'string') {
        if (label) {
          label.textContent = S.ing.photos[inp.dataset.ph]
            ? `No se pudo leer ${f.name}; se conserva la imagen anterior.`
            : `No se pudo leer ${f.name}. Selecciona otra imagen.`;
          label.classList.add('error');
        }
        notify('No se pudo leer la imagen seleccionada. Elige otro archivo.', 'error');
        return;
      }
      S.ing.photos[inp.dataset.ph] = rd.result;
      if (label) label.textContent = f.name;
      later();
    };
    rd.onerror = () => {
      if (label) {
        label.textContent = S.ing.photos[inp.dataset.ph]
          ? `No se pudo leer ${f.name}; se conserva la imagen anterior.`
          : `No se pudo leer ${f.name}. Selecciona otra imagen.`;
        label.classList.add('error');
      }
      notify('No se pudo leer la imagen seleccionada. Elige otro archivo.', 'error');
    };
    rd.readAsDataURL(f);
  }));
  const url = f => URL.createObjectURL(f);
  $('wmFile').addEventListener('change', e => { if (e.target.files[0]) { S.wmSrc = url(e.target.files[0]); later(); } });
  $('img1').addEventListener('change', e => { if (e.target.files[0]) { S.central[1] = url(e.target.files[0]); later(); } });
  $('img2').addEventListener('change', e => { if (e.target.files[0]) { S.central[2] = url(e.target.files[0]); later(); } });
  $('imgQR').addEventListener('change', e => { if (e.target.files[0]) { S.qr = url(e.target.files[0]); later(); } });

  /* ---------- zoom ---------- */
  function applyZoom() { $('stage').style.zoom = S.zoom; $('zoomLbl').textContent = Math.round(S.zoom * 100) + '%'; }
  function fit() { const w = $('view').clientWidth - 40; S.zoom = Math.max(.3, Math.min(1.2, w / 794)); applyZoom(); }
  $('zIn').onclick = () => { S.fit = false; S.zoom = Math.min(2, S.zoom + .1); applyZoom(); };
  $('zOut').onclick = () => { S.fit = false; S.zoom = Math.max(.3, S.zoom - .1); applyZoom(); };
  $('zFit').onclick = () => { S.fit = true; fit(); };
  window.addEventListener('resize', () => { if (S.fit && S.result) fit(); });

  /* ---------- PDF ---------- */
  $('btnPrint').addEventListener('click', async () => {
    if (S.loading || S.savingImport || S.savingCompilation || S.pendingFile) {
      if (S.pendingFile) notify('Guarda primero las preguntas revisadas antes de generar el simulacro.', 'warning');
      return;
    }
    const user = getCurrentUser();
    if (!user) {
      ensureAreaAccess('Mat');
      return;
    }
    const includedAreas = [...new Set([1, 2]
      .filter(session => $('chkS' + session).checked)
      .flatMap(session => (S.result?.sessions[session] || []).map(area => area.code).filter(Boolean)))];
    if (S.result?.questionBlocks?.some(question => !question.code)) {
      notify('Clasifica todas las preguntas «Por revisar» antes de descargar.', 'error');
      return;
    }
    if (!includedAreas.length || includedAreas.some(area => !ensureAreaAccess(area))) return;
    const area = includedAreas.length === 1 ? includedAreas[0] : 'all';
    const questionIds = S.result.questionBlocks
      .filter(question => includedAreas.includes(question.code))
      .map(question => S.questionIds[question.id]).filter(Boolean);
    const title = S.fileName ? S.fileName.replace(/\.docx$/i, '') : 'Simulacro';
    const fileName = `${title || 'Simulacro'} - Catalyst.pdf`;
    let pdfGenerated = false;
    S.savingCompilation = true;
    $('btnPrint').disabled = true;
    try {
      const pdf = await PdfGenerator.generate($('stage'), fileName);
      pdfGenerated = true;
      downloadGeneratedPdf(pdf, fileName);
      await addLibraryEntry({
        name: title, type: 'simulacro', area, questionIds,
        pdf,
        configuration: {
          sourceDocumentId: S.documentId,
          sessions: [1, 2].filter(session => $('chkS' + session).checked),
          includeCover: $('chkCover').checked,
          codes: { 1: $('code1').value, 2: $('code2').value },
          fileName: S.fileName
        }
      });
      notify('PDF descargado y guardado en Catalyst durante 15 días.', 'success');
    } catch (error) {
      notify(pdfGenerated
        ? `El PDF local se descargó, pero la operación en Catalyst no finalizó: ${error.message}`
        : `No se pudo generar el PDF: ${error.message}`, 'error');
    } finally {
      S.savingCompilation = false;
      const unresolved = S.result?.questionBlocks?.some(question => !question.code);
      $('btnPrint').disabled = !$('stage').children.length || unresolved || !!S.pendingFile || S.savingImport;
    }
  });

  /* Hook para pruebas automáticas */
  window.__catalyst = { load, render, S };
  window.CatalystApp = {
    S, CFG, busy, frame, store,
    getCurrentUser, getAllowedAreas, ensureAreaAccess, updateUserPanel, applyAreaTheme,
    addHistoryEntry, addLibraryEntry, renderDashboard, notify,
    downloadGeneratedPdf,
    refit() { if (S.fit) fit(); else applyZoom(); },
    wm() { return { src: S.wmSrc, opacity: $('wmOp').value / 100 }; },
    setWmOpacity(v) { $('wmOp').value = v; $('wmOp').dispatchEvent(new Event('input')); },
    canAccessArea(code) { return ensureAreaAccess(code); },
    renderSim() {
      if (S.result) render();
      else { $('stage').innerHTML = ''; $('empty').style.display = ''; $('btnPrint').disabled = true; busy(false); }
    }
  };

  Backend.ready.then(configured => {
    updateUserPanel();
    if (!configured && !Backend.isConfigured()) {
      $('authStatus').textContent = Backend.getStartupError();
      $('authStatus').className = 'form-status error';
      $('authForm').querySelector('button[type=submit]').disabled = true;
      $('forgotPassword').disabled = true;
    }
  }).catch(error => {
    $('authStatus').textContent = `No se pudo iniciar la aplicación: ${error.message}`;
    $('authStatus').className = 'form-status error';
  });
})();
