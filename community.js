import {
    addDoc,
    collection,
    deleteDoc,
    deleteObject,
    doc,
    getDownloadURL,
    getObjectURLFromURL,
    limit,
    limitToLast,
    onSnapshot,
    orderBy,
    query,
    ref,
    serverTimestamp,
    setDoc,
    uploadBytes,
    uploadBytesResumable,
    getLocalFileStore,
    getLocalDatabase,
    where
} from './local-db.js';

const maximumUploadBytes = 150 * 1000 * 1000;
const maximumMessengerVideoBytes = 50 * 1000 * 1000;
const defaultProfilePhoto = 'images/default-avatar.svg';

function isTrustedProfilePhoto(photoURL) {
    if (typeof photoURL !== 'string' || !photoURL) return false;
    try {
        const url = new URL(photoURL);
        return url.protocol === 'local-file:';
    } catch {
        return false;
    }
}

function createAvatar(photoURL, name, className) {
    const avatar = document.createElement('img');
    avatar.className = className;
    const localPhotoUrl = isTrustedProfilePhoto(photoURL) && new URL(photoURL).protocol === 'local-file:';
    avatar.src = isTrustedProfilePhoto(photoURL) && !localPhotoUrl ? photoURL : defaultProfilePhoto;
    avatar.alt = `${name} profile photo`;
    avatar.loading = 'lazy';
    if (localPhotoUrl) {
        getObjectURLFromURL(photoURL).then(url => { avatar.src = url; }).catch(error => {
            console.error('Could not load a browser-local profile photo:', error);
            avatar.src = defaultProfilePhoto;
        });
    }
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
            return 'Your browser did not allow access to its local database.';
        default:
            console.error('Browser-local church community request failed:', error);
            return error.name === 'QuotaExceededError'
                ? 'This browser is out of storage space. Remove some browser data or choose a smaller file and try again.'
                : 'The local database request failed. Check browser storage permissions and try again.';
    }
}

function formatDate(timestamp) {
    if (timestamp instanceof Date) return timestamp.toLocaleString();
    if (timestamp && typeof timestamp.toDate === 'function') return timestamp.toDate().toLocaleString();
    return 'Just now';
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

    const setOpen = open => {
        panel.hidden = !open;
        toggle.setAttribute('aria-expanded', String(open));
        toggle.setAttribute('aria-label', open ? 'Close Messenger' : 'Open Messenger');
        widget.classList.toggle('is-open', open);
        if (open) {
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
        setUnreadCount(count) {
            unreadBadge.textContent = count > 9 ? '9+' : String(count);
            unreadBadge.hidden = count === 0;
            unreadBadge.setAttribute('aria-label', `${count} unread messages`);
        }
    };
}

function createChatMessage(documentSnapshot, currentUser, readMessageIds, markAsRead, deleteMessage, status) {
    const message = documentSnapshot.data();
    const item = document.createElement('li');
    item.className = 'chat-message';
    const isOwnMessage = message.uid === currentUser.uid;
    item.dataset.own = String(isOwnMessage);

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

    const actions = document.createElement('div');
    actions.className = 'chat-message-actions';
    if (isOwnMessage) {
        const deleteButton = document.createElement('button');
        deleteButton.className = 'messenger-delete-message';
        deleteButton.type = 'button';
        deleteButton.textContent = 'Delete';
        deleteButton.setAttribute('aria-label', 'Delete your message');
        deleteButton.addEventListener('click', () => deleteMessage(documentSnapshot));
        actions.append(deleteButton);
    }

    if (message.attachment) {
        const attachmentUrl = new URL(message.attachment.downloadUrl);
        if (attachmentUrl.protocol !== 'local-file:') {
            throw new Error(`Message ${documentSnapshot.id} has an invalid attachment URL.`);
        }
        if (message.attachment.contentType.startsWith('image/')) {
            const image = document.createElement('img');
            image.className = 'chat-message-attachment';
            if (attachmentUrl.protocol === 'local-file:') {
                getObjectURLFromURL(message.attachment.downloadUrl).then(url => { image.src = url; }).catch(error => {
                    console.error('Could not load a browser-local message image:', error);
                });
            }
            image.alt = message.attachment.name;
            image.loading = 'lazy';
            bubble.append(image);
        } else if (message.attachment.contentType.startsWith('video/')) {
            const video = document.createElement('video');
            video.className = 'chat-message-attachment';
            if (attachmentUrl.protocol === 'local-file:') {
                getObjectURLFromURL(message.attachment.downloadUrl).then(url => { video.src = url; }).catch(error => {
                    console.error('Could not load a browser-local message video:', error);
                });
            }
            video.controls = true;
            video.preload = 'metadata';
            video.playsInline = true;
            video.setAttribute('aria-label', message.attachment.name);
            bubble.append(video);
        } else {
            const fileLink = document.createElement('a');
            fileLink.className = 'chat-message-file';
            fileLink.href = '#';
            fileLink.target = '_blank';
            fileLink.rel = 'noopener noreferrer';
            fileLink.download = message.attachment.name;
            fileLink.textContent = `\u{1f4ce} ${message.attachment.name} (${formatFileSize(message.attachment.size)})`;
            if (attachmentUrl.protocol === 'local-file:') {
                fileLink.addEventListener('click', async event => {
                    event.preventDefault();
                    try {
                        const url = await getObjectURLFromURL(message.attachment.downloadUrl);
                        const download = document.createElement('a');
                        download.href = url;
                        download.download = message.attachment.name;
                        download.click();
                    } catch (error) {
                        setStatus(status, `Could not open the attached file. ${getCommunityError(error)}`);
                    }
                });
            }
            bubble.append(fileLink);
        }
    }

    bubble.append(actions);
    item.append(avatar, bubble);
    bubble.addEventListener('click', () => {
        if (!isOwnMessage && item.dataset.read === 'false') {
            markAsRead(documentSnapshot.id);
        }
    });
    updateChatMessageReadState(
        item,
        documentSnapshot.id,
        readMessageIds.has(documentSnapshot.id),
        markAsRead
    );
    return item;
}

function updateChatMessageReadState(item, messageId, isRead, markAsRead) {
    item.dataset.read = String(isRead);
    if (item.dataset.own === 'true') return;

    const actions = item.querySelector('.chat-message-actions');
    const readState = document.createElement('span');
    readState.className = 'messenger-message-read-state';
    readState.textContent = isRead ? 'Read' : 'Unread';
    actions.replaceChildren(readState);
    if (!isRead) {
        const markReadButton = document.createElement('button');
        markReadButton.className = 'messenger-mark-read';
        markReadButton.type = 'button';
        markReadButton.textContent = 'Mark as read';
        markReadButton.addEventListener('click', () => markAsRead(messageId));
        actions.append(markReadButton);
    }
}

function initializePresence(messenger) {
    const status = document.createElement('span');
    status.className = 'messenger-presence-unavailable';
    status.textContent = 'Online status is unavailable in browser-local mode.';
    messenger.onlineUsers.append(status);
    return () => {};
}

function initializeChat(currentUser, db, storage) {
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
    const readReceipts = collection(db, 'users', currentUser.uid, 'messageReads');
    let latestMessageSnapshot = null;
    let readMessageIds = new Set();
    let unsubscribeReadReceipts = null;
    let currentReadBoundary = null;
    let readListenerVersion = 0;
    let firstSnapshot = true;
    const messageElements = new Map();
    let emptyMessageState = null;

    const renderMessages = forceScroll => {
        const shouldScroll = forceScroll
            || messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight < 80;
        let unreadCount = 0;
        const visibleMessageIds = new Set();
        const documents = latestMessageSnapshot ? latestMessageSnapshot.docs : [];
        documents.forEach(documentSnapshot => {
            const message = documentSnapshot.data();
            const isUnread = message.uid !== currentUser.uid && !readMessageIds.has(documentSnapshot.id);
            if (isUnread) unreadCount += 1;
            visibleMessageIds.add(documentSnapshot.id);
            try {
                let item = messageElements.get(documentSnapshot.id);
                if (!item) {
                    item = createChatMessage(
                        documentSnapshot,
                        currentUser,
                        readMessageIds,
                        markAsRead,
                        deleteMessage,
                        status
                    );
                    messageElements.set(documentSnapshot.id, item);
                } else {
                    updateChatMessageReadState(
                        item,
                        documentSnapshot.id,
                        readMessageIds.has(documentSnapshot.id),
                        markAsRead
                    );
                }
            } catch (error) {
                console.error(`Could not display message ${documentSnapshot.id}:`, error);
            }
        });

        for (const [messageId, item] of messageElements) {
            if (!visibleMessageIds.has(messageId)) {
                item.remove();
                messageElements.delete(messageId);
            }
        }

        if (documents.length === 0) {
            if (!emptyMessageState) {
                emptyMessageState = document.createElement('li');
                emptyMessageState.textContent = 'No messages yet. Start the conversation.';
            }
            messageList.append(emptyMessageState);
        } else if (emptyMessageState) {
            emptyMessageState.remove();
        }

        let nextMessage = null;
        for (let index = documents.length - 1; index >= 0; index -= 1) {
            const item = messageElements.get(documents[index].id);
            if (item && (item.parentNode !== messageList || item.nextSibling !== nextMessage)) {
                messageList.insertBefore(item, nextMessage);
            }
            if (item) nextMessage = item;
        }
        messenger.setUnreadCount(unreadCount);
        if (shouldScroll) messageList.scrollTop = messageList.scrollHeight;
    };

    const subscribeToReadReceipts = snapshot => {
        const oldestMessage = snapshot.docs[0];
        const createdAt = oldestMessage && oldestMessage.data().createdAt;
        const boundary = createdAt instanceof Date
            ? createdAt.getTime()
            : createdAt && typeof createdAt.toMillis === 'function'
                ? createdAt.toMillis()
                : null;
        if (boundary === currentReadBoundary) return;

        if (unsubscribeReadReceipts) unsubscribeReadReceipts();
        unsubscribeReadReceipts = null;
        currentReadBoundary = boundary;
        readMessageIds = new Set();
        const listenerVersion = ++readListenerVersion;

        if (boundary === null) {
            renderMessages(false);
            return;
        }

        const readsQuery = query(readReceipts, where('readAt', '>=', createdAt));
        unsubscribeReadReceipts = onSnapshot(readsQuery, receiptsSnapshot => {
            if (listenerVersion !== readListenerVersion) return;
            readMessageIds = new Set(receiptsSnapshot.docs.map(receipt => receipt.id));
            renderMessages(false);
        }, error => {
            if (listenerVersion !== readListenerVersion) return;
            setStatus(status, `Could not load message read status. ${getCommunityError(error)}`);
        });
    };

    const unsubscribeMessages = onSnapshot(messagesQuery, snapshot => {
        const shouldScroll = firstSnapshot
            || messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight < 80;
        latestMessageSnapshot = snapshot;
        subscribeToReadReceipts(snapshot);
        renderMessages(shouldScroll);
        firstSnapshot = false;
    }, error => {
        setStatus(status, `Could not load chat messages. ${getCommunityError(error)}`);
    });

    async function markAsRead(messageId) {
        if (readMessageIds.has(messageId)) return;
        readMessageIds.add(messageId);
        renderMessages(false);
        try {
            await setDoc(doc(readReceipts, messageId), { readAt: serverTimestamp() });
        } catch (error) {
            readMessageIds.delete(messageId);
            setStatus(status, `Could not mark this message as read. ${getCommunityError(error)}`);
            renderMessages(false);
        }
    }

    async function deleteMessage(documentSnapshot) {
        const message = documentSnapshot.data();
        if (!window.confirm('Delete this message for everyone?')) return;
        try {
            await deleteDoc(doc(db, 'messages', documentSnapshot.id));
        } catch (error) {
            setStatus(status, `Could not delete the message. ${getCommunityError(error)}`);
            return;
        }

        const storagePath = message.attachment && message.attachment.storagePath;
        if (storagePath) {
            const ownerPrefix = `messages/${currentUser.uid}/`;
            if (!storage || !storagePath.startsWith(ownerPrefix)) {
                console.error('Deleted message attachment has no valid owner-scoped storage path.');
                setStatus(status, 'Message deleted, but its attached file could not be removed.');
                return;
            }
            try {
                await deleteObject(ref(storage, storagePath));
            } catch (error) {
                console.error('Message was deleted, but its uploaded attachment could not be removed:', error);
                setStatus(status, 'Message deleted, but its attached file could not be removed.');
                return;
            }
        }
        setStatus(status, 'Message deleted for everyone.', 'success');
    }

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
        if (file && !storage) {
            setStatus(status, 'File attachments are unavailable in this browser.');
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

    const stopPresence = initializePresence(messenger);
    let stopped = false;
    return () => {
        if (stopped) return;
        stopped = true;
        unsubscribeMessages();
        if (unsubscribeReadReceipts) unsubscribeReadReceipts();
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
    if (mediaUrl.protocol !== 'local-file:') {
        throw new Error(`Post ${documentSnapshot.id} has an invalid media URL.`);
    }

    const media = document.createElement(post.contentType.startsWith('video/') ? 'video' : 'img');
    if (mediaUrl.protocol === 'local-file:') {
        getObjectURLFromURL(post.downloadUrl).then(url => { media.src = url; }).catch(error => {
            console.error('Could not load a browser-local activity upload:', error);
        });
    }
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

function initializeActivityFeed(db) {
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

function initializePostUpload(currentUser, db, storage) {
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

export async function initializeCommunity(currentUser) {
    const [db, storage] = await Promise.all([
        getLocalDatabase(),
        getLocalFileStore()
    ]);
    const hasActivityFeed = Boolean(document.getElementById('activity-feed'));
    if (hasActivityFeed && (!db || !storage)) {
        throw new Error('Browser-local database and file storage are unavailable.');
    }

    const cleanups = [];
    const chatCleanup = initializeChat(currentUser, db, storage);
    if (chatCleanup) cleanups.push(chatCleanup);
    if (hasActivityFeed) {
        cleanups.push(initializeActivityFeed(db));
        cleanups.push(initializePostUpload(currentUser, db, storage));
    }
    return () => cleanups.forEach(cleanup => cleanup());
}
