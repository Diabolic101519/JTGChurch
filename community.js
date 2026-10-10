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
    uploadBytes,
    uploadBytesResumable
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-storage.js';
import {
    onDisconnect,
    onValue,
    ref as databaseRef,
    serverTimestamp as databaseServerTimestamp,
    set
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js';
import { db, realtimeDb, storage } from './firebase.js';

const maximumUploadBytes = 150 * 1000 * 1000;
const maximumMessengerVideoBytes = 50 * 1000 * 1000;
const maximumProfilePhotoBytes = 5 * 1024 * 1024;
const defaultProfilePhoto = 'images/default-avatar.svg';

function isTrustedProfilePhoto(photoURL) {
    if (typeof photoURL !== 'string' || !photoURL) return false;
    try {
        const url = new URL(photoURL);
        return url.protocol === 'https:' && url.hostname === 'firebasestorage.googleapis.com';
    } catch {
        return false;
    }
}

function createAvatar(photoURL, name, className) {
    const avatar = document.createElement('img');
    avatar.className = className;
    avatar.src = isTrustedProfilePhoto(photoURL) ? photoURL : defaultProfilePhoto;
    avatar.alt = `${name} profile photo`;
    avatar.loading = 'lazy';
    avatar.addEventListener('error', () => {
        if (avatar.getAttribute('src') !== defaultProfilePhoto) {
            avatar.src = defaultProfilePhoto;
        }
    }, { once: true });
    return avatar;
}

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

function formatFileSize(size) {
    if (size < 1000 * 1000) return `${Math.max(1, Math.round(size / 1000))} KB`;
    return `${(size / (1000 * 1000)).toFixed(1)} MB`;
}

function createMessengerWidget() {
    const widget = document.createElement('div');
    widget.className = 'messenger-widget';

    const toggle = document.createElement('button');
    toggle.className = 'messenger-toggle';
    toggle.type = 'button';
    toggle.setAttribute('aria-label', 'Open Messenger');
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
    title.textContent = 'Messenger';
    titleGroup.append(title);
    const onlineUsers = document.createElement('div');
    onlineUsers.className = 'messenger-online-users';
    onlineUsers.setAttribute('aria-label', 'Online members');
    onlineUsers.setAttribute('aria-live', 'polite');

    const close = document.createElement('button');
    close.className = 'messenger-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Close Messenger');
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
    messageList.setAttribute('aria-label', 'Messenger messages');
    messageList.setAttribute('aria-live', 'polite');
    messageList.setAttribute('aria-relevant', 'additions');

    const attachmentPicker = document.createElement('div');
    attachmentPicker.className = 'messenger-attachment-picker';
    const selectedAttachment = document.createElement('div');
    selectedAttachment.className = 'messenger-selected-attachment';
    selectedAttachment.hidden = true;

    let selectedFile = null;
    let previewUrl = null;
    const showSelectedFile = file => {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = null;
        selectedAttachment.replaceChildren();
        selectedFile = file;
        if (!file) {
            selectedAttachment.hidden = true;
            return;
        }

        if (file.type.startsWith('image/')) {
            const preview = document.createElement('img');
            preview.className = 'messenger-attachment-preview';
            preview.src = URL.createObjectURL(file);
            preview.alt = '';
            preview.loading = 'eager';
            previewUrl = preview.src;
            selectedAttachment.append(preview);
        }
        const fileName = document.createElement('span');
        fileName.textContent = `${file.name} (${formatFileSize(file.size)})`;
        selectedAttachment.append(fileName);
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.setAttribute('aria-label', 'Remove attachment');
        remove.textContent = '\u00d7';
        remove.addEventListener('click', () => showSelectedFile(null));
        selectedAttachment.append(remove);
        selectedAttachment.hidden = false;
    };

    const attachmentButtons = [
        { label: 'File', icon: '\u{1f4ce}', accept: '' },
        { label: 'Image', icon: '\u{1f5bc}', accept: 'image/*' },
        { label: 'Video', icon: '\u{1f3ac}', accept: 'video/*' }
    ];
    attachmentButtons.forEach(({ label, icon, accept }) => {
        const picker = document.createElement('input');
        picker.type = 'file';
        picker.hidden = true;
        picker.accept = accept;
        picker.setAttribute('aria-label', `Choose ${label.toLowerCase()} attachment`);
        picker.addEventListener('change', () => {
            const file = picker.files && picker.files[0];
            if (!file) return;
            if (file.type.startsWith('video/') && file.size > maximumMessengerVideoBytes) {
                setStatus(status, 'Messenger videos must be 50 MB or smaller.');
                picker.value = '';
                return;
            }
            setStatus(status, '');
            showSelectedFile(file);
            picker.value = '';
        });
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'messenger-attachment-button';
        button.setAttribute('aria-label', `Attach ${label.toLowerCase()}`);
        button.title = `Attach ${label.toLowerCase()}`;
        button.textContent = icon;
        button.addEventListener('click', () => picker.click());
        attachmentPicker.append(button, picker);
    });

    const form = document.createElement('form');
    form.className = 'messenger-form';
    const messageInput = document.createElement('textarea');
    messageInput.id = 'messenger-message';
    messageInput.name = 'message';
    messageInput.maxLength = 2000;
    messageInput.rows = 1;
    messageInput.placeholder = 'Aa';
    messageInput.setAttribute('aria-label', 'Write a message');

    const sendButton = document.createElement('button');
    sendButton.type = 'submit';
    sendButton.setAttribute('aria-label', 'Send message');
    sendButton.textContent = 'Send';
    form.append(messageInput, sendButton);
    panel.append(header, onlineUsers, status, messageList, selectedAttachment, attachmentPicker, form);
    widget.append(toggle, panel);
    document.body.append(widget);

    let unreadCount = 0;
    const setOpen = open => {
        panel.hidden = !open;
        toggle.setAttribute('aria-expanded', String(open));
        toggle.setAttribute('aria-label', open ? 'Close Messenger' : 'Open Messenger');
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
        onlineUsers,
        status,
        messageList,
        messageInput,
        form,
        unreadBadge,
        get selectedFile() {
            return selectedFile;
        },
        clearSelectedFile() {
            showSelectedFile(null);
        },
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

    const avatar = createAvatar(message.photoURL, message.displayName, 'chat-message-avatar');
    const bubble = document.createElement('div');
    bubble.className = 'chat-message-bubble';
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
    bubble.append(header);
    if (message.body) bubble.append(body);

    if (message.attachment) {
        const attachmentUrl = new URL(message.attachment.downloadUrl);
        if (attachmentUrl.protocol !== 'https:' || attachmentUrl.hostname !== 'firebasestorage.googleapis.com') {
            throw new Error(`Message ${documentSnapshot.id} has an invalid attachment URL.`);
        }
        if (message.attachment.contentType.startsWith('image/')) {
            const image = document.createElement('img');
            image.className = 'chat-message-attachment';
            image.src = attachmentUrl.href;
            image.alt = message.attachment.name;
            image.loading = 'lazy';
            bubble.append(image);
        } else if (message.attachment.contentType.startsWith('video/')) {
            const video = document.createElement('video');
            video.className = 'chat-message-attachment';
            video.src = attachmentUrl.href;
            video.controls = true;
            video.preload = 'metadata';
            video.playsInline = true;
            video.setAttribute('aria-label', message.attachment.name);
            bubble.append(video);
        } else {
            const fileLink = document.createElement('a');
            fileLink.className = 'chat-message-file';
            fileLink.href = attachmentUrl.href;
            fileLink.target = '_blank';
            fileLink.rel = 'noopener noreferrer';
            fileLink.download = message.attachment.name;
            fileLink.textContent = `\u{1f4ce} ${message.attachment.name} (${formatFileSize(message.attachment.size)})`;
            bubble.append(fileLink);
        }
    }

    item.append(avatar, bubble);
    return item;
}

function initializePresence(currentUser, messenger) {
    if (!realtimeDb) {
        const status = document.createElement('span');
        status.className = 'messenger-presence-unavailable';
        status.textContent = 'Online status unavailable';
        messenger.onlineUsers.append(status);
        return () => {};
    }

    const presenceRoot = databaseRef(realtimeDb, 'presence');
    const ownPresence = databaseRef(realtimeDb, `presence/${currentUser.uid}`);
    const connectedRef = databaseRef(realtimeDb, '.info/connected');
    const displayName = (currentUser.displayName || currentUser.email || 'Church member').slice(0, 100);
    const photoURL = isTrustedProfilePhoto(currentUser.photoURL) ? currentUser.photoURL : '';
    const subscriptions = [];

    subscriptions.push(onValue(presenceRoot, snapshot => {
        const onlineMembers = [];
        snapshot.forEach(member => {
            const profile = member.val();
            if (profile && profile.state === 'online') {
                onlineMembers.push({ uid: member.key, ...profile });
            }
        });
        onlineMembers.sort((first, second) => first.displayName.localeCompare(second.displayName));
        messenger.onlineUsers.replaceChildren();
        const onlineLabel = document.createElement('span');
        onlineLabel.className = 'messenger-online-count';
        onlineLabel.textContent = `${onlineMembers.length} online`;
        messenger.onlineUsers.append(onlineLabel);

        onlineMembers.slice(0, 8).forEach(member => {
            const avatarWrap = document.createElement('span');
            avatarWrap.className = 'messenger-online-avatar';
            avatarWrap.title = `${member.displayName} is online`;
            avatarWrap.append(createAvatar(member.photoURL, member.displayName, 'online-member-photo'));
            const indicator = document.createElement('span');
            indicator.className = 'online-indicator';
            indicator.setAttribute('aria-hidden', 'true');
            avatarWrap.append(indicator);
            messenger.onlineUsers.append(avatarWrap);
        });
        if (onlineMembers.length > 8) {
            const more = document.createElement('span');
            more.className = 'messenger-online-more';
            more.textContent = `+${onlineMembers.length - 8}`;
            messenger.onlineUsers.append(more);
        }
        messenger.onlineUsers.setAttribute('aria-label', `${onlineMembers.length} church members online`);
    }, error => {
        console.error('Could not load online church members:', error);
        setStatus(messenger.status, 'Online member status is unavailable. Check your Firebase Realtime Database rules.');
    }));

    subscriptions.push(onValue(connectedRef, async snapshot => {
        if (snapshot.val() !== true) return;
        try {
            await onDisconnect(ownPresence).set({
                state: 'offline',
                displayName,
                photoURL,
                lastChanged: databaseServerTimestamp()
            });
            await set(ownPresence, {
                state: 'online',
                displayName,
                photoURL,
                lastChanged: databaseServerTimestamp()
            });
        } catch (error) {
            console.error('Could not publish online status:', error);
            setStatus(messenger.status, 'Could not update your online status. Check Firebase Realtime Database rules.');
        }
    }, error => {
        console.error('Could not connect to Firebase Realtime Database:', error);
        setStatus(messenger.status, 'Online member status is unavailable. Configure Firebase Realtime Database.');
    }));

    return () => {
        subscriptions.forEach(unsubscribe => unsubscribe());
        set(ownPresence, {
            state: 'offline',
            displayName,
            photoURL,
            lastChanged: databaseServerTimestamp()
        }).then(() => onDisconnect(ownPresence).cancel()).catch(error => {
            console.error('Could not clear online status:', error);
        });
    };
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
    const unsubscribeMessages = onSnapshot(messagesQuery, snapshot => {
        const shouldScroll = firstSnapshot || messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight < 80;
        const visibleMessageIds = new Set();
        messageList.replaceChildren();
        snapshot.forEach(documentSnapshot => {
            try {
                messageList.append(createChatMessage(documentSnapshot, currentUser));
            } catch (error) {
                console.error(`Could not display message ${documentSnapshot.id}:`, error);
            }
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
        const file = messenger.selectedFile;
        if (!body && !file) {
            setStatus(status, 'Write a message or attach a file before sending.');
            messageInput.focus();
            return;
        }
        if (body.length > 2000) {
            setStatus(status, 'Messages must be 2,000 characters or fewer.');
            return;
        }
        if (file && file.size === 0) {
            setStatus(status, 'Choose a file that is not empty.');
            return;
        }
        if (file && file.type.startsWith('video/') && file.size > maximumMessengerVideoBytes) {
            setStatus(status, 'Messenger videos must be 50 MB or smaller.');
            return;
        }

        const sendButton = messageForm.querySelector('button[type="submit"]');
        if (sendButton) sendButton.disabled = true;
        setStatus(status, 'Sending message…', 'progress');
        let uploadedReference = null;
        try {
            let attachment;
            if (file) {
                const storagePath = `messages/${currentUser.uid}/${crypto.randomUUID()}`;
                uploadedReference = ref(storage, storagePath);
                await uploadBytes(uploadedReference, file, {
                    contentType: file.type || 'application/octet-stream'
                });
                attachment = {
                    name: file.name.slice(0, 255),
                    contentType: file.type || 'application/octet-stream',
                    size: file.size,
                    storagePath,
                    downloadUrl: await getDownloadURL(uploadedReference)
                };
            }

            const message = {
                uid: currentUser.uid,
                displayName: (currentUser.displayName || currentUser.email || 'Church member').slice(0, 100),
                photoURL: isTrustedProfilePhoto(currentUser.photoURL) ? currentUser.photoURL : '',
                body,
                createdAt: serverTimestamp()
            };
            if (attachment) message.attachment = attachment;
            try {
                await addDoc(collection(db, 'messages'), message);
            } catch (error) {
                if (uploadedReference) {
                    try {
                        await deleteObject(uploadedReference);
                    } catch (cleanupError) {
                        console.error('Could not remove an attachment after its message failed to send:', cleanupError);
                        throw new Error('Your message could not be sent, and its uploaded attachment could not be removed.');
                    }
                }
                throw error;
            }
            messageForm.reset();
            messenger.clearSelectedFile();
            setStatus(status, 'Message sent.', 'success');
        } catch (error) {
            setStatus(status, `Could not send the message. ${getCommunityError(error)}`);
        } finally {
            if (sendButton) sendButton.disabled = false;
        }
    });

    const stopPresence = initializePresence(currentUser, messenger);
    let stopped = false;
    return () => {
        if (stopped) return;
        stopped = true;
        unsubscribeMessages();
        stopPresence();
        messenger.clearSelectedFile();
        messenger.widget.remove();
    };
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
    if (!feed || !db) return () => {};

    const postsQuery = query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(30));
    return onSnapshot(postsQuery, snapshot => {
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
    if (!uploadForm || !fileInput || !captionInput || !progress || !storage || !db) return () => {};

    const onFileChange = () => {
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
    };
    fileInput.addEventListener('change', onFileChange);

    const onSubmit = async event => {
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
    };
    uploadForm.addEventListener('submit', onSubmit);

    if (feedStatus) setStatus(feedStatus, '');
    return () => {
        fileInput.removeEventListener('change', onFileChange);
        uploadForm.removeEventListener('submit', onSubmit);
    };
}

export function initializeCommunity(currentUser) {
    const hasActivityFeed = Boolean(document.getElementById('activity-feed'));
    if (hasActivityFeed && (!db || !storage)) {
        throw new Error('Firebase Firestore and Storage are not configured.');
    }

    const cleanups = [];
    const chatCleanup = initializeChat(currentUser);
    if (chatCleanup) cleanups.push(chatCleanup);
    if (hasActivityFeed) {
        cleanups.push(initializeActivityFeed());
        cleanups.push(initializePostUpload(currentUser));
    }
    return () => cleanups.forEach(cleanup => cleanup());
}
