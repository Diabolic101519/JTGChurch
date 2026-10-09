# JTGChurch

Website for Jesus True Gospel Church.

## Features

- Church information pages with shared navigation and responsive styling.
- Login and sign-up forms embedded on the home page, beside the welcome message on desktop and stacked on smaller screens.
- A standalone login and sign-up page at [`auth.html`](./auth.html).
- Local account storage using the browser's built-in IndexedDB, shared by both login interfaces.
- Passwords stored as salted PBKDF2 hashes.
- Successful login redirects to the home page. The signed-in user's name appears in the upper-right navigation on every page.
- Hover over or keyboard-focus the account name to reveal the Log Out control. Logging out clears the current browser session; the account dropdown works independently of the page navigation menu.
- Unsuccessful login and attempts to sign up with an existing email show popup messages.

## Run locally

Open the project with a local web server, such as VS Code Live Server, or deploy it to a static hosting provider. No backend or package installation is required. Use HTTPS or localhost so the browser can provide the required Web Crypto API.
