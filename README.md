# Amigo Shift+N Navigator

A small Chrome/Edge extension for [amigo.amityonline.com](https://amigo.amityonline.com/) (Amity's Moodle site) that speeds up moving through course content. It can step through content pages and quiz screens, and—using **Auto Navigate**—keep advancing on its own until it reaches a quiz **attempt** page, where it stops so you can take the quiz.

## What it does

The extension recognises five page types on the site and performs the natural "forward" action on each:

| Page | Action |
|------|--------|
| `mod/page/view.php` | Click **Next activity** |
| `mod/resource/view.php` | Click **Next activity** |
| `mod/feedback/view.php` | Click **Answer the questions**; if already submitted, click **Next activity** |
| `mod/feedback/complete.php` | Select every **9** radio, then click **Next section** (or **Submit your answers**); if already submitted, click **Next activity** |
| `mod/quiz/view.php` | Click **Attempt quiz**; if none, click **Next activity** |
| `mod/quiz/attempt.php` | Click **Next page** (this is the stop point for Auto Navigate) |
| `mod/quiz/summary.php` | Click **Submit all and finish**, then confirm |
| `mod/quiz/review.php` | Click **Next activity** |

There are two ways to trigger it:

- **Golden floating button** — a "Go to Next Quiz" button at the bottom-right of the page.
- **Keyboard shortcut** — `Shift + N`.

## Features

- **Shift + N** — perform the forward action for the current page.
- **Auto Navigate** — instead of stopping after one step, keep advancing across page loads until arriving at a quiz attempt page, then stop.
- **Floating button** — a golden "Go to Next Quiz" button that always drives Auto Navigate. While a run is in progress it shows **"Navigating…"** and can be clicked again to stop.
- **Stop conditions during Auto Navigate:**
  - Arriving at a `mod/quiz/attempt.php` page → stop + short chime.
  - Landing on a `mod/quiz/view.php` whose heading ends with **"Module Assessment"** → stop (does **not** auto-attempt it) + a longer jingle.
- **Press `Esc`** at any time to stop an in-progress run.

## Recommended usage

**Use the golden button.** It's the simplest and most reliable way to drive Auto Navigate:

1. Open the extension popup and turn on **Floating Button**.
2. On any page of the site, click **Go to Next Quiz**.
3. The extension advances on its own until it reaches the next quiz attempt page (or a Module Assessment), plays a sound, and stops.
4. To stop early, click the button again (it reads **"Navigating…"**) or press `Esc`.

The button works regardless of the Shift+N / Auto Navigate toggles.

### Using the keyboard instead

- Turn on **Shift + N** in the popup, then press `Shift + N` for a single step.
- Also turn on **Auto Navigate** to make `Shift + N` start a continuous run (same behaviour as the button).
- Note: **Auto Navigate** can only be enabled while **Shift + N** is enabled. Turning Shift + N off turns Auto Navigate off too.

## Installation

This is an unpacked extension (not on the Chrome Web Store).

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome (or `edge://extensions` in Edge).
3. Turn on **Developer mode** (top-right).
4. Click **Load unpacked** and select the folder containing `manifest.json`.
5. Visit [amigo.amityonline.com](https://amigo.amityonline.com/) and open the extension's popup to configure the toggles.

After editing any file, click the **refresh** icon on the extension's card in `chrome://extensions`, then reload the site tab.

## Settings (popup)

| Toggle | Description |
|--------|-------------|
| **Shift + N** | Master switch for the keyboard shortcut. |
| **Auto Navigate** | Makes `Shift + N` keep advancing until the attempt page. Requires Shift + N to be on. |
| **Floating Button** | Shows the golden "Go to Next Quiz" button. |

Settings are saved with `chrome.storage` and apply to open tabs immediately.

## How it works

- `content.js` is injected into every page on `https://amigo.amityonline.com/*` and contains all the navigation logic.
- A run that's "in progress" is tracked per-tab via `sessionStorage`, so it survives the page reloads that happen as you navigate.
- The popup (`popup.html` / `popup.js`) just reads and writes the three toggle values.

## Disclaimer

This is an unofficial helper for personal convenience. It only clicks buttons/links that you could click yourself. Use it responsibly and in line with your institution's policies. It is not affiliated with Amity University or Moodle.

## License

MIT
