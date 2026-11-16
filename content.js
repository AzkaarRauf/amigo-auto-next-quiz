const BASE = 'https://amigo.amityonline.com/mod';
const AUTO_NAV_FLAG = 'amigoShiftN_autoNavActive';

// Defaults: Shift+N on, Auto Navigate off, floating button off.
const settings = {
  shiftNEnabled: true,
  autoNavigate: false,
  showFloatingButton: false,
};

chrome.storage.local.get(['shiftNEnabled', 'autoNavigate', 'showFloatingButton'], (stored) => {
  if (typeof stored.shiftNEnabled === 'boolean') settings.shiftNEnabled = stored.shiftNEnabled;
  if (typeof stored.autoNavigate === 'boolean') settings.autoNavigate = stored.autoNavigate;
  if (typeof stored.showFloatingButton === 'boolean') settings.showFloatingButton = stored.showFloatingButton;
  maybeResumeAutoNav();
  ensureFloatingButton();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.shiftNEnabled) settings.shiftNEnabled = changes.shiftNEnabled.newValue;
  if (changes.autoNavigate) settings.autoNavigate = changes.autoNavigate.newValue;
  if (changes.showFloatingButton) settings.showFloatingButton = changes.showFloatingButton.newValue;

  if (changes.showFloatingButton) ensureFloatingButton();
});

function getPageType(url) {
  if (url.startsWith(`${BASE}/quiz/attempt.php`)) return 'attempt';
  if (url.startsWith(`${BASE}/page/view.php`)) return 'page';
  if (url.startsWith(`${BASE}/resource/view.php`)) return 'page';
  if (url.startsWith(`${BASE}/quiz/view.php`)) return 'quizview';
  if (url.startsWith(`${BASE}/feedback/view.php`)) return 'feedback';
  if (url.startsWith(`${BASE}/feedback/complete.php`)) return 'feedbackform';
  if (url.startsWith(`${BASE}/quiz/summary.php`)) return 'summary';
  if (url.startsWith(`${BASE}/quiz/review.php`)) return 'review';
  return 'other';
}

// Performs the navigation action for the given page type.
// Returns true if it triggered an action that should cause navigation.
function performAction(type) {
  switch (type) {
    case 'page': {
      const nextLink = document.getElementById('next-activity-link');
      nextLink?.click();
      return !!nextLink;
    }
    case 'quizview': {
      const attemptButton = [...document.querySelectorAll('button, a')]
        .find(el => el.textContent.trim().includes('Attempt quiz'));
      if (attemptButton) {
        attemptButton.click();
        return true;
      }
      // No attempt button (e.g. quiz already done / no attempts left):
      // skip ahead via Next activity.
      const nextLink = document.getElementById('next-activity-link');
      nextLink?.click();
      return !!nextLink;
    }
    case 'feedback': {
      const answerLink = [...document.querySelectorAll('a, button')]
        .find(el => el.textContent.trim().toLowerCase().includes('answer the questions'));
      // Already submitted: no answer link, so skip ahead.
      const target = answerLink ?? document.getElementById('next-activity-link');
      target?.click();
      return !!target;
    }
    case 'feedbackform': {
      // Pick the "9" option in every radio group.
      const radioLabel = (radio) => {
        const label = radio.labels?.[0] ?? radio.closest('label');
        return label?.textContent.trim() ?? '';
      };
      document.querySelectorAll('input[type="radio"]').forEach(radio => {
        if (radioLabel(radio) === '9' && !radio.checked) radio.click();
      });

      // Multi-section forms: go to the next section; otherwise submit.
      const buttons = [...document.querySelectorAll('input[type="submit"], button')];
      const findButton = (text) => buttons
        .find(el => (el.value || el.textContent || '').trim().toLowerCase().includes(text));
      // Already submitted: no form, just the "Next Section" activity link.
      const button = findButton('next section') ?? findButton('submit your answers')
        ?? document.getElementById('next-activity-link');
      button?.click();
      return !!button;
    }
    case 'attempt': {
      const nextButton = document.querySelector('input[type="submit"]#mod_quiz-next-nav');
      nextButton?.click();
      return !!nextButton;
    }
    case 'summary': {
      const firstSubmitButton = [...document.querySelectorAll('button, input[type="submit"], a')]
        .find(el => el.textContent?.trim().includes('Submit all and finish'));
      firstSubmitButton?.click();

      setTimeout(() => {
        const confirmButton = [...document.querySelectorAll('button[data-action="save"]')]
          .find(el =>
            el.dataset.action === 'save' &&
            el.textContent.trim().includes('Submit all and finish'));
        confirmButton?.click();
      }, 1000);
      return !!firstSubmitButton;
    }
    case 'review': {
      const nextLink = document.getElementById('next-activity-link');
      nextLink?.click();
      return !!nextLink;
    }
    default:
      return false;
  }
}

function setAutoNav() {
  try { sessionStorage.setItem(AUTO_NAV_FLAG, '1'); } catch (_) {}
  updateFabState();
}

function clearAutoNav() {
  try { sessionStorage.removeItem(AUTO_NAV_FLAG); } catch (_) {}
  updateFabState();
}

function isAutoNavActive() {
  try { return sessionStorage.getItem(AUTO_NAV_FLAG) === '1'; } catch (_) { return false; }
}

// Plays a chime to signal navigation stopped. `long` plays a longer jingle,
// used when stopping at a Module Assessment quiz.
function playArrivalSound(long = false) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const now = ctx.currentTime;
    // Short: a quick two-note chime. Long: an ascending celebratory jingle.
    const notes = long
      ? [523.25, 659.25, 783.99, 1046.50, 1318.51, 1567.98] // C5 E5 G5 C6 E6 G6
      : [659.25, 987.77]; // E5 -> B5
    const step = long ? 0.17 : 0.16;
    const dur = long ? 0.30 : 0.24;

    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = now + i * step;
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + dur);
    });

    const tail = notes.length * step + dur + 0.2;
    setTimeout(() => { ctx.close().catch(() => {}); }, tail * 1000);
  } catch (_) {}
}

// True when the current quiz view page is a "Module Assessment".
function isModuleAssessment() {
  const heading = document.querySelector('.header-heading');
  const text = heading?.textContent?.trim() ?? '';
  return text.endsWith('Module Assessment');
}

// On every page load, if an auto-navigation run is in progress, keep going
// until we land on the quiz attempt page (the destination).
function maybeResumeAutoNav() {
  // An active run (started by Shift+N auto mode or the floating button) keeps
  // going regardless of toggle states until it reaches the destination.
  if (!isAutoNavActive()) return;

  const type = getPageType(window.location.href);

  // Destination reached: stop here.
  if (type === 'attempt') {
    clearAutoNav();
    playArrivalSound();
    return;
  }

  // Dead end (unknown page): can't continue, so stop.
  if (type === 'other') {
    clearAutoNav();
    return;
  }

  // Give the page a moment to settle, then continue the chain.
  setTimeout(() => {
    // Bail if the run was cancelled (e.g. Escape pressed) during the delay.
    if (!isAutoNavActive()) return;

    // Stop at Module Assessment quizzes instead of auto-attempting them.
    if (type === 'quizview' && isModuleAssessment()) {
      clearAutoNav();
      playArrivalSound(true);
      return;
    }

    const acted = performAction(type);
    if (!acted) clearAutoNav();
  }, 400);
}

// Pages we know how to act on (everything except unknown pages).
const ACTIONABLE_TYPES = ['page', 'quizview', 'feedback', 'feedbackform', 'summary', 'review', 'attempt'];

// Runs one navigation step. When `auto` is true, arms the auto-navigation run
// so the chain continues across page loads until it ARRIVES at the attempt
// page. The action below always fires for the current page (including the
// attempt page) — the stop check lives in the resume path, so triggering while
// already on the attempt page still navigates.
function startNavigation(auto) {
  const type = getPageType(window.location.href);

  if (auto && ACTIONABLE_TYPES.includes(type)) {
    setAutoNav();
  } else {
    clearAutoNav();
  }

  performAction(type);
}

function ensureFloatingButton() {
  const existing = document.getElementById('amigo-shiftn-fab');

  if (!settings.showFloatingButton) {
    existing?.remove();
    return;
  }
  if (existing) return;
  if (!document.body) return;

  const btn = document.createElement('button');
  btn.id = 'amigo-shiftn-fab';
  btn.type = 'button';
  Object.assign(btn.style, {
    position: 'fixed',
    right: '20px',
    bottom: '20px',
    zIndex: '2147483647',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '2px',
    padding: '10px 18px',
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    color: '#3a2d00',
    background: 'linear-gradient(135deg, #ffe066 0%, #ffd700 45%, #d4af37 100%)',
    border: '1px solid #c9a227',
    borderRadius: '14px',
    boxShadow: '0 4px 14px rgba(0, 0, 0, 0.35)',
    cursor: 'pointer',
    userSelect: 'none',
  });

  const label = document.createElement('span');
  label.dataset.role = 'label';
  Object.assign(label.style, { fontSize: '14px', fontWeight: '700' });

  const hint = document.createElement('span');
  hint.dataset.role = 'hint';
  Object.assign(hint.style, { fontSize: '11px', fontWeight: '500', opacity: '0.85' });

  btn.append(label, hint);

  btn.addEventListener('click', () => {
    btn.blur();
    if (isAutoNavActive()) {
      // While navigating, a click stops the run.
      clearAutoNav();
    } else {
      // Otherwise drive auto-navigation, independent of the toggles.
      startNavigation(true);
    }
  });

  document.body.appendChild(btn);
  updateFabState();
}

// Reflects the current auto-navigation run state on the floating button.
function updateFabState() {
  const btn = document.getElementById('amigo-shiftn-fab');
  if (!btn) return;

  const label = btn.querySelector('[data-role="label"]');
  const hint = btn.querySelector('[data-role="hint"]');
  const navigating = isAutoNavActive();

  btn.style.cursor = 'pointer';
  btn.style.opacity = navigating ? '0.9' : '1';

  if (label) label.textContent = navigating ? 'Navigating...' : 'Go to Next Quiz';
  if (hint) {
    hint.textContent = 'Click to stop navigation';
    hint.style.display = navigating ? 'block' : 'none';
  }
}

document.addEventListener('keydown', (event) => {
  // Escape — stop any in-progress auto-navigation run.
  if (event.code === 'Escape') {
    clearAutoNav();
    return;
  }

  // Shift + N
  if (!(event.shiftKey && event.code === 'KeyN')) return;
  if (!settings.shiftNEnabled) return;

  startNavigation(settings.autoNavigate);
});
