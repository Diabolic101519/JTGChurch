const currentPage = window.location.pathname.split('/').pop() || 'index.html';
const links = document.querySelectorAll('nav a');
const menu = document.getElementById('nav-menu');
const toggle = document.getElementById('menu-toggle');

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
