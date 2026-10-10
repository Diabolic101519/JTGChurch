import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    updateProfile
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import { auth, getFirebaseStorage } from './firebase.js';

const maximumProfilePhotoBytes = 5 * 1024 * 1024;

const authDialog = document.getElementById('auth-dialog');
const authDialogMessage = document.getElementById('auth-dialog-message');
const authDialogTitle = document.getElementById('auth-dialog-title');
const authDialogIcon = document.getElementById('auth-dialog-icon');
const loginTab = document.getElementById('login-tab');
const signupTab = document.getElementById('signup-tab');
const loginPanel = document.getElementById('login-panel');
const signupPanel = document.getElementById('signup-panel');

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
        if (!authDialog.open) {
            try {
                authDialog.showModal();
            } catch (error) {
                console.error('Could not show the authentication dialog:', error);
                authDialog.setAttribute('open', '');
            }
        }
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

function getAuthErrorMessage(error, action) {
    switch (error.code) {
        case 'auth/email-already-in-use':
            return 'An account with this email already exists. Try logging in instead.';
        case 'auth/invalid-credential':
        case 'auth/user-not-found':
        case 'auth/wrong-password':
            return 'Invalid email or password.';
        case 'auth/invalid-email':
            return 'Please enter a valid email address.';
        case 'auth/weak-password':
            return 'Password must be at least 8 characters long.';
        case 'auth/operation-not-allowed':
            return 'Email and password sign-in is not enabled for this Firebase project.';
        case 'auth/too-many-requests':
            return 'Too many attempts. Please wait a while and try again.';
        case 'auth/network-request-failed':
            return 'Could not reach the sign-in service. Check your connection and try again.';
        default:
            console.error(`Firebase ${action} failed:`, error);
            return `Could not ${action}. Please try again.`;
    }
}

function showPanel(panelName) {
    const isLogin = panelName === 'login';
    if (loginPanel) loginPanel.hidden = !isLogin;
    if (signupPanel) signupPanel.hidden = isLogin;
    if (loginTab) loginTab.setAttribute('aria-selected', String(isLogin));
    if (signupTab) signupTab.setAttribute('aria-selected', String(!isLogin));
}

export function initializeAuthForms() {
    if (loginTab) loginTab.addEventListener('click', () => showPanel('login'));
    if (signupTab) signupTab.addEventListener('click', () => showPanel('signup'));

    const signupForm = document.getElementById('signup-form');
    if (signupForm) {
        signupForm.addEventListener('submit', async event => {
            event.preventDefault();
            if (!validateForm(signupForm)) return;
            if (!auth) {
                showPopup('Firebase is not configured yet. Follow the Firebase setup steps in README.md.');
                return;
            }

            const formData = new FormData(signupForm);
            const email = String(formData.get('email')).trim().toLowerCase();
            const name = String(formData.get('name')).trim();
            const password = String(formData.get('password'));
            const photo = formData.get('photo');
            if (!name) {
                showPopup('Please enter your name.');
                document.getElementById('signup-name')?.focus();
                return;
            }
            if (photo instanceof File && photo.size > maximumProfilePhotoBytes) {
                showPopup('Profile pictures must be 5 MB or smaller.');
                document.getElementById('signup-photo')?.focus();
                return;
            }
            if (photo instanceof File && photo.size > 0 && !photo.type.startsWith('image/')) {
                showPopup('Choose an image for your profile picture.');
                document.getElementById('signup-photo')?.focus();
                return;
            }

            const submitButton = signupForm.querySelector('button[type="submit"]');
            if (submitButton) submitButton.disabled = true;
            let photoWarning = '';
            let profilePhotoReference = null;
            try {
                const credential = await createUserWithEmailAndPassword(auth, email, password);
                let photoURL = '';
                if (photo instanceof File && photo.size > 0) {
                    const storage = await getFirebaseStorage();
                    if (!storage) {
                        photoWarning = ' Your account was created, but profile photo storage is not configured.';
                    } else {
                        const { deleteObject, getDownloadURL, ref, uploadBytes } =
                            await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-storage.js');
                        profilePhotoReference = ref(storage, `profiles/${credential.user.uid}/avatar`);
                        try {
                            await uploadBytes(profilePhotoReference, photo, { contentType: photo.type });
                            photoURL = await getDownloadURL(profilePhotoReference);
                        } catch (error) {
                            console.error('Could not upload the new member profile photo:', error);
                            photoWarning = ' Your account was created, but the profile photo could not be uploaded.';
                            if (profilePhotoReference) {
                                try {
                                    await deleteObject(profilePhotoReference);
                                } catch (cleanupError) {
                                    console.error('Could not clean up the failed profile photo upload:', cleanupError);
                                }
                            }
                        }
                    }
                }
                try {
                    await updateProfile(credential.user, { displayName: name, photoURL });
                } catch (error) {
                    console.error('Could not save the new member profile:', error);
                    photoWarning = ' Your account was created, but its profile details could not be saved.';
                }
                try {
                    await signOut(auth);
                } catch (error) {
                    console.error('Could not sign out after account creation:', error);
                }
                signupForm.reset();
                const loginEmail = document.getElementById('login-email');
                if (loginEmail) loginEmail.value = email;
                showPanel('login');
                showPopup(`Your account is ready. You can now log in.${photoWarning}`, 'success');
            } catch (error) {
                showPopup(getAuthErrorMessage(error, 'create the account'));
            } finally {
                if (submitButton) submitButton.disabled = false;
            }
        });
    }

    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', async event => {
            event.preventDefault();
            if (!validateForm(loginForm)) return;
            if (!auth) {
                showPopup('Firebase is not configured yet. Follow the Firebase setup steps in README.md.');
                return;
            }

            const formData = new FormData(loginForm);
            const email = String(formData.get('email')).trim().toLowerCase();
            const password = String(formData.get('password'));

            const submitButton = loginForm.querySelector('button[type="submit"]');
            if (submitButton) submitButton.disabled = true;
            try {
                await signInWithEmailAndPassword(auth, email, password);
                window.location.href = 'index.html';
            } catch (error) {
                showPopup(getAuthErrorMessage(error, 'log in'));
            } finally {
                if (submitButton) submitButton.disabled = false;
            }
        });
    }

}
