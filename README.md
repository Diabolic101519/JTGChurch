# JTGChurch

Website for Jesus True Gospel Church.

## Features

- Church information pages with shared navigation and responsive styling.
- Login and sign-up forms embedded on the home page, beside the welcome message on desktop and stacked on smaller screens.
- A standalone login and sign-up page at [`auth.html`](./auth.html).
- Local account storage using the browser's built-in IndexedDB, shared by both login interfaces.
- Passwords stored as salted PBKDF2 hashes.
- Sign Up creates an account with a name, email, and password. Email addresses are normalized to lowercase; passwords must be at least eight characters. Invalid form entries, storage errors, and duplicate email attempts are reported in a centered, accessible dialog.
- A successful sign-up displays a confirmation dialog with a checkmark and switches to Login. Login errors, including missing accounts and incorrect passwords, are reported in the dialog as "Invalid Email/ Password"; custom validation prevents browser-native validation popups.
- Successful login saves the signed-in user's name and email in the current browser session, then redirects to the home page. The home-page login and sign-up card is hidden while signed in, and the user's name appears in the upper-right navigation.
- The Activity navigation link is disabled while signed out and enabled for a valid signed-in session. Opening `activities.html` directly while signed out redirects to `auth.html`.
- Hover over or keyboard-focus the signed-in name to reveal Log Out; the account control works independently of the page navigation menu.
- Logging out clears the current browser session and returns to the home page, where login and sign-up are available and Activity is disabled again.
- The navigation also provides access to About Us, Church's, and Contact Us.
- Pages apply a restrictive Content Security Policy and a strict cross-origin referrer policy.

## Run locally

Open the project with a local web server, such as VS Code Live Server, or deploy it to a static hosting provider. No backend or package installation is required. Use HTTPS or localhost so the browser can provide the required Web Crypto API.

## Security and availability

The Content Security Policy limits scripts, styles, forms, frames, and connections to this site; the church hero image is allowed from Unsplash. The referrer policy limits URL details shared with other origins. These page-level policies complement, but do not replace, HTTP response headers.

For production hosting, enforce HTTPS and configure response headers where the host supports them, including `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, a `frame-ancestors` Content Security Policy, and an appropriate `Permissions-Policy`. GitHub Pages does not read a repository `_headers` file, so those headers must be configured through a hosting provider or fronting CDN that supports them.

DoS protection cannot be implemented in static page code. Use the hosting provider or a CDN with DDoS mitigation, traffic filtering, and rate limiting. IndexedDB accounts and browser session state are client-side demo functionality, not trusted authentication; do not use them to authorize private data or server-side actions.
