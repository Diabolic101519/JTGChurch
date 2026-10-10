import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import { auth, firebaseConfigured, firebaseSetupMessage } from './firebase.js';
import { initializeAuthForms } from './auth.js';

const currentPage = window.location.pathname.split('/').pop() || 'index.html';
const links = document.querySelectorAll('nav a');
const menu = document.getElementById('nav-menu');
const toggle = document.getElementById('menu-toggle');
const accountMenu = document.getElementById('account-menu');
const accountName = document.getElementById('account-name');
const logoutButton = document.getElementById('logout-button');
const homeAuthCard = document.querySelector('.home-auth-card');
const heroLayout = document.getElementById('hero-layout');
const activityLinks = document.querySelectorAll('nav a[href="activities.html"]');
const setupStatus = document.getElementById('firebase-setup-status');
let communityUid = null;
let communityCleanup = null;
let communityInitializationId = 0;

const activeLink = document.querySelector(`nav a[href="${currentPage}"]`);
if (activeLink) activeLink.classList.add('active');

initializeAuthForms();

if (toggle && menu) {
    toggle.addEventListener('click', () => {
        const isOpen = menu.classList.toggle('show');
        toggle.textContent = isOpen ? '\u00d7' : '\u2630';
        toggle.setAttribute('aria-expanded', String(isOpen));
        toggle.setAttribute('aria-label', isOpen ? 'Close navigation menu' : 'Open navigation menu');
    });
}

links.forEach(link => {
    link.addEventListener('click', event => {
        if (link.getAttribute('aria-disabled') === 'true') {
            event.preventDefault();
            return;
        }
        links.forEach(item => item.classList.remove('active'));
        link.classList.add('active');

        if (window.innerWidth <= 768 && menu && toggle) {
            menu.classList.remove('show');
            toggle.textContent = '\u2630';
            toggle.setAttribute('aria-expanded', 'false');
            toggle.setAttribute('aria-label', 'Open navigation menu');
        }
    });
});

if (accountMenu && accountName) {
    const setAccountMenuExpanded = expanded => {
        accountName.setAttribute('aria-expanded', String(expanded));
    };

    accountMenu.addEventListener('mouseenter', () => setAccountMenuExpanded(true));
    accountMenu.addEventListener('mouseleave', () => setAccountMenuExpanded(false));
    accountMenu.addEventListener('focusin', () => setAccountMenuExpanded(true));
    accountMenu.addEventListener('focusout', event => {
        if (!accountMenu.contains(event.relatedTarget)) {
            setAccountMenuExpanded(false);
        }
    });
}

if (logoutButton && auth) {
    logoutButton.addEventListener('click', async () => {
        try {
            if (communityCleanup) {
                communityCleanup();
                communityCleanup = null;
                communityUid = null;
            }
            await signOut(auth);
            window.location.href = 'index.html';
        } catch (error) {
            console.error('Firebase sign out failed:', error);
            if (auth.currentUser) updateSignedInInterface(auth.currentUser);
            window.alert('Could not log out. Please try again.');
        }
    });
}

function showFirebaseSetupMessage() {
    if (setupStatus) {
        setupStatus.hidden = false;
        setupStatus.textContent = firebaseSetupMessage;
    }
    document.querySelectorAll('.community-form input, .community-form textarea, .community-form button')
        .forEach(control => { control.disabled = true; });
}

function updateSignedInInterface(user) {
    if (!user) {
        communityInitializationId += 1;
        if (communityCleanup) communityCleanup();
        communityCleanup = null;
        communityUid = null;
    }

    activityLinks.forEach(link => {
        link.setAttribute('aria-disabled', String(!user));
        if (user) link.removeAttribute('tabindex');
        else link.tabIndex = -1;
    });

    if (accountMenu && accountName) {
        accountMenu.hidden = !user;
        if (user) accountName.textContent = user.displayName || user.email || 'Church member';
    }

    if (homeAuthCard && heroLayout) {
        homeAuthCard.hidden = Boolean(user);
        heroLayout.classList.toggle('is-signed-in', Boolean(user));
    }

    const authSection = document.querySelector('.auth-section');
    const signedInNotice = document.getElementById('signed-in-notice');
    if (authSection && signedInNotice) {
        authSection.hidden = Boolean(user);
        signedInNotice.hidden = !user;
    }

    if (setupStatus && user) setupStatus.hidden = true;

    if (user && communityUid !== user.uid) {
        if (communityCleanup) communityCleanup();
        communityCleanup = null;
        communityUid = user.uid;
        const initializationId = ++communityInitializationId;
        import('./community.js')
            .then(async ({ initializeCommunity }) => {
                if (initializationId !== communityInitializationId || auth.currentUser?.uid !== user.uid) return;
                const cleanup = await initializeCommunity(user);
                if (initializationId !== communityInitializationId || auth.currentUser?.uid !== user.uid) {
                    cleanup();
                    return;
                }
                communityCleanup = cleanup;
            })
            .catch(error => {
                if (initializationId !== communityInitializationId) return;
                console.error('Could not initialize Messenger and activity posts:', error);
                if (setupStatus) {
                    setupStatus.hidden = false;
                    setupStatus.textContent = 'Could not load Messenger or activity posts. Refresh the page and try again.';
                }
            });
    }

    if (currentPage === 'activities.html') {
        if (!user) {
            if (firebaseConfigured) window.location.replace('auth.html');
            return;
        }
    }
}

if (!firebaseConfigured || !auth) {
    showFirebaseSetupMessage();
    updateSignedInInterface(null);
} else {
    onAuthStateChanged(auth, updateSignedInInterface, error => {
        console.error('Firebase authentication state could not be loaded:', error);
        if (setupStatus) {
            setupStatus.hidden = false;
            setupStatus.textContent = 'Could not verify your sign-in. Check your connection and refresh the page.';
        }
        if (currentPage === 'activities.html') window.location.replace('auth.html');
    });
}
