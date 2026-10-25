/* ============================================================
   Inicio + Compilado
   Inicio → «Crear simulacro» (flujo de siempre) o «Crear compilado»
   Compilado → área → editor:
     · Inglés: tarjetas por Parte (se pueden repetir: 1A, 1B, 1C…) + importar desde Word
     · Demás áreas: subes el Word y se arma con el diseño de 2 columnas del área
     · Portada con colores editables
   ============================================================ */
(function () {
  'use strict';
  const App = window.CatalystApp, CFG = App.CFG;
  const $ = id => document.getElementById(id);
  const lines = t => t.split('\n').map(s => s.trim()).filter(Boolean);

  const SHORT = { Mat: 'MATEMÁTICAS', Lec: 'LECTURA', Soc: 'SOCIALES', Nat: 'NATURALES', Ing: 'INGLÉS' };
  const ABBR = { Mat: 'MAT', Lec: 'LEC', Soc: 'SOC', Nat: 'NAT', Ing: 'ING' };
  const TYPE_NAME = { p1: 'Avisos', p2: 'Emparejar', p3: 'Diálogos', cloze: 'Texto con espacios', read3: 'Lectura · 3 opciones', read4: 'Lectura · 4 opciones' };
  const PHOTO_TYPES = ['cloze', 'read3'];
  const TYPE_BY_GROUP = CatalystIngles.GROUP_TYPE;
  const CARD_KEY = { p1: '1', p2: '2', p3: '3', cloze: '4A', read3: '5', read4: '5' };

  const EMPTY_SIM = $('empty').querySelector('p').innerHTML;
  const C = { area: null, cards: [], nextId: 1, atoms: null, parsedResult: null, documentId: null, pendingFile: null, loadingImport: false, savingImport: false, savingCompilation: false, persistedQuestionIds: {}, entryQuestionIds: {}, questionCount: 0, questionEntries: [], questionSources: [], excludedQuestionKeys: new Set(), importWarnings: [], fileName: '', central: null, qr: null, token: 0, coverTouched: false, flow: 'compilado', editingCompilationId: null, editingConfiguration: {}, savedQuestionRows: [], contextByGroup: {} };

  /* ---------------------------------------------------------- utilidades de color */
  const hex2rgb = h => { h = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
  const rgb2hex = a => '#' + a.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, t) => { const x = hex2rgb(a), y = hex2rgb(b); return rgb2hex(x.map((v, i) => v * (1 - t) + y[i] * t)); };
  const coverColors = () => {
    const c1 = $('cCol1').value, c2 = $('cCol2').value;
    return { rosa: c1, naranja: c2, rosaclaro: mix(c1, '#ffffff', .2), rojonaranja: mix(c1, c2, .3) };
  };
  const cleanText = value => String(value || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

  function sourceSession(index) {
    const source = C.questionSources.find(item => index >= item.start && index < item.end);
    return source ? source.session : 1;
  }

  const atomText = atom => {
    const template = document.createElement('template');
    template.innerHTML = atom?.html || '';
    return (template.content.textContent || '').replace(/\s+/g, ' ').trim();
  };
  const hasStructuredInline = atom => {
    const template = document.createElement('template');
    template.innerHTML = atom?.html || '';
    return !!template.content.querySelector('img,svg,math,table,canvas,object,iframe,sup,sub');
  };
  function setAtomText(atom, value) {
    const template = document.createElement('template');
    template.innerHTML = atom.html || '';
    if (template.content.querySelector('img,svg,math,table,canvas,object,iframe,sup,sub')) return false;
    const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    if (textNodes.length) {
      textNodes[0].nodeValue = value;
      textNodes.slice(1).forEach(node => { node.nodeValue = ''; });
    } else if (value) {
      template.content.appendChild(document.createTextNode(value));
    }
    atom.html = template.innerHTML;
    return true;
  }

  function contextAtomsFor(row) {
    const groupId = row.question_payload?.contextGroupId;
    if (groupId && C.contextByGroup[groupId]) return C.contextByGroup[groupId];
    const atoms = row.question_payload?.atoms || [];
    const promptIndex = atoms.findIndex(atom => atom.t === 'preg');
    return promptIndex > 0 ? atoms.slice(0, promptIndex).filter(atom => atom.t !== 'sep') : [];
  }

  function applyContextOverride(atoms, value) {
    const result = atoms.map(atom => ({ ...atom }));
    const paragraphs = result.filter(atom => atom.t === 'par');
    if (!paragraphs.length) return result;
    const lines = value.split(/\r?\n/);
    paragraphs.forEach((atom, index) => {
      const content = index === paragraphs.length - 1
        ? lines.slice(index).join('\n')
        : lines[index] || '';
      if (!hasStructuredInline(atom)) setAtomText(atom, content);
    });
    return result;
  }

  function overriddenQuestionAtoms(row) {
    const atoms = (row.question_payload?.atoms || []).map(atom => ({ ...atom }));
    const override = C.editingConfiguration.questionOverrides?.[row.id];
    if (!override) return atoms;
    const prompt = atoms.find(atom => atom.t === 'preg');
    if (prompt && typeof override.prompt === 'string' && !hasStructuredInline(prompt)) setAtomText(prompt, override.prompt);
    const options = atoms.filter(atom => atom.t === 'op');
    if (Array.isArray(override.options)) {
      options.forEach((atom, index) => {
        if (typeof override.options[index] === 'string' && !hasStructuredInline(atom)) setAtomText(atom, override.options[index]);
      });
    }
    return atoms;
  }

  function setEditorStatus(message) {
    $('cEditStatus').textContent = message;
  }

  function selectedEditorEntry() {
    return C.questionEntries[Number($('cEditQuestion').value)] || null;
  }

  function populateQuestionEditor() {
    const select = $('cEditQuestion');
    select.replaceChildren();
    C.questionEntries.forEach((entry, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = entry.label;
      select.appendChild(option);
    });
    refreshQuestionEditor();
  }

  function refreshQuestionEditor() {
    const entry = selectedEditorEntry();
    if (!entry) return;
    const atoms = C.atoms.slice(entry.start, entry.end);
    const promptAtom = atoms.find(atom => atom.t === 'preg');
    const options = atoms.filter(atom => atom.t === 'op');
    $('cEditPrompt').value = atomText(promptAtom);
    $('cEditPrompt').disabled = hasStructuredInline(promptAtom);
    const groupId = entry.contextKey;
    const context = C.contextByGroup[groupId] || entry.contextAtoms || [];
    const contextOverride = C.editingConfiguration.contextOverrides?.[groupId];
    const contextParagraphs = context.filter(atom => atom.t === 'par').map(atomText);
    $('cEditContext').value = typeof contextOverride === 'string' ? contextOverride : contextParagraphs.join('\n');
    const editableContext = contextParagraphs.length && !context.some(atom => atom.t === 'par' && hasStructuredInline(atom));
    $('cEditContext').disabled = !editableContext;
    if (!contextParagraphs.length) $('cEditContext').value = context.length
      ? 'El contexto contiene elementos gráficos o tablas; se conservan y no se editarán como texto.'
      : '';
    else if (!editableContext) $('cEditContext').value = 'El contexto contiene una imagen o expresión estructurada; se conserva sin cambios.';
    const optionWrap = $('cEditOptions');
    optionWrap.replaceChildren();
    options.forEach((atom, index) => {
      const label = document.createElement('label');
      label.className = 'field';
      label.textContent = `Opción ${atom.l || String.fromCharCode(65 + index)}`;
      const input = document.createElement('textarea');
      input.rows = 2;
      input.value = atomText(atom);
      input.dataset.optionIndex = String(index);
      input.disabled = hasStructuredInline(atom);
      input.addEventListener('input', () => {
        const current = selectedEditorEntry();
        const row = C.savedQuestionRows.find(item => item.id === C.entryQuestionIds[current.key]);
        const saved = C.editingConfiguration.questionOverrides[row.id] || {};
        const currentOptions = atoms.filter(item => item.t === 'op').map(item => atomText(item));
        currentOptions[index] = input.value;
        C.editingConfiguration.questionOverrides[row.id] = { ...saved, options: currentOptions };
        setAtomText(atoms.filter(item => item.t === 'op')[index], input.value);
        setEditorStatus('Cambios pendientes de guardar.');
        later();
      });
      label.appendChild(input);
      optionWrap.appendChild(label);
    });
    $('cEditContext').oninput = () => {
      C.editingConfiguration.contextOverrides[groupId] = $('cEditContext').value;
      const groupAtoms = C.contextByGroup[groupId] || entry.contextAtoms || [];
      const revised = applyContextOverride(groupAtoms, $('cEditContext').value);
      revised.forEach((atom, index) => { if (groupAtoms[index]) groupAtoms[index].html = atom.html; });
      setEditorStatus('Cambios pendientes de guardar.');
      later();
    };
    $('cEditPrompt').oninput = () => {
      const current = selectedEditorEntry();
      const row = C.savedQuestionRows.find(item => item.id === C.entryQuestionIds[current.key]);
      if (!row) return;
      const saved = C.editingConfiguration.questionOverrides[row.id] || {};
      C.editingConfiguration.questionOverrides[row.id] = { ...saved, prompt: $('cEditPrompt').value };
      const atom = C.atoms.slice(current.start, current.end).find(item => item.t === 'preg');
      if (atom) setAtomText(atom, $('cEditPrompt').value);
      setEditorStatus('Cambios pendientes de guardar.');
      later();
    };
  }

  function rebuildSavedCompilation() {
    C.atoms = [];
    C.questionSources = [];
    C.entryQuestionIds = {};
    const seenGroups = new Set();
    const groupKeys = [];
    C.savedQuestionRows.forEach(row => {
      const original = row.question_payload?.atoms;
      if (!Array.isArray(original) || !original.some(atom => atom.t === 'preg')) {
        throw new Error(`La pregunta ${row.question_number} no contiene átomos estructurados.`);
      }
      const groupId = row.question_payload?.contextGroupId
        ? `${row.document_id}:${row.question_payload.contextGroupId}`
        : `question-${row.id}`;
      groupKeys.push(groupId);
      const start = C.atoms.length;
      let context = C.contextByGroup[groupId];
      if (!context) {
        const promptIndex = original.findIndex(atom => atom.t === 'preg');
        context = promptIndex > 0 ? original.slice(0, promptIndex).filter(atom => atom.t !== 'sep') : [];
        C.contextByGroup[groupId] = context.map(atom => ({ ...atom }));
      }
      if (!seenGroups.has(groupId)) {
        seenGroups.add(groupId);
        const contextOverride = C.editingConfiguration.contextOverrides[groupId];
        const contextAtoms = typeof contextOverride === 'string'
          ? applyContextOverride(C.contextByGroup[groupId], contextOverride)
          : C.contextByGroup[groupId];
        C.contextByGroup[groupId] = contextAtoms;
        C.atoms.push(...contextAtoms);
      }
      const questionAtoms = overriddenQuestionAtoms(row);
      const promptIndex = questionAtoms.findIndex(atom => atom.t === 'preg');
      C.atoms.push(...questionAtoms.slice(promptIndex));
      C.questionSources.push({ start, end: C.atoms.length, session: Number(row.session_number) || 1 });
    });
    C.questionEntries = indexAtomQuestions(C.atoms);
    if (C.questionEntries.length !== C.savedQuestionRows.length) {
      throw new Error('El número de preguntas del compilado no coincide con sus referencias guardadas.');
    }
    C.questionEntries.forEach((entry, index) => {
      const row = C.savedQuestionRows[index];
      const documentInfo = Array.isArray(row.documents) ? row.documents[0] : row.documents;
      const groupId = groupKeys[index];
      entry.key = `saved-${row.id}`;
      entry.duplicate = false;
      entry.label = `${CFG.areas[row.area_code]?.short || row.area_code} · Sesión ${row.session_number} · Pregunta ${row.question_number}${documentInfo?.file_name ? ` · ${documentInfo.file_name}` : ''}`;
      entry.contextKey = groupId;
      entry.contextAtoms = C.contextByGroup[groupId] || [];
      C.entryQuestionIds[entry.key] = row.id;
    });
    C.questionCount = C.questionEntries.length;
    C.excludedQuestionKeys.clear();
  }

  async function editExistingCompilation(id) {
    const compilation = await window.CatalystBackend.loadCompilation(id);
    if (compilation.compilation_type !== 'compilado') {
      throw new Error('Solo se pueden editar compilados guardados desde esta pantalla.');
    }
    const area = compilation.area_code || compilation.questions[0]?.area_code;
    if (!area || compilation.questions.some(question => question.area_code !== area)) {
      throw new Error('Este compilado contiene áreas distintas o no tiene un área identificable; no se modificó.');
    }
    if (!App.ensureAreaAccess(area)) return;
    openArea(area, 'compilado');
    C.editingCompilationId = compilation.id;
    C.editingConfiguration = {
      ...(compilation.configuration || {}),
      questionOverrides: { ...(compilation.configuration?.questionOverrides || {}) },
      contextOverrides: { ...(compilation.configuration?.contextOverrides || {}) }
    };
    C.savedQuestionRows = compilation.questions;
    C.contextByGroup = Object.fromEntries(Object.entries(compilation.contextByGroup || {})
      .map(([key, atoms]) => [key, atoms.map(atom => ({ ...atom }))]));
    C.savedQuestionRows.forEach(row => {
      const sourceGroupId = row.question_payload?.contextGroupId;
      const groupId = sourceGroupId ? `${row.document_id}:${sourceGroupId}` : `question-${row.id}`;
      if (C.contextByGroup[groupId]) return;
      const atoms = row.question_payload?.atoms || [];
      const promptIndex = atoms.findIndex(atom => atom.t === 'preg');
      if (promptIndex > 0) C.contextByGroup[groupId] =
        atoms.slice(0, promptIndex).filter(atom => atom.t !== 'sep').map(atom => ({ ...atom }));
    });
    rebuildSavedCompilation();
    C.documentId = C.editingConfiguration.sourceDocumentId || null;
    C.fileName = C.editingConfiguration.fileName || '';
    $('cLabel').value = compilation.title;
    $('cCode').value = C.editingConfiguration.code || $('cCode').value;
    $('cCover').checked = C.editingConfiguration.cover !== false;
    if (/^#[0-9a-f]{6}$/i.test(C.editingConfiguration.colors?.first || '')) $('cCol1').value = C.editingConfiguration.colors.first;
    if (/^#[0-9a-f]{6}$/i.test(C.editingConfiguration.colors?.second || '')) $('cCol2').value = C.editingConfiguration.colors.second;
    $('cQuestionEditor').hidden = false;
    $('btnPrintC').textContent = 'Guardar cambios y descargar PDF';
    setEditorStatus(C.savedQuestionRows.some(row => !row.question_payload?.contextGroupId)
      ? 'Editando el mismo compilado. Las preguntas originales se conservarán; los registros antiguos sin identificador de contexto deben revisarse en la vista previa.'
      : 'Editando el mismo compilado. Las preguntas originales se conservarán.');
    populateQuestionEditor();
    updateQuestionSelector();
    await render();
  }

  function indexAtomQuestions(atoms) {
    const entries = [], seen = new Set();
    for (let i = 0; i < atoms.length; i++) {
      if (atoms[i].t !== 'preg') continue;
      let end = i + 1;
      while (end < atoms.length && atoms[end].t !== 'preg') {
        if (atoms[end].t === 'sep') { end++; break; }
        end++;
      }
      const segment = atoms.slice(i, end);
      const signature = segment.map(atom => {
        const comparable = { ...atom };
        delete comparable.n;
        return JSON.stringify(comparable);
      }).join('|');
      const duplicate = !!signature && seen.has(signature);
      if (signature) seen.add(signature);
      entries.push({
        key: `doc-${i}-${atoms[i].n}`,
        label: `Sesión ${sourceSession(i)} · Pregunta ${atoms[i].n}`,
        number: atoms[i].n,
        start: i,
        end,
        duplicate,
        options: segment.filter(atom => atom.t === 'op').length,
        duplicateOptions: (() => {
          const values = segment.filter(atom => atom.t === 'op').map(atom => cleanText(atom.html)).filter(Boolean);
          return new Set(values).size < values.length;
        })()
      });
      i = end - 1;
    }
    return entries;
  }

  function englishQuestionEntries() {
    const entries = [], validationWarnings = [], seen = new Set();
    C.cards.forEach(card => {
      const key = CARD_KEY[card.type];
      const part = CatalystIngles.parseTemplate(`PARTE ${key}\n${card.body || ''}`)[`p${key.toLowerCase()}`];
      if (!part) return;
      const items = card.type === 'p2' ? part.descriptions : part.items;
      (items || []).forEach((item, index) => {
        const id = `${card.id}:${card.type}:${item.num}:${index}`;
        const prompt = cleanText(item.text || item.q || item.stem || '');
        const options = (item.options || []).map(cleanText);
        const signature = `${card.type}|${card.type === 'cloze' ? item.num : ''}|${prompt}|${options.join('|')}`;
        const duplicate = !!(prompt || options.length) && seen.has(signature);
        if (signature && (prompt || options.length)) seen.add(signature);
        if (duplicate) validationWarnings.push(`Parte ${labelsFor(C.cards)[C.cards.indexOf(card)]}, pregunta ${item.num}: duplicado exacto omitido.`);
        entries.push({
          key: id, cardId: card.id, type: card.type, num: item.num, index,
          label: `Parte ${labelsFor(C.cards)[C.cards.indexOf(card)]} · Pregunta ${item.num}`,
          options: item.options ? item.options.length : null,
          prompt: item.text || item.q || item.stem || '',
          duplicate
        });
      });
      if (part.example && part.example.options && part.example.options.length) {
        const valid = Number.isInteger(part.example.correct) && part.example.correct >= 0 && part.example.correct < part.example.options.length;
        if (!valid) validationWarnings.push(`Parte ${labelsFor(C.cards)[C.cards.indexOf(card)]}: el ejemplo no tiene una respuesta correcta válida; revisa «RESPUESTA» antes de generar.`);
        if (part.example.options.length < 3) validationWarnings.push(`Parte ${labelsFor(C.cards)[C.cards.indexOf(card)]}: el ejemplo tiene menos de 3 opciones.`);
      }
      (items || []).forEach(item => {
        if (item.options && item.options.length < 3) validationWarnings.push(`Parte ${labelsFor(C.cards)[C.cards.indexOf(card)]}, pregunta ${item.num}: tiene menos de 3 opciones.`);
        if (!(item.text || item.q || item.stem || '').trim() && card.type !== 'cloze') validationWarnings.push(`Parte ${labelsFor(C.cards)[C.cards.indexOf(card)]}, pregunta ${item.num}: falta el enunciado.`);
        const options = (item.options || []).map(cleanText).filter(Boolean);
        if (new Set(options).size < options.length)
          validationWarnings.push(`Parte ${labelsFor(C.cards)[C.cards.indexOf(card)]}, pregunta ${item.num}: hay opciones de texto idéntico; confirma que no sea un duplicado accidental.`);
      });
      if (card.type === 'p2') {
        if (part.descriptions.length && !/^[A-H]$/.test(part.exampleLetter || ''))
          validationWarnings.push(`Parte ${labelsFor(C.cards)[C.cards.indexOf(card)]}: falta una respuesta válida para el ejemplo de emparejar.`);
        if (part.words.length < 2 || part.words.some(word => !word.text.trim()))
          validationWarnings.push(`Parte ${labelsFor(C.cards)[C.cards.indexOf(card)]}: la lista de palabras está incompleta.`);
        if (part.words.length < part.descriptions.length)
          validationWarnings.push(`Parte ${labelsFor(C.cards)[C.cards.indexOf(card)]}: hay menos opciones de emparejamiento que descripciones.`);
      }
    });
    C.validationWarnings = validationWarnings;
    return entries;
  }

  function updateQuestionSelector() {
    const wrap = $('cQuestionSelector');
    const entries = C.area === 'Ing' ? englishQuestionEntries() : C.questionEntries;
    const keySet = new Set(entries.map(entry => entry.key));
    C.excludedQuestionKeys = new Set([...C.excludedQuestionKeys].filter(key => keySet.has(key)));
    wrap.hidden = !entries.length;
    $('cQuestionList').innerHTML = '';
    $('cQuestionCount').textContent = `${entries.length - entries.filter(entry => entry.duplicate).length - entries.filter(entry => C.excludedQuestionKeys.has(entry.key) && !entry.duplicate).length} de ${entries.length - entries.filter(entry => entry.duplicate).length} preguntas seleccionadas.`;
    entries.forEach(entry => {
      const label = document.createElement('label');
      label.className = 'question-option';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !entry.duplicate && !C.excludedQuestionKeys.has(entry.key);
      checkbox.disabled = !!entry.duplicate;
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) C.excludedQuestionKeys.delete(entry.key);
        else C.excludedQuestionKeys.add(entry.key);
        updateQuestionSelector();
        later();
      });
      const text = document.createElement('span');
      text.textContent = `${entry.label}${entry.duplicate ? ' · duplicado exacto omitido' : ''}`;
      label.append(checkbox, text);
      $('cQuestionList').appendChild(label);
    });
    const warnings = [...new Set([...C.importWarnings, ...(C.validationWarnings || [])])];
    if (C.area !== 'Ing') {
      entries.filter(entry => !entry.duplicate && entry.options < 3).forEach(entry => {
        warnings.push(`${entry.label}: solo se detectaron ${entry.options} opciones; revisa el documento fuente.`);
      });
      entries.filter(entry => !entry.duplicate && entry.duplicateOptions).forEach(entry => {
        warnings.push(`${entry.label}: contiene opciones de texto idéntico; confirma que no sea un duplicado accidental.`);
      });
    }
    $('cWarns').innerHTML = '';
    warnings.forEach(message => {
      const li = document.createElement('li');
      li.textContent = message;
      $('cWarns').appendChild(li);
    });
    return entries;
  }

  function selectedDocumentAtoms(entries) {
    const selected = entries.filter(entry => !entry.duplicate && !C.excludedQuestionKeys.has(entry.key));
    const byStart = new Map(selected.map(entry => [entry.start, entry]));
    const allByStart = new Map(entries.map(entry => [entry.start, entry]));
    const out = [];
    for (let i = 0; i < C.atoms.length;) {
      const selectedEntry = byStart.get(i);
      const anyEntry = allByStart.get(i);
      if (selectedEntry) {
        out.push(...C.atoms.slice(selectedEntry.start, selectedEntry.end));
        i = selectedEntry.end;
      } else if (anyEntry) {
        i = anyEntry.end;
      } else {
        out.push(C.atoms[i++]);
      }
    }
    return out;
  }

  function filterEnglishCard(card, selected) {
    const key = CARD_KEY[card.type];
    const parsed = CatalystIngles.parseTemplate(`PARTE ${key}\n${card.body || ''}`)[`p${key.toLowerCase()}`];
    const items = card.type === 'p2' ? parsed.descriptions : parsed.items;
    if (!items || !items.length) return null;
    const keep = new Set(items.map((item, index) => `${card.id}:${card.type}:${item.num}:${index}`).filter(id => selected.has(id)));
    if (!keep.size) return null;
    let section = null, index = -1, keepCurrent = false;
    const filtered = (card.body || '').split(/\r?\n/).filter(line => {
      if (/^\s*PREGUNTAS\s*$/i.test(line)) { section = 'items'; index = -1; return true; }
      if (/^\s*DESCRIPCIONES\s*$/i.test(line)) { section = 'descriptions'; index = -1; return true; }
      if (/^\s*PALABRAS\s*$/i.test(line) || /^\s*PARTE\s+/i.test(line)) { section = null; return true; }
      if (!section) return true;
      const numbered = line.match(/^\s*(\d+)[.)]\s*(.*)$/);
      if (numbered) {
        index++;
        const id = `${card.id}:${card.type}:${numbered[1]}:${index}`;
        keepCurrent = keep.has(id);
        return keepCurrent;
      }
      return keepCurrent;
    }).join('\n');
    return { ...card, body: filtered };
  }

  /* ---------------------------------------------------------- navegación */
  function setMode(m) {
    document.body.dataset.mode = m;
    if (m === 'home') { $('homeMain').style.display = ''; $('homeAreas').style.display = 'none'; C.token++; }
    if (m === 'sim') { $('empty').querySelector('p').innerHTML = EMPTY_SIM; App.renderSim(); }
  }
  function syncAreaAccess() {
    const visible = App.getAllowedAreas ? App.getAllowedAreas() : Object.keys(CFG.areas);
    document.querySelectorAll('.acard').forEach(b => {
      const area = CFG.areas[b.dataset.area];
      if (area) {
        b.style.setProperty('--card-area-a', area.A);
        b.style.setProperty('--card-area-b', area.B);
      }
      const allowed = visible.includes(b.dataset.area);
      b.disabled = !allowed;
      b.style.display = allowed ? '' : 'none';
      b.title = allowed ? '' : 'Sin permiso para este área';
    });
    const firstAllowed = visible[0] || 'Mat';
    App.applyAreaTheme(firstAllowed);
    document.body.dataset.area = firstAllowed;
  }

  $('goSim').onclick = () => setMode('sim');
  $('goCmp').onclick = () => { C.flow = 'compilado'; syncAreaAccess(); $('homeMain').style.display = 'none'; $('homeAreas').style.display = ''; };
  $('goMini').onclick = () => { C.flow = 'mini'; syncAreaAccess(); $('homeMain').style.display = 'none'; $('homeAreas').style.display = ''; };
  $('areasBack').onclick = () => { $('homeMain').style.display = ''; $('homeAreas').style.display = 'none'; };
  $('btnHome').onclick = () => setMode('home');
  $('cChange').onclick = () => { setMode('home'); syncAreaAccess(); $('homeMain').style.display = 'none'; $('homeAreas').style.display = ''; };
  document.querySelectorAll('.acard').forEach(b => b.onclick = () => openArea(b.dataset.area, C.flow === 'mini' ? 'mini' : 'compilado'));

  function openArea(code, flow = 'compilado') {
    if (C.loadingImport || C.savingImport || C.savingCompilation) {
      App.notify('Espera a que termine la operación actual antes de cambiar de área.', 'warning');
      return;
    }
    if (C.pendingFile && !confirm('La importación actual todavía no está guardada. ¿Descartarla y cambiar de área?')) return;
    if (!App.ensureAreaAccess(code)) return;
    C.area = code; C.atoms = null; C.questionCount = 0; C.questionEntries = []; C.questionSources = [];
    C.documentId = null; C.pendingFile = null; C.persistedQuestionIds = {}; C.entryQuestionIds = {};
    C.editingCompilationId = null; C.editingConfiguration = {}; C.savedQuestionRows = []; C.contextByGroup = {};
    C.excludedQuestionKeys.clear(); C.importWarnings = []; C.validationWarnings = [];
    C.fileName = ''; C.coverTouched = false; C.flow = flow;
    const def = CFG.areas[code];
    App.applyAreaTheme(code);
    const chip = $('cAreaChip'); chip.textContent = def.name; chip.style.background = `linear-gradient(90deg, ${def.A}, ${def.B})`;
    $('cGeneric').style.display = code === 'Ing' ? 'none' : '';
    $('cEnglish').style.display = code === 'Ing' ? '' : 'none';
    $('cFname').textContent = ''; $('cInfo').innerHTML = ''; $('cWarns').innerHTML = ''; $('cFile').value = '';
    $('cImpInfo').textContent = '';
    $('cImportReview').hidden = true; $('cImportReviewStatus').textContent = '';
    $('btnSaveCompiledQuestions').hidden = false; $('btnSaveCompiledQuestions').disabled = false;
    $('cQuestionSelector').hidden = true; $('cQuestionList').innerHTML = ''; $('cQuestionCount').textContent = '';
    $('cQuestionEditor').hidden = true; $('cEditQuestion').replaceChildren(); $('cEditOptions').replaceChildren();
    $('btnPrintC').textContent = 'Descargar PDF';
    setColors(def.A, def.B);
    const Cv = CFG.cover;
    const labelText = flow === 'mini' ? `MINI-SIMULACRO · ${SHORT[code]}` : `COMPILADO DE ${SHORT[code]}`;
    $('cCode').value = flow === 'mini' ? `CAT · MINI · ${ABBR[code]}` : `CAT · COMPILADO · ${ABBR[code]}`;
    $('cLabel').value = labelText;
    $('cHoras').value = flow === 'mini' ? '1 HORA' : '2 HORAS'; $('cExtra').value = Cv.tags.extra;
    $('cComoTitle').value = flow === 'mini' ? '¿CÓMO RESOLVER ESTE MINI-SIMULACRO?' : '¿CÓMO REALIZAR ESTE COMPILADO?';
    $('cTen').value = Cv.tenEnCuenta.join('\n'); $('cComo').value = Cv.comoRealizar.join('\n');
    $('cCA').value = Cv.contactoA.join('\n'); $('cCB').value = Cv.contactoB.join('\n');
    $('cNq').value = '';
    $('cWmOp').value = Math.round(App.wm().opacity * 100); $('cWmVal').textContent = $('cWmOp').value;
    if (code === 'Ing') renderCards();
    document.body.dataset.mode = flow === 'mini' ? 'mini' : 'cmp';
    document.body.dataset.area = code;
    render();
  }

  function validateCompileConfig() {
    if (!C.area) return 'Debes seleccionar un área antes de continuar.';
    if (!$('cLabel').value.trim()) return 'La etiqueta del material es obligatoria.';
    if (!$('cCode').value.trim()) return 'El código del material es obligatorio.';
    const n = C.questionCount;
    if (!n || n < 1) return 'Debes indicar una cantidad válida de preguntas.';
    if (C.flow === 'mini' && n > 12) return 'El mini-simulacro no puede superar 12 preguntas.';
    if (C.area === 'Ing' && (!C.cards || C.cards.length === 0)) return 'Debes añadir al menos una parte para inglés.';
    return null;
  }

  function setColors(a, b) { $('cCol1').value = a; $('cCol2').value = b; }
  $('cColArea').onclick = () => { const d = CFG.areas[C.area]; setColors(d.A, d.B); render(); };
  $('cColBrand').onclick = () => { setColors('#E02F7A', '#F4841F'); render(); };

  /* ---------------------------------------------------------- Inglés: tarjetas */
  function labelsFor(cards) {
    const total = {}, seen = {};
    cards.forEach(c => { total[c.group] = (total[c.group] || 0) + 1; });
    return cards.map(c => {
      seen[c.group] = (seen[c.group] || 0) + 1;
      return total[c.group] > 1 ? c.group + String.fromCharCode(64 + seen[c.group]) : c.group;
    });
  }
  const skeletonFor = group => {
    const t = TYPE_BY_GROUP[group];
    return CatalystIngles.SKELETON[t === 'cloze' ? (group === '7' ? 'cloze4' : 'cloze3') : t];
  };
  function addCard(group, body, at) {
    const card = { id: C.nextId++, group, type: TYPE_BY_GROUP[group], body: body != null ? body : skeletonFor(group), photo: null };
    if (at == null) C.cards.push(card); else C.cards.splice(at, 0, card);
    return card;
  }

  function renderCards() {
    const wrap = $('cCards'); wrap.innerHTML = '';
    const labels = labelsFor(C.cards);
    C.cards.forEach((c, i) => {
      const d = document.createElement('details'); d.className = 'pcard'; d.open = C.cards.length <= 3;
      d.innerHTML = `<summary><span class="pl">Parte ${labels[i]}</span><span class="pk">${TYPE_NAME[c.type]}</span>
        <button class="pb" data-a="up" title="Subir">↑</button><button class="pb" data-a="down" title="Bajar">↓</button>
        <button class="pb" data-a="dup" title="Duplicar">⧉</button><button class="pb" data-a="del" title="Quitar">✕</button></summary>
        <div class="pcbody"><textarea spellcheck="false"></textarea>
        ${PHOTO_TYPES.includes(c.type) ? `<label>Foto (opcional)<input type="file" accept="image/*"></label>${c.photo ? '<div class="hint">✓ foto cargada</div>' : ''}` : ''}</div>`;
      const ta = d.querySelector('textarea'); ta.value = c.body;
      ta.addEventListener('input', () => { c.body = ta.value; later(); });
      const ph = d.querySelector('input[type=file]');
      if (ph) ph.addEventListener('change', e => {
        const f = e.target.files[0]; if (!f) return;
        const rd = new FileReader(); rd.onload = () => { c.photo = rd.result; renderCards(); later(); }; rd.readAsDataURL(f);
      });
      d.querySelectorAll('button[data-a]').forEach(b => b.addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation();
        const a = b.dataset.a;
        if (a === 'up' && i > 0) [C.cards[i - 1], C.cards[i]] = [C.cards[i], C.cards[i - 1]];
        else if (a === 'down' && i < C.cards.length - 1) [C.cards[i + 1], C.cards[i]] = [C.cards[i], C.cards[i + 1]];
        else if (a === 'dup') { const n = addCard(c.group, c.body, i + 1); n.photo = c.photo; }
        else if (a === 'del') C.cards.splice(i, 1);
        renderCards(); later();
      }));
      wrap.appendChild(d);
    });
    if (!C.cards.length) wrap.innerHTML = '<div class="hint">Aún no hay Partes. Elige un tipo y pulsa «+ Añadir», o importa desde un Word.</div>';
  }
  $('cAdd').onclick = () => { addCard($('cAddType').value); renderCards(); later(); };
  $('cSelectAll').onclick = () => { C.excludedQuestionKeys.clear(); updateQuestionSelector(); later(); };
  $('cSelectNone').onclick = () => {
    const entries = C.area === 'Ing' ? englishQuestionEntries() : C.questionEntries;
    entries.filter(entry => !entry.duplicate).forEach(entry => C.excludedQuestionKeys.add(entry.key));
    updateQuestionSelector(); later();
  };
  $('cEditQuestion').addEventListener('change', refreshQuestionEditor);
  $('btnSaveCompiledQuestions').addEventListener('click', async () => {
    if (!C.pendingFile || !C.parsedResult || C.loadingImport || C.savingImport) return;
    const button = $('btnSaveCompiledQuestions');
    C.savingImport = true;
    let saveCompleted = false;
    button.disabled = true;
    $('cImportReviewStatus').textContent = 'Guardando el documento y las preguntas revisadas…';
    try {
      const result = C.parsedResult;
      const user = App.getCurrentUser();
      const persistable = user?.role === 'admin'
        ? result
        : {
            ...result,
            sessions: {
              1: result.sessions[1].filter(area => area.code === C.area),
              2: result.sessions[2].filter(area => area.code === C.area)
            },
            questionBlocks: result.questionBlocks.filter(block => block.code === C.area || !block.code)
          };
      const saved = await window.CatalystBackend.uploadDocument(C.pendingFile, [C.area], persistable);
      C.documentId = saved.id;
      C.persistedQuestionIds = saved.questionIds;
      C.pendingFile = null;
      saveCompleted = true;
      $('cImportReviewStatus').textContent = 'Documento y preguntas guardados. Ya puedes descargar el compilado.';
      (saved.warnings || []).forEach(message => App.notify(message, 'warning'));
      applyCompiledResult(result, false);
    } catch (error) {
      $('cImportReviewStatus').textContent = saveCompleted
        ? `La importación se guardó, pero no se pudo actualizar la vista previa: ${error.message}`
        : `No se guardó la importación: ${error.message}`;
      App.notify(saveCompleted
        ? 'Las preguntas se guardaron; revisa la vista previa antes de continuar.'
        : 'No se guardaron las preguntas. Puedes corregir el problema e intentarlo de nuevo.', saveCompleted ? 'warning' : 'error');
    } finally {
      C.savingImport = false;
      button.hidden = !C.pendingFile;
      button.disabled = false;
      if (saveCompleted) {
        try {
          await render();
        } catch (error) {
          $('cImportReviewStatus').textContent = `La importación se guardó, pero no se pudo actualizar la vista previa: ${error.message}`;
          App.notify('Las preguntas se guardaron; vuelve a actualizar la vista antes de continuar.', 'warning');
        }
      }
    }
  });

  /* Importar Partes desde uno o varios Word */
  $('cImport').addEventListener('change', async e => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    if (C.loadingImport || C.savingImport || C.savingCompilation) {
      e.target.value = '';
      App.notify('Espera a que termine la operación actual antes de importar otro Word.', 'warning');
      return;
    }
    C.loadingImport = true;
    e.target.disabled = true;
    App.busy(true, 'Leyendo Word…');
    const msgs = []; let added = 0;
    const fileList = $('cImportFiles');
    const fileRows = new Map();
    fileList.replaceChildren();
    fileList.hidden = false;
    files.forEach(file => {
      const row = document.createElement('div');
      row.className = 'ing-file-row queued';
      const name = document.createElement('span');
      name.className = 'ing-file-name';
      name.textContent = file.name;
      const type = document.createElement('span');
      type.className = 'ing-file-type';
      type.textContent = 'Documento Word · DOCX';
      const state = document.createElement('span');
      state.className = 'ing-file-state';
      state.textContent = 'En espera';
      row.append(name, type, state);
      fileList.appendChild(row);
      fileRows.set(file, { row, state });
    });
    const setFileState = (file, status, label) => {
      const entry = fileRows.get(file);
      if (!entry) return;
      entry.row.className = `ing-file-row ${status}`;
      entry.state.textContent = label;
    };
    C.importWarnings = [];
    for (const f of files) {
      setFileState(f, 'processing', 'Procesando');
      try {
        const res = await DocxParser.parse(await f.arrayBuffer(), CFG);
        const areas = [1, 2].flatMap(s => res.sessions[s]);
        const ing = areas.filter(a => a.code === 'Ing' && a.raw);
        if (!ing.length) {
          msgs.push(`${f.name}: no encontré una sección identificada como Inglés; no se importó contenido de otras áreas.`);
          setFileState(f, 'not-found', 'Sin sección de Inglés');
          continue;
        }
        const source = ing;
        let n = 0;
        source.forEach(a => {
          const conv = CatalystIngles.fromWord(a.raw);
          CatalystIngles.splitParts(conv.text).forEach(p => { addCard(p.group, p.body); n++; });
          conv.warnings.forEach(w => { msgs.push(`${f.name}: ${w}`); C.importWarnings.push(`${f.name}: ${w}`); });
        });
        added += n;
        msgs.push(n ? `✓ ${f.name}: ${n} Partes listas para revisar. Se guardarán al descargar el compilado.` : `${f.name}: no encontré Partes de inglés.`);
        setFileState(f, n ? 'ready' : 'not-found', n ? `${n} ${n === 1 ? 'parte lista' : 'partes listas'}` : 'Sin partes detectadas');
      } catch (err) {
        console.error(err);
        msgs.push(`${f.name}: no pude leerlo (${err.message}).`);
        setFileState(f, 'error', 'No se pudo procesar');
      }
    }
    $('cImpInfo').innerHTML = msgs.map(m => m.replace(/&/g, '&amp;').replace(/</g, '&lt;')).join('<br>');
    e.target.value = '';
    e.target.disabled = false;
    C.loadingImport = false;
    App.busy(false);
    renderCards(); if (added) render(); else later();
  });

  /* ---------------------------------------------------------- Otras áreas: subir Word */
  const dz = $('dzC'), fileIn = $('cFile');
  dz.addEventListener('click', () => fileIn.click());
  dz.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileIn.click(); });
  fileIn.addEventListener('change', () => fileIn.files[0] && loadWord(fileIn.files[0]));
  ['dragover', 'dragenter'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('over'); }));
  dz.addEventListener('drop', e => {
    e.stopPropagation();
    const f = e.dataTransfer.files[0];
    if (f) loadWord(f);
  });

  function renderCompilerClassification(result) {
    const currentUser = App.getCurrentUser();
    const blocks = (result.questionBlocks || []).filter(block =>
      currentUser?.role === 'admin' || block.code === C.area || !block.code);
    const counts = Object.keys(CFG.areas).map(code => `${CFG.areas[code].name}: ${blocks.filter(q => q.code === code).length}`);
    const summary = $('cClassificationSummary');
    summary.hidden = !blocks.length;
    summary.textContent = blocks.length
      ? `Documento completo: ${blocks.length} preguntas. ${counts.join(' · ')} · Por revisar: ${blocks.filter(q => !q.code).length}.`
      : '';
    const review = $('cClassificationReview');
    review.hidden = !blocks.length;
    const list = $('cQuestionReviewList');
    list.innerHTML = '';
    const canCorrect = !!currentUser;
    blocks.forEach(block => {
      const row = document.createElement('label');
      row.className = 'question-review-item';
      const title = document.createElement('span');
      title.textContent = `Sesión ${block.session} · Pregunta ${block.number} — ${CFG.areas[block.code]?.name || 'POR REVISAR'} (${Math.round(block.confidence * 100)}%)`;
      const select = document.createElement('select');
      select.setAttribute('aria-label', `Área de sesión ${block.session}, pregunta ${block.number}`);
      const options = currentUser?.role === 'admin'
        ? Object.keys(CFG.areas)
        : currentUser?.areas.filter(code => code === C.area) || [];
      select.innerHTML = '<option value="">Por revisar</option>' + options.map(code => `<option value="${code}">${CFG.areas[code].name}</option>`).join('');
      select.value = block.code || '';
      select.disabled = !canCorrect;
      select.title = block.reason;
      select.addEventListener('change', async () => {
        if (!canCorrect) return;
        const previousCode = block.code;
        if (!result.setQuestionArea(result, block.id, select.value || null)) return;
        try {
          if (C.documentId) await window.CatalystBackend.setQuestionArea(C.documentId, block);
          C.excludedQuestionKeys.clear();
          renderCompilerClassification(result);
          applyCompiledResult(result);
        } catch (error) {
          result.setQuestionArea(result, block.id, previousCode);
          select.value = previousCode || '';
          App.notify(error.message, 'error');
        }
      });
      row.append(title, select);
      list.appendChild(row);
    });
  }

  function applyCompiledResult(result, renderNow = true) {
    C.parsedResult = result;
    const chosen = [1, 2].flatMap(session =>
      result.sessions[session].filter(area => area.code === C.area).map(area => ({ session, area })));
    C.atoms = [];
    C.questionSources = [];
    chosen.forEach(({ session, area }) => {
      const start = C.atoms.length;
      C.atoms.push(...area.atoms);
      C.questionSources.push({ start, end: C.atoms.length, session });
    });
    C.questionEntries = indexAtomQuestions(C.atoms);
    C.entryQuestionIds = {};
    const matchedBlocks = new Set();
    C.questionEntries.forEach(entry => {
      const session = sourceSession(entry.start);
      const block = (result.questionBlocks || []).find(question =>
        question.code === C.area && question.session === session &&
        String(question.number) === String(entry.number) && !matchedBlocks.has(question.id));
      if (block) {
        matchedBlocks.add(block.id);
        C.entryQuestionIds[entry.key] = C.persistedQuestionIds[block.id];
      }
    });
    C.importWarnings = result.warnings.slice();
    const duplicateCount = C.questionEntries.filter(entry => entry.duplicate).length;
    if (duplicateCount) C.importWarnings.push(`${duplicateCount} pregunta(s) idéntica(s) repetida(s) se omitieron para evitar duplicados accidentales.`);
    const count = C.questionEntries.filter(entry => !entry.duplicate).length;
    const reviewCount = result.questionBlocks.filter(question => !question.code).length;
    const areaCounts = Object.keys(CFG.areas).map(code =>
      `${CFG.areas[code].name}: ${result.questionBlocks.filter(question => question.code === code).length}`).join(' · ');
    $('cInfo').innerHTML = `${count ? `<b>${count} preguntas</b> clasificadas para ${CFG.areas[C.area].name}.` : `<b>No hay preguntas clasificadas para ${CFG.areas[C.area].name}.</b>`}<br><span>Documento: ${areaCounts} · Por revisar: ${reviewCount}.</span>`;
    $('cWarns').innerHTML = '';
    C.importWarnings.forEach(message => {
      const li = document.createElement('li');
      li.textContent = message;
      $('cWarns').appendChild(li);
    });
    updateQuestionSelector();
    if (renderNow) render();
  }

  async function loadWord(file) {
    if (!/\.docx$/i.test(file.name)) { alert('Sube un archivo Word .docx.'); return; }
    if (!C.area) {
      App.notify('Selecciona un área antes de importar preguntas.', 'warning');
      return;
    }
    if (!App.ensureAreaAccess(C.area)) return;
    if (C.loadingImport || C.savingImport || C.savingCompilation) return;
    if (C.pendingFile && !confirm('La importación actual todavía no está guardada. ¿Descartarla y abrir este archivo?')) return;
    C.loadingImport = true;
    C.atoms = null;
    C.documentId = null;
    C.pendingFile = null;
    C.persistedQuestionIds = {};
    C.entryQuestionIds = {};
    C.questionCount = 0;
    C.questionEntries = [];
    C.questionSources = [];
    C.importWarnings = [];
    C.excludedQuestionKeys.clear();
    C.token++;
    $('stage').innerHTML = '';
    $('empty').style.display = '';
    $('btnPrintC').disabled = true;
    $('cImportReview').hidden = true;
    $('btnSaveCompiledQuestions').hidden = false;
    $('btnSaveCompiledQuestions').disabled = false;
    $('cImportReviewStatus').textContent = '';
    $('cWarns').innerHTML = '';
    C.fileName = file.name; $('cFname').textContent = file.name;
    fileIn.value = '';
    App.busy(true, 'Leyendo el Word…');
    let res;
    try { res = await DocxParser.parse(await file.arrayBuffer(), CFG); }
    catch (err) {
      C.loadingImport = false;
      App.busy(false);
      console.error(err);
      alert('No pude leer el archivo: ' + err.message);
      return;
    }
    C.loadingImport = false;
    C.pendingFile = file;
    renderCompilerClassification(res);
    applyCompiledResult(res);
    $('cImportReview').hidden = false;
    $('cImportReviewStatus').textContent = res.questionBlocks.length
      ? 'Revisa las preguntas y corrige la clasificación antes de guardar. Aún no se ha guardado ningún dato.'
      : 'No se detectaron preguntas. Revisa el documento; no se guardará automáticamente.';
    $('btnSaveCompiledQuestions').disabled = !res.questionBlocks.length;
  }

  /* ---------------------------------------------------------- armado */
  let timer = null;
  const later = () => { clearTimeout(timer); timer = setTimeout(render, 450); };

  async function render() {
    if (!['cmp', 'mini'].includes(document.body.dataset.mode)) return;
    const my = ++C.token, stage = $('stage'), code = C.area;
    const entries = updateQuestionSelector();
    const selectedEntries = entries.filter(entry => !entry.duplicate && !C.excludedQuestionKeys.has(entry.key));
    const selectedCount = selectedEntries.length;
    const importPending = C.loadingImport || (code !== 'Ing' && (C.savingImport || !!C.pendingFile));
    const englishCards = code === 'Ing'
      ? C.cards.map(card => filterEnglishCard(card, new Set(selectedEntries.map(entry => entry.key)))).filter(Boolean)
      : [];
    C.questionCount = selectedCount;
    $('cNq').value = selectedCount;
    $('btnPrintC').disabled = !selectedCount || importPending || C.savingCompilation || (C.flow === 'mini' && selectedCount > 12);
    if (!selectedCount && entries.length) $('cInfo').textContent = 'No hay preguntas seleccionadas. Elige al menos una para continuar.';
    else if (C.flow === 'mini' && selectedCount > 12)
      $('cInfo').textContent = `Hay ${selectedCount} preguntas seleccionadas; el máximo del mini-simulacro es 12. Desmarca preguntas para continuar.`;
    else if (selectedCount) $('cInfo').textContent = `${selectedCount} pregunta${selectedCount === 1 ? '' : 's'} seleccionada${selectedCount === 1 ? '' : 's'}.`;
    const hasContent = selectedCount > 0 && (code === 'Ing' ? englishCards.length > 0 : !!C.atoms);
    stage.innerHTML = ''; stage.style.zoom = 1;
    if (!hasContent) {
      $('empty').style.display = '';
      $('empty').querySelector('p').innerHTML = code === 'Ing'
        ? (C.cards.length ? '<b>Selecciona al menos una pregunta</b> para crear la vista previa.' : '<b>Añade una Parte</b> o importa un Word y aquí aparecerá tu compilado de inglés.')
        : (C.atoms ? '<b>Selecciona al menos una pregunta</b> para crear la vista previa.' : `<b>Sube el Word del compilado de ${CFG.areas[code].name}</b> y aquí aparecerá ya diseñado.`);
      $('btnPrintC').disabled = true; App.busy(false); return;
    }
    $('empty').style.display = 'none';
    App.busy(true, 'Armando páginas…'); await App.frame();
    try {
      await document.fonts.ready;
    } catch (e) { /* ok */ }
    if (my !== C.token) return;

    const wm = App.wm();
    const pageColors = $('cColPages').checked ? { c1: $('cCol1').value, c2: $('cCol2').value } : null;
    let count = 0;
    if (code === 'Ing') {
      const labels = labelsFor(C.cards);
      const res = CatalystIngles.buildCards(englishCards.map(c => ({
        type: c.type, label: labels[C.cards.findIndex(original => original.id === c.id)], body: c.body, photo: c.photo
      })), stage, wm, pageColors);
      res.pages.forEach((p, i) => { p.numEl.textContent = i + 1; });
      count = res.count;
    } else {
      const def = CFG.areas[code];
      const areas = Object.assign({}, CFG.areas);
      areas[code] = { name: def.name, A: pageColors ? pageColors.c1 : def.A, B: pageColors ? pageColors.c2 : def.B };
      const atoms = selectedDocumentAtoms(entries);
      CatalystLayout.layoutSession([{ code, name: def.name, atoms }], { areas, watermarkSrc: wm.src, watermarkOpacity: wm.opacity }, stage);
      count = selectedCount;
    }
    if (my !== C.token) return;
    C.questionCount = count;
    $('cNq').value = count;
    if (C.flow === 'mini' && count > 12) {
      $('btnPrintC').disabled = true;
      App.busy(false);
      return;
    }
    if (!count) {
      stage.innerHTML = '';
      $('cInfo').textContent = 'No hay preguntas seleccionadas. Elige al menos una para continuar.';
      $('btnPrintC').disabled = true;
      App.busy(false);
      return;
    }

    if ($('cCover').checked) {
      const cv = CatalystCover.build({
        code: $('cCode').value, nQuestions: $('cNq').value || count, sessionName: $('cLabel').value,
        centralImage: C.central || CFG.cover.centralImages[1], qrImage: C.qr || CFG.cover.qrImage,
        tags: { horas: $('cHoras').value, extra: $('cExtra').value },
        tenEnCuenta: lines($('cTen').value), comoRealizar: lines($('cComo').value), comoTitle: $('cComoTitle').value,
        contactoA: lines($('cCA').value), contactoB: lines($('cCB').value), colors: coverColors()
      });
      stage.insertBefore(cv, stage.firstChild);
    }
    App.busy(false);
    $('btnPrintC').disabled = !stage.children.length || !C.questionCount || importPending || C.savingCompilation || (C.flow === 'mini' && C.questionCount > 12);
    App.refit();
  }

  /* ---------------------------------------------------------- controles */
  ['cCode', 'cLabel', 'cHoras', 'cExtra', 'cComoTitle', 'cTen', 'cComo', 'cCA', 'cCB', 'cNq', 'cCol1', 'cCol2'].forEach(id =>
    $(id).addEventListener('input', () => { if (id === 'cNq') C.coverTouched = true; later(); }));
  ['cCover', 'cColPages'].forEach(id => $(id).addEventListener('change', later));
  const url = f => URL.createObjectURL(f);
  $('cImg').addEventListener('change', e => { if (e.target.files[0]) { C.central = url(e.target.files[0]); later(); } });
  $('cQR').addEventListener('change', e => { if (e.target.files[0]) { C.qr = url(e.target.files[0]); later(); } });
  $('cWmOp').addEventListener('input', () => { $('cWmVal').textContent = $('cWmOp').value; App.setWmOpacity($('cWmOp').value); });
  $('cWmFile').addEventListener('change', e => { if (e.target.files[0]) { App.S.wmSrc = url(e.target.files[0]); later(); } });
  $('btnPrintC').addEventListener('click', async () => {
    if (C.loadingImport || C.savingImport || C.savingCompilation || C.pendingFile) {
      if (C.pendingFile) App.notify('Guarda primero las preguntas revisadas antes de generar el compilado.', 'warning');
      return;
    }
    const area = C.area || document.body.dataset.area || 'Mat';
    if (!App.ensureAreaAccess(area)) return;
    const error = validateCompileConfig();
    if (error) {
      App.notify ? App.notify(error, 'error') : alert(error);
      return;
    }
    const user = App.getCurrentUser && App.getCurrentUser();
    const entries = area === 'Ing' ? englishQuestionEntries() : C.questionEntries;
    const selected = entries.filter(entry => !entry.duplicate && !C.excludedQuestionKeys.has(entry.key));
    const type = C.flow === 'mini' ? 'mini-simulacro' : 'compilado';
    const questionIds = selected.map(entry => C.entryQuestionIds[entry.key]).filter(Boolean);
    if (C.editingCompilationId && questionIds.length !== selected.length) {
      App.notify('No se pudo confirmar la referencia de todas las preguntas; no se guardaron cambios.', 'error');
      return;
    }
    const selectedCards = C.cards.map(card => {
      const filtered = filterEnglishCard(card, new Set(selected.map(entry => entry.key)));
      return filtered ? { type: filtered.type, body: filtered.body, photo: filtered.photo || null } : null;
    }).filter(Boolean);
    const fileName = `${$('cLabel').value || `${type} ${CFG.areas[area].name}`}.pdf`;
    let pdfGenerated = false;
    C.savingCompilation = true;
    $('btnPrintC').disabled = true;
    try {
      const pdf = await PdfGenerator.generate($('stage'), fileName);
      pdfGenerated = true;
      App.downloadGeneratedPdf(pdf, fileName);
      await App.addLibraryEntry({
        id: C.editingCompilationId,
        name: $('cLabel').value || `Material ${CFG.areas[area].name}`,
        type, area, questionIds,
        pdf,
        configuration: {
          ...C.editingConfiguration,
          sourceDocumentId: C.documentId,
          questionCount: C.questionCount,
          questionNumbers: selected.map(entry => ({ number: entry.num || entry.number, session: entry.start == null ? null : sourceSession(entry.start) })),
          cards: selectedCards,
          cover: $('cCover').checked,
          code: $('cCode').value,
          colors: { first: $('cCol1').value, second: $('cCol2').value },
          fileName: C.fileName
        }
      });
      App.notify(C.editingCompilationId
        ? 'Cambios guardados en el mismo compilado; se descargó la nueva versión del PDF.'
        : 'PDF descargado y guardado en Catalyst durante 15 días.', 'success');
    } catch (error) {
      App.notify(pdfGenerated
        ? `El PDF local se descargó, pero la operación en Catalyst no finalizó: ${error.message}`
        : `No se pudo generar el PDF: ${error.message}`, error.outcome === 'partial' ? 'warning' : 'error');
    } finally {
      C.savingCompilation = false;
      await render();
    }
  });

  window.CatalystCompiledEditor = { editExisting: editExistingCompilation };
  syncAreaAccess();
})();
