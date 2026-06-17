/** Event types management — list, create, edit, deactivate via /api/event-types */

import { showToast } from './ui.js';
import { showConfirmDialog } from './a11y.js';
import {
  parseWeeklyHours,
  deriveGlobalHours,
  serializeWeeklyHours,
  mountWeeklyAvailabilityEditor,
} from './availability-editor.js';

const DEFAULT_AVAILABILITY = {
  workingHoursStart: '09:00',
  workingHoursEnd: '18:00',
};

/**
 * @param {Record<string, unknown>} rules
 */
export function parseAvailabilityRules(rules) {
  const start = typeof rules?.workingHoursStart === 'string' ? rules.workingHoursStart : DEFAULT_AVAILABILITY.workingHoursStart;
  const end = typeof rules?.workingHoursEnd === 'string' ? rules.workingHoursEnd : DEFAULT_AVAILABILITY.workingHoursEnd;
  const weeklyHours = parseWeeklyHours(rules ?? {}, { start, end });
  return { workingHoursStart: start, workingHoursEnd: end, weeklyHours };
}

/**
 * @param {string} name
 */
export function slugifyName(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

/**
 * @param {() => Promise<{ res: Response; data: unknown }>} api
 */
export function createEventTypesManager({ api, onNavigate }) {
  const screen = document.getElementById('event-types');
  const listView = document.getElementById('et-list-view');
  const formView = document.getElementById('et-form-view');
  const listEl = document.getElementById('et-list');
  const listEmpty = document.getElementById('et-list-empty');
  const listError = document.getElementById('et-list-error');
  const form = document.getElementById('et-form');
  const formTitle = document.getElementById('et-form-title');
  const formError = document.getElementById('et-form-error');
  const nameInput = document.getElementById('et-name');
  const slugInput = document.getElementById('et-slug');
  const durationInput = document.getElementById('et-duration');
  const descriptionInput = document.getElementById('et-description');
  const hoursStartInput = document.getElementById('et-hours-start');
  const hoursEndInput = document.getElementById('et-hours-end');
  const publicUrlField = document.getElementById('et-public-url');
  const copyUrlBtn = document.getElementById('et-copy-url');
  const saveBtn = document.getElementById('et-save');
  const cancelBtn = document.getElementById('et-cancel');
  const newBtn = document.getElementById('et-new');
  const showInactiveToggle = document.getElementById('et-show-inactive');
  const globalHoursStart = document.getElementById('global-hours-start');
  const globalHoursEnd = document.getElementById('global-hours-end');
  const globalWeeklyContainer = document.getElementById('global-weekly-hours');
  const etWeeklyContainer = document.getElementById('et-weekly-hours');
  const saveGlobalHoursBtn = document.getElementById('save-global-hours');
  const globalHoursError = document.getElementById('global-hours-error');

  let eventTypes = [];
  let editingId = null;
  let profile = null;
  let loading = false;
  let globalWeeklyHours = parseWeeklyHours({}, DEFAULT_AVAILABILITY);
  let etWeeklyHours = parseWeeklyHours({}, DEFAULT_AVAILABILITY);
  let globalWeeklyEditor = null;
  let etWeeklyEditor = null;

  function setLoading(active) {
    loading = active;
    if (saveBtn) saveBtn.disabled = active;
    if (newBtn) newBtn.disabled = active;
    if (saveGlobalHoursBtn) saveGlobalHoursBtn.disabled = active;
    saveBtn?.classList.toggle('is-loading', active);
    saveGlobalHoursBtn?.classList.toggle('is-loading', active);
  }

  function showList() {
    listView?.classList.remove('hidden');
    formView?.classList.add('hidden');
    editingId = null;
    form?.reset();
    formError?.classList.add('hidden');
    publicUrlField?.classList.add('hidden');
  }

  function mountGlobalWeeklyEditor(fallback) {
    if (!globalWeeklyContainer) return;
    globalWeeklyHours = parseWeeklyHours(profile?.availabilityRules ?? {}, fallback);
    globalWeeklyEditor = mountWeeklyAvailabilityEditor(globalWeeklyContainer, {
      weeklyHours: globalWeeklyHours,
    });
  }

  function mountEtWeeklyEditor(rules, fallback) {
    if (!etWeeklyContainer) return;
    etWeeklyHours = rules?.weeklyHours ?? parseWeeklyHours(rules ?? {}, fallback);
    etWeeklyEditor = mountWeeklyAvailabilityEditor(etWeeklyContainer, {
      weeklyHours: etWeeklyHours,
    });
  }

  function showForm({ mode, eventType = null }) {
    listView?.classList.add('hidden');
    formView?.classList.remove('hidden');
    formError?.classList.add('hidden');

    if (formTitle) {
      formTitle.textContent = mode === 'edit' ? 'Edit booking link' : 'New booking link';
    }

    const defaults = profile
      ? { workingHoursStart: profile.workingHoursStart, workingHoursEnd: profile.workingHoursEnd }
      : DEFAULT_AVAILABILITY;

    if (mode === 'edit' && eventType) {
      editingId = eventType.id;
      if (nameInput) nameInput.value = eventType.name ?? '';
      if (slugInput) slugInput.value = eventType.slug ?? '';
      if (durationInput) durationInput.value = String(eventType.durationMinutes ?? 30);
      if (descriptionInput) descriptionInput.value = eventType.description ?? '';
      const rules = parseAvailabilityRules(eventType.availabilityRules ?? {});
      mountEtWeeklyEditor(rules, defaults);
      if (publicUrlField) {
        publicUrlField.classList.remove('hidden');
        const urlInput = publicUrlField.querySelector('input');
        if (urlInput) urlInput.value = eventType.publicUrl ?? '';
      }
    } else {
      editingId = null;
      form?.reset();
      if (durationInput) durationInput.value = '30';
      mountEtWeeklyEditor(parseAvailabilityRules({}), defaults);
      publicUrlField?.classList.add('hidden');
    }
  }

  function renderList() {
    if (!listEl) return;
    listEl.innerHTML = '';

    const visible = showInactiveToggle?.checked
      ? eventTypes
      : eventTypes.filter((et) => et.active);

    listEmpty?.classList.toggle('hidden', visible.length > 0);

    for (const et of visible) {
      const card = document.createElement('article');
      card.className = `et-card${et.active ? '' : ' et-card-inactive'}`;

      const duration = `${et.durationMinutes} min`;
      const rules = parseAvailabilityRules(et.availabilityRules ?? {});
      const hours = `${rules.workingHoursStart} – ${rules.workingHoursEnd}`;

      card.innerHTML = `
        <div class="et-card-main">
          <h3 class="et-card-title">${escapeHtml(et.name)}</h3>
          <p class="et-card-meta">${escapeHtml(duration)} · ${escapeHtml(hours)}</p>
          ${et.description ? `<p class="et-card-desc">${escapeHtml(et.description)}</p>` : ''}
          ${et.publicUrl ? `<p class="et-card-url"><a href="${escapeAttr(et.publicUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(et.publicUrl)}</a></p>` : ''}
          ${!et.active ? '<span class="et-badge">Inactive</span>' : ''}
        </div>
        <div class="et-card-actions">
          <button type="button" class="btn ghost et-edit-btn" data-id="${escapeAttr(et.id)}">Edit</button>
          ${et.publicUrl ? `<button type="button" class="btn ghost et-copy-btn" data-url="${escapeAttr(et.publicUrl)}">Copy link</button>` : ''}
          ${et.active ? `<button type="button" class="btn ghost et-deactivate-btn" data-id="${escapeAttr(et.id)}">Deactivate</button>` : ''}
        </div>
      `;

      listEl.appendChild(card);
    }

    listEl.querySelectorAll('.et-edit-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const et = eventTypes.find((row) => row.id === id);
        if (et) showForm({ mode: 'edit', eventType: et });
      });
    });

    listEl.querySelectorAll('.et-copy-btn').forEach((btn) => {
      btn.addEventListener('click', () => copyPublicUrl(btn.dataset.url));
    });

    listEl.querySelectorAll('.et-deactivate-btn').forEach((btn) => {
      btn.addEventListener('click', () => deactivateEventType(btn.dataset.id));
    });
  }

  async function loadEventTypes() {
    listError?.classList.add('hidden');
    const includeInactive = showInactiveToggle?.checked ? 'true' : 'false';
    const { res, data } = await api(`/api/event-types?includeInactive=${includeInactive}`);
    if (!res.ok) {
      if (listError) {
        listError.textContent = data?.error ?? 'Could not load booking links.';
        listError.classList.remove('hidden');
      }
      return;
    }
    eventTypes = data?.eventTypes ?? [];
    renderList();
  }

  function applyProfileToGlobalHours(nextProfile) {
    profile = nextProfile;
    const fallback = {
      start: nextProfile?.workingHoursStart ?? DEFAULT_AVAILABILITY.workingHoursStart,
      end: nextProfile?.workingHoursEnd ?? DEFAULT_AVAILABILITY.workingHoursEnd,
    };
    mountGlobalWeeklyEditor(fallback);
  }

  async function loadProfile() {
    const { res, data } = await api('/api/profile');
    if (res.ok) applyProfileToGlobalHours(data);
  }

  async function saveGlobalHours() {
    if (loading) return;
    const derived = deriveGlobalHours(globalWeeklyHours);
    const { workingHoursStart, workingHoursEnd } = derived;

    if (!workingHoursStart || !workingHoursEnd || workingHoursStart >= workingHoursEnd) {
      globalHoursError?.classList.remove('hidden');
      if (globalHoursError) globalHoursError.textContent = 'Check that enabled days have valid start/end times.';
      return;
    }

    globalHoursError?.classList.add('hidden');
    setLoading(true);
    try {
      const { res, data } = await api('/api/profile', {
        method: 'PATCH',
        body: JSON.stringify({ workingHoursStart, workingHoursEnd }),
      });
      if (!res.ok) {
        const text = data?.error ?? 'Could not save working hours.';
        if (globalHoursError) {
          globalHoursError.textContent = text;
          globalHoursError.classList.remove('hidden');
        }
        showToast(text, 'error');
        return;
      }
      applyProfileToGlobalHours(data);
      showToast('Default working hours saved', 'success');
    } finally {
      setLoading(false);
    }
  }

  async function saveEventType(e) {
    e.preventDefault();
    if (loading) return;

    const name = nameInput?.value?.trim();
    const slug = slugInput?.value?.trim().toLowerCase() || slugifyName(name ?? '');
    const durationMinutes = parseInt(durationInput?.value ?? '', 10);
    const description = descriptionInput?.value?.trim() || null;
    const derived = deriveGlobalHours(etWeeklyHours);
    const { workingHoursStart, workingHoursEnd } = derived;

    formError?.classList.add('hidden');

    if (!name) {
      if (formError) {
        formError.textContent = 'Name is required.';
        formError.classList.remove('hidden');
      }
      return;
    }
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0 || durationMinutes > 480) {
      if (formError) {
        formError.textContent = 'Duration must be between 1 and 480 minutes.';
        formError.classList.remove('hidden');
      }
      return;
    }
    if (workingHoursStart >= workingHoursEnd) {
      if (formError) {
        formError.textContent = 'End time must be after start time.';
        formError.classList.remove('hidden');
      }
      return;
    }

    const payload = {
      name,
      slug,
      durationMinutes,
      description,
      availabilityRules: {
        workingHoursStart,
        workingHoursEnd,
        ...serializeWeeklyHours(etWeeklyHours),
      },
    };

    setLoading(true);
    try {
      const path = editingId ? `/api/event-types/${editingId}` : '/api/event-types';
      const method = editingId ? 'PATCH' : 'POST';
      const { res, data } = await api(path, { method, body: JSON.stringify(payload) });

      if (!res.ok) {
        const text = data?.error ?? 'Could not save booking link.';
        if (formError) {
          formError.textContent = text;
          formError.classList.remove('hidden');
        }
        showToast(text, 'error');
        return;
      }

      showToast(editingId ? 'Booking link updated' : 'Booking link created', 'success');
      await loadEventTypes();
      showList();
    } finally {
      setLoading(false);
    }
  }

  async function deactivateEventType(id) {
    if (!id || loading) return;
    const et = eventTypes.find((row) => row.id === id);
    if (!et?.active) return;
    const confirmed = await showConfirmDialog({
      title: 'Deactivate booking link?',
      message: `Guests will no longer be able to book "${et.name}". You can create a new link later.`,
      confirmLabel: 'Deactivate',
      danger: true,
    });
    if (!confirmed) return;

    setLoading(true);
    try {
      const { res, data } = await api(`/api/event-types/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        showToast(data?.error ?? 'Could not deactivate booking link.', 'error');
        return;
      }
      showToast('Booking link deactivated', 'success');
      await loadEventTypes();
    } finally {
      setLoading(false);
    }
  }

  async function copyPublicUrl(url) {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      showToast('Link copied to clipboard', 'success');
    } catch {
      showToast('Could not copy link', 'error');
    }
  }

  function bindEvents() {
    newBtn?.addEventListener('click', () => showForm({ mode: 'create' }));
    cancelBtn?.addEventListener('click', showList);
    form?.addEventListener('submit', saveEventType);
    showInactiveToggle?.addEventListener('change', () => loadEventTypes());
    saveGlobalHoursBtn?.addEventListener('click', saveGlobalHours);
    copyUrlBtn?.addEventListener('click', () => {
      const urlInput = publicUrlField?.querySelector('input');
      if (urlInput?.value) copyPublicUrl(urlInput.value);
    });

    nameInput?.addEventListener('blur', () => {
      if (!slugInput || slugInput.value.trim() || !nameInput.value.trim()) return;
      slugInput.value = slugifyName(nameInput.value);
    });

    for (const id of ['nav-chat', 'nav-chat-et']) {
      document.getElementById(id)?.addEventListener('click', (e) => {
        e.preventDefault();
        onNavigate?.('chat');
      });
    }
    for (const id of ['nav-event-types', 'nav-event-types-et']) {
      document.getElementById(id)?.addEventListener('click', (e) => {
        e.preventDefault();
        onNavigate?.('event-types');
      });
    }
  }

  return {
    async open() {
      screen?.classList.remove('hidden');
      await Promise.all([loadProfile(), loadEventTypes()]);
      showList();
    },
    close() {
      screen?.classList.add('hidden');
      showList();
    },
    init() {
      bindEvents();
    },
  };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, '&#39;');
}
