const databaseName = 'jtg-church-accounts';
const databaseVersion = 1;
const passwordIterations = 310000;
const encoder = new TextEncoder();
const authDialog = document.getElementById('auth-dialog');
const authDialogMessage = document.getElementById('auth-dialog-message');
const authDialogTitle = document.getElementById('auth-dialog-title');
const authDialogIcon = document.getElementById('auth-dialog-icon');
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

function showPopup(text, type = 'error') {
    if (!authDialog || !authDialogMessage) {
        throw new Error('The authentication message dialog is unavailable.');
    }
    authDialog.dataset.state = type;
    authDialogMessage.textContent = text;
    if (authDialogTitle) {
        authDialogTitle.textContent = type === 'success' ? 'Account created' : 'Please check your details';
    }
    if (authDialogIcon) {
        authDialogIcon.textContent = type === 'success' ? '\u2713' : '!';
    }
    if (typeof authDialog.showModal === 'function') {
        if (!authDialog.open) authDialog.showModal();
    } else {
        authDialog.setAttribute('open', '');
    }
}

function validateForm(form) {
    if (form.checkValidity()) return true;

    const invalidField = form.querySelector(':invalid');
    if (!invalidField) return false;

    let text = 'Please check the information you entered.';
    if (invalidField.validity.valueMissing) {
        text = 'Please complete all required fields.';
    } else if (invalidField.validity.typeMismatch) {
        text = 'Please enter a valid email address.';
    } else if (invalidField.validity.tooShort) {
        text = `Password must be at least ${invalidField.minLength} characters long.`;
    }
    showPopup(text);
    invalidField.focus();
    return false;
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
    if (loginPanel) loginPanel.hidden = !isLogin;
    if (signupPanel) signupPanel.hidden = isLogin;
    if (loginTab) loginTab.setAttribute('aria-selected', String(isLogin));
    if (signupTab) signupTab.setAttribute('aria-selected', String(!isLogin));
}

if (loginTab) loginTab.addEventListener('click', () => showPanel('login'));
if (signupTab) signupTab.addEventListener('click', () => showPanel('signup'));

const signupForm = document.getElementById('signup-form');
if (signupForm) signupForm.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!validateForm(form)) return;
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
            showPopup('An account with this email already exists. Try logging in instead.');
            return;
        }
        form.reset();
        const loginEmail = document.getElementById('login-email');
        if (loginEmail) loginEmail.value = email;
        showPanel('login');
        showPopup('Your account is ready. You can now log in.', 'success');
    } catch (error) {
        showPopup(error.message || 'Could not create the account. Please try again.');
    }
});

const loginForm = document.getElementById('login-form');
if (loginForm) loginForm.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!validateForm(form)) return;
    const formData = new FormData(form);
    const email = normalizeEmail(formData.get('email'));

    try {
        const account = await findAccount(email);
        if (!account) {
            showPopup('Invalid Email/ Password');
            return;
        }

        const hash = await hashPassword(formData.get('password'), hexToBytes(account.salt));
        if (hash !== account.passwordHash) {
            showPopup('Invalid Email/ Password');
            return;
        }

        sessionStorage.setItem('jtg-church-user', JSON.stringify({ email: account.email, name: account.name }));
        window.location.href = 'index.html';
    } catch (error) {
        showPopup(error.message || 'Could not log in. Please try again.');
    }
});

if (!window.indexedDB || !window.crypto || !window.crypto.subtle) {
    document.querySelectorAll('.auth-form button').forEach(button => { button.disabled = true; });
    showPopup('Account storage requires a modern browser and a secure connection (HTTPS or localhost).');
}
