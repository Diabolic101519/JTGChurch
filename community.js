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
    updateDoc,
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

function asDate(value) {
    if (value instanceof Date) return value;
    if (value && typeof value.toDate === 'function') return value.toDate();
    return null;
}

function makeTimestamp(value, className = '') {
    const time = document.createElement('time');
    const date = asDate(value);
    if (className) time.className = className;
    if (date) time.dateTime = date.toISOString();
    time.textContent = formatDate(value);
    return time;
}

function getPostMedia(post) {
    if (Array.isArray(post.media)) return post.media;
    if (post.downloadUrl && post.storagePath) {
        return [{
            storagePath: post.storagePath,
            downloadUrl: post.downloadUrl,
            contentType: post.contentType || 'image/*',
            name: post.fileName || 'Activity media'
        }];
    }
    return [];
}

function createPostMedia(mediaItems, post) {
    const gallery = document.createElement('div');
    gallery.className = 'activity-post-media';
    mediaItems.forEach(item => {
        const mediaUrl = new URL(item.downloadUrl);
        if (mediaUrl.protocol !== 'local-file:') {
            throw new Error('An activity post contains an invalid media URL.');
        }
        const media = document.createElement(item.contentType.startsWith('video/') ? 'video' : 'img');
        getObjectURLFromURL(item.downloadUrl).then(url => { media.src = url; }).catch(error => {
            console.error('Could not load a browser-local activity upload:', error);
        });
        if (media instanceof HTMLVideoElement) {
            media.controls = true;
            media.preload = 'metadata';
            media.playsInline = true;
        } else {
            media.alt = post.caption || item.name || `Photo shared by ${post.displayName}`;
            media.loading = 'lazy';
        }

        const itemContainer = document.createElement('div');
        itemContainer.className = 'activity-post-media-item';
        const name = document.createElement('p');
        name.className = 'activity-post-media-name';
        name.textContent = item.name || 'Shared media';
        itemContainer.append(media, name);
        gallery.append(itemContainer);
    });
    return gallery;
}

function createReply(reply) {
    const item = document.createElement('li');
    item.className = 'activity-reply';
    const author = document.createElement('strong');
    author.textContent = reply.displayName || 'Church member';
    const timestamp = makeTimestamp(reply.createdAt);
    const text = document.createElement('p');
    text.textContent = reply.text || '';
    item.append(author, timestamp, text);
    return item;
}

function createEditForm(post, mediaItems, currentUser, db, storage, status) {
    const form = document.createElement('form');
    form.className = 'activity-edit-form community-form';
    const captionLabel = document.createElement('label');
    captionLabel.textContent = 'Edit caption';
    const captionInput = document.createElement('textarea');
    captionInput.maxLength = 500;
    captionInput.rows = 3;
    captionInput.value = post.caption || '';
    captionLabel.append(captionInput);

    const mediaLabel = document.createElement('label');
    mediaLabel.textContent = 'Add more images or videos';
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*,video/*';
    fileInput.multiple = true;
    mediaLabel.append(fileInput);

    const mediaOptions = document.createElement('fieldset');
    mediaOptions.className = 'activity-edit-media';
    const legend = document.createElement('legend');
    legend.textContent = 'Remove media from this post';
    mediaOptions.append(legend);
    mediaItems.forEach(item => {
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = item.storagePath;
        label.append(checkbox, document.createTextNode(` Remove ${item.name || 'shared media'}`));
        mediaOptions.append(label);
    });

    const actions = document.createElement('div');
    actions.className = 'activity-post-actions';
    const saveButton = document.createElement('button');
    saveButton.type = 'submit';
    saveButton.textContent = 'Save changes';
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'secondary-button';
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', () => form.remove());
    actions.append(saveButton, cancelButton);
    form.append(captionLabel, mediaLabel, mediaOptions, actions);

    form.addEventListener('submit', async event => {
        event.preventDefault();
        const selectedFiles = Array.from(fileInput.files || []);
        const invalidFile = selectedFiles.find(file => (
            (!file.type.startsWith('image/') && !file.type.startsWith('video/'))
            || file.size > maximumUploadBytes
        ));
        if (invalidFile) {
            setStatus(status, invalidFile.size > maximumUploadBytes
                ? `${invalidFile.name} is larger than the 150 MB per-file limit.`
                : `${invalidFile.name} is not an image or video.`);
            return;
        }

        saveButton.disabled = true;
        const uploadedItems = [];
        let postSaved = false;
        try {
            for (let index = 0; index < selectedFiles.length; index += 1) {
                setStatus(status, `Adding media ${index + 1} of ${selectedFiles.length}...`, 'progress');
                uploadedItems.push(await uploadActivityMedia(selectedFiles[index], currentUser, storage));
            }

            await updateDoc(doc(db, 'posts', post.id), existing => {
                if (existing.uid !== currentUser.uid) {
                    throw new Error('Only the member who created this post can edit it.');
                }
                const latestMedia = Array.isArray(existing.media)
                    ? existing.media
                    : mediaItems;
                const removedPaths = new Set(
                    Array.from(mediaOptions.querySelectorAll('input:checked')).map(input => input.value)
                );
                const editedAt = serverTimestamp();
                return {
                    caption: captionInput.value.trim().slice(0, 500),
                    media: [
                        ...latestMedia.filter(item => !removedPaths.has(item.storagePath)),
                        ...uploadedItems.map(item => item.media)
                    ],
                    editedByUid: currentUser.uid,
                    editedByName: (currentUser.displayName || currentUser.email || 'Church member').slice(0, 100),
                    editedAt,
                    updatedAt: editedAt
                };
            });
            postSaved = true;
            const removedPaths = new Set(
                Array.from(mediaOptions.querySelectorAll('input:checked')).map(input => input.value)
            );
            let cleanupFailed = false;
            for (const path of removedPaths) {
                try {
                    await deleteObject(ref(storage, path));
                } catch (error) {
                    cleanupFailed = true;
                    console.error('Could not remove activity media selected for deletion:', error);
                }
            }
            if (cleanupFailed) {
                setStatus(status, 'Your post was updated, but some removed media could not be deleted from browser storage.');
            } else {
                setStatus(status, 'Your post was updated.', 'success');
            }
        } catch (error) {
            if (!postSaved) {
                let cleanupFailed = false;
                for (const item of uploadedItems) {
                    try {
                        await deleteObject(item.reference);
                    } catch (cleanupError) {
                        cleanupFailed = true;
                        console.error('Could not remove media after an activity edit failed:', cleanupError);
                    }
                }
                setStatus(status, cleanupFailed
                    ? `Could not update the post, and some temporary uploads could not be removed. ${getCommunityError(error)}`
                    : `Could not update the post. ${getCommunityError(error)}`);
            } else {
                setStatus(status, `The post was saved, but a follow-up operation failed. ${getCommunityError(error)}`);
            }
        } finally {
            saveButton.disabled = false;
        }
    });
    return form;
}

function createActivityPost(documentSnapshot, currentUser, db, storage, status) {
    const post = documentSnapshot.data();
    post.id = documentSnapshot.id;
    const mediaItems = getPostMedia(post);
    const card = document.createElement('article');
    card.className = 'activity-post';
    if (mediaItems.length) card.append(createPostMedia(mediaItems, post));

    const content = document.createElement('div');
    content.className = 'activity-post-content';
    const author = document.createElement('h3');
    author.textContent = post.displayName || 'Church member';
    const createdAt = makeTimestamp(post.createdAt, 'activity-post-timestamp');
    const postHeader = document.createElement('div');
    postHeader.className = 'activity-post-header';
    postHeader.append(author, createdAt);
    content.append(postHeader);

    if (post.caption) {
        const caption = document.createElement('p');
        caption.className = 'activity-post-caption';
        caption.textContent = post.caption;
        content.append(caption);
    }
    if (post.editedAt) {
        const edited = document.createElement('p');
        edited.className = 'activity-post-edited';
        edited.append(
            document.createTextNode(`Edited by ${post.editedByName || 'Church member'} · `),
            makeTimestamp(post.editedAt)
        );
        content.append(edited);
    }

    if (post.uid === currentUser.uid) {
        const actions = document.createElement('div');
        actions.className = 'activity-post-actions';
        const editButton = document.createElement('button');
        editButton.type = 'button';
        editButton.className = 'secondary-button';
        editButton.textContent = 'Edit post';
        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'danger-button';
        deleteButton.textContent = 'Delete post';
        const editForm = createEditForm(post, mediaItems, currentUser, db, storage, status);
        editForm.hidden = true;
        editButton.addEventListener('click', () => {
            editForm.hidden = !editForm.hidden;
            if (!editForm.hidden) editForm.querySelector('textarea').focus();
        });
        deleteButton.addEventListener('click', async () => {
            if (!window.confirm('Delete this activity post and all its uploaded media?')) return;
            deleteButton.disabled = true;
            try {
                await deleteDoc(doc(db, 'posts', post.id));
                let cleanupFailed = false;
                for (const item of mediaItems) {
                    try {
                        await deleteObject(ref(storage, item.storagePath));
                    } catch (error) {
                        cleanupFailed = true;
                        console.error('Could not remove media from a deleted activity post:', error);
                    }
                }
                setStatus(status, cleanupFailed
                    ? 'Your post was deleted, but some uploaded media could not be removed from browser storage.'
                    : 'Your post was deleted.', cleanupFailed ? 'error' : 'success');
            } catch (error) {
                setStatus(status, `Could not fully delete the post. ${getCommunityError(error)}`);
            } finally {
                deleteButton.disabled = false;
            }
        });
        actions.append(editButton, deleteButton);
        content.append(actions, editForm);
    }

    const replies = document.createElement('section');
    replies.className = 'activity-replies';
    const repliesHeading = document.createElement('h4');
    repliesHeading.textContent = 'Replies';
    const replyList = document.createElement('ul');
    replyList.className = 'activity-reply-list';
    (Array.isArray(post.replies) ? post.replies : []).forEach(reply => replyList.append(createReply(reply)));
    if (!replyList.childElementCount) {
        const emptyReplies = document.createElement('li');
        emptyReplies.className = 'activity-reply-empty';
        emptyReplies.textContent = 'No replies yet.';
        replyList.append(emptyReplies);
    }

    const replyForm = document.createElement('form');
    replyForm.className = 'activity-reply-form community-form';
    const replyLabel = document.createElement('label');
    replyLabel.textContent = 'Add a reply';
    const replyInput = document.createElement('textarea');
    replyInput.maxLength = 500;
    replyInput.rows = 2;
    replyInput.required = true;
    replyInput.placeholder = 'Write a reply...';
    replyLabel.append(replyInput);
    const replyButton = document.createElement('button');
    replyButton.type = 'submit';
    replyButton.textContent = 'Reply';
    replyForm.append(replyLabel, replyButton);
    replyForm.addEventListener('submit', async event => {
        event.preventDefault();
        const text = replyInput.value.trim();
        if (!text) {
            replyInput.focus();
            return;
        }
        replyButton.disabled = true;
        try {
            await updateDoc(doc(db, 'posts', post.id), existing => ({
                replies: [
                    ...(Array.isArray(existing.replies) ? existing.replies : []),
                    {
                        id: crypto.randomUUID(),
                        uid: currentUser.uid,
                        displayName: (currentUser.displayName || currentUser.email || 'Church member').slice(0, 100),
                        text: text.slice(0, 500),
                        createdAt: serverTimestamp()
                    }
                ]
            }));
            replyInput.value = '';
            setStatus(status, 'Your reply was added.', 'success');
        } catch (error) {
            setStatus(status, `Could not add your reply. ${getCommunityError(error)}`);
        } finally {
            replyButton.disabled = false;
        }
    });
    replies.append(repliesHeading, replyList, replyForm);
    content.append(replies);
    card.append(content);
    return card;
}

function initializeActivityFeed(currentUser, db, storage) {
    const feed = document.getElementById('activity-feed');
    const status = document.getElementById('feed-status');
    if (!feed || !db) return () => {};

    const postsQuery = query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(30));
    return onSnapshot(postsQuery, snapshot => {
        feed.replaceChildren();
        snapshot.forEach(documentSnapshot => {
            try {
                feed.append(createActivityPost(documentSnapshot, currentUser, db, storage, status));
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

async function uploadActivityMedia(file, currentUser, storage) {
    const storagePath = `posts/${currentUser.uid}/${crypto.randomUUID()}`;
    const reference = ref(storage, storagePath);
    const task = uploadBytesResumable(reference, file, { contentType: file.type });
    await new Promise((resolve, reject) => {
        task.on('state_changed', () => {}, reject, resolve);
    });
    return {
        reference,
        media: {
            storagePath,
            downloadUrl: await getDownloadURL(reference),
            contentType: file.type,
            name: file.name
        }
    };
}

function initializePostUpload(currentUser, db, storage) {
    const uploadForm = document.getElementById('upload-form');
    const fileInput = document.getElementById('activity-file');
    const captionInput = document.getElementById('activity-caption');
    const progress = document.getElementById('upload-progress');
    const status = document.getElementById('upload-status');
    const feedStatus = document.getElementById('feed-status');
    if (!uploadForm || !fileInput || !captionInput || !progress || !storage || !db) return () => {};
    const fileSelection = document.getElementById('activity-file-selection');

    const onFileChange = () => {
        const files = Array.from(fileInput.files || []);
        if (!files.length) {
            if (fileSelection) fileSelection.textContent = '';
            setStatus(status, '');
            return;
        }
        if (fileSelection) fileSelection.textContent = files.map(file => `${file.name} (${formatFileSize(file.size)})`).join(', ');
        const invalidFile = files.find(file => (
            (!file.type.startsWith('image/') && !file.type.startsWith('video/'))
            || file.size > maximumUploadBytes
        ));
        if (invalidFile) {
            setStatus(status, invalidFile.size > maximumUploadBytes
                ? `${invalidFile.name} is larger than the 150 MB per-file limit.`
                : `${invalidFile.name} is not an image or video.`);
        } else {
            setStatus(status, '');
        }
    };
    fileInput.addEventListener('change', onFileChange);

    const onSubmit = async event => {
        event.preventDefault();
        const files = Array.from(fileInput.files || []);
        if (!files.length) {
            setStatus(status, 'Choose at least one image or video file to upload.');
            fileInput.focus();
            return;
        }
        const invalidFile = files.find(file => (
            (!file.type.startsWith('image/') && !file.type.startsWith('video/'))
            || file.size > maximumUploadBytes
        ));
        if (invalidFile) {
            setStatus(status, invalidFile.size > maximumUploadBytes
                ? `${invalidFile.name} is larger than the 150 MB per-file limit.`
                : `${invalidFile.name} is not an image or video.`);
            return;
        }

        const uploadButton = uploadForm.querySelector('button[type="submit"]');
        const caption = captionInput.value.trim().slice(0, 500);
        const displayName = (currentUser.displayName || currentUser.email || 'Church member').slice(0, 100);
        if (uploadButton) uploadButton.disabled = true;
        progress.hidden = false;
        progress.value = 0;
        setStatus(status, `Uploading ${files.length} file${files.length === 1 ? '' : 's'}... Keep this page open until complete.`, 'progress');

        const uploadedItems = [];
        try {
            for (let index = 0; index < files.length; index += 1) {
                setStatus(status, `Uploading file ${index + 1} of ${files.length}... Keep this page open until complete.`, 'progress');
                uploadedItems.push(await uploadActivityMedia(files[index], currentUser, storage));
                progress.value = Math.round(((index + 1) / files.length) * 100);
            }
            const firstMedia = uploadedItems[0].media;
            await addDoc(collection(db, 'posts'), {
                uid: currentUser.uid,
                displayName,
                caption,
                media: uploadedItems.map(item => item.media),
                storagePath: firstMedia.storagePath,
                downloadUrl: firstMedia.downloadUrl,
                contentType: firstMedia.contentType,
                createdAt: serverTimestamp()
            });

            uploadForm.reset();
            if (fileSelection) fileSelection.textContent = '';
            progress.value = 100;
            setStatus(status, 'Your post was shared with the church.', 'success');
        } catch (error) {
            let cleanupFailed = false;
            for (const item of uploadedItems) {
                try {
                    await deleteObject(item.reference);
                } catch (cleanupError) {
                    cleanupFailed = true;
                    console.error('Could not remove media after the activity upload failed:', cleanupError);
                }
            }
            setStatus(status, cleanupFailed
                ? `Could not upload the post, and some uploaded files could not be removed. ${getCommunityError(error)}`
                : `Could not upload the post. ${getCommunityError(error)}`);
        } finally {
            if (uploadButton) uploadButton.disabled = false;
            if (!uploadedItems.length) progress.hidden = true;
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
        cleanups.push(initializeActivityFeed(currentUser, db, storage));
        cleanups.push(initializePostUpload(currentUser, db, storage));
    }
    return () => cleanups.forEach(cleanup => cleanup());
}
