# JTGChurch

Website for Jesus True Gospel Church.

## Features

- Church information pages with shared navigation and responsive styling.
- Login and sign-up forms on [`auth.html`](./auth.html).
- Local account storage using the browser's built-in IndexedDB.
- Passwords stored as salted PBKDF2 hashes; login state is kept for the browser session and can be cleared with Log Out.

## Run locally

Open the project with a local web server, such as VS Code Live Server, or deploy it to a static hosting provider. No backend or package installation is required. Use HTTPS or localhost so the browser can provide the required Web Crypto API.

## Account storage limitations

Accounts and sessions are stored only in the current browser on the current device. They are not synchronized, recoverable, or verified by a server. Clearing the browser's site data removes locally stored accounts. This client-side demo is not secure authentication and must not be used to protect private data or authorize server-side actions; use a trusted authentication service and backend for that.
