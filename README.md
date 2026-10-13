# JTGChurch

Website for Jesus True Gospel Church.

## Features

- Church information pages with shared navigation and responsive styling.
- Login and sign-up forms embedded on the home page, beside the welcome message on desktop and stacked on smaller screens.
- A standalone login and sign-up page at [`auth.html`](./auth.html).
- Browser-local email/password sign-in and named member accounts.
- Sign Up creates an account with a name, email, and password. Email addresses are normalized to lowercase; passwords must be at least eight characters. Passwords are salted and hashed in the browser. Invalid form entries and duplicate email attempts are reported in a centered, accessible dialog.
- A successful sign-up displays a confirmation dialog with a checkmark and switches to Login. Login errors, including missing accounts and incorrect passwords, are reported without revealing whether an email is registered; custom validation prevents browser-native validation popups.
- Successful login redirects to the home page, hides the login card, and shows the member's name in the navigation.
- The Activity navigation link is disabled while signed out and enabled for a valid local session. Opening `activities.html` directly while signed out redirects to `auth.html`.
- Signed-in members can open a floating Messenger from any page to send text, image, video, or file attachments and see profile photos or a default avatar.
- Incoming messages remain unread until a member marks them read. Members can delete their own messages for everyone.
- Messenger video attachments are limited to 50 MB; other Messenger attachments have no additional app-imposed size limit. Activity feed image/video uploads remain limited to 150 MB.
- New members can optionally upload a profile photo (up to 5 MB), which is used in chat.
- Activity uploads have a 150 MB per-file limit, show upload progress, and are restricted to images and videos.
- Hover over or keyboard-focus the signed-in name to reveal Log Out; the account control works independently of the page navigation menu.
- Logging out ends the local session and returns to the home page, where login and sign-up are available and Activity is disabled again.
- The navigation also provides access to About Us, Church's, and Contact Us.
- Pages apply a restrictive Content Security Policy and a strict cross-origin referrer policy.

## Browser-local data

The site uses IndexedDB in the current browser to store accounts, chat messages, read receipts, profile photos, and Activity uploads. No Firebase account or project configuration is needed. The site remains hosted on GitHub Pages.

This is intentionally a browser-only version: accounts, messages, and uploads are not shared with other visitors, browsers, or devices. Clearing this site's browser data or using private browsing can remove the local database. This client-side sign-in is for convenience, not secure identity verification; anyone with access to the browser profile can inspect or change its local data.

Messages and uploaded files expire five calendar years after creation. The app purges expired records when it is opened and periodically while it remains open; a closed browser cannot run cleanup, so expired data is removed the next time the app opens. Account records are not automatically deleted.

The local database uses the browser's available storage quota. Very large uploads may fail if the browser or device is low on space. Online presence across users is not available in browser-local mode.

To publish the site, open the GitHub repository's **Settings → Pages** and select **GitHub Actions** as the build and deployment source. The included workflow deploys each push to `main` to [https://diabolic101519.github.io/JTGChurch/](https://diabolic101519.github.io/JTGChurch/). GitHub Pages is free for public repositories on GitHub Free.

## Run locally

Open the project with a local web server, such as VS Code Live Server, or deploy it to GitHub Pages. No package installation or external backend is required. Use HTTPS or localhost.

## Security and availability

The Content Security Policy limits scripts, styles, forms, frames, and connections to this site. The church hero image is allowed from Unsplash. The referrer policy limits URL details shared with other origins. These page-level policies complement, but do not replace, HTTP response headers.

For production hosting, enforce HTTPS and configure response headers where the host supports them, including `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, a `frame-ancestors` Content Security Policy, and an appropriate `Permissions-Policy`. GitHub Pages does not read a repository `_headers` file, so those headers must be configured through a hosting provider or fronting CDN that supports them.

The browser-local database is not a shared service and does not provide server-side abuse prevention, moderation, or backups. Use a hosted backend if the site later needs shared accounts or data across visitors.
