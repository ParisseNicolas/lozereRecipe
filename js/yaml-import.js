// yaml-import.js
// Modal UI for importing repas.yml. Lets the user paste/load a YAML file,
// validates it live, displays issues, and only enables the import button when
// no errors remain. On import : clears local overrides, persists the new YAML
// under localStorage.importedYamlData, reloads.

(function () {
  const STORAGE_KEY = 'importedYamlData';
  const STORAGE_TEXT_KEY = 'importedYamlText';
  let modalEl = null;
  let backdropEl = null;
  let toastTimer = null;

  function close() {
    if (modalEl) modalEl.remove();
    if (backdropEl) backdropEl.remove();
    modalEl = null;
    backdropEl = null;
    document.removeEventListener('keydown', onKey);
  }

  function onKey(e) {
    if (e.key === 'Escape') close();
  }

  function showToast(message, kind) {
    const t = document.createElement('div');
    t.className = 'yaml-toast ' + (kind || 'info');
    t.textContent = message;
    document.body.appendChild(t);
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), 3500);
  }

  function open() {
    close();

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.addEventListener('click', close);

    const modal = document.createElement('div');
    modal.className = 'modal yaml-import-modal';
    modal.addEventListener('click', (e) => e.stopPropagation());

    // Header
    const title = document.createElement('h3');
    title.textContent = 'Importer un fichier repas.yml';
    modal.appendChild(title);

    const intro = document.createElement('p');
    intro.className = 'yaml-import-intro';
    intro.innerHTML = 'Colle ton YAML ou charge un fichier. Le contenu remplacera <strong>toutes</strong> les modifications locales (recettes, ingrédients, repas, portions).';
    modal.appendChild(intro);

    // Toolbar : load file + clear
    const toolbar = document.createElement('div');
    toolbar.className = 'yaml-import-toolbar';

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.yml,.yaml,text/yaml,text/x-yaml';
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      const text = await file.text();
      setEditorValue(text);
      validateAndRender();
    });
    modal.appendChild(fileInput);

    const loadBtn = document.createElement('button');
    loadBtn.type = 'button';
    loadBtn.textContent = '📂 Charger un fichier…';
    loadBtn.addEventListener('click', () => fileInput.click());
    toolbar.appendChild(loadBtn);

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.textContent = 'Vider l\'éditeur';
    clearBtn.addEventListener('click', () => {
      setEditorValue('');
      validateAndRender();
    });
    toolbar.appendChild(clearBtn);

    modal.appendChild(toolbar);

    // Body : split editor + issues panel
    const body = document.createElement('div');
    body.className = 'yaml-import-body';

    // Editor with line gutter
    const editorWrap = document.createElement('div');
    editorWrap.className = 'yaml-editor-wrap';

    const gutter = document.createElement('div');
    gutter.className = 'yaml-editor-gutter';
    editorWrap.appendChild(gutter);

    const textarea = document.createElement('textarea');
    textarea.className = 'yaml-editor-textarea';
    textarea.spellcheck = false;
    textarea.placeholder = 'Colle ici le contenu de repas.yml…';
    editorWrap.appendChild(textarea);

    body.appendChild(editorWrap);

    // Issues panel
    const issuesPanel = document.createElement('div');
    issuesPanel.className = 'yaml-issues-panel';
    body.appendChild(issuesPanel);

    modal.appendChild(body);

    // Footer : status + import button
    const footer = document.createElement('div');
    footer.className = 'yaml-import-footer';

    const status = document.createElement('div');
    status.className = 'yaml-import-status';
    footer.appendChild(status);

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Annuler';
    cancelBtn.addEventListener('click', close);
    footer.appendChild(cancelBtn);

    const importBtn = document.createElement('button');
    importBtn.type = 'button';
    importBtn.className = 'primary';
    importBtn.textContent = 'Importer';
    importBtn.disabled = true;
    importBtn.addEventListener('click', () => doImport(textarea.value));
    footer.appendChild(importBtn);

    modal.appendChild(footer);

    // Close × in corner
    const closeX = document.createElement('button');
    closeX.type = 'button';
    closeX.className = 'modal-close';
    closeX.textContent = '×';
    closeX.addEventListener('click', close);
    modal.appendChild(closeX);

    document.body.appendChild(backdrop);
    document.body.appendChild(modal);
    backdropEl = backdrop;
    modalEl = modal;
    document.addEventListener('keydown', onKey);

    // Editor wiring
    function setEditorValue(v) {
      textarea.value = v;
      syncGutter();
    }

    function syncGutter() {
      const lines = textarea.value.split(/\r?\n/);
      const n = Math.max(1, lines.length);
      let html = '';
      for (let i = 1; i <= n; i++) html += '<div data-line="' + i + '">' + i + '</div>';
      gutter.innerHTML = html;
      gutter.scrollTop = textarea.scrollTop;
    }

    let validateTimer = null;
    function scheduleValidate() {
      if (validateTimer) clearTimeout(validateTimer);
      validateTimer = setTimeout(validateAndRender, 200);
    }

    function validateAndRender() {
      const raw = textarea.value;
      // Reset gutter highlights
      Array.from(gutter.children).forEach((c) => c.classList.remove('has-error', 'has-warning'));

      if (!raw.trim()) {
        issuesPanel.innerHTML = '<p class="yaml-issues-empty">Aucun contenu à valider.</p>';
        status.textContent = '';
        importBtn.disabled = true;
        return;
      }

      const result = window.YamlValidator.validate(raw, window.RepasSchema);
      renderIssues(result.issues);

      const errorCount = result.issues.filter((i) => i.severity === 'error').length;
      const warnCount = result.issues.filter((i) => i.severity === 'warning').length;

      if (errorCount === 0 && warnCount === 0) {
        status.innerHTML = '<span class="ok">✔ YAML valide</span>';
        importBtn.disabled = false;
      } else if (errorCount === 0) {
        status.innerHTML = `<span class="warn">⚠ ${warnCount} avertissement${warnCount > 1 ? 's' : ''}</span> — import possible.`;
        importBtn.disabled = false;
      } else {
        status.innerHTML = `<span class="err">✖ ${errorCount} erreur${errorCount > 1 ? 's' : ''}</span>` +
          (warnCount ? `, ${warnCount} avertissement${warnCount > 1 ? 's' : ''}` : '') + '.';
        importBtn.disabled = true;
      }

      // Highlight gutter lines that have issues
      for (const issue of result.issues) {
        if (!issue.line) continue;
        const node = gutter.querySelector('[data-line="' + issue.line + '"]');
        if (node) node.classList.add(issue.severity === 'error' ? 'has-error' : 'has-warning');
      }
    }

    function renderIssues(issues) {
      if (!issues.length) {
        issuesPanel.innerHTML = '<p class="yaml-issues-empty">Aucun problème détecté.</p>';
        return;
      }
      // Group by severity, errors first
      const sorted = issues.slice().sort((a, b) => {
        if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
        return (a.line || 0) - (b.line || 0);
      });

      const ul = document.createElement('ul');
      ul.className = 'yaml-issues-list';
      for (const issue of sorted) {
        const li = document.createElement('li');
        li.className = 'yaml-issue ' + issue.severity;

        const head = document.createElement('div');
        head.className = 'yaml-issue-head';

        const badge = document.createElement('span');
        badge.className = 'yaml-issue-badge';
        badge.textContent = issue.severity === 'error' ? 'Erreur' : 'Avertissement';
        head.appendChild(badge);

        if (issue.line) {
          const lineLink = document.createElement('button');
          lineLink.type = 'button';
          lineLink.className = 'yaml-issue-line';
          lineLink.textContent = 'L' + issue.line;
          lineLink.title = 'Aller à cette ligne';
          lineLink.addEventListener('click', () => jumpToLine(issue.line));
          head.appendChild(lineLink);
        }

        const path = document.createElement('span');
        path.className = 'yaml-issue-path';
        path.textContent = issue.path;
        head.appendChild(path);

        li.appendChild(head);

        const msg = document.createElement('div');
        msg.className = 'yaml-issue-msg';
        msg.textContent = issue.message;
        li.appendChild(msg);

        if (issue.suggestion) {
          const sug = document.createElement('div');
          sug.className = 'yaml-issue-suggestion';
          sug.textContent = '💡 ' + issue.suggestion;
          li.appendChild(sug);
        }

        ul.appendChild(li);
      }
      issuesPanel.innerHTML = '';
      issuesPanel.appendChild(ul);
    }

    function jumpToLine(line) {
      const lines = textarea.value.split(/\r?\n/);
      let pos = 0;
      for (let i = 0; i < line - 1 && i < lines.length; i++) {
        pos += lines[i].length + 1;
      }
      textarea.focus();
      textarea.setSelectionRange(pos, pos + (lines[line - 1] || '').length);
      // Approximate scroll : average char height
      const lineHeight = parseInt(window.getComputedStyle(textarea).lineHeight, 10) || 18;
      textarea.scrollTop = Math.max(0, (line - 3) * lineHeight);
      gutter.scrollTop = textarea.scrollTop;
    }

    textarea.addEventListener('input', () => { syncGutter(); scheduleValidate(); });
    textarea.addEventListener('scroll', () => { gutter.scrollTop = textarea.scrollTop; });
    textarea.addEventListener('keydown', (e) => {
      // Tab inserts two spaces instead of moving focus
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        const s = textarea.selectionStart, t = textarea.selectionEnd;
        textarea.value = textarea.value.slice(0, s) + '  ' + textarea.value.slice(t);
        textarea.selectionStart = textarea.selectionEnd = s + 2;
        syncGutter();
        scheduleValidate();
      }
    });

    // Pre-fill : prefer the last imported text if any, else fetch the bundled
    // repas.yml so the user starts from a working baseline.
    const previous = localStorage.getItem(STORAGE_TEXT_KEY);
    if (previous) {
      setEditorValue(previous);
      validateAndRender();
    } else {
      fetch('repas.yml').then((r) => r.ok ? r.text() : '').then((text) => {
        if (!textarea.value) {
          setEditorValue(text || '');
          validateAndRender();
        }
      }).catch(() => {
        setEditorValue('');
        validateAndRender();
      });
    }
  }

  function doImport(rawText) {
    const result = window.YamlValidator.validate(rawText, window.RepasSchema);
    if (window.YamlValidator.hasErrors(result.issues)) {
      showToast('Import refusé : il reste des erreurs.', 'error');
      return;
    }
    try {
      // Clear all local overrides : "Replace all" semantics.
      localStorage.removeItem('customRecipes');
      localStorage.removeItem('customIngredients');
      localStorage.removeItem('mealOverrides');
      localStorage.removeItem('portionsByDay');
      localStorage.removeItem('checkedItems');
      // Persist parsed object + original text
      localStorage.setItem(STORAGE_KEY, JSON.stringify(result.data));
      localStorage.setItem(STORAGE_TEXT_KEY, rawText);
    } catch (e) {
      showToast('Erreur stockage : ' + e.message, 'error');
      return;
    }
    showToast('YAML importé avec succès. Rechargement…', 'success');
    setTimeout(() => window.location.reload(), 800);
  }

  window.YamlImport = { open, close, STORAGE_KEY, STORAGE_TEXT_KEY };
})();
