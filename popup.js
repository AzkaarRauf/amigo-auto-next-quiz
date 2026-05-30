const enabledToggle = document.getElementById('toggle-enabled');
const autoToggle = document.getElementById('toggle-auto');
const autoRow = document.getElementById('row-auto');
const fabToggle = document.getElementById('toggle-fab');

function render(shiftNEnabled, autoNavigate, showFloatingButton) {
  enabledToggle.checked = shiftNEnabled;

  // Toggle 2 depends on Toggle 1.
  autoToggle.disabled = !shiftNEnabled;
  autoRow.classList.toggle('disabled', !shiftNEnabled);
  autoToggle.checked = shiftNEnabled && autoNavigate;

  fabToggle.checked = showFloatingButton;
}

chrome.storage.local.get(['shiftNEnabled', 'autoNavigate', 'showFloatingButton'], (stored) => {
  const shiftNEnabled = typeof stored.shiftNEnabled === 'boolean' ? stored.shiftNEnabled : true;
  const autoNavigate = typeof stored.autoNavigate === 'boolean' ? stored.autoNavigate : false;
  const showFloatingButton = typeof stored.showFloatingButton === 'boolean' ? stored.showFloatingButton : false;
  render(shiftNEnabled, autoNavigate, showFloatingButton);
});

enabledToggle.addEventListener('change', () => {
  const shiftNEnabled = enabledToggle.checked;
  // If Shift+N is turned off, Auto Navigate must also turn off.
  const autoNavigate = shiftNEnabled ? autoToggle.checked : false;

  chrome.storage.local.set({ shiftNEnabled, autoNavigate });
  render(shiftNEnabled, autoNavigate, fabToggle.checked);
});

autoToggle.addEventListener('change', () => {
  // Guard: Auto Navigate can only be on when Shift+N is on.
  if (!enabledToggle.checked) {
    autoToggle.checked = false;
    return;
  }
  chrome.storage.local.set({ autoNavigate: autoToggle.checked });
});

fabToggle.addEventListener('change', () => {
  chrome.storage.local.set({ showFloatingButton: fabToggle.checked });
});
