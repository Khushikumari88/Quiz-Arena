import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getDatabase } from 'firebase/database';

const env = import.meta.env;
export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: env.VITE_FIREBASE_DATABASE_URL,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

export function hasFirebaseConfig() {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.databaseURL &&
    !firebaseConfig.databaseURL.includes('PASTE_YOUR_REAL_DATABASE_URL_HERE') && !firebaseConfig.databaseURL.includes('YOUR_DATABASE_REGION') && firebaseConfig.projectId && firebaseConfig.appId);
}

export async function connectFirebase() {
  if (!hasFirebaseConfig()) throw new Error('Firebase is not configured. Copy .env.example to .env and fill in your Firebase values.');
  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  const auth = getAuth(app);
  if (!auth.currentUser) await signInAnonymously(auth);
  const db = getDatabase(app);
  return { db, auth };
}
