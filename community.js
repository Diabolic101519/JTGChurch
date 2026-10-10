import {
    addDoc,
    collection,
    limit,
    limitToLast,
    onSnapshot,
    orderBy,
    query,
    serverTimestamp
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import {
    deleteObject,
    getDownloadURL,
    ref,
    uploadBytesResumable
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-storage.js';
import { db, storage } from './firebase.js';

const maximumUploadBytes = 150 * 1000 * 1000;

function setStatus(element, message, state = 'error') {
    if (!element) return;
    element.textContent = message;
    element.dataset.state = state;
    element.hidden = !message;
}

function getCommunityError(error) {
    switch (error.code) {
        case 'permission-denied':
        case 'storage/unauthorized':
            return 'Your account is not allowed to do that. Check that Firebase rules are deployed.';
        case 'storage/canceled':
            return 'The upload was canceled.';
        case 'storage/quota-exceeded':
            return 'Firebase Storage has reached its quota.';
        case 'unavailable':
        case 'storage/retry-limit-exceeded':
            return 'The service is temporarily unavailable. Check your connection and try again.';
        default:
            console.error('Church community request failed:', error);
            return 'The request failed. Check your connection and Firebase setup, then try again.';
    }
}

function formatDate(timestamp) {
    if (!timestamp || typeof timestamp.toDate !== 'function') return 'Just now';
    return timestamp.toDate().toLocaleString();
}

function createMessengerWidget() {
    const widget = document.createElement('div');
    widget.className = 'messenger-widget';

    const toggle = document.createElement('button');
    toggle.className = 'messenger-toggle';
    toggle.type = 'button';
    toggle.setAttribute('aria-label', 'Open church chat');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', 'messenger-panel');
    toggle.setAttribute('aria-haspopup', 'dialog');
    const toggleIcon = document.createElement('span');
    toggleIcon.className = 'messenger-toggle-icon';
    toggleIcon.setAttribute('aria-hidden', 'true');
    toggleIcon.textContent = '\u{1f4ac}';
    const unreadBadge = document.createElement('span');
    unreadBadge.className = 'messenger-unread';
    unreadBadge.setAttribute('aria-label', 'Unread messages');
    unreadBadge.hidden = true;
    toggle.append(toggleIcon, unreadBadge);

    const panel = document.createElement('section');
    panel.id = 'messenger-panel';
    panel.className = 'messenger-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-labelledby', 'messenger-title');
    panel.hidden = true;

    const header = document.createElement('header');
    header.className = 'messenger-header';
    const titleGroup = document.createElement('div');
    const title = document.createElement('h2');
    title.id = 'messenger-title';
    title.textContent = 'Church Chat';
    const subtitle = document.createElement('p');
    subtitle.textContent = 'Church-wide conversation';
    titleGroup.append(title, subtitle);

    const close = document.createElement('button');
    close.className = 'messenger-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Close church chat');
    close.textContent = '\u00d7';
    header.append(titleGroup, close);

    const status = document.createElement('div');
    status.className = 'messenger-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.hidden = true;

    const messageList = document.createElement('ol');
    messageList.id = 'messenger-messages';
    messageList.className = 'messenger-messages';
    messageList.setAttribute('aria-label', 'Church chat messages');
    messageList.setAttribute('aria-live', 'polite');
    messageList.setAttribute('aria-relevant', 'additions');

    const form = document.createElement('form');
    form.className = 'messenger-form';
    const messageInput = document.createElement('textarea');
    messageInput.id = 'messenger-message';
    messageInput.name = 'message';
    messageInput.maxLength = 2000;
    messageInput.rows = 1;
    messageInput.placeholder = 'Aa';
    messageInput.setAttribute('aria-label', 'Write a message');
    messageInput.required = true;

    const sendButton = document.createElement('button');
    sendButton.type = 'submit';
    sendButton.setAttribute('aria-label', 'Send message');
    sendButton.textContent = 'Send';
    form.append(messageInput, sendButton);
    panel.append(header, status, messageList, form);
    widget.append(toggle, panel);
    document.body.append(widget);

    let unreadCount = 0;
    const setOpen = open => {
        panel.hidden = !open;
        toggle.setAttribute('aria-expanded', String(open));
        toggle.setAttribute('aria-label', open ? 'Close church chat' : 'Open church chat');
        widget.classList.toggle('is-open', open);
        if (open) {
            unreadCount = 0;
            unreadBadge.hidden = true;
            unreadBadge.textContent = '';
            messageInput.focus();
            messageList.scrollTop = messageList.scrollHeight;
        }
    };

    toggle.addEventListener('click', () => setOpen(panel.hidden));
    close.addEventListener('click', () => {
        setOpen(false);
        toggle.focus();
    });
    panel.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            setOpen(false);
            toggle.focus();
        }
    });

    return {
        widget,
        toggle,
        panel,
        status,
        messageList,
        messageInput,
        form,
        unreadBadge,
        addUnreadMessage() {
            unreadCount += 1;
            unreadBadge.textContent = unreadCount > 9 ? '9+' : String(unreadCount);
            unreadBadge.hidden = false;
        }
    };
}

function createChatMessage(documentSnapshot, currentUser) {
    const message = documentSnapshot.data();
    const item = document.createElement('li');
    item.className = 'chat-message';
    item.dataset.own = String(message.uid === currentUser.uid);

    const header = document.createElement('div');
    header.className = 'chat-message-header';
    const author = document.createElement('span');
    author.textContent = message.displayName;
    const sentAt = document.createElement('time');
    sentAt.textContent = formatDate(message.createdAt);
    header.append(author, sentAt);

    const body = document.createElement('div');
    body.className = 'chat-message-body';
    body.textContent = message.body;
    item.append(header, body);
    return item;
}

function initializeChat(currentUser) {
    if (!db) return;
    const messenger = createMessengerWidget();
    const {
        toggle,
        panel,
        status,
        messageList,
        messageInput,
        form: messageForm
    } = messenger;

    const messagesQuery = query(
        collection(db, 'messages'),
        orderBy('createdAt', 'asc'),
        limitToLast(100)
    );
    let firstSnapshot = true;
    const seenMessageIds = new Set();
    onSnapshot(messagesQuery, snapshot => {
        const shouldScroll = firstSnapshot || messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight < 80;
        const visibleMessageIds = new Set();
        messageList.replaceChildren();
        snapshot.forEach(documentSnapshot => {
            messageList.append(createChatMessage(documentSnapshot, currentUser));
            const isNewMessage = !seenMessageIds.has(documentSnapshot.id);
            seenMessageIds.add(documentSnapshot.id);
            visibleMessageIds.add(documentSnapshot.id);
            if (!firstSnapshot && isNewMessage && documentSnapshot.data().uid !== currentUser.uid && panel.hidden) {
                messenger.addUnreadMessage();
            }
        });
        seenMessageIds.forEach(id => {
            if (!visibleMessageIds.has(id)) seenMessageIds.delete(id);
        });
        if (snapshot.empty) {
            const emptyState = document.createElement('li');
            emptyState.textContent = 'No messages yet. Start the conversation.';
            messageList.append(emptyState);
        }
        if (shouldScroll) messageList.scrollTop = messageList.scrollHeight;
        firstSnapshot = false;
    }, error => {
        setStatus(status, `Could not load chat messages. ${getCommunityError(error)}`);
    });

    messageForm.addEventListener('submit', async event => {
        event.preventDefault();
        const body = messageInput.value.trim();
        if (!body) {
            setStatus(status, 'Write a message before sending.');
            messageInput.focus();
            return;
        }
        if (body.length > 2000) {
            setStatus(status, 'Messages must be 2,000 characters or fewer.');
            return;
        }

        const sendButton = messageForm.querySelector('button[type="submit"]');
        if (sendButton) sendButton.disabled = true;
        setStatus(status, 'Sending message…', 'progress');
        try {
            await addDoc(collection(db, 'messages'), {
                uid: currentUser.uid,
                displayName: (currentUser.displayName || currentUser.email || 'Church member').slice(0, 100),
                body,
                createdAt: serverTimestamp()
            });
            messageForm.reset();
            setStatus(status, 'Message sent.', 'success');
        } catch (error) {
            setStatus(status, `Could not send the message. ${getCommunityError(error)}`);
        } finally {
            if (sendButton) sendButton.disabled = false;
        }
    });
}

function createActivityPost(documentSnapshot) {
    const post = documentSnapshot.data();
    const card = document.createElement('article');
    card.className = 'activity-post';

    const mediaUrl = new URL(post.downloadUrl);
    if (mediaUrl.protocol !== 'https:' || mediaUrl.hostname !== 'firebasestorage.googleapis.com') {
        throw new Error(`Post ${documentSnapshot.id} has an invalid media URL.`);
    }

    const media = document.createElement(post.contentType.startsWith('video/') ? 'video' : 'img');
    media.src = mediaUrl.href;
    if (media instanceof HTMLVideoElement) {
        media.controls = true;
        media.preload = 'metadata';
        media.playsInline = true;
    } else {
        media.alt = post.caption || `Photo shared by ${post.displayName}`;
        media.loading = 'lazy';
    }

    const content = document.createElement('div');
    content.className = 'activity-post-content';
    const author = document.createElement('h3');
    author.textContent = post.displayName;
    content.append(author);

    if (post.caption) {
        const caption = document.createElement('p');
        caption.textContent = post.caption;
        content.append(caption);
    }

    const createdAt = document.createElement('time');
    createdAt.dateTime = post.createdAt && typeof post.createdAt.toDate === 'function'
        ? post.createdAt.toDate().toISOString()
        : '';
    createdAt.textContent = formatDate(post.createdAt);
    content.append(createdAt);
    card.append(media, content);
    return card;
}

function initializeActivityFeed() {
    const feed = document.getElementById('activity-feed');
    const status = document.getElementById('feed-status');
    if (!feed || !db) return;

    const postsQuery = query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(30));
    onSnapshot(postsQuery, snapshot => {
        feed.replaceChildren();
        snapshot.forEach(documentSnapshot => {
            try {
                feed.append(createActivityPost(documentSnapshot));
            } catch (error) {
                console.error('Could not display activity post:', error);
                setStatus(status, 'One of the activity posts could not be displayed.');
            }
        });

        if (snapshot.empty) {
            const emptyState = document.createElement('p');
            emptyState.className = 'activity-feed-empty';
            emptyState.textContent = 'No activity posts yet. Share a photo or video with the church.';
            feed.append(emptyState);
        }
    }, error => {
        setStatus(status, `Could not load activity posts. ${getCommunityError(error)}`);
    });
}

function initializePostUpload(currentUser) {
    const uploadForm = document.getElementById('upload-form');
    const fileInput = document.getElementById('activity-file');
    const captionInput = document.getElementById('activity-caption');
    const progress = document.getElementById('upload-progress');
    const status = document.getElementById('upload-status');
    const feedStatus = document.getElementById('feed-status');
    if (!uploadForm || !fileInput || !captionInput || !progress || !storage || !db) return;

    fileInput.addEventListener('change', () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) {
            setStatus(status, '');
            return;
        }
        if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
            setStatus(status, 'Choose an image or video file.');
        } else if (file.size > maximumUploadBytes) {
            setStatus(status, 'The selected file is larger than the 150 MB upload limit.');
        } else {
            setStatus(status, '');
        }
    });

    uploadForm.addEventListener('submit', async event => {
        event.preventDefault();
        const file = fileInput.files && fileInput.files[0];
        if (!file) {
            setStatus(status, 'Choose an image or video file to upload.');
            fileInput.focus();
            return;
        }
        if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
            setStatus(status, 'Choose an image or video file.');
            return;
        }
        if (file.size > maximumUploadBytes) {
            setStatus(status, 'The selected file is larger than the 150 MB upload limit.');
            return;
        }

        const uploadButton = uploadForm.querySelector('button[type="submit"]');
        const caption = captionInput.value.trim().slice(0, 500);
        const displayName = (currentUser.displayName || currentUser.email || 'Church member').slice(0, 100);
        const storagePath = `posts/${currentUser.uid}/${crypto.randomUUID()}`;
        const storageReference = ref(storage, storagePath);
        if (uploadButton) uploadButton.disabled = true;
        progress.hidden = false;
        progress.value = 0;
        setStatus(status, 'Uploading: 0%. Keep this page open until the upload finishes.', 'progress');

        let uploadedReference = null;
        try {
            const task = uploadBytesResumable(storageReference, file, { contentType: file.type });
            uploadedReference = await new Promise((resolve, reject) => {
                task.on('state_changed', snapshot => {
                    const percentage = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
                    progress.value = percentage;
                    setStatus(status, `Uploading: ${percentage}%. Keep this page open until the upload finishes.`, 'progress');
                }, reject, () => resolve(task.snapshot.ref));
            });

            const downloadUrl = await getDownloadURL(uploadedReference);
            try {
                await addDoc(collection(db, 'posts'), {
                    uid: currentUser.uid,
                    displayName,
                    caption,
                    storagePath,
                    downloadUrl,
                    contentType: file.type,
                    createdAt: serverTimestamp()
                });
            } catch (error) {
                try {
                    await deleteObject(uploadedReference);
                } catch (cleanupError) {
                    console.error('Could not remove uploaded media after its post failed to save:', cleanupError);
                    throw new Error('The post could not be saved, and its uploaded file could not be cleaned up. Contact the site administrator.');
                }
                throw error;
            }

            uploadForm.reset();
            progress.value = 100;
            setStatus(status, 'Your post was shared with the church.', 'success');
        } catch (error) {
            setStatus(status, `Could not upload the post. ${getCommunityError(error)}`);
        } finally {
            if (uploadButton) uploadButton.disabled = false;
            if (!uploadedReference) progress.hidden = true;
        }
    });

    if (feedStatus) setStatus(feedStatus, '');
}

export function initializeCommunity(currentUser) {
    initializeChat(currentUser);
    if (document.getElementById('activity-feed')) {
        if (!db || !storage) {
            throw new Error('Firebase Firestore and Storage are not configured.');
        }
        initializeActivityFeed();
        initializePostUpload(currentUser);
    }
}
