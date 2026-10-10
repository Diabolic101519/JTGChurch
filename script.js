const currentPage = window.location.pathname.split('/').pop() || 'index.html';
const links = document.querySelectorAll('nav a');
const menu = document.getElementById('nav-menu');
const toggle = document.getElementById('menu-toggle');
const accountMenu = document.getElementById('account-menu');
const accountName = document.getElementById('account-name');
const logoutButton = document.getElementById('logout-button');
const authContent = document.getElementById('auth-content');
const homeAuthCard = document.querySelector('.home-auth-card');
const heroLayout = document.getElementById('hero-layout');
const activityLinks = document.querySelectorAll('nav a[href="activities.html"]');
let isSignedIn = false;

const activeLink = document.querySelector(`nav a[href="${currentPage}"]`);
if (activeLink) {
    activeLink.classList.add('active');
}

activityLinks.forEach(link => {
    link.setAttribute('aria-disabled', 'true');
    link.tabIndex = -1;
    link.addEventListener('click', event => {
        if (link.getAttribute('aria-disabled') === 'true') {
            event.preventDefault();
        }
    });
});

if (toggle && menu) {
    toggle.addEventListener('click', () => {
        const isOpen = menu.classList.toggle('show');
        toggle.textContent = isOpen ? '\u00d7' : '\u2630';
        toggle.setAttribute('aria-expanded', String(isOpen));
        toggle.setAttribute('aria-label', isOpen ? 'Close navigation menu' : 'Open navigation menu');
    });
}

links.forEach(link => {
    link.addEventListener('click', function () {
        if (this.getAttribute('aria-disabled') === 'true') return;

        links.forEach(item => item.classList.remove('active'));
        this.classList.add('active');

        if (window.innerWidth <= 768 && menu && toggle) {
            menu.classList.remove('show');
            toggle.textContent = '\u2630';
            toggle.setAttribute('aria-expanded', 'false');
            toggle.setAttribute('aria-label', 'Open navigation menu');
        }
    });
});

const storedUser = sessionStorage.getItem('jtg-church-user');
if (storedUser && accountMenu && accountName) {
    try {
        const user = JSON.parse(storedUser);
        if (typeof user.name === 'string' && user.name.trim() && typeof user.email === 'string') {
            isSignedIn = true;
            activityLinks.forEach(link => {
                link.setAttribute('aria-disabled', 'false');
                link.removeAttribute('tabindex');
            });
            accountName.textContent = user.name;
            accountMenu.hidden = false;
            if (authContent && homeAuthCard && heroLayout) {
                authContent.hidden = true;
                homeAuthCard.hidden = true;
                heroLayout.classList.add('is-signed-in');
            }
        } else {
            sessionStorage.removeItem('jtg-church-user');
        }
    } catch {
        sessionStorage.removeItem('jtg-church-user');
    }
}

if (currentPage === 'activities.html' && !isSignedIn) {
    window.location.replace('auth.html');
}

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

if (logoutButton) {
    logoutButton.addEventListener('click', () => {
        sessionStorage.removeItem('jtg-church-user');
        window.location.href = 'index.html';
    });
}
