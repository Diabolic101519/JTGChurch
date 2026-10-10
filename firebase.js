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

async function loadFirebaseConfig() {
    try {
        const response = await fetch('/__/firebase/init.json', {
            headers: { Accept: 'application/json' },
            cache: 'no-store'
        });
        if (response.ok) {
            const hostingConfig = await response.json();
            if (isValidConfig(hostingConfig)) {
                return hostingConfig;
            }
            console.error('Firebase Hosting returned an invalid Firebase app configuration.');
        }
    } catch (error) {
        console.info('Firebase Hosting auto-configuration is unavailable; checking the local Firebase configuration.', error);
    }

    if (isValidConfig(firebaseConfig)) {
        return firebaseConfig;
    }
    return null;
}

const loadedFirebaseConfig = await loadFirebaseConfig();
export const firebaseConfigured = loadedFirebaseConfig !== null;
const isLocalDevelopmentHost = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
export const firebaseSetupMessage = firebaseConfigured
    ? ''
    : isLocalDevelopmentHost
        ? 'Firebase Hosting auto-configuration is unavailable on this local development server. Open the deployed Firebase Hosting site, or add a Firebase Web app configuration to firebase-config.js. Sign-in, chat, and uploads are unavailable until Firebase is configured.'
        : 'Firebase Hosting did not provide a valid Web app configuration, and firebase-config.js has no valid fallback. Register a Web app in the Firebase project used for Hosting, or add its settings to firebase-config.js.';

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
