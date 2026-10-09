const databaseName = 'jtg-church-accounts';
const databaseVersion = 1;
const passwordIterations = 310000;
const encoder = new TextEncoder();
const message = document.getElementById('auth-message');
const loginTab = document.getElementById('login-tab');
const signupTab = document.getElementById('signup-tab');
const loginPanel = document.getElementById('login-panel');
const signupPanel = document.getElementById('signup-panel');

function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(databaseName, databaseVersion);
        let blocked = false;

        request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains('accounts')) {
                database.createObjectStore('accounts', { keyPath: 'email' });
            }
        };
        request.onsuccess = () => {
            if (blocked) {
                request.result.close();
                return;
            }
            resolve(request.result);
        };
        request.onerror = () => reject(request.error || new Error('Could not open the account database.'));
        request.onblocked = () => {
            blocked = true;
            reject(new Error('The account database is blocked by another open page. Close other site tabs and try again.'));
        };
    });
}

function withAccountStore(mode, operation) {
    return openDatabase().then(database => new Promise((resolve, reject) => {
        const transaction = database.transaction('accounts', mode);
        const store = transaction.objectStore('accounts');
        let result;

        transaction.oncomplete = () => {
            database.close();
            resolve(result);
        };
        transaction.onerror = () => {
            database.close();
            reject(transaction.error || new Error('The account database operation failed.'));
        };
        transaction.onabort = () => {
            database.close();
            reject(transaction.error || new Error('The account database operation was cancelled.'));
        };

        try {
            operation(store, value => { result = value; });
        } catch (error) {
            database.close();
            reject(error);
        }
    }));
}

function findAccount(email) {
    return withAccountStore('readonly', (store, setResult) => {
        const request = store.get(email);
        request.onsuccess = () => setResult(request.result);
    });
}

function saveAccount(account) {
    return withAccountStore('readwrite', (store, setResult) => {
        const request = store.add(account);
        request.onsuccess = () => setResult(true);
        request.onerror = event => {
            if (request.error && request.error.name === 'ConstraintError') {
                event.preventDefault();
                event.stopPropagation();
                setResult(false);
            }
        };
    });
}

async function hashPassword(password, salt) {
    const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({
        name: 'PBKDF2',
        salt,
        iterations: passwordIterations,
        hash: 'SHA-256'
    }, key, 256);
    return Array.from(new Uint8Array(bits), byte => byte.toString(16).padStart(2, '0')).join('');
}

function setMessage(text, state) {
    message.textContent = text;
    message.dataset.state = state;
}

function normalizeEmail(email) {
    return email.trim().toLowerCase();
}

function bytesToHex(bytes) {
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
    if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) {
        throw new Error('The saved account data is invalid.');
    }
    return Uint8Array.from(hex.match(/.{2}/g), byte => parseInt(byte, 16));
}

function showPanel(panelName) {
    const isLogin = panelName === 'login';
    loginPanel.hidden = !isLogin;
    signupPanel.hidden = isLogin;
    loginTab.setAttribute('aria-selected', String(isLogin));
    signupTab.setAttribute('aria-selected', String(!isLogin));
    setMessage('', '');
}

loginTab.addEventListener('click', () => showPanel('login'));
signupTab.addEventListener('click', () => showPanel('signup'));

document.getElementById('signup-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const email = normalizeEmail(formData.get('email'));
    const name = formData.get('name').trim();
    const password = formData.get('password');

    try {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const account = {
            email,
            name,
            salt: bytesToHex(salt),
            passwordHash: await hashPassword(password, salt)
        };
        const saved = await saveAccount(account);
        if (!saved) {
            setMessage('An account with this email already exists.', 'error');
            return;
        }
        form.reset();
        document.getElementById('login-email').value = email;
        showPanel('login');
        setMessage('Account created. You can now log in.', 'success');
    } catch (error) {
        setMessage(error.message || 'Could not create the account. Please try again.', 'error');
    }
});

document.getElementById('login-form').addEventListener('submit', async event => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const email = normalizeEmail(formData.get('email'));

    try {
        const account = await findAccount(email);
        if (!account) {
            setMessage('No account was found.', 'error');
            return;
        }

        const hash = await hashPassword(formData.get('password'), hexToBytes(account.salt));
        if (hash !== account.passwordHash) {
            setMessage('The email or password is incorrect.', 'error');
            return;
        }

        sessionStorage.setItem('jtg-church-user', JSON.stringify({ email: account.email, name: account.name }));
        window.location.href = 'activities.html';
    } catch (error) {
        setMessage(error.message || 'Could not log in. Please try again.', 'error');
    }
});

if (!window.indexedDB || !window.crypto || !window.crypto.subtle) {
    document.querySelectorAll('.auth-form button').forEach(button => { button.disabled = true; });
    setMessage('Account storage requires, and a secure connection (HTTPS or localhost).', 'error');
}
