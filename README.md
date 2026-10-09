# JTGChurch
for Jesus True Gospel Church

## Local accounts

The Login / Sign Up page stores accounts in the browser's built-in IndexedDB. Passwords are stored as salted PBKDF2 hashes, not as plain text. Accounts and login sessions are local to the current browser/device; they are not synchronized or verified by a server. This is suitable only for a static-site demo and must not be used to protect server-side data or functionality.
