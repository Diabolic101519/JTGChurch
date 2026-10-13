const databaseName = 'jtg-church-local';
const databaseVersion = 1;
const retentionYears = 5;
const sessionStorageKey = 'jtg-church-local-session';
const databaseChangeEvent = 'jtg-church-local-database-change';
const objectUrls = new Map();

let databasePromise;
let lastRetentionCheck = 0;
let retentionCheckPromise = null;

function authError(code, message) {
    return Object.assign(new Error(message), { code });
}

function openDatabase() {
    if (!databasePromise) {
        databasePromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(databaseName, databaseVersion);
            request.onupgradeneeded = () => {
                const database = request.result;
                if (!database.objectStoreNames.contains('accounts')) {
                    const accounts = database.createObjectStore('accounts', { keyPath: 'email' });
                    accounts.createIndex('uid', 'uid', { unique: true });
                }
                if (!database.objectStoreNames.contains('messages')) {
                    database.createObjectStore('messages', { keyPath: 'id' });
                }
                if (!database.objectStoreNames.contains('posts')) {
                    database.createObjectStore('posts', { keyPath: 'id' });
                }
                if (!database.objectStoreNames.contains('messageReads')) {
                    database.createObjectStore('messageReads', { keyPath: ['uid', 'messageId'] });
                }
                if (!database.objectStoreNames.contains('files')) {
                    database.createObjectStore('files', { keyPath: 'path' });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => {
                databasePromise = null;
                reject(request.error || new Error('Could not open this browser’s local database.'));
            };
            request.onblocked = () => {
                databasePromise = null;
                reject(new Error('The local database is blocked by another open page. Close other copies of the site and try again.'));
            };
        });
    }
    return databasePromise;
}

function readAll(database, storeName) {
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, 'readonly');
        const request = transaction.objectStore(storeName).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error(`Could not read local ${storeName} data.`));
        transaction.onabort = () => reject(transaction.error || new Error(`Could not read local ${storeName} data.`));
    });
}

function timestampMillis(value) {
    if (value instanceof Date) return value.getTime();
    if (value && typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value === 'number') return value;
    return 0;
}

function broadcastDatabaseChange() {
    window.dispatchEvent(new Event(databaseChangeEvent));
    try {
        localStorage.setItem(`${databaseChangeEvent}-signal`, `${Date.now()}-${crypto.randomUUID()}`);
    } catch (error) {
        console.warn('Could not notify other browser tabs about a local database update:', error);
    }
}

async function purgeExpiredData(database) {
    const now = Date.now();
    if (now - lastRetentionCheck < 60_000) return;
    if (retentionCheckPromise) return retentionCheckPromise;

    retentionCheckPromise = (async () => {
        const [messages, posts, files, reads] = await Promise.all([
            readAll(database, 'messages'),
            readAll(database, 'posts'),
            readAll(database, 'files'),
            readAll(database, 'messageReads')
        ]);
        const expiredMessageIds = new Set(
            messages.filter(item => timestampMillis(item.expiresAt) <= now).map(item => item.id)
        );
        const expiredPosts = posts.filter(item => timestampMillis(item.expiresAt) <= now);
        const expiredFiles = new Set(
            files.filter(item => timestampMillis(item.expiresAt) <= now).map(item => item.path)
        );

        for (const message of messages) {
            if (expiredMessageIds.has(message.id) && message.attachment?.storagePath) {
                expiredFiles.add(message.attachment.storagePath);
            }
        }
        for (const post of expiredPosts) {
            if (post.storagePath) expiredFiles.add(post.storagePath);
        }

        if (expiredMessageIds.size || expiredPosts.length || expiredFiles.size) {
            await new Promise((resolve, reject) => {
                const transaction = database.transaction(
                    ['messages', 'posts', 'messageReads', 'files'],
                    'readwrite'
                );
                const messageStore = transaction.objectStore('messages');
                const postStore = transaction.objectStore('posts');
                const readStore = transaction.objectStore('messageReads');
                const fileStore = transaction.objectStore('files');

                expiredMessageIds.forEach(id => messageStore.delete(id));
                expiredPosts.forEach(post => postStore.delete(post.id));
                reads.filter(read => expiredMessageIds.has(read.messageId)).forEach(read => {
                    readStore.delete([read.uid, read.messageId]);
                });
                expiredFiles.forEach(path => fileStore.delete(path));

                transaction.oncomplete = resolve;
                transaction.onerror = () => reject(transaction.error || new Error('Could not remove expired local data.'));
                transaction.onabort = () => reject(transaction.error || new Error('Could not remove expired local data.'));
            });

            expiredFiles.forEach(path => {
                const url = objectUrls.get(path);
                if (url) URL.revokeObjectURL(url);
                objectUrls.delete(path);
            });
            broadcastDatabaseChange();
        }
        lastRetentionCheck = now;
    })();

    try {
        await retentionCheckPromise;
    } finally {
        retentionCheckPromise = null;
    }
}

async function readyDatabase() {
    const database = await openDatabase();
    await purgeExpiredData(database);
    return database;
}

function runTransaction(database, storeNames, mode, operation) {
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(storeNames, mode);
        let result;
        try {
            result = operation(transaction);
        } catch (error) {
            transaction.abort();
            reject(error);
            return;
        }
        transaction.oncomplete = () => resolve(result && 'result' in result ? result.result : result);
        transaction.onerror = () => reject(transaction.error || new Error('The local database request failed.'));
        transaction.onabort = () => reject(transaction.error || new Error('The local database request was cancelled.'));
    });
}

function getCollectionStore(path) {
    if (path[0] === 'messages' && path.length === 1) return 'messages';
    if (path[0] === 'posts' && path.length === 1) return 'posts';
    if (path[0] === 'users' && path.length === 3 && path[2] === 'messageReads') return 'messageReads';
    throw new Error(`Unsupported local collection: ${path.join('/')}`);
}

function createSnapshot(items) {
    const docs = items.map(item => ({
        id: item.id || item.messageId,
        data: () => ({ ...item })
    }));
    return {
        docs,
        empty: docs.length === 0,
        forEach(callback) {
            docs.forEach(callback);
        }
    };
}

async function readQuery(queryReference) {
    const database = await readyDatabase();
    const storeName = getCollectionStore(queryReference.collection.path);
    let items = await readAll(database, storeName);

    if (storeName === 'messageReads') {
        const uid = queryReference.collection.path[1];
        items = items.filter(item => item.uid === uid);
    }

    for (const constraint of queryReference.constraints) {
        if (constraint.kind === 'where') {
            items = items.filter(item => {
                const value = timestampMillis(item[constraint.field]);
                const expected = timestampMillis(constraint.value);
                switch (constraint.operator) {
                    case '==': return item[constraint.field] === constraint.value;
                    case '>': return value > expected;
                    case '>=': return value >= expected;
                    case '<': return value < expected;
                    case '<=': return value <= expected;
                    default: throw new Error(`Unsupported local query operator: ${constraint.operator}`);
                }
            });
        }
    }

    const order = queryReference.constraints.find(item => item.kind === 'orderBy');
    if (order) {
        const direction = order.direction === 'desc' ? -1 : 1;
        items.sort((first, second) => (
            (timestampMillis(first[order.field]) - timestampMillis(second[order.field])) * direction
        ));
    }

    const firstLimit = queryReference.constraints.find(item => item.kind === 'limit');
    const lastLimit = queryReference.constraints.find(item => item.kind === 'limitToLast');
    if (firstLimit) items = items.slice(0, firstLimit.count);
    if (lastLimit) items = items.slice(-lastLimit.count);
    return createSnapshot(items);
}

function dateFiveYearsAfter(date) {
    const expiresAt = new Date(date.getTime());
    expiresAt.setFullYear(expiresAt.getFullYear() + retentionYears);
    return expiresAt;
}

export const localDatabaseReady = true;

export const auth = {
    currentUser: null,
    ready: null,
    listeners: new Set()
};

auth.ready = (async () => {
    try {
        const uid = localStorage.getItem(sessionStorageKey);
        if (!uid) return null;
        const database = await readyDatabase();
        const accounts = await readAll(database, 'accounts');
        const account = accounts.find(item => item.uid === uid);
        auth.currentUser = account ? toPublicUser(account) : null;
        if (!account) localStorage.removeItem(sessionStorageKey);
        return auth.currentUser;
    } catch (error) {
        console.error('Could not restore the browser-local sign-in session:', error);
        return null;
    }
})();

function toPublicUser(account) {
    return {
        uid: account.uid,
        email: account.email,
        displayName: account.displayName,
        photoURL: account.photoURL || ''
    };
}

function notifyAuthListeners(user) {
    auth.currentUser = user;
    auth.listeners.forEach(listener => listener(user));
}

export function onAuthStateChanged(authInstance, next, errorCallback) {
    if (authInstance !== auth || typeof next !== 'function') {
        throw new TypeError('A valid local authentication instance and listener are required.');
    }
    let active = true;
    const listener = user => {
        if (active) next(user);
    };
    auth.listeners.add(listener);
    auth.ready.then(user => {
        if (active) next(auth.currentUser || user);
    }).catch(error => {
        if (active && errorCallback) errorCallback(error);
    });
    const onStorage = event => {
        if (event.key !== sessionStorageKey) return;
        void (async () => {
            try {
                const database = await readyDatabase();
                const accounts = await readAll(database, 'accounts');
                const account = accounts.find(item => item.uid === event.newValue);
                notifyAuthListeners(account ? toPublicUser(account) : null);
            } catch (error) {
                if (errorCallback) errorCallback(error);
            }
        })();
    };
    window.addEventListener('storage', onStorage);
    return () => {
        active = false;
        auth.listeners.delete(listener);
        window.removeEventListener('storage', onStorage);
    };
}

async function hashPassword(password, salt) {
    if (!crypto.subtle) throw new Error('Secure password hashing requires HTTPS or localhost.');
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(password),
        'PBKDF2',
        false,
        ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits({
        name: 'PBKDF2',
        salt,
        iterations: 310_000,
        hash: 'SHA-256'
    }, key, 256);
    return Array.from(new Uint8Array(bits), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function createUserWithEmailAndPassword(authInstance, email, password) {
    if (authInstance !== auth) throw new TypeError('Invalid local authentication instance.');
    const normalizedEmail = email.trim().toLowerCase();
    const database = await readyDatabase();
    const existing = await runTransaction(database, ['accounts'], 'readonly', transaction => (
        transaction.objectStore('accounts').get(normalizedEmail)
    ));
    if (existing) throw authError('auth/email-already-in-use', 'An account with this email already exists.');
    if (password.length < 8) throw authError('auth/weak-password', 'Password must be at least 8 characters long.');

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const account = {
        uid: crypto.randomUUID(),
        email: normalizedEmail,
        displayName: '',
        photoURL: '',
        salt: Array.from(salt),
        passwordHash: await hashPassword(password, salt),
        createdAt: new Date()
    };
    await runTransaction(database, ['accounts'], 'readwrite', transaction => (
        transaction.objectStore('accounts').add(account)
    ));
    broadcastDatabaseChange();
    return { user: toPublicUser(account) };
}

export async function signInWithEmailAndPassword(authInstance, email, password) {
    if (authInstance !== auth) throw new TypeError('Invalid local authentication instance.');
    const normalizedEmail = email.trim().toLowerCase();
    const database = await readyDatabase();
    const account = await runTransaction(database, ['accounts'], 'readonly', transaction => (
        transaction.objectStore('accounts').get(normalizedEmail)
    ));
    if (!account) throw authError('auth/user-not-found', 'Invalid email or password.');
    const candidateHash = await hashPassword(password, new Uint8Array(account.salt));
    if (candidateHash !== account.passwordHash) throw authError('auth/wrong-password', 'Invalid email or password.');
    const user = toPublicUser(account);
    localStorage.setItem(sessionStorageKey, user.uid);
    notifyAuthListeners(user);
    return { user };
}

export async function signOut(authInstance) {
    if (authInstance !== auth) throw new TypeError('Invalid local authentication instance.');
    localStorage.removeItem(sessionStorageKey);
    notifyAuthListeners(null);
}

export async function updateProfile(user, profile) {
    const database = await readyDatabase();
    const accounts = await readAll(database, 'accounts');
    const account = accounts.find(item => item.uid === user.uid);
    if (!account) throw authError('auth/user-not-found', 'The local account could not be found.');
    Object.assign(account, profile);
    await runTransaction(database, ['accounts'], 'readwrite', transaction => (
        transaction.objectStore('accounts').put(account)
    ));
    const updatedUser = toPublicUser(account);
    if (auth.currentUser?.uid === updatedUser.uid) notifyAuthListeners(updatedUser);
    broadcastDatabaseChange();
}

export async function getLocalDatabase() {
    return readyDatabase();
}

export async function getLocalFileStore() {
    return readyDatabase();
}

export function collection(database, ...segments) {
    if (!database || segments.length === 0) throw new Error('A local database and collection path are required.');
    const path = segments.flatMap(segment => (
        typeof segment === 'object' && segment.path ? segment.path.split('/') : [String(segment)]
    ));
    getCollectionStore(path);
    return { kind: 'collection', path };
}

export function doc(parent, ...segments) {
    const basePath = parent?.path
        ? parent.path.split('/')
        : [];
    const path = [...basePath, ...segments.map(String)];
    if (path.length < 2 || path.length % 2 !== 0) {
        throw new Error(`Invalid local document path: ${path.join('/')}`);
    }
    return { kind: 'document', path };
}

export function query(collectionReference, ...constraints) {
    if (!collectionReference || collectionReference.kind !== 'collection') {
        throw new TypeError('A local collection is required to create a query.');
    }
    return { collection: collectionReference, constraints };
}

export function where(field, operator, value) {
    return { kind: 'where', field, operator, value };
}

export function orderBy(field, direction = 'asc') {
    return { kind: 'orderBy', field, direction };
}

export function limit(count) {
    return { kind: 'limit', count };
}

export function limitToLast(count) {
    return { kind: 'limitToLast', count };
}

export function serverTimestamp() {
    return new Date();
}

export async function addDoc(collectionReference, data) {
    const database = await readyDatabase();
    const storeName = getCollectionStore(collectionReference.path);
    const now = data.createdAt instanceof Date ? data.createdAt : new Date();
    const id = crypto.randomUUID();
    const record = { ...data, id, createdAt: now, expiresAt: dateFiveYearsAfter(now) };
    if (storeName === 'messageReads') {
        record.uid = collectionReference.path[1];
        record.messageId = id;
    }
    await runTransaction(database, [storeName], 'readwrite', transaction => (
        transaction.objectStore(storeName).add(record)
    ));
    broadcastDatabaseChange();
    return { id };
}

export async function deleteDoc(documentReference) {
    const database = await readyDatabase();
    const storeName = getCollectionStore(documentReference.path.slice(0, -1));
    const id = documentReference.path[documentReference.path.length - 1];
    await runTransaction(database, [storeName], 'readwrite', transaction => (
        transaction.objectStore(storeName).delete(
            storeName === 'messageReads'
                ? [documentReference.path[1], id]
                : id
        )
    ));
    broadcastDatabaseChange();
}

export async function setDoc(documentReference, data) {
    const database = await readyDatabase();
    const storeName = getCollectionStore(documentReference.path.slice(0, -1));
    const id = documentReference.path[documentReference.path.length - 1];
    const record = storeName === 'messageReads'
        ? { ...data, uid: documentReference.path[1], messageId: id }
        : { ...data, id };
    await runTransaction(database, [storeName], 'readwrite', transaction => (
        transaction.objectStore(storeName).put(record)
    ));
    broadcastDatabaseChange();
}

export function onSnapshot(queryReference, next, errorCallback) {
    if (!queryReference?.collection || typeof next !== 'function') {
        throw new TypeError('A local query and listener are required.');
    }
    let active = true;
    let refreshing = false;
    let refreshRequested = false;
    const refresh = () => {
        if (!active) return;
        if (refreshing) {
            refreshRequested = true;
            return;
        }
        refreshing = true;
        void readQuery(queryReference).then(snapshot => {
            if (active) next(snapshot);
        }).catch(error => {
            if (active && errorCallback) errorCallback(error);
            else if (active) console.error('Could not read the browser-local database:', error);
        }).finally(() => {
            refreshing = false;
            if (refreshRequested) {
                refreshRequested = false;
                refresh();
            }
        });
    };
    window.addEventListener(databaseChangeEvent, refresh);
    refresh();
    return () => {
        active = false;
        window.removeEventListener(databaseChangeEvent, refresh);
    };
}

export function ref(storage, path) {
    if (!storage || typeof path !== 'string' || !path) throw new Error('A local storage path is required.');
    return { storage, path };
}

export async function uploadBytes(reference, file, metadata = {}) {
    const database = await readyDatabase();
    const createdAt = new Date();
    const fileRecord = {
        path: reference.path,
        blob: file,
        name: file.name || reference.path.split('/').pop(),
        contentType: metadata.contentType || file.type || 'application/octet-stream',
        createdAt,
        expiresAt: dateFiveYearsAfter(createdAt)
    };
    await runTransaction(database, ['files'], 'readwrite', transaction => (
        transaction.objectStore('files').put(fileRecord)
    ));
    broadcastDatabaseChange();
    return { ref: reference, metadata: fileRecord };
}

export function uploadBytesResumable(reference, file, metadata = {}) {
    let stateChanged;
    let rejected;
    let completed;
    let settled = false;
    const task = {
        snapshot: { ref: reference, bytesTransferred: 0, totalBytes: file.size },
        on(eventName, onProgress, onError, onComplete) {
            if (eventName !== 'state_changed') throw new Error(`Unsupported local upload event: ${eventName}`);
            stateChanged = onProgress;
            rejected = onError;
            completed = onComplete;
            queueMicrotask(() => {
                if (settled) return;
                stateChanged?.({ ...task.snapshot, bytesTransferred: 0 });
                uploadBytes(reference, file, metadata).then(() => {
                    settled = true;
                    stateChanged?.({ ...task.snapshot, bytesTransferred: file.size });
                    completed?.();
                }).catch(error => {
                    settled = true;
                    rejected?.(error);
                });
            });
            return () => { settled = true; };
        }
    };
    return task;
}

export async function getDownloadURL(reference) {
    return `local-file:///${encodeURIComponent(reference.path)}`;
}

export async function getObjectURLFromURL(downloadUrl) {
    const parsedUrl = new URL(downloadUrl);
    if (parsedUrl.protocol !== 'local-file:') {
        throw new Error('The file URL does not belong to this browser-local database.');
    }
    return getObjectURL({ path: decodeURIComponent(parsedUrl.pathname).replace(/^\/+/, '') });
}

export async function getObjectURL(reference) {
    const cachedUrl = objectUrls.get(reference.path);
    if (cachedUrl) return cachedUrl;
    const database = await readyDatabase();
    const fileRecord = await runTransaction(database, ['files'], 'readonly', transaction => (
        transaction.objectStore('files').get(reference.path)
    ));
    if (!fileRecord) throw new Error('This file is no longer available in the browser-local database.');
    const objectUrl = URL.createObjectURL(fileRecord.blob);
    objectUrls.set(reference.path, objectUrl);
    return objectUrl;
}

export async function deleteObject(reference) {
    const database = await readyDatabase();
    await runTransaction(database, ['files'], 'readwrite', transaction => (
        transaction.objectStore('files').delete(reference.path)
    ));
    const objectUrl = objectUrls.get(reference.path);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrls.delete(reference.path);
    broadcastDatabaseChange();
}

window.addEventListener('storage', event => {
    if (event.key === `${databaseChangeEvent}-signal`) {
        window.dispatchEvent(new Event(databaseChangeEvent));
    }
});

window.setInterval(() => {
    if (document.visibilityState !== 'hidden') {
        void openDatabase()
            .then(purgeExpiredData)
            .catch(error => console.error('Could not remove expired browser-local data:', error));
    }
}, 60 * 60 * 1000);
