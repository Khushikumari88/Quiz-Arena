# Quiz Arena — React + Vite + Firebase

A responsive real-time multiplayer quiz game built with React, Vite, and Firebase Realtime Database.

## Game rules

- 2–8 players per room
- 5-character room code (the join field accepts 4–6 characters)
- Nicknames up to 18 characters
- 10 general-knowledge multiple-choice questions, four options each
- 15 seconds per question
- +100 points for a correct answer; 0 otherwise; no speed bonus
- Reveal the correct answer and leaderboard after each question
- Final ranking and winner after question 10
- Firebase anonymous authentication and real-time updates across browsers/devices

## 1. Requirements

- Node.js 20 or newer recommended
- A Firebase project with Realtime Database enabled

## 2. Install and configure

In Terminal, enter the project directory and install dependencies:

```bash
npm install
```

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Open `.env`. The known Firebase web-app values are prefilled; replace `PASTE_YOUR_REAL_DATABASE_URL_HERE` in `VITE_FIREBASE_DATABASE_URL` with the exact database URL from Firebase Console → Build → Realtime Database → Data. The URL often looks like `https://PROJECT-default-rtdb.REGION.firebasedatabase.app` or `https://PROJECT-default-rtdb.firebaseio.com`; use the exact value shown in your console.

Enable anonymous authentication in Firebase Console → Authentication → Sign-in method → Anonymous.

## 3. Run locally

```bash
npm run dev
```

Open the local URL printed by Vite, usually `http://localhost:5173`. For multiplayer testing, open the same URL in a second browser window and connect both sessions to the same Firebase project. Each browser connects automatically; users do not paste config into the game.

## 4. Build for hosting

```bash
npm run build
npm run preview
```

Vite outputs the production frontend into `dist/`. You can deploy it to Firebase Hosting, Vercel, or another static host. This project includes `firebase.json` and `.firebaserc` for Firebase Hosting. After installing the Firebase CLI and logging in, run `firebase deploy --only hosting` from this directory.

## Firebase rules and security warning

Do **not** use broad development rules such as `.read: "auth != null"` and `.write: "auth != null"` for a public game. They let any anonymous authenticated player modify room data and scores. The current implementation is a learning/demo prototype: the client coordinates room state and scoring. For a public launch, enforce room membership and host permissions in rules and move authoritative answer validation/scoring to trusted server code (for example, Cloud Functions), so clients cannot award themselves points or alter the game state. Never put Firebase service-account credentials in this frontend.

The Firebase web config is client-side configuration, not a service-account secret. Environment variables prefixed with `VITE_` are embedded into the browser bundle during build; database rules and trusted server-side validation are the actual security controls.

## Project structure

```text
src/
  firebase.js   Firebase initialization and anonymous sign-in
  questions.js  The ten quiz questions
  main.jsx      React screens and multiplayer room state
  styles.css    Responsive modern gaming UI
```
