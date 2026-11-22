const BASE = 'https://amigo.amityonline.com/mod';
const AUTO_NAV_FLAG = 'amigoShiftN_autoNavActive';
const FAB_FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const GOLD_BG = 'linear-gradient(135deg, #ffe066 0%, #ffd700 45%, #d4af37 100%)';
const NAV_BG = 'linear-gradient(135deg, #7dd3fc 0%, #38bdf8 45%, #0284c7 100%)';

// Defaults: Shift+N on, Auto Navigate off, floating button off.
const settings = {
  shiftNEnabled: true,
  autoNavigate: false,
  showFloatingButton: false,
  navVersion: 'v1', // 'v1' = click through every page, 'v2' = jump straight to next quiz
  fabCorner: 'br', // floating button anchor: 'br' | 'bl' | 'tr' | 'tl'
};
const FAB_CORNERS = ['br', 'bl', 'tr', 'tl'];

chrome.storage.local.get(['shiftNEnabled', 'autoNavigate', 'showFloatingButton', 'navVersion', 'fabCorner'], (stored) => {
  if (typeof stored.shiftNEnabled === 'boolean') settings.shiftNEnabled = stored.shiftNEnabled;
  if (typeof stored.autoNavigate === 'boolean') settings.autoNavigate = stored.autoNavigate;
  if (typeof stored.showFloatingButton === 'boolean') settings.showFloatingButton = stored.showFloatingButton;
  if (stored.navVersion === 'v1' || stored.navVersion === 'v2') settings.navVersion = stored.navVersion;
  if (FAB_CORNERS.includes(stored.fabCorner)) settings.fabCorner = stored.fabCorner;
  maybeResumeAutoNav();
  maybeResumeFeedbackRun();
  ensureFloatingButton();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.shiftNEnabled) settings.shiftNEnabled = changes.shiftNEnabled.newValue;
  if (changes.autoNavigate) settings.autoNavigate = changes.autoNavigate.newValue;
  if (changes.showFloatingButton) settings.showFloatingButton = changes.showFloatingButton.newValue;
  if (changes.navVersion) settings.navVersion = changes.navVersion.newValue;

  if (changes.fabCorner && FAB_CORNERS.includes(changes.fabCorner.newValue)) {
    settings.fabCorner = changes.fabCorner.newValue;
    applyFabCorner();
  }

  if (changes.showFloatingButton) ensureFloatingButton();
});

// Fixed-position offsets for the chosen corner; `v` = vertical inset.
function cornerStyle(v) {
  const c = settings.fabCorner;
  const top = c[0] === 't';
  const left = c[1] === 'l';
  return {
    top: top ? v : 'auto',
    bottom: top ? 'auto' : v,
    left: left ? '20px' : 'auto',
    right: left ? 'auto' : '20px',
  };
}

function applyFabCorner() {
  const wrap = document.getElementById('amigo-shiftn-fab-wrap');
  if (wrap) Object.assign(wrap.style, cornerStyle('20px'));
  const menu = document.getElementById('amigo-shiftn-menu');
  if (menu) {
    const c = settings.fabCorner;
    Object.assign(menu.style, {
      top: c[0] === 't' ? 'calc(100% + 8px)' : 'auto',
      bottom: c[0] === 't' ? 'auto' : 'calc(100% + 8px)',
      left: c[1] === 'l' ? '0' : 'auto',
      right: c[1] === 'l' ? 'auto' : '0',
    });
  }
  const toast = document.getElementById('amigo-shiftn-toast');
  if (toast) Object.assign(toast.style, cornerStyle('84px'));
}

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
      const attemptButton = findAttemptButton();
      if (attemptButton) {
        attemptButton.click();
        return true;
      }
      // No attempt/continue button (e.g. quiz already done / no attempts left):
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
      fillFeedbackForm();
      // Already submitted: no form, just the "Next Section" activity link.
      const button = findFeedbackSubmitButton() ?? document.getElementById('next-activity-link');
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
    // Section title: the outer accordion card's header (e.g. "#Module 3 : ...").
    const collapse = a.closest('.collapse');
    const section = collapse?.parentElement
      ?.querySelector(':scope > .card-header h5')?.textContent.trim().replace(/\s+/g, ' ') ?? '';
    return {
      id,
      url,
      section,
      isQuiz: url.includes('/mod/quiz/view.php'),
      isFeedback: url.includes('/mod/feedback/view.php'),
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

// "Attempt quiz" first; if absent, "Continue your attempt" (an unfinished
// attempt is in progress). Null when neither exists.
function findAttemptButton() {
  const els = [...document.querySelectorAll('button, a')];
  const find = (text) => els.find(el => el.textContent.trim().toLowerCase().startsWith(text));
  return find('attempt quiz') ?? find('continue your attempt');
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
      // No "Attempt quiz" / "Continue your attempt" => quiz done; move on.
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

// ---------- Feedback forms ----------

const FEEDBACK_TEXT = 'good';
const FEEDBACK_COUNTRY = 'india';

function setFieldValue(el, value) {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

// Fills the feedback form on complete.php: "9" on every radio group, "India" in
// dropdowns, "good" in empty text inputs / textareas. Scoped to the main
// region so the chat / search boxes elsewhere on the page are left alone.
function fillFeedbackForm() {
  const root = document.getElementById('region-main') ?? document;

  const radioLabel = (radio) => {
    const label = radio.labels?.[0] ?? radio.closest('label');
    return label?.textContent.trim() ?? '';
  };
  root.querySelectorAll('input[type="radio"]').forEach(radio => {
    if (radioLabel(radio) === '9' && !radio.checked) radio.click();
  });

  root.querySelectorAll('select').forEach(select => {
    const india = [...select.options]
      .find(o => o.textContent.trim().toLowerCase() === FEEDBACK_COUNTRY);
    if (india && select.value !== india.value) setFieldValue(select, india.value);
  });

  root.querySelectorAll('textarea, input[type="text"], input:not([type])').forEach(field => {
    if (field.disabled || field.readOnly || field.type === 'hidden') return;
    if (!field.value.trim()) setFieldValue(field, FEEDBACK_TEXT);
  });
}

// "Next section" on multi-section forms, otherwise "Submit your answers".
function findFeedbackSubmitButton() {
  const buttons = [...document.querySelectorAll('input[type="submit"], button')];
  const findButton = (text) => buttons
    .find(el => (el.value || el.textContent || '').trim().toLowerCase().includes(text));
  return findButton('next section') ?? findButton('submit your answers');
}

function findAnswerQuestionsLink() {
  return [...document.querySelectorAll('a, button')]
    .find(el => el.textContent.trim().toLowerCase().includes('answer the questions'));
}

// A feedback run walks a queue of incomplete feedback activities in the
// #Module sections, in this tab. State lives in sessionStorage so it survives
// page loads.
const FB_QUEUE_KEY = 'amigoShiftN_feedbackQueue';
const FB_TRIES_KEY = 'amigoShiftN_feedbackTries';
const FB_MAX_FORM_PAGES = 20; // guard against a validation-error resubmit loop

function getFeedbackQueue() {
  try { return JSON.parse(sessionStorage.getItem(FB_QUEUE_KEY)); } catch (_) { return null; }
}

function setFeedbackQueue(queue) {
  try { sessionStorage.setItem(FB_QUEUE_KEY, JSON.stringify(queue)); } catch (_) {}
}

function clearFeedbackRun() {
  try {
    sessionStorage.removeItem(FB_QUEUE_KEY);
    sessionStorage.removeItem(FB_TRIES_KEY);
  } catch (_) {}
}

function isFeedbackRunActive() {
  return Array.isArray(getFeedbackQueue());
}

// Moves on to the next queued feedback, or ends the run.
function nextFeedback() {
  const queue = getFeedbackQueue() ?? [];
  const next = queue.shift();
  try { sessionStorage.removeItem(FB_TRIES_KEY); } catch (_) {}
  if (!next) {
    clearFeedbackRun();
    playArrivalSound(true);
    return;
  }
  setFeedbackQueue(queue);
  window.location.href = next;
}

async function startFeedbackRun() {
  const activities = await loadActivities();
  const urls = activities
    // Module feedback forms, plus the course-level "Student Feedback for ..."
    // forms (course + faculty), which live in their own section.
    .filter(a => a.isFeedback && !a.complete &&
      (a.section.startsWith('#Module') || a.name.toLowerCase().startsWith('student feedback for')))
    .map(a => a.url);
  if (!urls.length) return 0;
  setFeedbackQueue(urls);
  nextFeedback();
  return urls.length;
}

function maybeResumeFeedbackRun() {
  if (!isFeedbackRunActive()) return;
  const type = getPageType(window.location.href);

  setTimeout(() => {
    if (!isFeedbackRunActive()) return;

    if (type === 'feedback') {
      // Not answered yet: open the form. Answered/closed: move on.
      const answer = findAnswerQuestionsLink();
      if (answer) answer.click();
      else nextFeedback();
      return;
    }

    if (type === 'feedbackform') {
      const submit = findFeedbackSubmitButton();
      if (!submit) {
        // No form left => "answers saved" page: this one is submitted.
        nextFeedback();
        return;
      }
      let tries = 0;
      try { tries = Number(sessionStorage.getItem(FB_TRIES_KEY)) || 0; } catch (_) {}
      if (tries >= FB_MAX_FORM_PAGES) {
        // Stuck (likely a required field we can't fill): stop for the user.
        clearFeedbackRun();
        return;
      }
      try { sessionStorage.setItem(FB_TRIES_KEY, String(tries + 1)); } catch (_) {}
      fillFeedbackForm();
      submit.click();
      return;
    }

    // Anywhere else (e.g. course page after submit): move on.
    nextFeedback();
  }, 400);
}

// ---------- Open unread pages (driven by background.js) ----------

// Collects incomplete non-quiz, non-feedback activities in the #Module sections
// and hands them to the background worker, which opens one background tab
// every 5 seconds and closes each once it has loaded.
async function startPagesRun() {
  const activities = await loadActivities();
  const items = activities
    .filter(a => a.section.startsWith('#Module') && !a.isQuiz && !a.isFeedback && !a.complete)
    .map(({ url, name }) => ({ url, name }));
  if (!items.length) return 0;
  await chrome.runtime.sendMessage({ type: 'startPages', items });
  return items.length;
}

function stopPagesRun() {
  return chrome.runtime.sendMessage({ type: 'stopPages' }).catch(() => {});
}

function getPagesStatus() {
  return chrome.runtime.sendMessage({ type: 'pagesStatus' }).catch(() => ({ running: false }));
}

// Small transient message above the floating buttons.
function showToast(text) {
  document.getElementById('amigo-shiftn-toast')?.remove();
  const toast = document.createElement('div');
  toast.id = 'amigo-shiftn-toast';
  toast.textContent = text;
  Object.assign(toast.style, {
    position: 'fixed', ...cornerStyle('84px'), zIndex: '2147483647',
    padding: '8px 12px', borderRadius: '8px', fontSize: '13px',
    fontFamily: FAB_FONT,
    background: '#1e293b', color: '#e2e8f0', boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
  });
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
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
  const existing = document.getElementById('amigo-shiftn-fab-wrap');

  if (!settings.showFloatingButton) {
    existing?.remove();
    return;
  }
  if (existing) return;
  if (!document.body) return;

  // Row anchored at the chosen corner: [golden button][⋮]
  const wrap = document.createElement('div');
  wrap.id = 'amigo-shiftn-fab-wrap';
  Object.assign(wrap.style, {
    position: 'fixed',
    zIndex: '2147483647',
    display: 'flex',
    alignItems: 'stretch',
    gap: '6px',
    fontFamily: FAB_FONT,
  });

  const btn = document.createElement('button');
  btn.id = 'amigo-shiftn-fab';
  btn.type = 'button';
  Object.assign(btn.style, {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '2px',
    padding: '10px 18px',
    fontFamily: FAB_FONT,
    color: '#3a2d00',
    background: GOLD_BG,
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

  // Narrow three-dot button; same height as the golden one (row is stretch-aligned).
  const dots = document.createElement('button');
  dots.id = 'amigo-shiftn-more';
  dots.type = 'button';
  dots.title = 'More actions';
  dots.textContent = '⋮';
  Object.assign(dots.style, {
    width: '34px',
    padding: '0',
    fontSize: '20px',
    fontWeight: '700',
    lineHeight: '1',
    color: '#3a2d00',
    background: GOLD_BG,
    border: '1px solid #c9a227',
    borderRadius: '14px',
    boxShadow: '0 4px 14px rgba(0, 0, 0, 0.35)',
    cursor: 'pointer',
  });

  const menu = buildMoreMenu();
  dots.addEventListener('click', (e) => {
    e.stopPropagation();
    dots.blur();
    if (menu.style.display !== 'none') closeMoreMenu();
    else openMoreMenu();
  });

  wrap.append(btn, dots, menu);
  document.body.appendChild(wrap);
  applyFabCorner();
  updateFabState();
}

let moreMenuTimer = null;

function buildMoreMenu() {
  const menu = document.createElement('div');
  menu.id = 'amigo-shiftn-menu';
  Object.assign(menu.style, {
    display: 'none',
    position: 'absolute',
    minWidth: '250px',
    padding: '6px',
    background: '#1e293b',
    borderRadius: '10px',
    boxShadow: '0 6px 20px rgba(0, 0, 0, 0.4)',
    flexDirection: 'column',
    gap: '4px',
  });
  // Clicks inside the menu shouldn't close it.
  menu.addEventListener('click', (e) => e.stopPropagation());

  const item = (role) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.dataset.role = role;
    Object.assign(el.style, {
      textAlign: 'left',
      padding: '8px 10px',
      fontFamily: FAB_FONT,
      fontSize: '13px',
      fontWeight: '600',
      color: '#e2e8f0',
      background: 'transparent',
      border: 'none',
      borderRadius: '6px',
      cursor: 'pointer',
    });
    el.addEventListener('mouseenter', () => { el.style.background = '#334155'; });
    el.addEventListener('mouseleave', () => { el.style.background = 'transparent'; });
    return el;
  };

  const pagesItem = item('pages');
  pagesItem.addEventListener('click', async () => {
    const status = await getPagesStatus();
    if (status?.running) {
      await stopPagesRun();
      showToast('Stopped opening pages');
    } else {
      try {
        const count = await startPagesRun();
        showToast(count ? `Opening ${count} unread page(s), one every 5s` : 'No unread pages found');
      } catch (_) {
        showToast('Could not start (reload the page)');
      }
    }
    refreshMoreMenu();
  });

  const feedbackItem = item('feedback');
  feedbackItem.addEventListener('click', async () => {
    if (isFeedbackRunActive()) {
      clearFeedbackRun();
      showToast('Stopped feedback forms');
      refreshMoreMenu();
      return;
    }
    closeMoreMenu();
    const count = await startFeedbackRun().catch(() => 0);
    showToast(count ? `Completing ${count} feedback form(s)` : 'No incomplete feedback forms found');
  });

  menu.append(pagesItem, feedbackItem);

  // Close when clicking anywhere else on the page.
  document.addEventListener('click', () => closeMoreMenu());
  return menu;
}

function openMoreMenu() {
  const menu = document.getElementById('amigo-shiftn-menu');
  if (!menu) return;
  menu.style.display = 'flex';
  refreshMoreMenu();
  clearInterval(moreMenuTimer);
  moreMenuTimer = setInterval(refreshMoreMenu, 1000);
}

function closeMoreMenu() {
  const menu = document.getElementById('amigo-shiftn-menu');
  if (menu) menu.style.display = 'none';
  clearInterval(moreMenuTimer);
  moreMenuTimer = null;
}

// Updates menu item labels to reflect whether each run is in progress.
async function refreshMoreMenu() {
  const menu = document.getElementById('amigo-shiftn-menu');
  if (!menu) return;
  const pagesItem = menu.querySelector('[data-role="pages"]');
  const feedbackItem = menu.querySelector('[data-role="feedback"]');

  const status = await getPagesStatus();
  pagesItem.textContent = status?.running
    ? `■ Stop opening pages (${status.done}/${status.total})`
    : '▶ Open unread pages';

  const remaining = getFeedbackQueue()?.length ?? 0;
  feedbackItem.textContent = isFeedbackRunActive()
    ? `■ Stop feedback forms (${remaining} left)`
    : '▶ Complete feedback forms';
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
  btn.style.background = navigating ? NAV_BG : GOLD_BG;
  btn.style.borderColor = navigating ? '#0369a1' : '#c9a227';
  btn.style.color = navigating ? '#06263d' : '#3a2d00';

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
    clearFeedbackRun();
    stopPagesRun();
    refreshMoreMenu();
    return;
  }

  // Shift + N
  if (!(event.shiftKey && event.code === 'KeyN')) return;
  if (!settings.shiftNEnabled) return;

  startNavigation(settings.autoNavigate);
});
