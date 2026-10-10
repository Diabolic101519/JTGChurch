# JTGChurch

Website for Jesus True Gospel Church.

## Features

- Church information pages with shared navigation and responsive styling.
- Login and sign-up forms embedded on the home page, beside the welcome message on desktop and stacked on smaller screens.
- A standalone login and sign-up page at [`auth.html`](./auth.html).
- Firebase Authentication with email/password sign-in and named member accounts.
- Sign Up creates an account with a name, email, and password. Email addresses are normalized to lowercase; passwords must be at least eight characters. Invalid form entries, Firebase errors, and duplicate email attempts are reported in a centered, accessible dialog.
- A successful sign-up displays a confirmation dialog with a checkmark and switches to Login. Login errors, including missing accounts and incorrect passwords, are reported without revealing whether an email is registered; custom validation prevents browser-native validation popups.
- Successful login redirects to the home page, hides the login card, and shows the member's name in the navigation.
- The Activity navigation link is disabled while signed out and enabled for a valid Firebase session. Opening `activities.html` directly while signed out redirects to `auth.html`.
- Signed-in members can open a floating Messenger from any page to send text, image, video, or file attachments and see online members with profile photos or a default avatar.
- Incoming messages remain unread until a member marks them read. Members can delete their own messages for everyone.
- Messenger video attachments are limited to 50 MB; other Messenger attachments have no additional app-imposed size limit. Activity feed image/video uploads remain limited to 150 MB.
- New members can optionally upload a profile photo (up to 5 MB), which is used in chat and presence.
- Activity uploads have a 150 MB per-file limit, show upload progress, and are restricted to images and videos by Firebase Storage rules.
- Hover over or keyboard-focus the signed-in name to reveal Log Out; the account control works independently of the page navigation menu.
- Logging out ends the Firebase session and returns to the home page, where login and sign-up are available and Activity is disabled again.
- The navigation also provides access to About Us, Church's, and Contact Us.
- Pages apply a restrictive Content Security Policy and a strict cross-origin referrer policy.

## Firebase setup

The site needs a Firebase project before sign-in, chat, or uploads can work:

1. Create a Firebase project and register a Web app in the Firebase console.
2. Enable **Authentication → Sign-in method → Email/Password**.
3. Create a Cloud Firestore database, a Cloud Storage bucket, and a Firebase Realtime Database for online-member presence.
4. For Firebase Hosting, deploy the site to your Firebase project; the app automatically discovers its Web app config from Firebase Hosting's reserved `/__/firebase/init.json` endpoint. For other hosts, copy the Web app settings into `firebase-config.js`. The browser or operating system cannot determine a Firebase project on its own.
5. Install the Firebase CLI, select your project with `firebase use --add`, then deploy the included security rules with `firebase deploy --only firestore:rules,database,storage:rules`.
6. Serve the site over HTTPS (or localhost) so Firebase Authentication and browser security APIs work. To host with Firebase Hosting, run `firebase deploy --only hosting` after selecting the project.

The Firestore rules allow signed-in members to read shared messages and posts, restrict deletion to the message sender, and store each member's read receipts in their own private collection. Storage rules require the uploader's own account folder, restrict Activity posts to images/videos up to 150,000,000 bytes (150 MB), and enforce a 50,000,000-byte (50 MB) limit for Messenger videos; other Messenger file types have no app-imposed size cap. Profile pictures are limited to 5 MB. Client checks provide feedback, while Firebase rules enforce these limits and permissions if a client bypasses the page. Presence uses one connection entry per browser session so multiple open tabs do not incorrectly mark a member offline. It also needs the Realtime Database URL in the Firebase Hosting app config or `firebase-config.js`; if it is missing, chat remains available and shows that online status is unavailable.

Existing accounts created by the earlier browser-local demo are not transferred to Firebase. Members need to create new accounts after Firebase is configured. Firebase Storage usage and uploads can incur charges; configure project budgets and monitor usage.

## Run locally

Open the project with a local web server, such as VS Code Live Server, or deploy it to a static hosting provider. The Firebase JavaScript SDK is loaded from Google's CDN; no local package installation is required. Use HTTPS or localhost.

## Security and availability

The Content Security Policy limits scripts, styles, forms, frames, and connections to this site and the Firebase services needed for sign-in, chat, and media. The church hero image is allowed from Unsplash. The referrer policy limits URL details shared with other origins. These page-level policies complement, but do not replace, HTTP response headers.

For production hosting, enforce HTTPS and configure response headers where the host supports them, including `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, a `frame-ancestors` Content Security Policy, and an appropriate `Permissions-Policy`. GitHub Pages does not read a repository `_headers` file, so those headers must be configured through a hosting provider or fronting CDN that supports them.

DoS protection and chat moderation cannot be implemented in static page code. Use the hosting provider or a CDN with DDoS mitigation, traffic filtering, and rate limiting, and monitor Firebase quotas and billing.
