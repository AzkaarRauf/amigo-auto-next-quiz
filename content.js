const BASE = 'https://amigo.amityonline.com/mod';
const AUTO_NAV_FLAG = 'amigoShiftN_autoNavActive';

// Defaults: Shift+N on, Auto Navigate off, floating button off.
const settings = {
  shiftNEnabled: true,
  autoNavigate: false,
  showFloatingButton: false,
  navVersion: 'v1', // 'v1' = click through every page, 'v2' = jump straight to next quiz
};

chrome.storage.local.get(['shiftNEnabled', 'autoNavigate', 'showFloatingButton', 'navVersion'], (stored) => {
  if (typeof stored.shiftNEnabled === 'boolean') settings.shiftNEnabled = stored.shiftNEnabled;
  if (typeof stored.autoNavigate === 'boolean') settings.autoNavigate = stored.autoNavigate;
  if (typeof stored.showFloatingButton === 'boolean') settings.showFloatingButton = stored.showFloatingButton;
  if (stored.navVersion === 'v1' || stored.navVersion === 'v2') settings.navVersion = stored.navVersion;
  maybeResumeAutoNav();
  ensureFloatingButton();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.shiftNEnabled) settings.shiftNEnabled = changes.shiftNEnabled.newValue;
  if (changes.autoNavigate) settings.autoNavigate = changes.autoNavigate.newValue;
  if (changes.showFloatingButton) settings.showFloatingButton = changes.showFloatingButton.newValue;
  if (changes.navVersion) settings.navVersion = changes.navVersion.newValue;

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

// ---------- V2 navigation: jump straight to the next incomplete quiz ----------

// Course module id of the current page, from Moodle's `cmid-123` body class.
function currentCmid() {
  return document.body?.className.match(/\bcmid-(\d+)\b/)?.[1] ?? null;
}

// Module name of the current page, from Moodle's `path-mod-quiz` body class.
function currentModName() {
  return document.body?.className.match(/\bpath-mod-([a-z]+)\b/)?.[1] ?? null;
}

const ACTIVITY_LINK_SELECTOR = '#accordionEx1 .activity-item a[href]';

// Parses the activity list (focus-mode "Activity List" dropdown) into
// [{ id, url, isQuiz, complete, name }], in course order.
function parseActivities(doc) {
  return [...doc.querySelectorAll(ACTIVITY_LINK_SELECTOR)].map((a) => {
    const url = a.href || a.getAttribute('href');
    const id = url.match(/[?&]id=(\d+)/)?.[1] ?? null;
    return {
      id,
      url,
      isQuiz: url.includes('/mod/quiz/view.php'),
      complete: !!a.querySelector('.complete_icon'),
      name: a.textContent.trim().replace(/\s+/g, ' '),
    };
  });
}

// Gets the activity list from this page, or — if this page doesn't render it
// (e.g. quiz review) — from a fresh fetch of the current activity's view page.
async function loadActivities() {
  const here = parseActivities(document);
  if (here.length) return here;

  const cmid = currentCmid();
  const mod = currentModName();
  if (!cmid || !mod) return [];

  const res = await fetch(`${BASE}/${mod}/view.php?id=${cmid}`, { credentials: 'include' });
  if (!res.ok) return [];
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return parseActivities(doc);
}

// Navigates to the first incomplete quiz after the current activity in course
// order (Module Assessments are quizzes too, so they're reached naturally).
async function goToNextQuiz() {
  try {
    const activities = await loadActivities();
    const cmid = currentCmid();
    const pos = cmid ? activities.findIndex(a => a.id === cmid) : -1;
    const next = activities
      .slice(pos + 1)
      .find(a => a.isQuiz && !a.complete && a.id !== cmid);

    if (!next) {
      clearAutoNav();
      return false;
    }
    window.location.href = next.url;
    return true;
  } catch (_) {
    clearAutoNav();
    return false;
  }
}

function findAttemptButton() {
  return [...document.querySelectorAll('button, a')]
    .find(el => el.textContent.trim().includes('Attempt quiz'));
}

// V2 action for the given page type. Content/feedback pages are skipped
// entirely: we jump straight to the next quiz instead of clicking through.
function performActionV2(type) {
  switch (type) {
    case 'quizview': {
      const attemptButton = findAttemptButton();
      if (attemptButton) {
        attemptButton.click();
        return true;
      }
      // No "Attempt quiz" button => this quiz is done; move to the next one.
      goToNextQuiz();
      return true;
    }
    case 'attempt':
    case 'summary':
      return performAction(type);
    case 'review':
    case 'page':
    case 'feedback':
    case 'feedbackform':
    case 'other':
      goToNextQuiz();
      return true;
    default:
      return false;
  }
}

function runAction(type) {
  return settings.navVersion === 'v2' ? performActionV2(type) : performAction(type);
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

// Plays a sound to signal navigation stopped. Default: subtle ~2s bass
// "pick-pock" for a regular quiz. `long`: bright jingle for Module Assessment.
function playArrivalSound(long = false) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const now = ctx.currentTime;

    if (!long) {
      // Subtle bass-heavy "pick-pock" pattern, ~2s: three pairs of low thumps.
      const hits = [
        [0.00, 196], [0.20, 147], // pick-pock (G3 -> D3)
        [0.70, 196], [0.90, 147],
        [1.40, 196], [1.60, 131], // final pock lands lower (C3)
      ];
      hits.forEach(([t, freq], i) => {
        const start = now + t;
        const dur = i === hits.length - 1 ? 0.4 : 0.22;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.3, start + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
        gain.connect(ctx.destination);

        // Body: sine with quick pitch drop for a woody thump.
        const body = ctx.createOscillator();
        body.type = 'sine';
        body.frequency.setValueAtTime(freq * 1.8, start);
        body.frequency.exponentialRampToValueAtTime(freq, start + 0.04);
        body.connect(gain);

        // Faint overtone so it's audible on laptop speakers.
        const over = ctx.createOscillator();
        const overGain = ctx.createGain();
        over.type = 'triangle';
        over.frequency.value = freq * 2;
        overGain.gain.value = 0.12;
        over.connect(overGain).connect(gain);

        [body, over].forEach((o) => { o.start(start); o.stop(start + dur); });
      });
      setTimeout(() => { ctx.close().catch(() => {}); }, 2300);
      return;
    }

    // Long: an ascending celebratory jingle.
    const notes = [523.25, 659.25, 783.99, 1046.50, 1318.51, 1567.98]; // C5 E5 G5 C6 E6 G6
    const step = 0.17;
    const dur = 0.30;

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

    const acted = runAction(type);
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

  // V2 can start from anywhere that renders the activity list.
  const actionable = ACTIONABLE_TYPES.includes(type) || settings.navVersion === 'v2';
  if (auto && actionable) {
    setAutoNav();
  } else {
    clearAutoNav();
  }

  runAction(type);
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
