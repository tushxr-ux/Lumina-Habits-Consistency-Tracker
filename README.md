# Lumina Habits — Consistency Tracker

A dark/light habit tracker with streak freezes, per-habit notes, a daily diary, a weight tracker, and a local on-device "AI" coach — built with plain **HTML, CSS, and JavaScript**. No framework, no backend, no build step, no account.

![Lumina Habits logo](assets/logo.png)

## Features

- ✅ Track unlimited custom habits (name, category, accent color, optional target streak)
- 🔥 Automatic current-streak and longest-streak calculation
- 🧊 **Streak freezes** — protect a streak on a day you can't check in, without it counting as a real completion
- 📅 GitHub-style contribution heatmap per habit (last 26 weeks) — squares are color-coded **green (done) / red (missed) / blue (frozen) / dim (future or before the habit existed)**; tap any past square to toggle it
- 📊 Stats dashboard: total active habits, best streak, average 30-day completion rate (correctly scoped to how long each habit has actually existed), per-habit breakdown bars
- 📝 **Per-habit notes** — jot something down about today's attempt at a habit and page back through past notes by date
- 📓 **Daily diary** — a separate, free-form journal entry per day, independent of any single habit
- ⚖️ **Weight tracker** — log a daily weight, see a trend chart and history list
- 🤖 **AI Habit Coach** — a chat-style assistant that answers questions about your streaks, weight trend, and habits by name. It's a local, rule-based assistant that reads your own data on-device — not a connected LLM (there's no backend here to safely hold an API key)
- 🔔 **Daily reminders** — an optional browser notification if a habit isn't checked in by a time you set (only fires while the tab is open; real background push needs a server)
- ☰ Bottom-sheet menu with a profile photo/emoji avatar, linking to Profile, AI Coach, Diary, Weight Tracker, and Settings
- 👤 Profile page with an uploadable photo (or emoji avatar) and lifetime stats
- 💾 Everything persists locally via `localStorage` — no account, no server, your data never leaves your device
- 📤 Export your data as JSON or CSV
- 🌓 Light/dark theme toggle (fully re-themed, not just an afterthought)
- 📱 Fully responsive — bottom nav on mobile, side nav on desktop

## Tech Stack

- HTML5 / CSS3
- Vanilla JavaScript (ES6+)
- [Tailwind CSS](https://tailwindcss.com/) (via CDN, for utility styling)
- [Material Symbols](https://fonts.google.com/icons) for iconography
- Hand-rolled inline SVG for the weight trend chart (no charting library)
- `localStorage` for persistence — zero backend

## Getting Started

No build tools required.

```bash
git clone https://github.com/<your-username>/lumina-habits.git
cd lumina-habits
```

Then just open `index.html` in a browser, or serve it locally:

```bash
python3 -m http.server 8000
# visit http://localhost:8000
```

> Some browsers restrict `localStorage` when opening a file directly (`file://`). If your data doesn't seem to save, serve it over `http://localhost` instead.

## Deploying to GitHub Pages

1. Push this repo to GitHub.
2. Go to **Settings → Pages**.
3. Set source to the `main` branch, root folder.
4. Your live link will appear at `https://<username>.github.io/lumina-habits/`.

## Project Structure

```
lumina-habits/
├── index.html   # markup for every view (dashboard, detail, stats, settings,
│                #  profile, AI chat, diary, weight tracker, new-habit modal,
│                #  bottom-sheet menu)
├── style.css    # custom styles (heatmap, cards, chips, nav states, chat
│                #  bubbles, bottom sheet, toasts) + full light-mode overrides
├── app.js       # state management, streak math, rendering, and all feature
│                #  logic (freezes, notes, diary, weight, chatbot, reminders)
├── assets/
│   └── logo.png # app icon / favicon
└── README.md
```

## How the streak logic works

- **Current streak**: counts consecutive days that are either completed *or* frozen, ending today (or yesterday, if today isn't checked in yet, so the streak doesn't reset the moment the clock rolls over).
- **Streak freeze**: each habit has a small pool of freezes (set at creation, default 3). Using one on a day marks it as protected — the streak keeps going, but it's tracked separately from a real completion.
- **Longest streak**: scans the full check-in + freeze history for the longest run of consecutive dates.
- **Completion rate**: percentage of days marked complete, scoped to the days the habit has actually existed (a habit created 5 days ago is judged over those 5 days, not a fixed 30).
- **Dates**: computed from the browser's local time (not UTC), so a late-night check-in near midnight lands on the correct day regardless of time zone.

## Notes on the "AI" features

- **AI Habit Coach**: pattern-matches your message against your own habits/streaks/weight/diary data and replies with relevant, locally-generated answers. There is no API call, no external model, and no data leaves your device.
- **Reminders**: use the browser's `Notification` API. They only fire while this tab is open in your browser — there's no service worker or push server behind this, so closing the tab (or the browser) means no reminder.

## Ideas for a v2

- Sync data across devices with a real backend (Firebase/Supabase) — would also unlock true push notifications and real login (Google/phone OTP)
- Swap the local chatbot for a real LLM call through your own backend/API key
- Weekly email/summary digest
- Freeze auto-refill (e.g. +1 per week) instead of a fixed pool

---

Built as a personal project to practice vanilla JS state management and data visualization without a framework.
