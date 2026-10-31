import { initializeApp } from "firebase/app";
import { getDatabase, connectDatabaseEmulator } from "firebase/database";
import { initializeAuth, browserSessionPersistence, connectAuthEmulator } from "firebase/auth";

const env = import.meta.env;

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: env.VITE_FIREBASE_DATABASE_URL,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

export const useEmulator = env.VITE_USE_EMULATOR === "true";
export const isConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.databaseURL && firebaseConfig.projectId);

let app = null;
let db = null;

export function getFirebaseApp() {
  if (!app) app = initializeApp(firebaseConfig);
  return app;
}

export function getDb() {
  if (!db) {
    db = getDatabase(getFirebaseApp());
    if (useEmulator) connectDatabaseEmulator(db, "127.0.0.1", 9000);
  }
  return db;
}

let auth = null;
export function getAuthInstance() {
  if (!auth) {
    // Session persistence: the instructor signs in again on every new visit (closing the tab signs out).
    auth = initializeAuth(getFirebaseApp(), { persistence: browserSessionPersistence });
    if (useEmulator) connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  }
  return auth;
}
