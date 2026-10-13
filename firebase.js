import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import { firebaseConfig } from './firebase-config.js';

const requiredConfigKeys = [
    'apiKey',
    'authDomain',
    'projectId',
    'storageBucket',
    'messagingSenderId',
    'appId'
];

function isValidConfig(config) {
    return requiredConfigKeys.every(key => {
        const value = config && config[key];
        return typeof value === 'string' && value.trim() !== '' && !value.startsWith('REPLACE_');
    });
}

const loadedFirebaseConfig = isValidConfig(firebaseConfig) ? firebaseConfig : null;
export const firebaseConfigured = loadedFirebaseConfig !== null;
export const firebaseSetupMessage = firebaseConfigured
    ? ''
    : 'Firebase Web app settings are missing or incomplete. Add the configuration for this project to firebase-config.js. Sign-in, chat, and uploads are unavailable until Firebase is configured.';

/* Keep configuration values client-side; never put Firebase Admin credentials here. */
const app = loadedFirebaseConfig ? initializeApp(loadedFirebaseConfig) : null;

export const auth = app ? getAuth(app) : null;
const hasRealtimeDatabaseURL = typeof loadedFirebaseConfig?.databaseURL === 'string'
    && loadedFirebaseConfig.databaseURL.trim() !== ''
    && !loadedFirebaseConfig.databaseURL.startsWith('REPLACE_');

let firestoreInstancePromise = null;
let storageInstancePromise = null;
let realtimeDatabaseInstancePromise = null;

export function getFirestoreDb() {
    if (!app) return Promise.resolve(null);
    if (!firestoreInstancePromise) {
        firestoreInstancePromise = import('https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js')
            .then(({ getFirestore }) => getFirestore(app));
    }
    return firestoreInstancePromise;
}

export function getFirebaseStorage() {
    if (!app) return Promise.resolve(null);
    if (!storageInstancePromise) {
        storageInstancePromise = import('https://www.gstatic.com/firebasejs/11.10.0/firebase-storage.js')
            .then(({ getStorage }) => getStorage(app));
    }
    return storageInstancePromise;
}

export function getRealtimeDatabase() {
    if (!app || !hasRealtimeDatabaseURL) return Promise.resolve(null);
    if (!realtimeDatabaseInstancePromise) {
        realtimeDatabaseInstancePromise = import('https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js')
            .then(({ getDatabase }) => getDatabase(app));
    }
    return realtimeDatabaseInstancePromise;
}
