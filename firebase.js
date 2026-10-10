import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import { getStorage } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-storage.js';
import { getDatabase } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js';
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
export const firebaseSetupMessage = firebaseConfigured
    ? ''
    : 'Firebase could not be configured automatically. Open this site through Firebase Hosting, or add the Firebase web app settings in firebase-config.js.';

/* Keep configuration values client-side; never put Firebase Admin credentials here. */
const app = loadedFirebaseConfig ? initializeApp(loadedFirebaseConfig) : null;

export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
export const storage = app ? getStorage(app) : null;
export const realtimeDb = app && loadedFirebaseConfig.databaseURL ? getDatabase(app) : null;
