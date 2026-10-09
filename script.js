const currentPage = window.location.pathname.split('/').pop() || 'index.html';
const links = document.querySelectorAll('nav a');
const menu = document.getElementById('nav-menu');
const toggle = document.getElementById('menu-toggle');
const accountMenu = document.getElementById('account-menu');
const accountName = document.getElementById('account-name');
const logoutButton = document.getElementById('logout-button');
const authContent = document.getElementById('auth-content');
const homeSignedIn = document.getElementById('home-signed-in');
const homeSignedInName = document.getElementById('home-signed-in-name');

const activeLink = document.querySelector(`nav a[href="${currentPage}"]`);
if (activeLink) {
    activeLink.classList.add('active');
}

if (toggle && menu) {
    toggle.addEventListener('click', () => {
        menu.classList.toggle('show');
        toggle.innerHTML = menu.classList.contains('show') ? '&times;' : '&#9776;';
    });
}

links.forEach(link => {
    link.addEventListener('click', function () {
        links.forEach(item => item.classList.remove('active'));
        this.classList.add('active');

        if (window.innerWidth <= 768 && menu && toggle) {
            menu.classList.remove('show');
            toggle.innerHTML = '&#9776;';
        }
    });
});

const storedUser = sessionStorage.getItem('jtg-church-user');
if (storedUser && accountMenu && accountName) {
    try {
        const user = JSON.parse(storedUser);
        if (typeof user.name === 'string' && user.name.trim() && typeof user.email === 'string') {
            accountName.textContent = user.name;
            accountMenu.hidden = false;
            if (authContent) authContent.hidden = true;
            if (homeSignedIn && homeSignedInName) {
                homeSignedInName.textContent = user.name;
                homeSignedIn.hidden = false;
            }
        } else {
            sessionStorage.removeItem('jtg-church-user');
        }
    } catch {
        sessionStorage.removeItem('jtg-church-user');
    }
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
