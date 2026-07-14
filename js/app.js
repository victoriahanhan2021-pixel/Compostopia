const firebaseConfig = {
    apiKey: "AIzaSyCjg1kZpXAD8lE1HfMWhTTc_GwWGx5zFWI",
    authDomain: "composting-74985.firebaseapp.com",
    projectId: "composting-74985",
    storageBucket: "composting-74985.firebasestorage.app",
    messagingSenderId: "192197253836",
    appId: "1:192197253836:web:2db6084cf85cb2629b0069",
    measurementId: "G-MKG29HYVWS"
};

firebase.initializeApp(firebaseConfig);
const firebaseAuth = firebase.auth();
let firestoreDb = null;
let storageDb = null;
try {
    firestoreDb = firebase.firestore();
} catch (error) {
    firestoreDb = null;
}
try {
    storageDb = firebase.storage();
} catch (error) {
    storageDb = null;
}

try {
    firebase.analytics();
} catch (error) {
    console.log('analytics not available', error);
}

const App = {
    data: {
        batches: [],
        currentBatch: null,
        currentPage: 'login',
        currentUser: null,
        currentOrganization: '',
        currentCommunityType: '',
        currentCommunityTypeOther: '',
        rememberMe: false,
        authSubmitting: false,
        editingBatch: null,
        editingRecord: null,
        pendingRoute: null,
        globalClickDelegationBound: false,
        batchGalleryPhotos: [],
        batchInfoPanel: null,
        batchTransferHistoryExpanded: false,
        carbonReductionExpanded: false,
        carbonCalculationDetailsExpanded: false,
        carbonReductionDraft: {}
    },

    init() {
        this.data.currentPage = 'login';
        this.data.rememberMe = localStorage.getItem('compostRememberMe') === 'true';
        this.data.pendingRoute = this.parseRouteFromUrl();
        this.bindGlobalClickDelegation();
        this.bindAuthState();
        this.cleanupOverlays();
        this.render();
    },

    cleanupOverlays() {
        try {
            const ids = [
                'infoModal',
                'confirmModal',
                'deleteDailyRecordModal',
                'finishModal'
            ];
            ids.forEach((id) => {
                const el = document.getElementById(id);
                if (el) el.remove();
            });
            document.querySelectorAll('.modal-overlay').forEach((el) => {
                el.remove();
            });
        } catch (error) {
        }
    },

    parseRouteFromUrl() {
        try {
            const params = new URLSearchParams(window.location.search || '');
            const page = String(params.get('page') || '').trim();
            const batchId = String(params.get('batchId') || '').trim();
            const recordId = params.get('recordId');
            const allowedPages = new Set(['dashboard', 'createBatch', 'batchDetail', 'dailyRecord', 'output', 'export']);
            if (!allowedPages.has(page)) return null;
            const route = { page };
            if (batchId) route.batchId = batchId;
            if (recordId != null && String(recordId).trim() !== '') route.recordId = String(recordId);
            return route;
        } catch (error) {
            return null;
        }
    },

    clearUrlRouteParams() {
        try {
            const url = new URL(window.location.href);
            url.searchParams.delete('page');
            url.searchParams.delete('batchId');
            url.searchParams.delete('recordId');
            window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
        } catch (error) {
        }
    },

    bindGlobalClickDelegation() {
        if (this.data.globalClickDelegationBound) return;
        document.addEventListener('click', (event) => {
            let target = event.target;
            if (target && target.nodeType === 3) target = target.parentElement;
            if (!target || typeof target.closest !== 'function') return;

            const addBtn = target.closest('#addDailyRecordBtn');
            if (addBtn) {
                const batchId = addBtn.getAttribute('data-batch-id') || (this.data.currentBatch ? this.data.currentBatch.id : null);
                if (batchId) this.navigate('dailyRecord', { batchId });
                return;
            }

            const actionBtn = target.closest('button[data-action]');
            if (actionBtn) {
                const action = actionBtn.getAttribute('data-action') || '';
                if (action === 'edit') {
                    const batchId = actionBtn.getAttribute('data-batch-id') || (this.data.currentBatch ? this.data.currentBatch.id : null);
                    const recordId = actionBtn.getAttribute('data-record-id');
                    if (batchId && recordId != null) this.navigate('dailyRecord', { batchId, recordId });
                    return;
                }
                if (action === 'delete') {
                    const recordId = actionBtn.getAttribute('data-record-id');
                    if (recordId != null) this.deleteDailyRecord(recordId);
                }
            }
        }, true);
        this.data.globalClickDelegationBound = true;
    },

    normalizeEmail(value) {
        return (value || '').trim().toLowerCase();
    },

    bindAuthState() {
        firebaseAuth.onAuthStateChanged(async (user) => {
            this.data.currentUser = user ? {
                uid: user.uid,
                email: user.email,
                displayName: user.displayName || ''
            } : null;

            if (this.data.currentUser) {
                await this.loadData();
                this.loadOrganization();
                await this.loadUserProfile();
            } else {
                this.data.batches = [];
                this.data.currentBatch = null;
                this.data.editingRecord = null;
                this.data.currentOrganization = '';
                this.data.currentCommunityType = '';
                this.data.currentCommunityTypeOther = '';
                this.data.currentPage = 'login';
            }

            if (this.data.currentUser) {
                const pending = this.data.pendingRoute || this.parseRouteFromUrl();
                this.data.pendingRoute = null;
                if (pending && pending.page) {
                    this.navigate(pending.page, {
                        ...(pending.batchId ? { batchId: pending.batchId } : {}),
                        ...(pending.recordId != null ? { recordId: pending.recordId } : {})
                    });
                    return;
                }
                if (this.data.currentPage === 'login' || this.data.currentPage === 'register') {
                    this.navigate('dashboard');
                    return;
                }
            }

            this.render();
        });
    },

    getStorageKey() {
        return this.data.currentUser?.uid ? `compostData_${this.data.currentUser.uid}` : null;
    },

    getOrganizationKey() {
        return this.getOrganizationKeyForUid(this.data.currentUser?.uid);
    },

    getOrganizationKeyForUid(uid) {
        return uid ? `compostOrg_${uid}` : null;
    },

    loadOrganization() {
        const key = this.getOrganizationKey();
        this.data.currentOrganization = key ? (localStorage.getItem(key) || '') : '';
    },

    saveOrganization(organization) {
        const key = this.getOrganizationKey();
        if (!key) return;
        localStorage.setItem(key, organization || '');
        this.data.currentOrganization = organization || '';
    },

    getUserProfileCacheKeyForUid(uid) {
        return uid ? `compostUserProfile_${uid}` : null;
    },

    loadCachedUserProfile(uid = this.data.currentUser?.uid) {
        const cacheKey = this.getUserProfileCacheKeyForUid(uid);
        if (!cacheKey) return null;
        const raw = localStorage.getItem(cacheKey);
        if (!raw) return null;
        try {
            return JSON.parse(raw);
        } catch (error) {
            return null;
        }
    },

    cacheUserProfile(uid, profile) {
        const cacheKey = this.getUserProfileCacheKeyForUid(uid);
        if (!cacheKey) return;
        localStorage.setItem(cacheKey, JSON.stringify(profile || {}));
    },

    async loadUserProfile() {
        const uid = this.data.currentUser?.uid;
        if (!uid) return;

        const applyProfile = (profile) => {
            const organization = (profile && profile.organization) ? String(profile.organization).trim() : '';
            const communityType = (profile && profile.communityType) ? String(profile.communityType).trim() : '';
            const communityTypeOther = (profile && profile.communityTypeOther) ? String(profile.communityTypeOther).trim() : '';

            if (organization) this.saveOrganization(organization);
            this.data.currentCommunityType = communityType;
            this.data.currentCommunityTypeOther = communityTypeOther;
        };

        try {
            if (firestoreDb) {
                const doc = await firestoreDb.collection('users').doc(uid).get();
                if (doc && doc.exists) {
                    const data = doc.data() || {};
                    const profile = {
                        organization: data.organization || '',
                        communityType: data.communityType || '',
                        communityTypeOther: data.communityTypeOther || ''
                    };
                    applyProfile(profile);
                    this.cacheUserProfile(uid, profile);
                    return;
                }
            }
        } catch (error) {
        }

        const cached = this.loadCachedUserProfile(uid);
        if (cached) applyProfile(cached);
    },

    async saveUserProfile(uid, profile) {
        if (!uid) return;
        const normalized = {
            organization: profile?.organization ? String(profile.organization).trim() : '',
            communityType: profile?.communityType ? String(profile.communityType).trim() : '',
            communityTypeOther: profile?.communityTypeOther ? String(profile.communityTypeOther).trim() : ''
        };

        try {
            if (firestoreDb) {
                const payload = {
                    ...normalized,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                };
                await firestoreDb.collection('users').doc(uid).set(payload, { merge: true });
            }
        } catch (error) {
        }

        this.cacheUserProfile(uid, normalized);
        localStorage.setItem(this.getOrganizationKeyForUid(uid), normalized.organization || '');

        if (this.data.currentUser?.uid === uid) {
            if (normalized.organization) this.data.currentOrganization = normalized.organization;
            this.data.currentCommunityType = normalized.communityType;
            this.data.currentCommunityTypeOther = normalized.communityTypeOther;
        }
    },

    getBatchRouteId(batch) {
        return batch ? String(batch.cloudId || batch.id || '') : '';
    },

    findBatchByRouteId(batchId) {
        const target = String(batchId || '');
        return this.data.batches.find((batch) => this.getBatchRouteId(batch) === target || String(batch?.id || '') === target) || null;
    },

    escapeAttr(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/"/g, '&quot;');
    },

    escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    normalizeCollaboratorEmails(emails = []) {
        return Array.from(new Set((Array.isArray(emails) ? emails : [])
            .map((email) => this.normalizeEmail(email))
            .filter(Boolean)));
    },

    isBatchOwner(batch) {
        if (!batch) return false;
        if (!batch.ownerUid) return true;
        return batch.ownerUid === this.data.currentUser?.uid;
    },

    canDeleteBatch(batch) {
        return this.isBatchOwner(batch);
    },

    getBatchCollaborators(batch) {
        return this.normalizeCollaboratorEmails(
            batch?.collaboratorEmails
            || batch?.collaborationSettings?.collaborators
            || []
        );
    },

    isCurrentUserCollaborator(batch) {
        const email = this.normalizeEmail(this.data.currentUser?.email || '');
        return !!email && this.getBatchCollaborators(batch).includes(email) && !this.isBatchOwner(batch);
    },

    updateBatchCollaborationFields(batch, collaborators = []) {
        const normalizedCollaborators = this.normalizeCollaboratorEmails(collaborators)
            .filter((email) => email !== this.normalizeEmail(batch?.ownerEmail || this.data.currentUser?.email || ''));
        const nextType = normalizedCollaborators.length > 0 ? 'shared' : 'private';
        batch.collaboratorEmails = normalizedCollaborators;
        batch.visibility = nextType;
        batch.collaborationSettings = {
            ...(batch.collaborationSettings || {}),
            type: nextType,
            collaborators: normalizedCollaborators
        };
        return batch;
    },

    async syncBatchCollaboration(batch) {
        this.saveData();
        try {
            await this.upsertBatchToCloud(batch, { skipCreatedAt: true });
            this.saveData();
        } catch (error) {
            alert('Collaboration settings were updated locally, but cloud sync failed. Please refresh and try again.');
        }
    },

    getCurrentActorInfo() {
        return {
            uid: this.data.currentUser?.uid || '',
            email: this.normalizeEmail(this.data.currentUser?.email || '') || 'unknown user'
        };
    },

    createActivityEntry(action, summary, details = {}) {
        const actor = this.getCurrentActorInfo();
        return this.removeUndefinedDeep({
            id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            action,
            summary,
            actorUid: actor.uid,
            actorEmail: actor.email,
            createdAt: new Date().toISOString(),
            details
        });
    },

    appendBatchActivity(batch, action, summary, details = {}) {
        if (!batch) return null;
        if (!Array.isArray(batch.activityLog)) batch.activityLog = [];
        const entry = this.createActivityEntry(action, summary, details);
        batch.activityLog.unshift(entry);
        batch.activityLog = batch.activityLog
            .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
            .slice(0, 80);
        return entry;
    },

    getBatchActivityLog(batch) {
        return (Array.isArray(batch?.activityLog) ? batch.activityLog : [])
            .slice()
            .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    },

    formatActivityDateTime(value) {
        if (!value) return 'Unknown time';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return date.toLocaleString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    },

    getActivityActionMeta(action) {
        switch (action) {
            case 'record_added':
                return { icon: '📝', badgeClass: 'record' };
            case 'record_photos_uploaded':
                return { icon: '🖼', badgeClass: 'photo' };
            case 'batch_finished':
                return { icon: '🏁', badgeClass: 'finish' };
            case 'batch_final_photos_uploaded':
                return { icon: '📸', badgeClass: 'photo' };
            case 'collaborators_added':
                return { icon: '➕', badgeClass: 'collab' };
            case 'collaborator_removed':
                return { icon: '➖', badgeClass: 'collab' };
            case 'collaborator_left':
                return { icon: '🚪', badgeClass: 'collab' };
            default:
                return { icon: '•', badgeClass: 'default' };
        }
    },

    renderActivityLog(batch) {
        const entries = this.getBatchActivityLog(batch).slice(0, 16);
        if (entries.length === 0) {
            return `<div class="activity-log-empty">No shared activity has been recorded for this batch yet.</div>`;
        }
        return `
            <div class="activity-log-list">
                ${entries.map((entry) => {
                    const meta = this.getActivityActionMeta(entry.action);
                    return `
                        <div class="activity-log-item">
                            <div class="activity-log-icon ${meta.badgeClass}">${meta.icon}</div>
                            <div class="activity-log-content">
                                <div class="activity-log-summary">${this.escapeAttr(entry.summary || '')}</div>
                                <div class="activity-log-meta">
                                    <span>${this.escapeAttr(entry.actorEmail || 'unknown user')}</span>
                                    <span>${this.escapeAttr(this.formatActivityDateTime(entry.createdAt))}</span>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    },

    isDataUrl(value) {
        return typeof value === 'string' && value.startsWith('data:image/');
    },

    isRemotePhotoUrl(value) {
        return typeof value === 'string' && /^https?:\/\//i.test(value);
    },

    normalizePhotoItem(photo) {
        if (!photo) return null;
        if (typeof photo === 'string') {
            if (this.isDataUrl(photo)) {
                return {
                    url: photo,
                    previewUrl: photo,
                    storagePath: '',
                    uploadedAt: '',
                    uploadedBy: this.normalizeEmail(this.data.currentUser?.email || '')
                };
            }
            if (this.isRemotePhotoUrl(photo)) {
                return {
                    url: photo,
                    previewUrl: photo,
                    storagePath: '',
                    uploadedAt: '',
                    uploadedBy: ''
                };
            }
            return null;
        }
        const url = typeof photo.url === 'string' && photo.url
            ? photo.url
            : (typeof photo.src === 'string' ? photo.src : '');
        if (!url) return null;
        return {
            url,
            previewUrl: typeof photo.previewUrl === 'string' && photo.previewUrl ? photo.previewUrl : url,
            storagePath: typeof photo.storagePath === 'string' ? photo.storagePath : '',
            uploadedAt: photo.uploadedAt || '',
            uploadedBy: typeof photo.uploadedBy === 'string' ? photo.uploadedBy : ''
        };
    },

    normalizePhotoList(photos = []) {
        return (Array.isArray(photos) ? photos : [])
            .map((photo) => this.normalizePhotoItem(photo))
            .filter(Boolean)
            .slice(0, 9);
    },

    getPhotoPreviewSrc(photo) {
        return this.normalizePhotoItem(photo)?.previewUrl || '';
    },

    isCloudPhotoStorageEnabled() {
        return !!storageDb;
    },

    isBatchShared(batch) {
        const type = String(batch?.collaborationSettings?.type || batch?.visibility || '').toLowerCase();
        return type === 'shared';
    },

    serializePhotoItemForCloud(photo) {
        const normalized = this.normalizePhotoItem(photo);
        if (!normalized) return null;
        if (!this.isCloudPhotoStorageEnabled()) return null;
        if (this.isDataUrl(normalized.url)) return null;
        return this.removeUndefinedDeep({
            url: normalized.url,
            storagePath: normalized.storagePath || '',
            uploadedAt: normalized.uploadedAt || '',
            uploadedBy: normalized.uploadedBy || ''
        });
    },

    getPhotoStoragePaths(photos = []) {
        return this.normalizePhotoList(photos)
            .map((photo) => photo.storagePath || '')
            .filter(Boolean);
    },

    getStorageRoot() {
        return storageDb ? storageDb.ref() : null;
    },

    makeStoragePhotoPath(batch, scope, recordId = '') {
        const ownerUid = this.data.currentUser?.uid || batch?.ownerUid || 'anonymous';
        const routeId = this.getBatchRouteId(batch) || String(batch?.id || 'batch');
        const safeRecordId = recordId ? `/${String(recordId).replace(/[^a-zA-Z0-9_-]/g, '_')}` : '';
        const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        return `batch-photos/${ownerUid}/${routeId}/${scope}${safeRecordId}/${unique}.jpg`;
    },

    async uploadPhotoToStorage(batch, photo, scope, recordId = '') {
        const normalized = this.normalizePhotoItem(photo);
        if (!normalized) return null;
        if (!this.isDataUrl(normalized.url)) {
            return {
                ...normalized,
                previewUrl: normalized.url
            };
        }
        const root = this.getStorageRoot();
        if (!root) {
            return {
                ...normalized,
                previewUrl: normalized.url
            };
        }
        const storagePath = this.makeStoragePhotoPath(batch, scope, recordId);
        const ref = root.child(storagePath);
        await ref.putString(normalized.url, 'data_url');
        const downloadUrl = await ref.getDownloadURL();
        return {
            url: downloadUrl,
            previewUrl: downloadUrl,
            storagePath,
            uploadedAt: new Date().toISOString(),
            uploadedBy: this.normalizeEmail(this.data.currentUser?.email || '')
        };
    },

    async syncPhotoListToCloud(batch, photos, scope, recordId = '') {
        const normalized = this.normalizePhotoList(photos);
        const results = [];
        for (const photo of normalized) {
            const uploaded = await this.uploadPhotoToStorage(batch, photo, scope, recordId);
            if (uploaded) results.push(uploaded);
        }
        return results.slice(0, 9);
    },

    async deleteStorageFiles(paths = []) {
        const root = this.getStorageRoot();
        if (!root) return;
        const uniquePaths = Array.from(new Set((Array.isArray(paths) ? paths : []).filter(Boolean)));
        await Promise.all(uniquePaths.map(async (storagePath) => {
            try {
                await root.child(storagePath).delete();
            } catch (error) {
            }
        }));
    },

    removeUndefinedDeep(value) {
        if (Array.isArray(value)) {
            return value
                .map((item) => this.removeUndefinedDeep(item))
                .filter((item) => item !== undefined);
        }
        if (value && typeof value === 'object') {
            const result = {};
            Object.entries(value).forEach(([key, nested]) => {
                const cleaned = this.removeUndefinedDeep(nested);
                if (cleaned !== undefined) result[key] = cleaned;
            });
            return result;
        }
        return value === undefined ? null : value;
    },

    getBatchesCollection() {
        return firestoreDb ? firestoreDb.collection('batches') : null;
    },

    getRecordsCollection(batch) {
        if (!firestoreDb || !batch?.cloudId) return null;
        return firestoreDb.collection('batches').doc(String(batch.cloudId)).collection('records');
    },

    buildCloudBatchPayload(batch, options = {}) {
        const collaboration = batch?.collaborationSettings || {};
        const collaboratorEmails = this.normalizeCollaboratorEmails(
            Array.isArray(collaboration.collaborators) ? collaboration.collaborators : batch?.collaboratorEmails || []
        );
        const cloudPhotosEnabled = this.isCloudPhotoStorageEnabled();
        const cloudFinalPhotos = cloudPhotosEnabled
            ? this.normalizePhotoList(batch?.finalAssessment?.finalCompostPhotos || [])
                .map((photo) => this.serializePhotoItemForCloud(photo))
                .filter(Boolean)
            : [];
        const finalAssessment = batch?.finalAssessment
            ? {
                ...batch.finalAssessment,
                finalCompostPhotos: cloudFinalPhotos,
                finalCompostPhotosCount: cloudFinalPhotos.length
            }
            : null;

        const payload = {
            id: batch.id,
            startDate: batch.startDate || '',
            manager: batch.manager || '',
            location: batch.location || '',
            notes: batch.notes || '',
            measurementSettings: batch.measurementSettings || null,
            settings: batch.settings || null,
            initialStock: batch.initialStock || null,
            compostingSystemInformation: batch.compostingSystemInformation || null,
            foodWasteLibrary: Array.isArray(batch.foodWasteLibrary) ? batch.foodWasteLibrary : [],
            structuralMaterialLibrary: Array.isArray(batch.structuralMaterialLibrary) ? batch.structuralMaterialLibrary : [],
            collaborationSettings: {
                ...collaboration,
                type: collaboration.type || 'private',
                collaborators: collaboratorEmails
            },
            status: batch.status || 'active',
            output: batch.output || null,
            finalAssessment,
            currentPhase: batch.currentPhase || '',
            finishedDate: batch.finishedDate || '',
            ownerUid: batch.ownerUid || this.data.currentUser?.uid || '',
            ownerEmail: batch.ownerEmail || this.normalizeEmail(this.data.currentUser?.email || ''),
            visibility: collaboration.type === 'shared' ? 'shared' : 'private',
            collaboratorEmails,
            activityLog: this.getBatchActivityLog(batch),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        if (!batch.cloudId && !options.skipCreatedAt) {
            payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        }

        return this.removeUndefinedDeep(payload);
    },

    buildCloudRecordPayload(record) {
        const normalizedRecord = this.normalizeRecordForCompatibility(record);
        const cloudPhotosEnabled = this.isCloudPhotoStorageEnabled();
        const photos = cloudPhotosEnabled && Array.isArray(normalizedRecord?.uploadedPhotos) ? normalizedRecord.uploadedPhotos : [];
        const cloudPhotos = cloudPhotosEnabled
            ? this.normalizePhotoList(photos)
                .map((photo) => this.serializePhotoItemForCloud(photo))
                .filter(Boolean)
            : [];
        return this.removeUndefinedDeep({
            ...normalizedRecord,
            id: String(normalizedRecord?.id || ''),
            uploadedPhotos: cloudPhotos,
            uploadedPhotosCount: cloudPhotos.length,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    },

    normalizeCloudBatch(doc) {
        const data = doc.data() || {};
        const collaboratorEmails = this.normalizeCollaboratorEmails(data.collaboratorEmails || data?.collaborationSettings?.collaborators || []);
        const finalAssessment = data.finalAssessment
            ? {
                ...data.finalAssessment,
                finalCompostPhotos: this.normalizePhotoList(data.finalAssessment.finalCompostPhotos)
            }
            : null;
        return {
            ...data,
            cloudId: doc.id,
            ownerUid: data.ownerUid || '',
            ownerEmail: data.ownerEmail || '',
            finalAssessment,
            activityLog: Array.isArray(data.activityLog) ? data.activityLog : [],
            collaboratorEmails,
            collaborationSettings: {
                ...(data.collaborationSettings || {}),
                type: data.visibility || data?.collaborationSettings?.type || 'private',
                collaborators: collaboratorEmails
            },
            records: []
        };
    },

    normalizeCloudRecord(doc) {
        const data = doc.data() || {};
        return this.normalizeRecordForCompatibility({
            ...data,
            id: String(data.id || doc.id),
            uploadedPhotos: this.normalizePhotoList(data.uploadedPhotos)
        });
    },

    normalizeBatchForCompatibility(batch) {
        if (!batch) return batch;
        const records = Array.isArray(batch.records) ? batch.records : [];
        return {
            ...batch,
            records: records.map((record) => this.normalizeRecordForCompatibility(record, batch))
        };
    },

    getDefaultRecordMetadata() {
        return {
            createdByUID: '',
            createdByEmail: '',
            createdByName: '',
            createdAt: '',
            lastEditedByUID: '',
            lastEditedByEmail: '',
            lastEditedByName: '',
            lastEditedAt: ''
        };
    },

    normalizeRecordMetadata(raw) {
        const base = this.getDefaultRecordMetadata();
        const input = raw && typeof raw === 'object' ? raw : {};
        return {
            ...base,
            createdByUID: String(input.createdByUID || ''),
            createdByEmail: String(input.createdByEmail || ''),
            createdByName: String(input.createdByName || ''),
            createdAt: String(input.createdAt || ''),
            lastEditedByUID: String(input.lastEditedByUID || ''),
            lastEditedByEmail: String(input.lastEditedByEmail || ''),
            lastEditedByName: String(input.lastEditedByName || ''),
            lastEditedAt: String(input.lastEditedAt || '')
        };
    },

    getDefaultMaterialTransfer() {
        return {
            performed: false,
            transferDate: '',
            sourceBatchId: '',
            sourceComposterId: '',
            destinationBatchId: '',
            destinationComposterId: '',
            materialType: '',
            amount: 0,
            unit: '',
            notes: ''
        };
    },

    normalizeMaterialTransfer(raw, batch = null) {
        const base = this.getDefaultMaterialTransfer();
        const input = raw && typeof raw === 'object' ? raw : {};
        const hasContent = [
            input.transferDate,
            input.sourceBatchId,
            input.sourceComposterId,
            input.destinationBatchId,
            input.destinationComposterId,
            input.materialType,
            input.notes
        ].some((value) => String(value || '').trim() !== '') || (input.amount != null && !isNaN(input.amount) && (parseFloat(input.amount) || 0) > 0);
        const performed = input.performed === true || input.performed === 'true' || hasContent;
        const parsedAmount = input.amount != null && input.amount !== '' ? parseFloat(input.amount) : 0;
        const unit = performed
            ? String(input.unit || this.getBatchInputUnitName(batch) || '')
            : String(input.unit || '');
        return {
            ...base,
            performed,
            transferDate: String(input.transferDate || ''),
            sourceBatchId: String(input.sourceBatchId || ''),
            sourceComposterId: String(input.sourceComposterId || ''),
            destinationBatchId: String(input.destinationBatchId || ''),
            destinationComposterId: String(input.destinationComposterId || ''),
            materialType: String(input.materialType || ''),
            amount: isNaN(parsedAmount) ? 0 : parsedAmount,
            unit,
            notes: String(input.notes || '')
        };
    },

    normalizeRecordForCompatibility(record, batch = null) {
        const raw = record && typeof record === 'object' ? record : {};
        return {
            ...raw,
            id: String(raw.id || ''),
            uploadedPhotos: this.normalizePhotoList(raw.uploadedPhotos),
            materialTransfer: this.normalizeMaterialTransfer(raw.materialTransfer, batch),
            metadata: this.normalizeRecordMetadata(raw.metadata)
        };
    },

    getBatchComposterIds(batch) {
        const compostingInfo = batch?.compostingSystemInformation || {};
        const composterIdsFromTable = Array.isArray(compostingInfo.composters)
            ? compostingInfo.composters
                .map((composter) => (composter && composter.composterId != null) ? String(composter.composterId).trim() : '')
                .filter((value) => !!value)
            : [];
        const fallbackCount = (compostingInfo.numberOfCompostersUsed != null && !isNaN(compostingInfo.numberOfCompostersUsed))
            ? Math.max(1, Math.min(50, parseInt(compostingInfo.numberOfCompostersUsed, 10)))
            : 2;
        return composterIdsFromTable.length > 0
            ? Array.from(new Set(composterIdsFromTable))
            : Array.from({ length: fallbackCount }, (_, index) => String(index + 1));
    },

    formatComposterLabel(composterId) {
        const value = String(composterId || '').trim();
        if (!value) return '—';
        return /^composter\b/i.test(value) ? value : `Composter ${value}`;
    },

    findBatchByExactId(batchId) {
        const target = String(batchId || '').trim();
        if (!target) return null;
        return this.data.batches.find((batch) => (
            String(batch?.id || '').trim() === target
            || String(batch?.cloudId || '').trim() === target
            || String(this.getBatchRouteId(batch) || '').trim() === target
        )) || null;
    },

    getCurrentOperatorIdentity() {
        const authUser = firebaseAuth.currentUser || null;
        const currentUser = this.data.currentUser || {};
        const uid = String(currentUser.uid || authUser?.uid || '').trim();
        const email = String(currentUser.email || authUser?.email || '').trim();
        const cachedProfile = uid ? (this.loadCachedUserProfile(uid) || {}) : {};
        const rawName = String(
            currentUser.displayName
            || authUser?.displayName
            || cachedProfile.name
            || cachedProfile.fullName
            || cachedProfile.displayName
            || ''
        ).trim();
        const emailFallback = email.includes('@') ? email.split('@')[0] : email;
        return {
            uid,
            email,
            name: rawName || emailFallback || ''
        };
    },

    getMaterialTransferState(record, batch, recordDate = '') {
        const normalizedRecord = this.normalizeRecordForCompatibility(record, batch);
        const base = normalizedRecord.materialTransfer || this.getDefaultMaterialTransfer();
        const composterIds = this.getBatchComposterIds(batch);
        return {
            ...base,
            transferDate: base.transferDate || recordDate || '',
            sourceBatchId: base.sourceBatchId || batch?.id || '',
            sourceComposterId: base.sourceComposterId || String(record?.composterId || composterIds[0] || ''),
            destinationBatchId: base.destinationBatchId || batch?.id || '',
            destinationComposterId: base.destinationComposterId || '',
            unit: base.unit || this.getBatchInputUnitName(batch)
        };
    },

    hasMaterialTransferContent(transfer) {
        const normalized = this.normalizeMaterialTransfer(transfer);
        return normalized.performed;
    },

    getTransferBatchLabel(batchId, currentBatch = null) {
        const value = String(batchId || '').trim();
        if (!value) return '—';
        if (currentBatch && this.batchMatchesTransferId(currentBatch, value)) return currentBatch.id || value;
        const matchedBatch = this.findBatchByExactId(value);
        return matchedBatch?.id || value;
    },

    batchMatchesTransferId(batch, transferBatchId) {
        const target = String(transferBatchId || '').trim();
        if (!batch || !target) return false;
        return [batch.id, batch.cloudId, this.getBatchRouteId(batch)]
            .map((value) => String(value || '').trim())
            .filter(Boolean)
            .includes(target);
    },

    collectBatchTransferData(batch, options = {}) {
        const inputUnit = this.getBatchInputUnitName(batch);
        const dateFrom = String(options.dateFrom || '').trim();
        const dateTo = String(options.dateTo || '').trim();
        const summary = {
            incomingCount: 0,
            incomingAmount: 0,
            outgoingCount: 0,
            outgoingAmount: 0,
            history: []
        };
        if (!batch) return summary;

        this.data.batches.forEach((batchEntry) => {
            const records = Array.isArray(batchEntry?.records) ? batchEntry.records : [];
            records.forEach((rawRecord) => {
                const record = this.normalizeRecordForCompatibility(rawRecord, batchEntry);
                const transfer = this.normalizeMaterialTransfer(record.materialTransfer, batch);
                if (!transfer.performed) return;
                const effectiveDate = String(transfer.transferDate || record.date || '').trim();
                if (dateFrom && effectiveDate && effectiveDate < dateFrom) return;
                if (dateTo && effectiveDate && effectiveDate > dateTo) return;

                const isIncoming = this.batchMatchesTransferId(batch, transfer.destinationBatchId);
                const isOutgoing = this.batchMatchesTransferId(batch, transfer.sourceBatchId);
                if (!isIncoming && !isOutgoing) return;

                const amount = transfer.amount != null && !isNaN(transfer.amount) ? (parseFloat(transfer.amount) || 0) : 0;
                if (isIncoming) {
                    summary.incomingCount += 1;
                    summary.incomingAmount += amount;
                }
                if (isOutgoing) {
                    summary.outgoingCount += 1;
                    summary.outgoingAmount += amount;
                }

                summary.history.push({
                    effectiveDate,
                    recordDate: record.date || '',
                    ownerBatchId: batchEntry?.id || '',
                    composterId: record.composterId || '',
                    sourceBatchLabel: this.getTransferBatchLabel(transfer.sourceBatchId, batch),
                    sourceComposterLabel: this.formatComposterLabel(transfer.sourceComposterId),
                    destinationBatchLabel: this.getTransferBatchLabel(transfer.destinationBatchId, batch),
                    destinationComposterLabel: this.formatComposterLabel(transfer.destinationComposterId),
                    materialType: transfer.materialType || '',
                    amount,
                    unit: transfer.unit || inputUnit,
                    notes: transfer.notes || '',
                    metadata: this.normalizeRecordMetadata(record.metadata),
                    isIncoming,
                    isOutgoing
                });
            });
        });

        summary.history.sort((a, b) => {
            const dateCompare = String(b.effectiveDate || '').localeCompare(String(a.effectiveDate || ''));
            if (dateCompare !== 0) return dateCompare;
            return String(b.recordDate || '').localeCompare(String(a.recordDate || ''));
        });

        return summary;
    },

    formatTransferSummaryText(count, amount, unit) {
        const safeCount = count || 0;
        const label = safeCount === 1 ? 'transfer' : 'transfers';
        return `${this.formatNumber(amount || 0, 3)} ${unit} (${safeCount} ${label})`;
    },

    async loadCloudBatches() {
        const collection = this.getBatchesCollection();
        const uid = this.data.currentUser?.uid;
        const email = this.normalizeEmail(this.data.currentUser?.email || '');
        if (!collection || !uid) return [];

        const requests = [collection.where('ownerUid', '==', uid).get()];
        if (email) requests.push(collection.where('collaboratorEmails', 'array-contains', email).get());
        const snapshots = await Promise.all(requests);
        const docMap = new Map();
        snapshots.forEach((snapshot) => {
            snapshot.forEach((doc) => docMap.set(doc.id, doc));
        });

        const batches = await Promise.all(Array.from(docMap.values()).map(async (doc) => {
            const batch = this.normalizeCloudBatch(doc);
            const recordsCollection = this.getRecordsCollection(batch);
            if (recordsCollection) {
                const recordsSnap = await recordsCollection.get();
                batch.records = recordsSnap.docs
                    .map((recordDoc) => this.normalizeCloudRecord(recordDoc))
                    .sort((a, b) => new Date(a.date) - new Date(b.date));
            }
            return batch;
        }));

        return batches.sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || '')));
    },

    async upsertBatchToCloud(batch, options = {}) {
        const collection = this.getBatchesCollection();
        if (!collection || !batch || !this.data.currentUser?.uid) return batch;
        const payload = this.buildCloudBatchPayload(batch, options);
        if (batch.cloudId) {
            await collection.doc(String(batch.cloudId)).set(payload, { merge: true });
        } else {
            const ref = collection.doc();
            await ref.set(payload, { merge: true });
            batch.cloudId = ref.id;
        }
        return batch;
    },

    async upsertDailyRecordToCloud(batch, record) {
        const recordsCollection = this.getRecordsCollection(batch);
        if (!recordsCollection || !record?.id) return;
        await recordsCollection.doc(String(record.id)).set(this.buildCloudRecordPayload(record), { merge: true });
    },

    async deleteDailyRecordFromCloud(batch, recordId, removedPhotoPaths = []) {
        const recordsCollection = this.getRecordsCollection(batch);
        if (!recordsCollection || recordId == null) return;
        await recordsCollection.doc(String(recordId)).delete();
        await this.deleteStorageFiles(removedPhotoPaths);
    },

    async deleteBatchFromCloud(batch) {
        if (!firestoreDb || !batch?.cloudId) return;
        const recordsCollection = this.getRecordsCollection(batch);
        const photoPaths = [];
        (Array.isArray(batch?.records) ? batch.records : []).forEach((record) => {
            photoPaths.push(...this.getPhotoStoragePaths(record?.uploadedPhotos || []));
        });
        photoPaths.push(...this.getPhotoStoragePaths(batch?.finalAssessment?.finalCompostPhotos || []));
        if (recordsCollection) {
            const recordsSnap = await recordsCollection.get();
            await Promise.all(recordsSnap.docs.map((doc) => doc.ref.delete()));
        }
        await firestoreDb.collection('batches').doc(String(batch.cloudId)).delete();
        await this.deleteStorageFiles(photoPaths);
    },

    getBatchMeasurementSettings(batch) {
        const raw = (batch && batch.measurementSettings) ? batch.measurementSettings : {};
        const inputMethod = (raw && raw.inputMethod) ? String(raw.inputMethod) : 'weight';
        const normalizedMethod = ['weight', 'volume', 'other'].includes(inputMethod) ? inputMethod : 'weight';

        if (normalizedMethod === 'volume') {
            const bucketSizeL = (raw && raw.bucketSizeL != null && !isNaN(raw.bucketSizeL)) ? parseFloat(raw.bucketSizeL) : 2;
            const bucketConversionEnabled = raw && raw.bucketConversionEnabled != null ? !!raw.bucketConversionEnabled : true;
            return {
                inputMethod: 'volume',
                unitName: 'L',
                bucketSizeL,
                bucketConversionEnabled,
                customUnitName: ''
            };
        }

        if (normalizedMethod === 'other') {
            const customUnitName = (raw && raw.customUnitName) ? String(raw.customUnitName).trim() : '';
            return {
                inputMethod: 'other',
                unitName: customUnitName || 'Unit',
                bucketSizeL: null,
                bucketConversionEnabled: false,
                customUnitName
            };
        }

        return {
            inputMethod: 'weight',
            unitName: 'kg',
            bucketSizeL: null,
            bucketConversionEnabled: false,
            customUnitName: ''
        };
    },

    getBatchInputUnitName(batch) {
        const settings = this.getBatchMeasurementSettings(batch);
        return settings.unitName || 'kg';
    },

    getBatchCalculationSettings(batch) {
        const raw = batch?.settings || {};
        const useCustom = !!raw.useCustomConversionRate;
        const storedRate = raw.compostConversionRate != null ? parseFloat(raw.compostConversionRate) : null;
        const compostConversionRate = (storedRate != null && !isNaN(storedRate) && storedRate >= 0)
            ? storedRate
            : 0.36;
        return {
            useCustomConversionRate: useCustom,
            compostConversionRate,
            monitoringProtocol: raw.monitoringProtocol === 'advanced' ? 'advanced' : 'basic'
        };
    },

    getBatchMonitoringProtocol(batch) {
        return this.getBatchCalculationSettings(batch).monitoringProtocol;
    },

    getInitialStockState(batch) {
        const initial = batch?.initialStock || null;
        if (!initial) {
            return { exists: false, materials: [] };
        }

        const legacyExists = initial.exists === true || initial.exists === 'yes';
        const hasMaterials = Array.isArray(initial.materials) && initial.materials.length > 0;
        const materials = hasMaterials
            ? initial.materials.map((item, index) => {
                const materialType = String(item?.materialType || item?.type || '').trim();
                return {
                    id: String(item?.id || `initial-stock-${index + 1}`),
                    materialType,
                    materialDescription: String(item?.materialDescription || item?.otherType || '').trim(),
                    materialWeight: item?.materialWeight != null
                        ? (parseFloat(item.materialWeight) || 0)
                        : (item?.amount != null ? (parseFloat(item.amount) || 0) : 0),
                    approximateHeightCm: item?.approximateHeightCm != null
                        ? (parseFloat(item.approximateHeightCm) || 0)
                        : (item?.height != null ? (parseFloat(item.height) || 0) : 0),
                    composterId: String(item?.composterId || item?.location || '').trim(),
                    notes: String(item?.notes || '').trim(),
                    purpose: materialType === 'Structural Material'
                        ? String(item?.purpose || '').trim()
                        : ''
                };
            })
            : (legacyExists ? [{
                id: 'initial-stock-1',
                materialType: String(initial.type || '').trim(),
                materialDescription: String(initial.otherType || '').trim(),
                materialWeight: initial.amount != null ? (parseFloat(initial.amount) || 0) : 0,
                approximateHeightCm: initial.height != null ? (parseFloat(initial.height) || 0) : 0,
                composterId: String(initial.composterId || initial.location || '').trim(),
                notes: '',
                purpose: String(initial.purpose || '').trim()
            }] : []);

        return {
            exists: hasMaterials || legacyExists,
            materials: materials.filter((item) => item.materialType || item.materialWeight || item.approximateHeightCm || item.composterId || item.notes)
        };
    },

    calculateTotalMaterialInput(batch) {
        return this.calculateBatchMaterialTotals(batch).totalMaterialInput;
    },

    calculateTotalSystemMassInput(batch) {
        return this.calculateInitialStockAmount(batch) + this.calculateTotalMaterialInput(batch) + this.calculateTotalWaterAdded(batch);
    },

    calculateEstimatedCompostOutput(batch) {
        const settings = this.getBatchCalculationSettings(batch);
        return (this.calculateInitialStockAmount(batch) + this.calculateTotalMaterialInput(batch)) * settings.compostConversionRate;
    },

    getICTAMonitoringState(record) {
        const process = record?.process || {};
        const observation = record?.observation || {};
        const monitoring = record?.monitoring || {};
        const advancedMonitoring = monitoring.advancedMonitoring || {};

        const normalizeBool = (value) => {
            if (value === true || value === 'true' || value === 1 || value === '1') return true;
            if (value === false || value === 'false' || value === 0 || value === '0') return false;
            return null;
        };

        const mapLegacyOdourDistanceFromLevel = (level) => {
            if (level === 'less_than_1m') return 'lt_1m';
            if (level === 'between_1_and_5m') return '1_5m';
            if (level === 'greater_than_5m') return 'gt_5m';
            return null;
        };

        const getOdourState = () => {
            const explicitDetected = normalizeBool(monitoring.odourDetected);
            const explicitType = String(monitoring.odourType || '').trim() || null;
            const explicitDistance = String(monitoring.odourDistance || '').trim() || null;
            if (explicitDetected !== null || explicitType || explicitDistance) {
                return {
                    odourDetected: explicitDetected,
                    odourType: explicitType,
                    odourDistance: explicitDistance
                };
            }

            const legacyLevel = String(monitoring.odourLevel || '').trim();
            if (legacyLevel && legacyLevel !== 'no_odour') {
                return {
                    odourDetected: true,
                    odourType: null,
                    odourDistance: mapLegacyOdourDistanceFromLevel(legacyLevel)
                };
            }

            if (observation.odour === 'Strong') {
                return { odourDetected: true, odourType: null, odourDistance: 'gt_5m' };
            }
            if (observation.odour === 'Slight') {
                return { odourDetected: true, odourType: null, odourDistance: '1_5m' };
            }

            return { odourDetected: null, odourType: null, odourDistance: null };
        };

        const deriveLegacyOdourLevel = (odourDetected, odourDistance) => {
            if (odourDetected === false) return 'no_odour';
            if (odourDetected === true) {
                if (odourDistance === 'lt_1m') return 'less_than_1m';
                if (odourDistance === '1_5m') return 'between_1_and_5m';
                if (odourDistance === 'gt_5m') return 'greater_than_5m';
                return 'between_1_and_5m';
            }
            return 'no_odour';
        };

        const mapLeachateFromObservation = () => {
            const stored = String(monitoring.leachateObserved ?? '').trim();
            if (stored) return stored;
            if (observation.leachate === 'Yes') return 'yes';
            if (observation.leachate === 'No') return 'no';
            return '';
        };

        const quantitativeMoisture = monitoring.moistureValue != null
            ? monitoring.moistureValue
            : (process.moisture != null ? process.moisture : null);

        const getOptionalAdvancedField = (key, unit = '') => {
            const rawEnabled = advancedMonitoring?.[`${key}Enabled`];
            const value = advancedMonitoring?.[key];
            const numericValue = value != null && value !== '' && !isNaN(value) ? (parseFloat(value) || 0) : null;
            return {
                enabled: rawEnabled === true || rawEnabled === 'true' || numericValue != null,
                value: numericValue,
                unit
            };
        };
        const recordDate = String(record?.date || '').trim();
        const samplingDate = String(advancedMonitoring?.samplingDate || recordDate).trim();
        const measurementDate = String(advancedMonitoring?.measurementDate || samplingDate).trim();
        const odourState = getOdourState();

        const moistureAssessmentType = String(monitoring.moistureAssessmentType || '').trim()
            || (quantitativeMoisture != null ? 'quantitative' : ((monitoring.moistureQualitative || '') ? 'qualitative' : ''));

        return {
            recordDate,
            ambientTemperature: monitoring.ambientTemperature != null ? monitoring.ambientTemperature : (process.ambient != null ? process.ambient : null),
            ambientHumidity: monitoring.ambientHumidity != null ? monitoring.ambientHumidity : null,
            coreTemperature: monitoring.coreTemperature != null ? monitoring.coreTemperature : (process.core != null ? process.core : null),
            transitionTemperature: monitoring.transitionTemperature != null ? monitoring.transitionTemperature : (process.transition != null ? process.transition : null),
            outerTemperature: monitoring.outerTemperature != null ? monitoring.outerTemperature : (process.outer != null ? process.outer : null),
            moistureAssessmentType,
            moistureValue: quantitativeMoisture,
            moistureQualitative: monitoring.moistureQualitative || '',
            odourDetected: odourState.odourDetected,
            odourType: odourState.odourType,
            odourDistance: odourState.odourDistance,
            odourLevel: monitoring.odourLevel || deriveLegacyOdourLevel(odourState.odourDetected, odourState.odourDistance),
            leachateObserved: mapLeachateFromObservation(),
            advancedMonitoring: {
                samplingDate,
                measurementDate,
                laboratoryMoisture: getOptionalAdvancedField('laboratoryMoisture', '%'),
                oxygen: getOptionalAdvancedField('oxygen', '%'),
                ammonia: getOptionalAdvancedField('ammonia', 'ppm'),
                carbonDioxide: getOptionalAdvancedField('carbonDioxide', 'ppm'),
                methane: getOptionalAdvancedField('methane', 'ppm'),
                hydrogenSulfide: getOptionalAdvancedField('hydrogenSulfide', 'ppm'),
                voc: getOptionalAdvancedField('voc', 'ppm'),
                nitrousOxide: getOptionalAdvancedField('nitrousOxide', 'ppm'),
                organicMatter: getOptionalAdvancedField('organicMatter', '%'),
                electricalConductivity: getOptionalAdvancedField('electricalConductivity', 'mS/cm'),
                notes: String(advancedMonitoring?.notes || advancedMonitoring?.additionalNotes || '').trim()
            }
        };
    },

    getModuleToggleLabel(label, isCompleted) {
        return isCompleted ? `☑ ${label}` : `☐ ${label}`;
    },

    syncModuleToggleText(textEl, label) {
        if (!textEl) return;
        const isCompleted = textEl.dataset.completed === 'true';
        textEl.textContent = this.getModuleToggleLabel(label, isCompleted);
    },

    updateModuleCompletionState(textEl, label, isCompleted) {
        if (!textEl) return;
        textEl.dataset.completed = isCompleted ? 'true' : 'false';
        this.syncModuleToggleText(textEl, label);
    },

    hasMonitoringStateContent(monitoring) {
        if (!monitoring) return false;
        const advanced = monitoring.advancedMonitoring || {};
        return [
            monitoring.ambientTemperature,
            monitoring.ambientHumidity,
            monitoring.coreTemperature,
            monitoring.transitionTemperature,
            monitoring.outerTemperature,
            monitoring.moistureValue
        ].some(value => value != null && value !== '' && !isNaN(value))
            || !!monitoring.moistureQualitative
            || monitoring.odourDetected === true
            || monitoring.odourDetected === false
            || !!monitoring.odourType
            || !!monitoring.odourDistance
            || (monitoring.odourLevel && monitoring.odourLevel !== 'no_odour')
            || (monitoring.leachateObserved && monitoring.leachateObserved !== 'not_assessed')
            || ['laboratoryMoisture', 'oxygen', 'ammonia', 'carbonDioxide', 'methane', 'hydrogenSulfide', 'voc', 'nitrousOxide', 'organicMatter', 'electricalConductivity']
                .some((key) => advanced?.[key]?.value != null && advanced[key].value !== '' && !isNaN(advanced[key].value))
            || !!advanced.notes;
    },

    hasMaintenanceStateContent(maintenance) {
        if (!maintenance) return false;
        const numericValues = [
            maintenance.totalFoodWaste,
            maintenance.regularStructuralMaterial,
            maintenance.additionalOrganicMaterial,
            maintenance.additionalStructuralMaterial,
            maintenance.totalAdditionalInput,
            maintenance.totalOrganicWaste,
            maintenance.totalStructuralMaterial,
            maintenance.totalMaterialInput,
            maintenance.totalOrganicInput,
            maintenance.foodWasteCocina,
            maintenance.foodWastePlanta0,
            maintenance.foodWastePlanta1,
            maintenance.foodWastePlanta3,
            maintenance.woodFusta,
            maintenance.woodChips
        ];
        if (numericValues.some(value => value != null && !isNaN(value) && Number(value) > 0)) return true;
        const foodRows = Array.isArray(maintenance.foodWasteEntries) ? maintenance.foodWasteEntries : (Array.isArray(maintenance.foodWasteSources) ? maintenance.foodWasteSources : []);
        if (foodRows.some((row) => {
            const hasLibraryRef = !!String(row?.sourceId || '').trim();
            if (hasLibraryRef) return Number(row?.amount || 0) > 0;
            return (Number(row?.amount || 0) > 0)
                || !!String(row?.source || '').trim()
                || !!String(row?.type || '').trim()
                || !!String(row?.otherType || '').trim();
        })) return true;
        const structRows = Array.isArray(maintenance.structuralMaterialEntries) ? maintenance.structuralMaterialEntries : (Array.isArray(maintenance.structuralMaterials) ? maintenance.structuralMaterials : []);
        if (structRows.some((row) => {
            const hasLibraryRef = !!String(row?.materialId || '').trim();
            if (hasLibraryRef) return Number(row?.amount || 0) > 0;
            return (Number(row?.amount || 0) > 0)
                || !!String(row?.type || '').trim()
                || !!String(row?.otherType || '').trim()
                || !!String(row?.material || '').trim();
        })) return true;
        const additionalRows = Array.isArray(maintenance.additionalInputs) ? maintenance.additionalInputs : [];
        return additionalRows.some(row => (row?.source || '').trim() || (row?.description || '').trim() || Number(row?.amount || 0) > 0 || ((row?.type || '') !== 'organic' && (row?.type || '') !== ''));
    },

    hasActionTakenContent(action) {
        if (!action) return false;
        return !!(
            action.actionTurning ||
            action.actionMixing ||
            action.actionAddedWater ||
            action.actionRemovedImpurities ||
            action.actionOther ||
            (action.waterAddedAmount != null && Number(action.waterAddedAmount) > 0) ||
            (action.removedImpuritiesDescription || '').trim() ||
            (action.otherActionDescription || '').trim()
        );
    },

    hasPhotosContent(photos) {
        return Array.isArray(photos) && photos.length > 0;
    },

    hasNotesContent(notes) {
        return !!String(notes || '').trim();
    },

    renderMonitoringPlaceholder(label, compact = false) {
        return `
            <div style="margin-top: ${compact ? '0' : '8px'}; padding: ${compact ? '22px 14px' : '18px'}; border: 2px dashed #C8E6C9; border-radius: 10px; background: #FAFFFA; color: var(--gray); text-align: center; font-size: ${compact ? '0.85rem' : '0.9rem'};">
                Placeholder image: ${label}
            </div>
        `;
    },

    renderMaintenanceSummaryInfoButton(title, description) {
        const safeTitle = String(title || '').replace(/'/g, "\\'");
        const safeDescription = String(description || '').replace(/'/g, "\\'");
        return `<button type="button" class="maintenance-summary-info-btn" onclick="event.stopPropagation(); app.showMaintenanceSummaryInfo('${safeTitle}', '${safeDescription}')">ⓘ</button>`;
    },

    renderMoistureGuideImage(kind, compact = false) {
        const srcMap = {
            dry: 'assets/moisture-guides/dry.jpg',
            optimal: 'assets/moisture-guides/optimal.jpg',
            wet: 'assets/moisture-guides/wet.jpg'
        };
        const labelMap = {
            dry: 'Dry moisture assessment',
            optimal: 'Optimal moisture assessment',
            wet: 'Wet moisture assessment'
        };
        const src = srcMap[kind] || '';
        const label = labelMap[kind] || 'Moisture assessment';
        if (!src) return this.renderMonitoringPlaceholder(label, compact);
        return `
            <div class="moisture-guide-illustration">
                <img class="moisture-guide-image" src="${src}" alt="${label}"
                    onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
                <div style="display:none;">${this.renderMonitoringPlaceholder(label, compact)}</div>
            </div>
        `;
    },

    renderICTAMonitoringModule(monitoring) {
        const moistureType = String(monitoring.moistureAssessmentType || '').trim()
            || (monitoring.moistureValue != null ? 'quantitative' : ((monitoring.moistureQualitative || '') ? 'qualitative' : ''));
        const showQuantitative = moistureType === 'quantitative';
        const showQualitative = moistureType === 'qualitative';
        const odourDetectedChoice = monitoring.odourDetected === true
            ? 'detected'
            : (monitoring.odourDetected === false ? 'no' : '');
        const showOdourDetails = monitoring.odourDetected === true;
        const odourType = String(monitoring.odourType || '').trim();
        const odourDistance = String(monitoring.odourDistance || '').trim();
        const leachateObserved = String(monitoring.leachateObserved || '').trim();
        const isCompleted = this.hasMonitoringStateContent(monitoring);
        const showAdvanced = this.getBatchMonitoringProtocol(this.data.currentBatch) === 'advanced';

        return `
            <div class="card">
                <div style="display: flex; align-items: center; justify-content: space-between; cursor: pointer;" onclick="app.toggleICTAMonitoringModule()">
                    <h2 class="card-title module-title process" id="monitoringModuleToggleText" data-completed="${isCompleted ? 'true' : 'false'}" style="margin: 0;">${this.getModuleToggleLabel('Monitoring Module', isCompleted)}</h2>
                    <span id="monitoringModuleToggleIcon" style="color: var(--gray); font-weight: 700;">▸</span>
                </div>

                <div id="monitoringModuleContent" style="display: none; margin-top: 20px;">
                    <div class="module" style="background: #F3F8FF; border-color: #BBDEFB;">
                        <h3 class="module-title" style="color: #1976D2;">🌤 Environmental Conditions</h3>
                        <div style="display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px;">
                            <div class="form-group" style="margin-bottom: 0;">
                                <label class="form-label">Ambient Temperature (℃)</label>
                                <input type="number" class="form-input" id="ambientTemperature" step="any" value="${monitoring.ambientTemperature != null ? monitoring.ambientTemperature : ''}">
                            </div>
                            <div class="form-group" style="margin-bottom: 0;">
                                <label class="form-label">Ambient Humidity (%)</label>
                                <input type="number" class="form-input" id="ambientHumidity" step="any" value="${monitoring.ambientHumidity != null ? monitoring.ambientHumidity : ''}">
                            </div>
                        </div>
                    </div>

                    <div class="module" style="background: #F4FBF4; border-color: #C8E6C9;">
                        <h3 class="module-title process">Temperature Monitoring</h3>
                        <div class="monitoring-temperature-grid">
                            <div class="monitoring-temperature-card">
                                <label class="form-label" style="margin-bottom: 6px;">Core Temperature (°C)</label>
                                <button type="button" class="btn btn-secondary monitoring-help-btn" onclick="event.stopPropagation(); app.showTemperatureGuide('core')">ⓘ How to Measure</button>
                                <input type="number" class="form-input" id="coreTemperature" step="any" value="${monitoring.coreTemperature != null ? monitoring.coreTemperature : ''}">
                            </div>
                            <div class="monitoring-temperature-card">
                                <label class="form-label required" style="margin-bottom: 6px;">Transition Temperature (°C)</label>
                                <button type="button" class="btn btn-secondary monitoring-help-btn" onclick="event.stopPropagation(); app.showTemperatureGuide('transition')">ⓘ How to Measure</button>
                                <input type="number" class="form-input" id="transitionTemperature" step="any" value="${monitoring.transitionTemperature != null ? monitoring.transitionTemperature : ''}">
                            </div>
                            <div class="monitoring-temperature-card">
                                <label class="form-label required" style="margin-bottom: 6px;">Outer Temperature (°C)</label>
                                <button type="button" class="btn btn-secondary monitoring-help-btn" onclick="event.stopPropagation(); app.showTemperatureGuide('outer')">ⓘ How to Measure</button>
                                <input type="number" class="form-input" id="outerTemperature" step="any" value="${monitoring.outerTemperature != null ? monitoring.outerTemperature : ''}">
                            </div>
                        </div>
                    </div>

                    <div class="module" style="background: #FFFDF4; border-color: #FFE082;">
                        <h3 class="module-title" style="color: #F57C00;">Moisture Assessment</h3>
                        <div class="radio-group" style="margin-bottom: 15px;">
                            <label class="radio-item">
                                <input type="radio" name="moistureAssessmentType" value="quantitative" ${showQuantitative ? 'checked' : ''} onchange="app.updateICTAMoistureAssessmentVisibility()">
                                Quantitative
                            </label>
                            <label class="radio-item">
                                <input type="radio" name="moistureAssessmentType" value="qualitative" ${showQualitative ? 'checked' : ''} onchange="app.updateICTAMoistureAssessmentVisibility()">
                                Qualitative
                            </label>
                        </div>

                        <div id="moistureQuantitativeSection" style="${showQuantitative ? '' : 'display:none;'}">
                            <div class="form-group">
                                <label class="form-label">Moisture (%)</label>
                                <input type="number" class="form-input" id="moistureValue" step="any" value="${monitoring.moistureValue != null ? monitoring.moistureValue : ''}">
                            </div>
                        </div>

                        <div id="moistureQualitativeSection" style="${showQualitative ? '' : 'display:none;'}">
                            <div style="margin-bottom: 12px; color: var(--gray);">Take a handful of compost and squeeze firmly.</div>
                            <div class="moisture-card-grid">
                                <label class="moisture-card">
                                    <input type="radio" name="moistureQualitative" value="dry" ${monitoring.moistureQualitative === 'dry' ? 'checked' : ''}>
                                    <div class="moisture-card-content">
                                        <div class="moisture-card-image">${this.renderMoistureGuideImage('dry', true)}</div>
                                        <div class="moisture-card-title">Dry</div>
                                        <div class="moisture-card-desc">No shape remains after squeezing</div>
                                    </div>
                                </label>
                                <label class="moisture-card">
                                    <input type="radio" name="moistureQualitative" value="optimal" ${monitoring.moistureQualitative === 'optimal' ? 'checked' : ''}>
                                    <div class="moisture-card-content">
                                        <div class="moisture-card-image">${this.renderMoistureGuideImage('optimal', true)}</div>
                                        <div class="moisture-card-title">Optimal</div>
                                        <div class="moisture-card-desc">Keeps shape and releases 1–2 drops</div>
                                    </div>
                                </label>
                                <label class="moisture-card">
                                    <input type="radio" name="moistureQualitative" value="wet" ${monitoring.moistureQualitative === 'wet' ? 'checked' : ''}>
                                    <div class="moisture-card-content">
                                        <div class="moisture-card-image">${this.renderMoistureGuideImage('wet', true)}</div>
                                        <div class="moisture-card-title">Wet</div>
                                        <div class="moisture-card-desc">Water flows out when squeezed</div>
                                    </div>
                                </label>
                            </div>
                        </div>
                    </div>

                    <div class="module" style="background: #F3F8FF; border-color: #BBDEFB;">
                        <h3 class="module-title" style="color: #1976D2;">Odour Assessment <button type="button" class="btn btn-secondary" style="padding: 4px 10px; font-size: 0.8rem;" onclick="event.stopPropagation(); app.showOdourGuide()">ⓘ Odour Guide</button></h3>

                        <div class="form-group" style="margin-bottom: 0;">
                            <label class="form-label">Is any noticeable odour detected?</label>
                            <div class="radio-group" style="flex-direction: column; align-items: flex-start;">
                                <label class="radio-item">
                                    <input type="radio" name="odourDetected" value="no" ${odourDetectedChoice === 'no' ? 'checked' : ''} onchange="app.updateOdourAssessmentVisibility()">
                                    No Noticeable Odour
                                </label>
                                <label class="radio-item">
                                    <input type="radio" name="odourDetected" value="detected" ${odourDetectedChoice === 'detected' ? 'checked' : ''} onchange="app.updateOdourAssessmentVisibility()">
                                    Odour Detected
                                </label>
                            </div>
                        </div>

                        <div id="odourDetectedDetails" style="${showOdourDetails ? '' : 'display:none;'}">
                            <div style="margin-top: 14px; padding-top: 14px; border-top: 1px solid #E3F2FD;">
                                <div style="font-weight: 700; margin-bottom: 10px;">A. Odour Type</div>
                                <div class="radio-group" style="flex-direction: column; align-items: flex-start;">
                                    <label class="radio-item" style="align-items: flex-start;">
                                        <input type="radio" name="odourType" value="earth" ${odourType === 'earth' ? 'checked' : ''}>
                                        <div>
                                            <div>Earth / Forest Odour</div>
                                            <div style="color: var(--gray); font-size: 0.9rem;">Natural soil smell. Indicates compost is operating normally.</div>
                                        </div>
                                    </label>
                                    <label class="radio-item" style="align-items: flex-start;">
                                        <input type="radio" name="odourType" value="vinegar" ${odourType === 'vinegar' ? 'checked' : ''}>
                                        <div>
                                            <div>Vinegar Odour</div>
                                            <div style="color: var(--gray); font-size: 0.9rem;">Sour smell. Often indicates too much fruit/vegetable content.</div>
                                        </div>
                                    </label>
                                    <label class="radio-item" style="align-items: flex-start;">
                                        <input type="radio" name="odourType" value="rotten" ${odourType === 'rotten' ? 'checked' : ''}>
                                        <div>
                                            <div>Rotten Odour</div>
                                            <div style="color: var(--gray); font-size: 0.9rem;">Strong rotten smell. Usually indicates insufficient oxygen (anaerobic conditions).</div>
                                        </div>
                                    </label>
                                    <label class="radio-item" style="align-items: flex-start;">
                                        <input type="radio" name="odourType" value="ammonia" ${odourType === 'ammonia' ? 'checked' : ''}>
                                        <div>
                                            <div>Ammonia / Fermented Odour</div>
                                            <div style="color: var(--gray); font-size: 0.9rem;">Strong ammonia or fermented smell. Often indicates too much nitrogen-rich material.</div>
                                        </div>
                                    </label>
                                </div>
                            </div>

                            <div style="margin-top: 14px; padding-top: 14px; border-top: 1px solid #E3F2FD;">
                                <div style="font-weight: 700; margin-bottom: 10px;">B. Odour Detection Distance</div>
                                <div style="color: var(--gray); font-size: 0.9rem; margin-bottom: 12px;">
                                    Estimated detection distance under normal outdoor conditions (without strong wind).
                                </div>
                                <div class="radio-group" style="flex-direction: column; align-items: flex-start;">
                                    <label class="radio-item">
                                        <input type="radio" name="odourDistance" value="lt_1m" ${odourDistance === 'lt_1m' ? 'checked' : ''}>
                                        Detected &lt;1 m
                                    </label>
                                    <label class="radio-item">
                                        <input type="radio" name="odourDistance" value="1_5m" ${odourDistance === '1_5m' ? 'checked' : ''}>
                                        Detected 1–5 m
                                    </label>
                                    <label class="radio-item">
                                        <input type="radio" name="odourDistance" value="gt_5m" ${odourDistance === 'gt_5m' ? 'checked' : ''}>
                                        Detected &gt;5 m
                                    </label>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="module" style="background: #FFF8F8; border-color: #FFCDD2;">
                        <h3 class="module-title" style="color: #C62828;">Leachate Assessment</h3>
                        <div class="form-group">
                            <label class="form-label">Leachate Observed</label>
                            <div class="radio-group">
                                <label class="radio-item">
                                    <input type="radio" name="leachateObserved" value="yes" ${leachateObserved === 'yes' ? 'checked' : ''}>
                                    Yes
                                </label>
                                <label class="radio-item">
                                    <input type="radio" name="leachateObserved" value="no" ${leachateObserved === 'no' ? 'checked' : ''}>
                                    No
                                </label>
                                <label class="radio-item">
                                    <input type="radio" name="leachateObserved" value="not_assessed" ${leachateObserved === 'not_assessed' ? 'checked' : ''}>
                                    Not Assessed
                                </label>
                            </div>
                        </div>
                    </div>

                    ${showAdvanced ? this.renderAdvancedMonitoringSection(monitoring) : ''}
                    ${this.renderSystemRecommendationModule()}
                </div>
            </div>
        `;
    },

    renderNonICTAMonitoringModule(monitoring) {
        const moistureType = String(monitoring.moistureAssessmentType || '').trim()
            || (monitoring.moistureValue != null ? 'quantitative' : ((monitoring.moistureQualitative || '') ? 'qualitative' : ''));
        const showQuantitative = moistureType === 'quantitative';
        const showQualitative = moistureType === 'qualitative';
        const odourDetectedChoice = monitoring.odourDetected === true
            ? 'detected'
            : (monitoring.odourDetected === false ? 'no' : '');
        const showOdourDetails = monitoring.odourDetected === true;
        const odourType = String(monitoring.odourType || '').trim();
        const odourDistance = String(monitoring.odourDistance || '').trim();
        const leachateObserved = String(monitoring.leachateObserved || '').trim();
        const isCompleted = this.hasMonitoringStateContent(monitoring);
        const showAdvanced = this.getBatchMonitoringProtocol(this.data.currentBatch) === 'advanced';

        return `
            <div class="card">
                <div style="display: flex; align-items: center; justify-content: space-between; cursor: pointer;" onclick="app.toggleICTAMonitoringModule()">
                    <h2 class="card-title module-title process" id="monitoringModuleToggleText" data-completed="${isCompleted ? 'true' : 'false'}" style="margin: 0;">${this.getModuleToggleLabel('Monitoring Module', isCompleted)}</h2>
                    <span id="monitoringModuleToggleIcon" style="color: var(--gray); font-weight: 700;">▸</span>
                </div>

                <div id="monitoringModuleContent" style="display: none; margin-top: 20px;">
                    <div class="module" style="background: #F3F8FF; border-color: #BBDEFB;">
                        <h3 class="module-title" style="color: #1976D2;">🌤 Environmental Conditions</h3>
                        <div style="display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px;">
                            <div class="form-group" style="margin-bottom: 0;">
                                <label class="form-label">Ambient Temperature (℃)</label>
                                <input type="number" class="form-input" id="ambientTemperature" step="any" value="${monitoring.ambientTemperature != null ? monitoring.ambientTemperature : ''}">
                            </div>
                            <div class="form-group" style="margin-bottom: 0;">
                                <label class="form-label">Ambient Humidity (%)</label>
                                <input type="number" class="form-input" id="ambientHumidity" step="any" value="${monitoring.ambientHumidity != null ? monitoring.ambientHumidity : ''}">
                            </div>
                        </div>
                    </div>

                    <div class="module" style="background: #F4FBF4; border-color: #C8E6C9;">
                        <h3 class="module-title process">Temperature Monitoring</h3>
                        <div class="monitoring-temperature-grid" style="grid-template-columns: minmax(0, 1fr);">
                            <div class="monitoring-temperature-card">
                                <label class="form-label" style="margin-bottom: 6px;">Core Temperature (°C)</label>
                                <button type="button" class="btn btn-secondary monitoring-help-btn" onclick="event.stopPropagation(); app.showTemperatureGuide('core')">ⓘ How to Measure</button>
                                <input type="number" class="form-input" id="coreTemperature" step="any" value="${monitoring.coreTemperature != null ? monitoring.coreTemperature : ''}">
                            </div>
                        </div>
                    </div>

                    <div class="module" style="background: #FFFDF4; border-color: #FFE082;">
                        <h3 class="module-title" style="color: #F57C00;">Moisture Assessment</h3>
                        <div class="radio-group" style="margin-bottom: 15px;">
                            <label class="radio-item">
                                <input type="radio" name="moistureAssessmentType" value="quantitative" ${showQuantitative ? 'checked' : ''} onchange="app.updateICTAMoistureAssessmentVisibility()">
                                Quantitative
                            </label>
                            <label class="radio-item">
                                <input type="radio" name="moistureAssessmentType" value="qualitative" ${showQualitative ? 'checked' : ''} onchange="app.updateICTAMoistureAssessmentVisibility()">
                                Qualitative
                            </label>
                        </div>

                        <div id="moistureQuantitativeSection" style="${showQuantitative ? '' : 'display:none;'}">
                            <div class="form-group">
                                <label class="form-label">Moisture (%)</label>
                                <input type="number" class="form-input" id="moistureValue" step="any" value="${monitoring.moistureValue != null ? monitoring.moistureValue : ''}">
                            </div>
                        </div>

                        <div id="moistureQualitativeSection" style="${showQualitative ? '' : 'display:none;'}">
                            <div style="margin-bottom: 12px; color: var(--gray);">Take a handful of compost and squeeze firmly.</div>
                            <div class="moisture-card-grid">
                                <label class="moisture-card">
                                    <input type="radio" name="moistureQualitative" value="dry" ${monitoring.moistureQualitative === 'dry' ? 'checked' : ''}>
                                    <div class="moisture-card-content">
                                        <div class="moisture-card-image">${this.renderMoistureGuideImage('dry', true)}</div>
                                        <div class="moisture-card-title">Dry</div>
                                        <div class="moisture-card-desc">No shape remains after squeezing</div>
                                    </div>
                                </label>
                                <label class="moisture-card">
                                    <input type="radio" name="moistureQualitative" value="optimal" ${monitoring.moistureQualitative === 'optimal' ? 'checked' : ''}>
                                    <div class="moisture-card-content">
                                        <div class="moisture-card-image">${this.renderMoistureGuideImage('optimal', true)}</div>
                                        <div class="moisture-card-title">Optimal</div>
                                        <div class="moisture-card-desc">Keeps shape and releases 1–2 drops</div>
                                    </div>
                                </label>
                                <label class="moisture-card">
                                    <input type="radio" name="moistureQualitative" value="wet" ${monitoring.moistureQualitative === 'wet' ? 'checked' : ''}>
                                    <div class="moisture-card-content">
                                        <div class="moisture-card-image">${this.renderMoistureGuideImage('wet', true)}</div>
                                        <div class="moisture-card-title">Wet</div>
                                        <div class="moisture-card-desc">Water flows out when squeezed</div>
                                    </div>
                                </label>
                            </div>
                        </div>
                    </div>

                    <div class="module" style="background: #F3F8FF; border-color: #BBDEFB;">
                        <h3 class="module-title" style="color: #1976D2;">Odour Assessment <button type="button" class="btn btn-secondary" style="padding: 4px 10px; font-size: 0.8rem;" onclick="event.stopPropagation(); app.showOdourGuide()">ⓘ Odour Guide</button></h3>

                        <div class="form-group" style="margin-bottom: 0;">
                            <label class="form-label">Is any noticeable odour detected?</label>
                            <div class="radio-group" style="flex-direction: column; align-items: flex-start;">
                                <label class="radio-item">
                                    <input type="radio" name="odourDetected" value="no" ${odourDetectedChoice === 'no' ? 'checked' : ''} onchange="app.updateOdourAssessmentVisibility()">
                                    No Noticeable Odour
                                </label>
                                <label class="radio-item">
                                    <input type="radio" name="odourDetected" value="detected" ${odourDetectedChoice === 'detected' ? 'checked' : ''} onchange="app.updateOdourAssessmentVisibility()">
                                    Odour Detected
                                </label>
                            </div>
                        </div>

                        <div id="odourDetectedDetails" style="${showOdourDetails ? '' : 'display:none;'}">
                            <div style="margin-top: 14px; padding-top: 14px; border-top: 1px solid #E3F2FD;">
                                <div style="font-weight: 700; margin-bottom: 10px;">A. Odour Type</div>
                                <div class="radio-group" style="flex-direction: column; align-items: flex-start;">
                                    <label class="radio-item" style="align-items: flex-start;">
                                        <input type="radio" name="odourType" value="earth" ${odourType === 'earth' ? 'checked' : ''}>
                                        <div>
                                            <div>Earth / Forest Odour</div>
                                            <div style="color: var(--gray); font-size: 0.9rem;">Natural soil smell. Indicates compost is operating normally.</div>
                                        </div>
                                    </label>
                                    <label class="radio-item" style="align-items: flex-start;">
                                        <input type="radio" name="odourType" value="vinegar" ${odourType === 'vinegar' ? 'checked' : ''}>
                                        <div>
                                            <div>Vinegar Odour</div>
                                            <div style="color: var(--gray); font-size: 0.9rem;">Sour smell. Often indicates too much fruit/vegetable content.</div>
                                        </div>
                                    </label>
                                    <label class="radio-item" style="align-items: flex-start;">
                                        <input type="radio" name="odourType" value="rotten" ${odourType === 'rotten' ? 'checked' : ''}>
                                        <div>
                                            <div>Rotten Odour</div>
                                            <div style="color: var(--gray); font-size: 0.9rem;">Strong rotten smell. Usually indicates insufficient oxygen (anaerobic conditions).</div>
                                        </div>
                                    </label>
                                    <label class="radio-item" style="align-items: flex-start;">
                                        <input type="radio" name="odourType" value="ammonia" ${odourType === 'ammonia' ? 'checked' : ''}>
                                        <div>
                                            <div>Ammonia / Fermented Odour</div>
                                            <div style="color: var(--gray); font-size: 0.9rem;">Strong ammonia or fermented smell. Often indicates too much nitrogen-rich material.</div>
                                        </div>
                                    </label>
                                </div>
                            </div>

                            <div style="margin-top: 14px; padding-top: 14px; border-top: 1px solid #E3F2FD;">
                                <div style="font-weight: 700; margin-bottom: 10px;">B. Odour Detection Distance</div>
                                <div style="color: var(--gray); font-size: 0.9rem; margin-bottom: 12px;">
                                    Estimated detection distance under normal outdoor conditions (without strong wind).
                                </div>
                                <div class="radio-group" style="flex-direction: column; align-items: flex-start;">
                                    <label class="radio-item">
                                        <input type="radio" name="odourDistance" value="lt_1m" ${odourDistance === 'lt_1m' ? 'checked' : ''}>
                                        Detected &lt;1 m
                                    </label>
                                    <label class="radio-item">
                                        <input type="radio" name="odourDistance" value="1_5m" ${odourDistance === '1_5m' ? 'checked' : ''}>
                                        Detected 1–5 m
                                    </label>
                                    <label class="radio-item">
                                        <input type="radio" name="odourDistance" value="gt_5m" ${odourDistance === 'gt_5m' ? 'checked' : ''}>
                                        Detected &gt;5 m
                                    </label>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="module" style="background: #FFF8F8; border-color: #FFCDD2;">
                        <h3 class="module-title" style="color: #C62828;">Leachate Assessment</h3>
                        <div class="form-group">
                            <label class="form-label">Leachate Observed</label>
                            <div class="radio-group">
                                <label class="radio-item">
                                    <input type="radio" name="leachateObserved" value="yes" ${leachateObserved === 'yes' ? 'checked' : ''}>
                                    Yes
                                </label>
                                <label class="radio-item">
                                    <input type="radio" name="leachateObserved" value="no" ${leachateObserved === 'no' ? 'checked' : ''}>
                                    No
                                </label>
                                <label class="radio-item">
                                    <input type="radio" name="leachateObserved" value="not_assessed" ${leachateObserved === 'not_assessed' ? 'checked' : ''}>
                                    Not Assessed
                                </label>
                            </div>
                        </div>
                    </div>

                    ${showAdvanced ? this.renderAdvancedMonitoringSection(monitoring) : ''}
                    ${this.renderSystemRecommendationModule()}
                </div>
            </div>
        `;
    },

    renderSystemRecommendationModule() {
        return `
            <div class="module system-recommendation-module" id="systemRecommendationModule" style="display:none;">
                <h3 class="module-title system-recommendation-title">💡 System Recommendation</h3>
                <div class="system-recommendation-section">
                    <div class="system-recommendation-heading">🩺 Current Compost Condition</div>
                    <div id="systemRecommendationInterpretations" class="system-recommendation-list"></div>
                </div>
                <div class="system-recommendation-section" style="margin-top: 14px;">
                    <div class="system-recommendation-heading">🔧 Recommended Actions</div>
                    <div id="systemRecommendationActions" class="system-recommendation-list"></div>
                </div>
            </div>
        `;
    },

    renderAdvancedMonitoringField(config, state) {
        const enabled = !!state?.enabled;
        const value = state?.value != null && !isNaN(state.value) ? this.formatNumber(state.value, 6) : '';
        const unitControl = `<span class="advanced-monitoring-unit-fixed">${this.escapeAttr(config.unit || '')}</span>`;
        return `
            <div class="advanced-monitoring-field-card">
                <label class="checkbox-item advanced-monitoring-checkbox">
                    <input type="checkbox" id="${config.id}Enabled" ${enabled ? 'checked' : ''} onchange="app.updateAdvancedMonitoringFieldVisibility()">
                    ${config.label}
                </label>
                ${config.description ? `<div class="advanced-monitoring-field-desc">${this.escapeHtml(config.description)}</div>` : ''}
                <div class="advanced-monitoring-field-inputs" id="${config.id}Row" style="${enabled ? '' : 'display:none;'}">
                    <input type="number" class="form-input advanced-monitoring-value" id="${config.id}Value" step="any" value="${value}" placeholder="${config.placeholder || 'Enter value'}" ${enabled ? '' : 'disabled'}>
                    ${unitControl}
                </div>
            </div>
        `;
    },

    renderAdvancedMonitoringSection(monitoring) {
        const advanced = monitoring.advancedMonitoring || {};
        const fields = [
            {
                id: 'advancedLaboratoryMoisture',
                label: 'Laboratory Moisture',
                unit: '%',
                description: 'Relative moisture determined using laboratory oven-drying methods.',
                state: advanced.laboratoryMoisture
            },
            {
                id: 'advancedOxygen',
                label: 'Oxygen (O2)',
                unit: '%',
                description: 'Oxygen concentration inside the compost.',
                state: advanced.oxygen
            },
            {
                id: 'advancedAmmonia',
                label: 'Ammonia (NH3)',
                unit: 'ppm',
                description: 'Measured ammonia concentration.',
                state: advanced.ammonia
            },
            {
                id: 'advancedCarbonDioxide',
                label: 'Carbon Dioxide (CO2)',
                unit: 'ppm',
                description: 'Measured carbon dioxide concentration.',
                state: advanced.carbonDioxide
            },
            {
                id: 'advancedMethane',
                label: 'Methane (CH4)',
                unit: 'ppm',
                description: 'Measured methane concentration.',
                state: advanced.methane
            },
            {
                id: 'advancedHydrogenSulfide',
                label: 'Hydrogen Sulfide (H2S)',
                unit: 'ppm',
                description: 'Measured hydrogen sulfide concentration.',
                state: advanced.hydrogenSulfide
            },
            {
                id: 'advancedVoc',
                label: 'Volatile Organic Compounds (VOC)',
                unit: 'ppm',
                description: 'Measured volatile organic compound concentration.',
                state: advanced.voc
            },
            {
                id: 'advancedNitrousOxide',
                label: 'Nitrous Oxide (N2O)',
                unit: 'ppm',
                description: 'Measured nitrous oxide concentration.',
                state: advanced.nitrousOxide
            },
            {
                id: 'advancedOrganicMatter',
                label: 'Organic Matter',
                unit: '%',
                description: 'Organic matter content determined through laboratory analysis.',
                state: advanced.organicMatter
            },
            {
                id: 'advancedElectricalConductivity',
                label: 'Electrical Conductivity (EC)',
                unit: 'mS/cm',
                description: 'Electrical conductivity of the compost sample.',
                state: advanced.electricalConductivity
            }
        ];
        return `
            <div class="module advanced-monitoring-module" style="background: #F8F5FF; border-color: #D1C4E9;">
                <div class="advanced-monitoring-header" onclick="app.toggleAdvancedMonitoringSection()">
                    <div>
                        <h3 class="module-title" style="color: #6A1B9A; margin: 0;">🔬 Advanced Monitoring</h3>
                        <div class="advanced-monitoring-subtitle">Optional laboratory and research measurements. Record only the parameters that are available.</div>
                    </div>
                    <span id="advancedMonitoringToggleIcon" style="color: var(--gray); font-weight: 700;">▸</span>
                </div>
                <div id="advancedMonitoringContent" class="advanced-monitoring-content">
                    <div class="advanced-monitoring-date-grid">
                        <div class="form-group" style="margin-bottom: 0;">
                            <label class="form-label">Sampling Date</label>
                            <div class="advanced-monitoring-date-readonly">${this.escapeHtml(advanced.samplingDate || monitoring.recordDate || '') || '—'}</div>
                        </div>
                        <div class="form-group" style="margin-bottom: 0;">
                            <label class="form-label">Measurement Date</label>
                            <input type="date" class="form-input" id="advancedMeasurementDate" value="${this.escapeAttr(advanced.measurementDate || advanced.samplingDate || monitoring.recordDate || '')}">
                        </div>
                    </div>
                    <div class="advanced-monitoring-grid">
                        ${fields.map((field) => this.renderAdvancedMonitoringField(field, field.state)).join('')}
                    </div>
                    <div class="form-group" style="margin-top: 16px;">
                        <label class="form-label">Additional Notes</label>
                        <textarea class="form-input" id="advancedMonitoringNotes" rows="3" placeholder="Optional.">${this.escapeAttr(advanced.notes || advanced.additionalNotes || '')}</textarea>
                    </div>
                </div>
            </div>
        `;
    },

    toggleAdvancedMonitoringSection() {
        const content = document.getElementById('advancedMonitoringContent');
        const icon = document.getElementById('advancedMonitoringToggleIcon');
        if (!content || !icon) return;
        const isOpen = content.classList.toggle('is-open');
        icon.textContent = isOpen ? '▾' : '▸';
    },

    updateAdvancedMonitoringFieldVisibility() {
        [
            'advancedLaboratoryMoisture',
            'advancedOxygen',
            'advancedCarbonDioxide',
            'advancedMethane',
            'advancedAmmonia',
            'advancedHydrogenSulfide',
            'advancedVoc',
            'advancedNitrousOxide',
            'advancedElectricalConductivity',
            'advancedOrganicMatter'
        ].forEach((baseId) => {
            const enabledEl = document.getElementById(`${baseId}Enabled`);
            const rowEl = document.getElementById(`${baseId}Row`);
            const valueEl = document.getElementById(`${baseId}Value`);
            const unitEl = document.getElementById(`${baseId}Unit`);
            const enabled = !!enabledEl?.checked;
            if (rowEl) rowEl.style.display = enabled ? 'grid' : 'none';
            if (valueEl) {
                valueEl.disabled = !enabled;
                if (!enabled) valueEl.value = '';
            }
            if (unitEl) unitEl.disabled = !enabled;
        });
        this.refreshDailyRecordModuleCompletionStates();
    },

    getICTAMaintenanceState(record, batch) {
        const input = record?.input || {};
        const maintenance = record?.maintenance || {};
        const batchUnit = batch ? this.getBatchInputUnitName(batch) : 'kg';
        const batchMethod = batch ? (this.getBatchMeasurementSettings(batch)?.inputMethod || '') : '';

        const foodWasteCocina = (maintenance.foodWasteCocina != null ? maintenance.foodWasteCocina : input.cocina) || 0;
        const foodWastePlanta0 = (maintenance.foodWastePlanta0 != null ? maintenance.foodWastePlanta0 : input.planta0) || 0;
        const foodWastePlanta1 = (maintenance.foodWastePlanta1 != null ? maintenance.foodWastePlanta1 : input.planta1) || 0;
        const foodWastePlanta3 = (maintenance.foodWastePlanta3 != null ? maintenance.foodWastePlanta3 : input.planta3) || 0;
        const woodFusta = (maintenance.woodFusta != null ? maintenance.woodFusta : input.woodFusta) || 0;
        const woodChips = (maintenance.woodChips != null ? maintenance.woodChips : input.woodChips) || 0;
        const breakdown = this.calculateRecordMaterialBreakdown({
            ...(record || {}),
            input,
            maintenance: {
                ...maintenance,
                foodWasteCocina,
                foodWastePlanta0,
                foodWastePlanta1,
                foodWastePlanta3,
                woodFusta,
                woodChips
            }
        });
        const foodStructuralRatio = (batchMethod === 'volume')
            ? this.simplifyRatio(breakdown.totalOrganicWaste, breakdown.totalStructuralMaterial)
            : '';

        return {
            batchUnit,
            batchMethod,
            foodWasteCocina,
            foodWastePlanta0,
            foodWastePlanta1,
            foodWastePlanta3,
            totalFoodWaste: breakdown.regularOrganicWaste,
            woodFusta,
            woodChips,
            regularStructuralMaterial: breakdown.regularStructuralMaterial,
            totalStructuralMaterial: breakdown.totalStructuralMaterial,
            additionalInputs: breakdown.additionalInputs,
            additionalOrganicMaterial: breakdown.additionalOrganicMaterial,
            additionalStructuralMaterial: breakdown.additionalStructuralMaterial,
            totalAdditionalInput: breakdown.totalAdditionalInput,
            totalOrganicWaste: breakdown.totalOrganicWaste,
            totalMaterialInput: breakdown.totalMaterialInput,
            totalOrganicInput: breakdown.totalMaterialInput,
            foodStructuralRatio
        };
    },

    simplifyRatio(a, b) {
        const x = (a != null && !isNaN(a)) ? (parseFloat(a) || 0) : 0;
        const y = (b != null && !isNaN(b)) ? (parseFloat(b) || 0) : 0;
        if (x <= 0 || y <= 0) return '—';

        const scale = 1000;
        const xi = Math.round(x * scale);
        const yi = Math.round(y * scale);
        const gcd = (m, n) => {
            let a = Math.abs(m);
            let b = Math.abs(n);
            while (b !== 0) {
                const t = b;
                b = a % b;
                a = t;
            }
            return a || 1;
        };
        const g = gcd(xi, yi);
        const left = Math.round(xi / g);
        const right = Math.round(yi / g);
        return `${left} : ${right}`;
    },

    renderICTAMaintenanceModule(batch, maintenance) {
        const inputUnit = maintenance.batchUnit || this.getBatchInputUnitName(batch);
        const isCompleted = this.hasMaintenanceStateContent(maintenance);
        const additionalRows = Array.isArray(maintenance.additionalInputs) && maintenance.additionalInputs.length > 0
            ? maintenance.additionalInputs
            : [{ source: '', type: 'organic', description: '', amount: 0 }];

        const sourceOptions = [
            'Organic waste generated during events',
            'Garden clean-up residues',
            'Seasonal pruning residues',
            'Research or experimental materials',
            'Other occasional organic inputs'
        ];

        return `
            <div class="card">
                <div style="display: flex; align-items: center; justify-content: space-between; cursor: pointer;" onclick="app.toggleICTAMaintenanceModule()">
                    <h2 class="card-title module-title maintenance" id="maintenanceModuleToggleText" data-completed="${isCompleted ? 'true' : 'false'}" style="margin: 0;">${this.getModuleToggleLabel('Maintenance Module', isCompleted)}</h2>
                    <span id="maintenanceModuleToggleIcon" style="color: var(--gray); font-weight: 700;">▸</span>
                </div>

                <div id="maintenanceModuleContent" style="display: none; margin-top: 20px;">
                    <div class="module" style="background: #F4FBF4; border-color: #C8E6C9;">
                        <div class="maintenance-section-header">
                            <h3 class="module-title maintenance" style="margin-bottom: 0;">Food Waste Input</h3>
                            <div class="maintenance-helptext">ⓘ Regularly collected food waste from the community collection system.</div>
                        </div>

                        <div class="maintenance-table">
                            <div class="maintenance-table-head">Food Waste Source</div>
                            <div class="maintenance-table-head" style="text-align:right;">Amount (${inputUnit})</div>

                            <div class="maintenance-table-cell">Cocina</div>
                            <div class="maintenance-table-cell">
                                <input type="number" class="form-input maintenance-amount" id="foodWasteCocina" step="any" value="${maintenance.foodWasteCocina != null && maintenance.foodWasteCocina !== 0 ? maintenance.foodWasteCocina : ''}" placeholder="Enter number" oninput="app.updateMaintenanceTotals()">
                            </div>

                            <div class="maintenance-table-cell">Planta 0</div>
                            <div class="maintenance-table-cell">
                                <input type="number" class="form-input maintenance-amount" id="foodWastePlanta0" step="any" value="${maintenance.foodWastePlanta0 != null && maintenance.foodWastePlanta0 !== 0 ? maintenance.foodWastePlanta0 : ''}" placeholder="Enter number" oninput="app.updateMaintenanceTotals()">
                            </div>

                            <div class="maintenance-table-cell">Planta 1</div>
                            <div class="maintenance-table-cell">
                                <input type="number" class="form-input maintenance-amount" id="foodWastePlanta1" step="any" value="${maintenance.foodWastePlanta1 != null && maintenance.foodWastePlanta1 !== 0 ? maintenance.foodWastePlanta1 : ''}" placeholder="Enter number" oninput="app.updateMaintenanceTotals()">
                            </div>

                            <div class="maintenance-table-cell">Planta 3</div>
                            <div class="maintenance-table-cell">
                                <input type="number" class="form-input maintenance-amount" id="foodWastePlanta3" step="any" value="${maintenance.foodWastePlanta3 != null && maintenance.foodWastePlanta3 !== 0 ? maintenance.foodWastePlanta3 : ''}" placeholder="Enter number" oninput="app.updateMaintenanceTotals()">
                            </div>
                        </div>

                        <div class="field-section" style="margin-top: 12px;">
                            <label class="field-section-title">Regular Organic Waste: <span class="auto-calc" id="regularOrganicWaste">${this.formatNumber(maintenance.totalFoodWaste || 0, 3)}</span> ${inputUnit}</label>
                        </div>
                    </div>

                    <div class="module" style="background: #FFFDF4; border-color: #FFE082;">
                        <h3 class="module-title" style="color: #F57C00;">Structural Material Input</h3>
                        <div class="maintenance-table">
                            <div class="maintenance-table-head">Structural Material Type</div>
                            <div class="maintenance-table-head" style="text-align:right;">Amount (${inputUnit})</div>

                            <div class="maintenance-table-cell">Wood Fusta</div>
                            <div class="maintenance-table-cell">
                                <input type="number" class="form-input maintenance-amount" id="woodFusta" step="any" value="${maintenance.woodFusta != null && maintenance.woodFusta !== 0 ? maintenance.woodFusta : ''}" placeholder="Enter number" oninput="app.updateMaintenanceTotals()">
                            </div>

                            <div class="maintenance-table-cell">Wood Chips</div>
                            <div class="maintenance-table-cell">
                                <input type="number" class="form-input maintenance-amount" id="woodChips" step="any" value="${maintenance.woodChips != null && maintenance.woodChips !== 0 ? maintenance.woodChips : ''}" placeholder="Enter number" oninput="app.updateMaintenanceTotals()">
                            </div>
                        </div>
                        <div class="field-section" style="margin-top: 12px;">
                            <label class="field-section-title">Regular Structural Material: <span class="auto-calc" id="regularStructuralMaterial">${this.formatNumber(maintenance.regularStructuralMaterial || 0, 3)}</span> ${inputUnit}</label>
                        </div>
                    </div>

                    <div class="module" style="background: #F3F8FF; border-color: #BBDEFB;">
                        <div style="display:flex; align-items:center; justify-content: space-between; cursor:pointer;" onclick="app.toggleICTAOtherOrganicInput()">
                            <h3 class="module-title" style="color: #1976D2; margin: 0;" id="otherOrganicToggleText">☐ Other Organic Input (Optional)</h3>
                            <span id="otherOrganicToggleIcon" style="color: var(--gray); font-weight: 700;">▸</span>
                        </div>
                        <div class="maintenance-helptext" style="margin-top: 8px;">ⓘ Occasional organic materials that are not part of the regular collection system.</div>

                        <div id="otherOrganicContent" style="display:none; margin-top: 16px;">
                            <div id="maintenanceAdditionalInputsList">
                                ${additionalRows.map((row, idx) => `
                                    <div class="maintenance-additional-row">
                                        <div class="maintenance-additional-grid">
                                            <div class="form-group">
                                                <label class="form-label">Source</label>
                                                <select class="form-input maintenance-additional-source" onchange="app.updateMaintenanceTotals()">
                                                    <option value="">Select source...</option>
                                                    ${sourceOptions.map(opt => `<option value="${opt.replace(/"/g, '&quot;')}" ${(row.source || '') === opt ? 'selected' : ''}>${opt}</option>`).join('')}
                                                </select>
                                            </div>
                                            <div class="form-group">
                                                <label class="form-label">Type</label>
                                                <div class="radio-group" style="gap: 14px;">
                                                    <label class="radio-item">
                                                        <input type="radio" name="maintenanceAdditionalType_${idx}" value="organic" ${(row.type || 'organic') === 'organic' ? 'checked' : ''} onchange="app.updateMaintenanceTotals()">
                                                        Organic Material
                                                    </label>
                                                    <label class="radio-item">
                                                        <input type="radio" name="maintenanceAdditionalType_${idx}" value="structural" ${(row.type || '') === 'structural' ? 'checked' : ''} onchange="app.updateMaintenanceTotals()">
                                                        Structural Material
                                                    </label>
                                                </div>
                                            </div>
                                            <div class="form-group">
                                                <label class="form-label">Material Description</label>
                                                <input type="text" class="form-input maintenance-additional-desc" value="${(row.description || '').replace(/"/g, '&quot;')}" oninput="app.updateMaintenanceTotals()">
                                            </div>
                                            <div class="form-group">
                                                <label class="form-label">Amount (${inputUnit})</label>
                                                <input type="number" class="form-input maintenance-additional-amount" step="any" value="${row.amount != null ? row.amount : ''}" oninput="app.updateMaintenanceTotals()">
                                            </div>
                                        </div>
                                        <div style="display:flex; justify-content:flex-end; margin-top: 10px;">
                                            <button type="button" class="btn btn-secondary" style="padding: 8px 12px;" onclick="app.removeMaintenanceAdditionalInputRow(this)">− Remove</button>
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                            <button type="button" class="btn btn-secondary" style="padding: 8px 12px;" onclick="app.addMaintenanceAdditionalInputRow()">+ Add Additional Input</button>

                            <div class="field-section" style="margin-top: 12px;">
                                <div class="field-section-title">Additional Input Summary</div>
                                <div class="maintenance-helptext" style="margin-top: 8px;">
                                    Additional Organic Material: <span class="auto-calc" id="additionalOrganicMaterial">${this.formatNumber(maintenance.additionalOrganicMaterial || 0, 3)}</span> ${inputUnit}
                                </div>
                                <div class="maintenance-helptext" style="margin-top: 4px;">
                                    Additional Structural Material: <span class="auto-calc" id="additionalStructuralMaterial">${this.formatNumber(maintenance.additionalStructuralMaterial || 0, 3)}</span> ${inputUnit}
                                </div>
                                <div class="maintenance-helptext" style="margin-top: 4px; font-weight: 700;">
                                    Total Additional Input: <span class="auto-calc" id="totalAdditionalInput">${this.formatNumber(maintenance.totalAdditionalInput || 0, 3)}</span> ${inputUnit}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="maintenance-summary-card">
                        <div class="maintenance-summary-value maintenance-summary-value-row">
                            <span>Organic Waste: <span id="totalOrganicWaste">${this.formatNumber(maintenance.totalOrganicWaste || 0, 3)}</span> ${inputUnit}</span>
                            ${this.renderMaintenanceSummaryInfoButton('Organic Waste', 'Regular Organic Waste + Additional Organic Material')}
                        </div>
                        <div class="maintenance-summary-value maintenance-summary-value-row" style="margin-top: 10px;">
                            <span>Structural Material: <span id="totalStructuralMaterialOverall">${this.formatNumber(maintenance.totalStructuralMaterial || 0, 3)}</span> ${inputUnit}</span>
                            ${this.renderMaintenanceSummaryInfoButton('Structural Material', 'Regular Structural Material + Additional Structural Material')}
                        </div>
                        <div class="maintenance-summary-value maintenance-summary-value-row" style="margin-top: 10px;">
                            <span>Total Material Input: <span id="totalMaterialInput">${this.formatNumber((maintenance.totalMaterialInput ?? maintenance.totalOrganicInput) || 0, 3)}</span> ${inputUnit}</span>
                            ${this.renderMaintenanceSummaryInfoButton('Total Material Input', 'Organic Waste + Structural Material')}
                        </div>
                    </div>
                </div>
            </div>
        `;
    },

    getNonICTAFoodTypeOptions() {
        return [
            'Fruit & Vegetable Waste',
            'Cooked Food Waste',
            'Coffee Grounds',
            'Bread & Bakery Waste',
            'Garden Waste',
            'Mixed Organic Waste',
            'Other'
        ];
    },

    makeNonICTALibraryItemId(prefix = 'lib') {
        return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    },

    normalizeNonICTAFoodWasteLibrary(batch) {
        const explicit = Array.isArray(batch?.foodWasteLibrary) ? batch.foodWasteLibrary : [];
        const normalizedExplicit = explicit
            .map((item) => ({
                id: String(item?.id || this.makeNonICTALibraryItemId('food')),
                source: String(item?.source || '').trim(),
                type: String(item?.type || '').trim(),
                active: item?.active !== false
            }))
            .filter((item) => item.source && item.type);
        if (normalizedExplicit.length > 0) return normalizedExplicit;

        const derived = [];
        const seen = new Set();
        const records = Array.isArray(batch?.records) ? batch.records : [];
        records.forEach((record) => {
            const maintenance = record?.maintenance || {};
            const rows = Array.isArray(maintenance.foodWasteSources) ? maintenance.foodWasteSources : [];
            rows.forEach((row) => {
                const source = String(row?.source || '').trim();
                const baseType = String(row?.type || '').trim();
                const otherType = String(row?.otherType || '').trim();
                const type = baseType === 'Other' ? otherType : (otherType || baseType);
                if (!source || !type) return;
                const key = `${source.toLowerCase()}__${type.toLowerCase()}`;
                if (seen.has(key)) return;
                seen.add(key);
                derived.push({
                    id: this.makeNonICTALibraryItemId('food'),
                    source,
                    type,
                    active: true
                });
            });
        });
        return derived;
    },

    normalizeNonICTAStructuralMaterialLibrary(batch) {
        const explicit = Array.isArray(batch?.structuralMaterialLibrary) ? batch.structuralMaterialLibrary : [];
        const normalizedExplicit = explicit
            .map((item) => ({
                id: String(item?.id || this.makeNonICTALibraryItemId('struct')),
                material: String(item?.material || '').trim(),
                active: item?.active !== false
            }))
            .filter((item) => item.material);
        if (normalizedExplicit.length > 0) return normalizedExplicit;

        const derived = [];
        const seen = new Set();
        const records = Array.isArray(batch?.records) ? batch.records : [];
        records.forEach((record) => {
            const maintenance = record?.maintenance || {};
            const legacyRows = Array.isArray(maintenance.structuralMaterials) ? maintenance.structuralMaterials : [];
            legacyRows.forEach((row) => {
                const baseType = String(row?.type || '').trim();
                const otherType = String(row?.otherType || '').trim();
                const material = baseType === 'Other' ? otherType : (otherType || baseType);
                if (!material) return;
                const key = material.toLowerCase();
                if (seen.has(key)) return;
                seen.add(key);
                derived.push({
                    id: this.makeNonICTALibraryItemId('struct'),
                    material,
                    active: true
                });
            });
            const legacyInputRows = Array.isArray(record?.input?.structuringMaterials) ? record.input.structuringMaterials : [];
            legacyInputRows.forEach((row) => {
                const material = String(row?.type || '').trim();
                if (!material) return;
                const key = material.toLowerCase();
                if (seen.has(key)) return;
                seen.add(key);
                derived.push({
                    id: this.makeNonICTALibraryItemId('struct'),
                    material,
                    active: true
                });
            });
        });
        return derived;
    },

    ensureNonICTAMaterialLibraries(batch) {
        if (!batch) {
            return {
                foodWasteLibrary: [],
                structuralMaterialLibrary: []
            };
        }

        const foodWasteLibrary = this.normalizeNonICTAFoodWasteLibrary(batch);
        const structuralMaterialLibrary = this.normalizeNonICTAStructuralMaterialLibrary(batch);
        batch.foodWasteLibrary = foodWasteLibrary;
        batch.structuralMaterialLibrary = structuralMaterialLibrary;
        return { foodWasteLibrary, structuralMaterialLibrary };
    },

    getLegacyNonICTAFoodEntryAmounts(maintenance, library) {
        const rows = Array.isArray(maintenance?.foodWasteSources) ? maintenance.foodWasteSources : [];
        const amounts = new Map();
        rows.forEach((row) => {
            const source = String(row?.source || '').trim();
            const baseType = String(row?.type || '').trim();
            const otherType = String(row?.otherType || '').trim();
            const type = baseType === 'Other' ? otherType : (otherType || baseType);
            const amount = (row?.amount != null && !isNaN(row.amount)) ? (parseFloat(row.amount) || 0) : 0;
            if (!source || !type || amount <= 0) return;
            const match = library.find((item) => item.source === source && item.type === type);
            if (!match) return;
            amounts.set(match.id, amount);
        });
        return amounts;
    },

    getLegacyNonICTAStructuralEntryAmounts(maintenance, input, library) {
        const amounts = new Map();
        const rows = Array.isArray(maintenance?.structuralMaterials) ? maintenance.structuralMaterials : [];
        rows.forEach((row) => {
            const baseType = String(row?.type || '').trim();
            const otherType = String(row?.otherType || '').trim();
            const material = baseType === 'Other' ? otherType : (otherType || baseType);
            const amount = (row?.amount != null && !isNaN(row.amount)) ? (parseFloat(row.amount) || 0) : 0;
            if (!material || amount <= 0) return;
            const match = library.find((item) => item.material === material);
            if (!match) return;
            amounts.set(match.id, amount);
        });

        if (amounts.size === 0) {
            const legacyInputRows = Array.isArray(input?.structuringMaterials) ? input.structuringMaterials : [];
            legacyInputRows.forEach((row) => {
                const material = String(row?.type || '').trim();
                const amount = (row?.kg != null && !isNaN(row.kg)) ? (parseFloat(row.kg) || 0) : 0;
                if (!material || amount <= 0) return;
                const match = library.find((item) => item.material === material);
                if (!match) return;
                amounts.set(match.id, amount);
            });
        }

        return amounts;
    },

    getNonICTAMaintenanceDraftFromDom() {
        const moduleContent = document.getElementById('maintenanceModuleContent');
        const otherContent = document.getElementById('otherOrganicContent');
        const foodWasteEntries = Array.from(document.querySelectorAll('#nonIctaFoodWasteRows .nonicta-library-row'))
            .map((row) => {
                const sourceId = row.getAttribute('data-source-id') || '';
                const amountValue = row.querySelector('.nonicta-food-amount')?.value;
                const amount = amountValue !== '' && amountValue != null ? parseFloat(amountValue) : 0;
                return {
                    sourceId,
                    amount: isNaN(amount) ? 0 : amount
                };
            });
        const structuralMaterialEntries = Array.from(document.querySelectorAll('#nonIctaStructuralRows .nonicta-library-row'))
            .map((row) => {
                const materialId = row.getAttribute('data-material-id') || '';
                const amountValue = row.querySelector('.nonicta-struct-amount')?.value;
                const amount = amountValue !== '' && amountValue != null ? parseFloat(amountValue) : 0;
                return {
                    materialId,
                    amount: isNaN(amount) ? 0 : amount
                };
            });
        const additionalInputs = Array.from(document.querySelectorAll('#maintenanceAdditionalInputsList .maintenance-additional-row'))
            .map((row) => {
                const source = row.querySelector('.maintenance-additional-source')?.value || '';
                const type = row.querySelector('input[type="radio"]:checked')?.value || 'organic';
                const description = row.querySelector('.maintenance-additional-desc')?.value || '';
                const amountValue = row.querySelector('.maintenance-additional-amount')?.value;
                const amount = amountValue !== '' && amountValue != null ? parseFloat(amountValue) : 0;
                return {
                    source,
                    type,
                    description,
                    amount: isNaN(amount) ? 0 : amount
                };
            });

        return {
            foodWasteEntries,
            structuralMaterialEntries,
            additionalInputs,
            moduleExpanded: !!moduleContent && moduleContent.style.display === 'block',
            otherOrganicExpanded: !!otherContent && otherContent.style.display === 'block'
        };
    },

    getNonICTAMaintenanceState(record, batch, draft = null) {
        const input = record?.input || {};
        const maintenance = record?.maintenance || {};
        const inputUnit = batch ? this.getBatchInputUnitName(batch) : 'kg';
        const libraries = this.ensureNonICTAMaterialLibraries(batch);
        const foodWasteLibraryAll = Array.isArray(libraries.foodWasteLibrary) ? libraries.foodWasteLibrary : [];
        const structuralMaterialLibraryAll = Array.isArray(libraries.structuralMaterialLibrary) ? libraries.structuralMaterialLibrary : [];

        const recordFoodEntries = Array.isArray(draft?.foodWasteEntries) && draft.foodWasteEntries.length > 0
            ? draft.foodWasteEntries
            : (Array.isArray(maintenance.foodWasteEntries) && maintenance.foodWasteEntries.length > 0
                ? maintenance.foodWasteEntries
                : Array.from(this.getLegacyNonICTAFoodEntryAmounts(maintenance, foodWasteLibraryAll), ([sourceId, amount]) => ({ sourceId, amount })));
        const recordStructuralEntries = Array.isArray(draft?.structuralMaterialEntries) && draft.structuralMaterialEntries.length > 0
            ? draft.structuralMaterialEntries
            : (Array.isArray(maintenance.structuralMaterialEntries) && maintenance.structuralMaterialEntries.length > 0
                ? maintenance.structuralMaterialEntries
                : Array.from(this.getLegacyNonICTAStructuralEntryAmounts(maintenance, input, structuralMaterialLibraryAll), ([materialId, amount]) => ({ materialId, amount })));

        const referencedFoodIds = new Set(recordFoodEntries.map((entry) => String(entry?.sourceId || '')).filter(Boolean));
        const referencedMaterialIds = new Set(recordStructuralEntries.map((entry) => String(entry?.materialId || '')).filter(Boolean));

        const visibleFoodLibrary = foodWasteLibraryAll.filter((item) => item.active !== false || referencedFoodIds.has(item.id));
        const visibleStructuralLibrary = structuralMaterialLibraryAll.filter((item) => item.active !== false || referencedMaterialIds.has(item.id));

        const foodAmountMap = new Map(
            recordFoodEntries.map((entry) => [
                String(entry?.sourceId || ''),
                (entry?.amount != null && !isNaN(entry.amount)) ? (parseFloat(entry.amount) || 0) : 0
            ])
        );
        const structuralAmountMap = new Map(
            recordStructuralEntries.map((entry) => [
                String(entry?.materialId || ''),
                (entry?.amount != null && !isNaN(entry.amount)) ? (parseFloat(entry.amount) || 0) : 0
            ])
        );

        const foodWasteEntries = visibleFoodLibrary.map((item) => ({
            sourceId: item.id,
            source: item.source,
            type: item.type,
            active: item.active !== false,
            amount: foodAmountMap.get(item.id) || 0
        }));
        const structuralMaterialEntries = visibleStructuralLibrary.map((item) => ({
            materialId: item.id,
            material: item.material,
            active: item.active !== false,
            amount: structuralAmountMap.get(item.id) || 0
        }));

        const rawAdditionalInputs = Array.isArray(draft?.additionalInputs)
            ? draft.additionalInputs
            : (Array.isArray(maintenance.additionalInputs) && maintenance.additionalInputs.length > 0
                ? maintenance.additionalInputs
                : (Array.isArray(input.additionalInputs) ? input.additionalInputs.map((item) => ({
                    source: item?.source || '',
                    type: this.normalizeAdditionalMaterialType(item?.type),
                    description: item?.description || '',
                    amount: item?.amount != null
                        ? ((item.amount != null && !isNaN(item.amount)) ? (parseFloat(item.amount) || 0) : 0)
                        : ((item?.weight != null && !isNaN(item.weight)) ? (parseFloat(item.weight) || 0) : 0)
                })) : []));
        const additionalInputs = rawAdditionalInputs.length > 0 ? rawAdditionalInputs : [{ source: '', type: 'organic', description: '', amount: 0 }];
        const additionalTotals = this.calculateAdditionalInputTotals(additionalInputs);

        const totalFoodWaste = foodWasteEntries.reduce((sum, item) => sum + ((item.amount != null && !isNaN(item.amount)) ? (parseFloat(item.amount) || 0) : 0), 0);
        const regularStructuralMaterial = structuralMaterialEntries.reduce((sum, item) => sum + ((item.amount != null && !isNaN(item.amount)) ? (parseFloat(item.amount) || 0) : 0), 0);
        const totalOrganicWaste = totalFoodWaste + additionalTotals.additionalOrganicMaterial;
        const totalStructuralMaterial = regularStructuralMaterial + additionalTotals.additionalStructuralMaterial;
        const totalMaterialInput = totalOrganicWaste + totalStructuralMaterial;

        return {
            batchUnit: inputUnit,
            foodWasteLibrary: visibleFoodLibrary,
            foodWasteEntries,
            structuralMaterialLibrary: visibleStructuralLibrary,
            structuralMaterialEntries,
            additionalInputs,
            totalFoodWaste,
            regularStructuralMaterial,
            additionalOrganicMaterial: additionalTotals.additionalOrganicMaterial,
            additionalStructuralMaterial: additionalTotals.additionalStructuralMaterial,
            totalAdditionalInput: additionalTotals.totalAdditionalInput,
            totalOrganicWaste,
            totalStructuralMaterial,
            totalMaterialInput,
            totalOrganicInput: totalMaterialInput,
            moduleExpanded: !!draft?.moduleExpanded,
            otherOrganicExpanded: !!draft?.otherOrganicExpanded
        };
    },

    renderNonICTAMaintenanceModule(batch, maintenance) {
        const inputUnit = maintenance.batchUnit || this.getBatchInputUnitName(batch);
        const isCompleted = this.hasMaintenanceStateContent(maintenance);
        const additionalRows = Array.isArray(maintenance.additionalInputs) && maintenance.additionalInputs.length > 0
            ? maintenance.additionalInputs
            : [{ source: '', type: 'organic', description: '', amount: 0 }];
        const sourceOptions = [
            'Organic waste generated during events',
            'Garden clean-up residues',
            'Seasonal pruning residues',
            'Research or experimental materials',
            'Other occasional organic inputs'
        ];

        return `
            <div class="card" id="nonIctaMaintenanceCard">
                <div style="display: flex; align-items: center; justify-content: space-between; cursor: pointer;" onclick="app.toggleICTAMaintenanceModule()">
                    <h2 class="card-title module-title maintenance" id="maintenanceModuleToggleText" data-completed="${isCompleted ? 'true' : 'false'}" style="margin: 0;">${this.getModuleToggleLabel('Maintenance Module', isCompleted)}</h2>
                    <span id="maintenanceModuleToggleIcon" style="color: var(--gray); font-weight: 700;">▸</span>
                </div>

                <div id="maintenanceModuleContent" style="display: none; margin-top: 20px;">
                    <div class="module" style="background: #F4FBF4; border-color: #C8E6C9;">
                        <div class="maintenance-section-header">
                            <h3 class="module-title maintenance" style="margin-bottom: 0;">Food Waste Input</h3>
                            <div class="maintenance-helptext">ⓘ Sources and default food waste types are managed at Batch level. Daily Record only needs today's amount.</div>
                        </div>

                        <div id="nonIctaFoodWasteRows" class="nonicta-library-list">
                            ${maintenance.foodWasteEntries.length > 0 ? maintenance.foodWasteEntries.map((row) => `
                                <div class="nonicta-library-row" data-source-id="${this.escapeAttr(row.sourceId)}">
                                    <div class="nonicta-library-main">
                                        <div class="nonicta-library-title-row">
                                            <div class="nonicta-library-title">${this.escapeAttr(row.source || 'Untitled Source')}</div>
                                            <div class="nonicta-library-actions">
                                                ${row.active !== false ? `
                                                    <button type="button" class="btn btn-secondary nonicta-inline-btn" onclick="app.renameNonICTAFoodWasteSource('${this.escapeAttr(row.sourceId)}')">✏ Rename</button>
                                                    <button type="button" class="btn btn-secondary nonicta-inline-btn" onclick="app.editNonICTAFoodWasteType('${this.escapeAttr(row.sourceId)}')">Edit Type</button>
                                                    <button type="button" class="btn btn-secondary nonicta-inline-btn" onclick="app.removeNonICTAFoodWasteSource('${this.escapeAttr(row.sourceId)}')">🗑 Remove</button>
                                                ` : `<span class="nonicta-library-badge">Archived</span>`}
                                            </div>
                                        </div>
                                        <div class="nonicta-library-subtitle">${this.escapeAttr(row.type || 'No Type')}</div>
                                    </div>
                                    <div class="form-group" style="margin: 0;">
                                        <label class="form-label">Today's Amount (${inputUnit})</label>
                                        <input type="number" class="form-input nonicta-food-amount" step="any" value="${row.amount ? row.amount : ''}" placeholder="Enter number" oninput="app.updateNonICTAMaintenanceTotals()">
                                    </div>
                                </div>
                            `).join('') : `
                                <div class="nonicta-library-empty">No food waste sources have been added to this Batch yet.</div>
                            `}
                        </div>

                        <button type="button" class="btn btn-secondary" style="padding: 8px 12px; margin-top: 12px;" onclick="app.addNonICTAFoodWasteSource()">+ Add New Source</button>

                        <div class="field-section" style="margin-top: 12px;">
                            <label class="field-section-title">Regular Organic Waste: <span class="auto-calc" id="regularOrganicWaste">${this.formatNumber(maintenance.totalFoodWaste || 0, 3)}</span> ${inputUnit}</label>
                        </div>
                    </div>

                    <div class="module" style="background: #FFFDF4; border-color: #FFE082;">
                        <div class="maintenance-section-header">
                            <h3 class="module-title" style="color: #F57C00; margin-bottom: 0;">Structural Material Input</h3>
                            <div class="maintenance-helptext">ⓘ Structural materials are stored in the Batch Material Library and reused across all Daily Records.</div>
                        </div>

                        <div id="nonIctaStructuralRows" class="nonicta-library-list">
                            ${maintenance.structuralMaterialEntries.length > 0 ? maintenance.structuralMaterialEntries.map((row) => `
                                <div class="nonicta-library-row" data-material-id="${this.escapeAttr(row.materialId)}">
                                    <div class="nonicta-library-main">
                                        <div class="nonicta-library-title-row">
                                            <div class="nonicta-library-title">${this.escapeAttr(row.material || 'Untitled Material')}</div>
                                            <div class="nonicta-library-actions">
                                                ${row.active !== false ? `
                                                    <button type="button" class="btn btn-secondary nonicta-inline-btn" onclick="app.renameNonICTAStructuralMaterial('${this.escapeAttr(row.materialId)}')">✏ Rename</button>
                                                    <button type="button" class="btn btn-secondary nonicta-inline-btn" onclick="app.removeNonICTAStructuralMaterial('${this.escapeAttr(row.materialId)}')">🗑 Remove</button>
                                                ` : `<span class="nonicta-library-badge">Archived</span>`}
                                            </div>
                                        </div>
                                    </div>
                                    <div class="form-group" style="margin: 0;">
                                        <label class="form-label">Today's Amount (${inputUnit})</label>
                                        <input type="number" class="form-input nonicta-struct-amount" step="any" value="${row.amount ? row.amount : ''}" placeholder="Enter number" oninput="app.updateNonICTAMaintenanceTotals()">
                                    </div>
                                </div>
                            `).join('') : `
                                <div class="nonicta-library-empty">No structural materials have been added to this Batch yet.</div>
                            `}
                        </div>

                        <button type="button" class="btn btn-secondary" style="padding: 8px 12px; margin-top: 12px;" onclick="app.addNonICTAStructuralMaterial()">+ Add Structural Material</button>

                        <div class="field-section" style="margin-top: 12px;">
                            <label class="field-section-title">Regular Structural Material: <span class="auto-calc" id="regularStructuralMaterial">${this.formatNumber(maintenance.regularStructuralMaterial || 0, 3)}</span> ${inputUnit}</label>
                        </div>
                    </div>

                    <div class="module" style="background: #F3F8FF; border-color: #BBDEFB;">
                        <div style="display:flex; align-items:center; justify-content: space-between; cursor:pointer;" onclick="app.toggleICTAOtherOrganicInput()">
                            <h3 class="module-title" style="color: #1976D2; margin: 0;" id="otherOrganicToggleText">☐ Other Organic Input (Optional)</h3>
                            <span id="otherOrganicToggleIcon" style="color: var(--gray); font-weight: 700;">▸</span>
                        </div>
                        <div class="maintenance-helptext" style="margin-top: 8px;">ⓘ Occasional organic materials that are not part of the regular collection system.</div>

                        <div id="otherOrganicContent" style="display:none; margin-top: 16px;">
                            <div id="maintenanceAdditionalInputsList">
                                ${additionalRows.map((row, idx) => `
                                    <div class="maintenance-additional-row">
                                        <div class="maintenance-additional-grid">
                                            <div class="form-group">
                                                <label class="form-label">Source</label>
                                                <select class="form-input maintenance-additional-source" onchange="app.updateMaintenanceTotals()">
                                                    <option value="">Select source...</option>
                                                    ${sourceOptions.map(opt => `<option value="${opt.replace(/"/g, '&quot;')}" ${(row.source || '') === opt ? 'selected' : ''}>${opt}</option>`).join('')}
                                                </select>
                                            </div>
                                            <div class="form-group">
                                                <label class="form-label">Type</label>
                                                <div class="radio-group" style="gap: 14px;">
                                                    <label class="radio-item">
                                                        <input type="radio" name="maintenanceAdditionalType_${idx}" value="organic" ${(row.type || 'organic') === 'organic' ? 'checked' : ''} onchange="app.updateMaintenanceTotals()">
                                                        Organic Material
                                                    </label>
                                                    <label class="radio-item">
                                                        <input type="radio" name="maintenanceAdditionalType_${idx}" value="structural" ${(row.type || '') === 'structural' ? 'checked' : ''} onchange="app.updateMaintenanceTotals()">
                                                        Structural Material
                                                    </label>
                                                </div>
                                            </div>
                                            <div class="form-group">
                                                <label class="form-label">Material Description</label>
                                                <input type="text" class="form-input maintenance-additional-desc" value="${(row.description || '').replace(/"/g, '&quot;')}" oninput="app.updateMaintenanceTotals()">
                                            </div>
                                            <div class="form-group">
                                                <label class="form-label">Amount (${inputUnit})</label>
                                                <input type="number" class="form-input maintenance-additional-amount" step="any" value="${row.amount != null ? row.amount : ''}" oninput="app.updateMaintenanceTotals()">
                                            </div>
                                        </div>
                                        <div style="display:flex; justify-content:flex-end; margin-top: 10px;">
                                            <button type="button" class="btn btn-secondary" style="padding: 8px 12px;" onclick="app.removeMaintenanceAdditionalInputRow(this)">− Remove</button>
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                            <button type="button" class="btn btn-secondary" style="padding: 8px 12px;" onclick="app.addMaintenanceAdditionalInputRow()">+ Add Additional Input</button>

                            <div class="field-section" style="margin-top: 12px;">
                                <div class="field-section-title">Additional Input Summary</div>
                                <div class="maintenance-helptext" style="margin-top: 8px;">
                                    Additional Organic Material: <span class="auto-calc" id="additionalOrganicMaterial">${this.formatNumber(maintenance.additionalOrganicMaterial || 0, 3)}</span> ${inputUnit}
                                </div>
                                <div class="maintenance-helptext" style="margin-top: 4px;">
                                    Additional Structural Material: <span class="auto-calc" id="additionalStructuralMaterial">${this.formatNumber(maintenance.additionalStructuralMaterial || 0, 3)}</span> ${inputUnit}
                                </div>
                                <div class="maintenance-helptext" style="margin-top: 4px; font-weight: 700;">
                                    Total Additional Input: <span class="auto-calc" id="totalAdditionalInput">${this.formatNumber(maintenance.totalAdditionalInput || 0, 3)}</span> ${inputUnit}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="maintenance-summary-card">
                        <div class="maintenance-summary-value maintenance-summary-value-row">
                            <span>Organic Waste: <span id="totalOrganicWaste">${this.formatNumber(maintenance.totalOrganicWaste || 0, 3)}</span> ${inputUnit}</span>
                            ${this.renderMaintenanceSummaryInfoButton('Organic Waste', 'Regular Organic Waste + Additional Organic Material')}
                        </div>
                        <div class="maintenance-summary-value maintenance-summary-value-row" style="margin-top: 10px;">
                            <span>Structural Material: <span id="totalStructuralMaterialOverall">${this.formatNumber(maintenance.totalStructuralMaterial || 0, 3)}</span> ${inputUnit}</span>
                            ${this.renderMaintenanceSummaryInfoButton('Structural Material', 'Regular Structural Material + Additional Structural Material')}
                        </div>
                        <div class="maintenance-summary-value maintenance-summary-value-row" style="margin-top: 10px;">
                            <span>Total Material Input: <span id="totalMaterialInput">${this.formatNumber((maintenance.totalMaterialInput ?? maintenance.totalOrganicInput) || 0, 3)}</span> ${inputUnit}</span>
                            ${this.renderMaintenanceSummaryInfoButton('Total Material Input', 'Organic Waste + Structural Material')}
                        </div>
                    </div>
                </div>
            </div>
        `;
    },

    getICTAActionTakenState(record) {
        const raw = record || {};
        const nested = raw.actionTaken || {};
        const legacy = raw.process || {};
        return {
            actionTurning: !!(raw.actionTurning ?? nested.actionTurning ?? legacy.turning),
            actionMixing: !!(raw.actionMixing ?? nested.actionMixing ?? legacy.mixing),
            actionAddedWater: !!(raw.actionAddedWater ?? nested.actionAddedWater ?? legacy.waterAdded),
            waterAddedAmount: (raw.waterAddedAmount ?? nested.waterAddedAmount ?? legacy.waterAddedAmount) != null ? (parseFloat(raw.waterAddedAmount ?? nested.waterAddedAmount ?? legacy.waterAddedAmount) || 0) : 0,
            actionRemovedImpurities: !!(raw.actionRemovedImpurities ?? nested.actionRemovedImpurities),
            removedImpuritiesDescription: String(raw.removedImpuritiesDescription ?? nested.removedImpuritiesDescription ?? ''),
            actionOther: !!(raw.actionOther ?? nested.actionOther),
            otherActionDescription: String(raw.otherActionDescription ?? nested.otherActionDescription ?? '')
        };
    },

    renderICTAActionTakenModule(action) {
        const showWater = !!action.actionAddedWater;
        const showRemoved = !!action.actionRemovedImpurities;
        const showOther = !!action.actionOther;
        const isCompleted = this.hasActionTakenContent(action);
        return `
            <div class="card">
                <div style="display: flex; align-items: center; justify-content: space-between; cursor: pointer;" onclick="app.toggleICTAActionTakenModule()">
                    <h2 class="card-title module-title maintenance" id="actionTakenToggleText" data-completed="${isCompleted ? 'true' : 'false'}" style="margin: 0;">${this.getModuleToggleLabel('Action Taken', isCompleted)}</h2>
                    <span id="actionTakenToggleIcon" style="color: var(--gray); font-weight: 700;">▸</span>
                </div>

                <div id="actionTakenContent" style="display: none; margin-top: 20px;">
                    <div class="action-chip-group">
                        <label class="action-chip">
                            <input type="checkbox" id="actionTurning" ${action.actionTurning ? 'checked' : ''} onchange="app.updateICTAActionTakenVisibility()">
                            <span>Turning</span>
                        </label>
                        <label class="action-chip">
                            <input type="checkbox" id="actionMixing" ${action.actionMixing ? 'checked' : ''} onchange="app.updateICTAActionTakenVisibility()">
                            <span>Mixing</span>
                        </label>
                        <label class="action-chip">
                            <input type="checkbox" id="actionAddedWater" ${action.actionAddedWater ? 'checked' : ''} onchange="app.updateICTAActionTakenVisibility()">
                            <span>Added Water</span>
                        </label>
                        <label class="action-chip">
                            <input type="checkbox" id="actionRemovedImpurities" ${action.actionRemovedImpurities ? 'checked' : ''} onchange="app.updateICTAActionTakenVisibility()">
                            <span>Removed Impurities</span>
                        </label>
                        <label class="action-chip">
                            <input type="checkbox" id="actionOther" ${action.actionOther ? 'checked' : ''} onchange="app.updateICTAActionTakenVisibility()">
                            <span>Other</span>
                        </label>
                    </div>

                    <div class="action-conditional-grid">
                        <div id="actionWaterFields" style="${showWater ? '' : 'display:none;'}">
                            <label class="form-label">Water Added (L)</label>
                            <input type="number" class="form-input" id="waterAddedAmount" step="any" value="${showWater && action.waterAddedAmount != null && action.waterAddedAmount !== 0 ? action.waterAddedAmount : ''}" placeholder="e.g., 5">
                        </div>
                        <div id="actionRemovedFields" style="${showRemoved ? '' : 'display:none;'}">
                            <label class="form-label">Removed Materials</label>
                            <input type="text" class="form-input" id="removedImpuritiesDescription" value="${action.removedImpuritiesDescription.replace(/"/g, '&quot;')}" placeholder="e.g., Plastic bags, paper towels...">
                        </div>
                        <div id="actionOtherFields" style="${showOther ? '' : 'display:none;'}">
                            <label class="form-label">Description</label>
                            <input type="text" class="form-input" id="otherActionDescription" value="${action.otherActionDescription.replace(/"/g, '&quot;')}" placeholder="Describe other actions taken">
                        </div>
                    </div>
                </div>
            </div>
        `;
    },

    renderTransferBatchOptions(currentBatch, selectedBatchId) {
        const selected = String(selectedBatchId || '').trim();
        const options = [];
        const seen = new Set();
        const appendOption = (batch, labelSuffix = '') => {
            const value = String(batch?.id || '').trim();
            if (!value || seen.has(value)) return;
            seen.add(value);
            const label = `${batch.id}${labelSuffix}`;
            options.push(`<option value="${this.escapeAttr(value)}" ${selected === value ? 'selected' : ''}>${this.escapeHtml(label)}</option>`);
        };

        if (currentBatch?.id) appendOption(currentBatch, ' (Current Batch)');
        this.data.batches.forEach((batch) => {
            if (!batch?.id || (currentBatch?.id && String(batch.id) === String(currentBatch.id))) return;
            appendOption(batch);
        });

        if (selected && !seen.has(selected)) {
            options.push(`<option value="${this.escapeAttr(selected)}" selected>${this.escapeHtml(selected)} (Unavailable)</option>`);
        }

        return options.join('');
    },

    renderTransferComposterOptions(batchId, selectedComposterId) {
        const selected = String(selectedComposterId || '').trim();
        const matchedBatch = this.findBatchByExactId(batchId);
        const composterIds = this.getBatchComposterIds(matchedBatch);
        const seen = new Set();
        const options = ['<option value="">Select composter...</option>'];

        composterIds.forEach((composterId) => {
            const value = String(composterId || '').trim();
            if (!value || seen.has(value)) return;
            seen.add(value);
            options.push(`<option value="${this.escapeAttr(value)}" ${selected === value ? 'selected' : ''}>${this.escapeHtml(this.formatComposterLabel(value))}</option>`);
        });

        if (selected && !seen.has(selected)) {
            options.push(`<option value="${this.escapeAttr(selected)}" selected>${this.escapeHtml(this.formatComposterLabel(selected))} (Unavailable)</option>`);
        }

        return options.join('');
    },

    renderMaterialTransferModule(batch, transfer) {
        const isCompleted = this.hasMaterialTransferContent(transfer);
        const inputUnit = this.getBatchInputUnitName(batch);
        const materialTypes = [
            'Active Compost',
            'Semi-mature Compost',
            'Mature Compost',
            'Structural Material',
            'Other'
        ];
        const sourceBatchValue = transfer.sourceBatchId || batch?.id || '';
        const destinationBatchValue = transfer.destinationBatchId || batch?.id || '';
        return `
            <div class="card">
                <div style="display: flex; align-items: center; justify-content: space-between; cursor: pointer;" onclick="app.toggleICTAMaterialTransferModule()">
                    <h2 class="card-title module-title maintenance" id="materialTransferToggleText" data-completed="${isCompleted ? 'true' : 'false'}" style="margin: 0;">${this.getModuleToggleLabel('Material Transfer', isCompleted)}</h2>
                    <span id="materialTransferToggleIcon" style="color: var(--gray); font-weight: 700;">▸</span>
                </div>

                <div id="materialTransferModuleContent" style="display: none; margin-top: 20px;">
                    <div class="form-group">
                        <label class="form-label">Material Transfer Performed?</label>
                        <div class="radio-group" style="gap: 18px;">
                            <label class="radio-item">
                                <input type="radio" name="materialTransferPerformed" value="yes" ${transfer.performed ? 'checked' : ''} onchange="app.updateMaterialTransferVisibility()">
                                Yes
                            </label>
                            <label class="radio-item">
                                <input type="radio" name="materialTransferPerformed" value="no" ${!transfer.performed ? 'checked' : ''} onchange="app.updateMaterialTransferVisibility()">
                                No
                            </label>
                        </div>
                    </div>

                    <div id="materialTransferFields" style="${transfer.performed ? '' : 'display:none;'}">
                        <div class="form-row">
                            <div class="form-group">
                                <label class="form-label">Transfer Date</label>
                                <input type="date" class="form-input" id="materialTransferDate" value="${this.escapeAttr(transfer.transferDate || '')}">
                            </div>
                            <div class="form-group">
                                <label class="form-label">Material Type</label>
                                <select class="form-input" id="materialTransferMaterialType">
                                    <option value="">Select material type...</option>
                                    ${materialTypes.map((type) => `<option value="${this.escapeAttr(type)}" ${transfer.materialType === type ? 'selected' : ''}>${this.escapeHtml(type)}</option>`).join('')}
                                </select>
                            </div>
                            <div class="form-group">
                                <label class="form-label">Transferred Amount</label>
                                <input type="number" class="form-input" id="materialTransferAmount" step="any" value="${transfer.amount != null && transfer.amount !== 0 ? this.escapeAttr(transfer.amount) : ''}" placeholder="Enter amount">
                            </div>
                            <div class="form-group">
                                <label class="form-label">Unit</label>
                                <input type="text" class="form-input" id="materialTransferUnit" value="${this.escapeAttr(transfer.unit || inputUnit)}" readonly>
                            </div>
                        </div>

                        <div class="form-row">
                            <div class="form-group">
                                <label class="form-label">Source Batch</label>
                                <select class="form-input" id="materialTransferSourceBatchId" onchange="app.updateMaterialTransferVisibility()">
                                    ${this.renderTransferBatchOptions(batch, sourceBatchValue)}
                                </select>
                            </div>
                            <div class="form-group">
                                <label class="form-label">Source Composter</label>
                                <select class="form-input" id="materialTransferSourceComposterId">
                                    ${this.renderTransferComposterOptions(sourceBatchValue, transfer.sourceComposterId)}
                                </select>
                            </div>
                        </div>

                        <div class="form-row">
                            <div class="form-group">
                                <label class="form-label">Destination Batch</label>
                                <select class="form-input" id="materialTransferDestinationBatchId" onchange="app.updateMaterialTransferVisibility()">
                                    ${this.renderTransferBatchOptions(batch, destinationBatchValue)}
                                </select>
                            </div>
                            <div class="form-group">
                                <label class="form-label">Destination Composter</label>
                                <select class="form-input" id="materialTransferDestinationComposterId">
                                    ${this.renderTransferComposterOptions(destinationBatchValue, transfer.destinationComposterId)}
                                </select>
                            </div>
                        </div>

                        <div class="form-group">
                            <label class="form-label">Notes</label>
                            <textarea class="form-input icta-notes-textarea" id="materialTransferNotes" placeholder="Optional notes about this transfer">${this.escapeHtml(transfer.notes || '')}</textarea>
                        </div>
                    </div>
                </div>
            </div>
        `;
    },

    getICTAPhotosState(record) {
        const photos = Array.isArray(record?.uploadedPhotos) ? record.uploadedPhotos : [];
        return this.normalizePhotoList(photos);
    },

    renderICTAPhotoGridHtml(photos) {
        if (!Array.isArray(photos) || photos.length === 0) {
            return `<div class="icta-photo-empty">No photos uploaded yet.</div>`;
        }
        return photos.map((photo, idx) => `
            <div class="icta-photo-tile">
                <img class="icta-photo-thumb" src="${this.getPhotoPreviewSrc(photo)}" alt="Uploaded photo ${idx + 1}">
                <div class="icta-photo-actions">
                    <button type="button" class="btn btn-secondary icta-photo-btn" onclick="app.viewICTAPhoto(${idx})">View</button>
                    <button type="button" class="btn btn-secondary icta-photo-btn" onclick="app.openICTAPhotoReplace(${idx})">Replace</button>
                    <button type="button" class="btn btn-danger icta-photo-btn" onclick="app.deleteICTAPhoto(${idx})">Delete</button>
                </div>
            </div>
        `).join('');
    },

    renderICTAPhotoUploadModule(photos) {
        const isCompleted = this.hasPhotosContent(photos);
        const batch = this.data.currentBatch;
        const showLocalOnlyNotice = this.isBatchShared(batch) && !this.isCloudPhotoStorageEnabled();
        const localOnlyNotice = showLocalOnlyNotice
            ? `<div class="alert alert-warning" style="margin-bottom: 14px;">
                    <strong>Photos are local-only</strong><br>
                    Photos will be saved on this device but will not be shared with collaborators until cloud photo storage is enabled.
               </div>`
            : '';
        return `
            <div class="card">
                <div style="display: flex; align-items: center; justify-content: space-between; cursor: pointer;" onclick="app.toggleICTAPhotoUploadModule()">
                    <h2 class="card-title module-title maintenance" id="photoUploadToggleText" data-completed="${isCompleted ? 'true' : 'false'}" style="margin: 0;">${this.getModuleToggleLabel('Photo Upload', isCompleted)}</h2>
                    <span id="photoUploadToggleIcon" style="color: var(--gray); font-weight: 700;">▸</span>
                </div>

                <div id="photoUploadContent" style="display: none; margin-top: 20px;">
                    ${localOnlyNotice}
                    <div class="icta-photo-toolbar">
                        <button type="button" class="btn btn-secondary" onclick="app.openICTAPhotoPicker('take')">📷 Take Photo</button>
                        <button type="button" class="btn btn-secondary" onclick="app.openICTAPhotoPicker('upload')">⬆ Upload Photo</button>
                        <button type="button" class="btn btn-secondary" onclick="app.openICTAPhotoPicker('file')">📁 Choose File</button>
                        <div class="icta-photo-hint">JPG / JPEG / PNG • Up to 9 photos</div>
                    </div>

                    <input id="ictaTakePhotoInput" type="file" accept="image/jpeg,image/jpg,image/png" capture="environment" style="display:none;">
                    <input id="ictaUploadPhotoInput" type="file" accept="image/jpeg,image/jpg,image/png" multiple style="display:none;">
                    <input id="ictaChooseFileInput" type="file" accept="image/jpeg,image/jpg,image/png" multiple style="display:none;">
                    <input id="ictaReplacePhotoInput" type="file" accept="image/jpeg,image/jpg,image/png" style="display:none;">

                    <div id="ictaPhotoGrid" class="icta-photo-grid">
                        ${this.renderICTAPhotoGridHtml(photos)}
                    </div>
                </div>
            </div>
        `;
    },

    getICTANotesState(record) {
        return String(record?.notes ?? record?.observation?.notes ?? '');
    },

    getMaterialTransferFormState(batch, recordDate = '') {
        const performed = document.querySelector('input[name="materialTransferPerformed"]:checked')?.value === 'yes';
        if (!performed) return this.getDefaultMaterialTransfer();
        const amountRaw = document.getElementById('materialTransferAmount')?.value;
        const amount = amountRaw != null && String(amountRaw).trim() !== '' ? parseFloat(amountRaw) : 0;
        return this.normalizeMaterialTransfer({
            performed: true,
            transferDate: document.getElementById('materialTransferDate')?.value || recordDate || '',
            sourceBatchId: document.getElementById('materialTransferSourceBatchId')?.value || '',
            sourceComposterId: document.getElementById('materialTransferSourceComposterId')?.value || '',
            destinationBatchId: document.getElementById('materialTransferDestinationBatchId')?.value || '',
            destinationComposterId: document.getElementById('materialTransferDestinationComposterId')?.value || '',
            materialType: document.getElementById('materialTransferMaterialType')?.value || '',
            amount: isNaN(amount) ? 0 : amount,
            unit: this.getBatchInputUnitName(batch),
            notes: document.getElementById('materialTransferNotes')?.value || ''
        }, batch);
    },

    getActionTakenDraftStateFromDom() {
        return {
            actionTurning: !!document.getElementById('actionTurning')?.checked,
            actionMixing: !!document.getElementById('actionMixing')?.checked,
            actionAddedWater: !!document.getElementById('actionAddedWater')?.checked,
            waterAddedAmount: parseFloat(document.getElementById('waterAddedAmount')?.value || '') || 0,
            actionRemovedImpurities: !!document.getElementById('actionRemovedImpurities')?.checked,
            removedImpuritiesDescription: document.getElementById('removedImpuritiesDescription')?.value || '',
            actionOther: !!document.getElementById('actionOther')?.checked,
            otherActionDescription: document.getElementById('otherActionDescription')?.value || ''
        };
    },

    getPhotosDraftStateFromDom() {
        return Array.isArray(this.data.ictaPhotoDraft) ? this.data.ictaPhotoDraft : [];
    },

    getNotesDraftStateFromDom() {
        return document.getElementById('ictaNotesTextarea')?.value || '';
    },

    getMaintenanceDraftStateFromDom() {
        const batch = this.data.currentBatch;
        if (!batch) return null;
        if (this.isICTAUser()) {
            const getNumber = (id) => {
                const el = document.getElementById(id);
                if (!el || el.value === '') return 0;
                const parsed = parseFloat(el.value);
                return isNaN(parsed) ? 0 : parsed;
            };
            const additionalRows = Array.from(document.querySelectorAll('#maintenanceAdditionalInputsList .maintenance-additional-row'));
            const additionalInputs = additionalRows.map((row) => {
                const source = row.querySelector('.maintenance-additional-source')?.value || '';
                const type = row.querySelector('input[type="radio"]:checked')?.value || 'organic';
                const description = row.querySelector('.maintenance-additional-desc')?.value || '';
                const amountRaw = row.querySelector('.maintenance-additional-amount')?.value;
                const amount = amountRaw != null && amountRaw !== '' ? parseFloat(amountRaw) : 0;
                return { source, type, description, amount: isNaN(amount) ? 0 : amount };
            });
            const additionalTotals = this.calculateAdditionalInputTotals(additionalInputs);
            const foodWasteCocina = getNumber('foodWasteCocina');
            const foodWastePlanta0 = getNumber('foodWastePlanta0');
            const foodWastePlanta1 = getNumber('foodWastePlanta1');
            const foodWastePlanta3 = getNumber('foodWastePlanta3');
            const woodFusta = getNumber('woodFusta');
            const woodChips = getNumber('woodChips');
            const totalFoodWaste = foodWasteCocina + foodWastePlanta0 + foodWastePlanta1 + foodWastePlanta3;
            const regularStructuralMaterial = woodFusta + woodChips;
            const totalOrganicWaste = totalFoodWaste + additionalTotals.additionalOrganicMaterial;
            const totalStructuralMaterial = regularStructuralMaterial + additionalTotals.additionalStructuralMaterial;
            const totalMaterialInput = totalOrganicWaste + totalStructuralMaterial;
            return {
                batchUnit: this.getBatchInputUnitName(batch),
                foodWasteCocina,
                foodWastePlanta0,
                foodWastePlanta1,
                foodWastePlanta3,
                totalFoodWaste,
                woodFusta,
                woodChips,
                regularStructuralMaterial,
                additionalInputs,
                additionalOrganicMaterial: additionalTotals.additionalOrganicMaterial,
                additionalStructuralMaterial: additionalTotals.additionalStructuralMaterial,
                totalAdditionalInput: additionalTotals.totalAdditionalInput,
                totalOrganicWaste,
                totalStructuralMaterial,
                totalMaterialInput,
                totalOrganicInput: totalMaterialInput
            };
        }
        const record = this.data.editingRecord
            ? batch.records.find((item) => String(item.id) === String(this.data.editingRecord)) || null
            : null;
        return this.getNonICTAMaintenanceState(record, batch, this.getNonICTAMaintenanceDraftFromDom());
    },

    refreshDailyRecordModuleCompletionStates() {
        if (this.data.currentPage !== 'dailyRecord') return;
        const batch = this.data.currentBatch;
        if (!batch) return;

        const monitoringState = this.getMonitoringDraftStateFromDom();
        const maintenanceState = this.getMaintenanceDraftStateFromDom();
        const materialTransferState = this.getMaterialTransferFormState(batch, document.getElementById('recordDate')?.value || '');
        const actionState = this.getActionTakenDraftStateFromDom();
        const photosState = this.getPhotosDraftStateFromDom();
        const notesState = this.getNotesDraftStateFromDom();

        this.updateModuleCompletionState(
            document.getElementById('monitoringModuleToggleText'),
            'Monitoring Module',
            this.hasMonitoringStateContent(monitoringState)
        );
        this.updateModuleCompletionState(
            document.getElementById('maintenanceModuleToggleText'),
            'Maintenance Module',
            this.hasMaintenanceStateContent(maintenanceState)
        );
        this.updateModuleCompletionState(
            document.getElementById('materialTransferToggleText'),
            'Material Transfer',
            this.hasMaterialTransferContent(materialTransferState)
        );
        this.updateModuleCompletionState(
            document.getElementById('actionTakenToggleText'),
            'Action Taken',
            this.hasActionTakenContent(actionState)
        );
        this.updateModuleCompletionState(
            document.getElementById('photoUploadToggleText'),
            'Photo Upload',
            this.hasPhotosContent(photosState)
        );
        this.updateModuleCompletionState(
            document.getElementById('ictaNotesToggleText'),
            'Notes (Optional)',
            this.hasNotesContent(notesState)
        );
    },

    renderICTANotesModule(notes) {
        const isCompleted = this.hasNotesContent(notes);
        return `
            <div class="card">
                <div style="display: flex; align-items: center; justify-content: space-between; cursor: pointer;" onclick="app.toggleICTANotesModule()">
                    <h2 class="card-title module-title maintenance" id="ictaNotesToggleText" data-completed="${isCompleted ? 'true' : 'false'}" style="margin: 0;">${this.getModuleToggleLabel('Notes (Optional)', isCompleted)}</h2>
                    <span id="ictaNotesToggleIcon" style="color: var(--gray); font-weight: 700;">▸</span>
                </div>

                <div id="ictaNotesContent" style="display: none; margin-top: 20px;">
                    <textarea id="ictaNotesTextarea" class="form-input icta-notes-textarea" placeholder="Add any observations, unusual conditions, or additional information related to this visit.">${notes.replace(/</g, '&lt;')}</textarea>
                </div>
            </div>
        `;
    },

    isICTAUser() {
        return (this.data.currentOrganization || '').toLowerCase().includes('icta');
    },

    async loadData() {
        const storageKey = this.getStorageKey();
        if (!storageKey) {
            this.data.batches = [];
            return;
        }
        const saved = localStorage.getItem(storageKey);
        let localBatches = [];
        if (saved) {
            try {
                localBatches = JSON.parse(saved) || [];
            } catch (error) {
                localBatches = [];
            }
        }

        this.data.batches = (Array.isArray(localBatches) ? localBatches : []).map((batch) => this.normalizeBatchForCompatibility(batch));

        try {
            if (this.getBatchesCollection() && this.data.currentUser?.uid) {
                const cloudBatches = await this.loadCloudBatches();
                const merged = [...cloudBatches];
                this.data.batches.forEach((localBatch) => {
                    const exists = merged.some((cloudBatch) => (
                        (localBatch.cloudId && cloudBatch.cloudId === localBatch.cloudId)
                        || (!localBatch.cloudId && String(cloudBatch.id || '') === String(localBatch.id || '') && (cloudBatch.ownerUid || this.data.currentUser?.uid) === (localBatch.ownerUid || this.data.currentUser?.uid))
                    ));
                    if (!exists) merged.push(localBatch);
                });
                this.data.batches = merged.map((batch) => this.normalizeBatchForCompatibility(batch));
                this.saveData();
            }
        } catch (error) {
        }
    },

    saveData() {
        const storageKey = this.getStorageKey();
        if (!storageKey) return;
        localStorage.setItem(storageKey, JSON.stringify(this.data.batches));
    },

    addSampleData() {
        const sampleBatch = {
            id: 'B2026-01',
            startDate: '2026-03-01',
            manager: 'Yihan',
            location: 'Compost Site A',
            notes: 'Initial batch for testing',
            status: 'active',
            output: null,
            records: [
                {
                    id: 1,
                    date: '2026-03-01',
                    composterId: 1,
                    input: {
                        cocina: 50,
                        planta0: 30,
                        planta1: 40,
                        planta3: 25,
                        ratio: '1:1',
                        woodFusta: 10,
                        woodChips: 5,
                        quality: 'Clean (0–5%)',
                        contaminants: { plastic: true, paper: false, metal: false, glass: false, other: false }
                    },
                    process: {
                        ambient: 22,
                        core: 55,
                        transition: 48,
                        outer: 42,
                        moisture: 55,
                        waterAddedAmount: 5
                    },
                    observation: {
                        odour: 'None',
                        odourNote: '',
                        leachate: 'No',
                        leachateNote: '',
                        notes: ''
                    }
                },
                {
                    id: 2,
                    date: '2026-03-03',
                    composterId: 2,
                    input: {
                        cocina: 45,
                        planta0: 35,
                        planta1: 38,
                        planta3: 28,
                        ratio: '1:2',
                        woodFusta: 8,
                        woodChips: 4,
                        quality: 'Slightly contaminated (5–15%)',
                        contaminants: { plastic: true, paper: true, metal: false, glass: false, other: false }
                    },
                    process: {
                        ambient: 24,
                        core: 62,
                        transition: 52,
                        outer: 45,
                        moisture: 58,
                        waterAddedAmount: 0
                    },
                    observation: {
                        odour: 'Slight',
                        odourNote: 'Normal composting smell',
                        leachate: 'No',
                        leachateNote: '',
                        notes: ''
                    }
                },
                {
                    id: 3,
                    date: '2026-03-05',
                    composterId: 1,
                    input: {
                        cocina: 0,
                        planta0: 0,
                        planta1: 0,
                        planta3: 0,
                        ratio: '1:1',
                        woodFusta: 0,
                        woodChips: 0,
                        quality: '',
                        contaminants: { plastic: false, paper: false, metal: false, glass: false, other: false }
                    },
                    process: {
                        ambient: 20,
                        core: 42,
                        transition: 38,
                        outer: 35,
                        moisture: null,
                        waterAddedAmount: null
                    },
                    observation: {
                        odour: 'Slight',
                        odourNote: 'Slightly anaerobic',
                        leachate: 'Yes',
                        leachateNote: 'Minor leakage observed',
                        notes: ''
                    }
                }
            ]
        };
        this.data.batches.push(sampleBatch);
        this.saveData();
    },

    navigate(page, params = {}) {
        this.cleanupOverlays();
        this.data.currentPage = page;
        if (params.batchId) {
            this.data.currentBatch = this.findBatchByRouteId(params.batchId);
        }
        if (params.recordId != null) {
            this.data.editingRecord = String(params.recordId);
        } else {
            this.data.editingRecord = null;
        }
        this.render();
        window.scrollTo(0, 0);
    },

    formatDate(dateStr) {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    },

    formatNumber(value, maxDecimals = 3) {
        const n = typeof value === 'number' ? value : parseFloat(value);
        if (n === null || n === undefined || isNaN(n)) return '-';
        const factor = Math.pow(10, maxDecimals);
        const rounded = Math.round((n + Number.EPSILON) * factor) / factor;
        const fixed = rounded.toFixed(maxDecimals);
        return fixed.replace(/\.?0+$/, '');
    },

    getTodayISODateInTimeZone(timeZone) {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).formatToParts(new Date());
        const year = parts.find(p => p.type === 'year')?.value;
        const month = parts.find(p => p.type === 'month')?.value;
        const day = parts.find(p => p.type === 'day')?.value;
        if (!year || !month || !day) return null;
        return `${year}-${month}-${day}`;
    },

    parseDateToUTCms(dateStr) {
        if (!dateStr) return null;
        const str = String(dateStr).trim();

        const m1 = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (m1) return Date.UTC(parseInt(m1[1], 10), parseInt(m1[2], 10) - 1, parseInt(m1[3], 10));

        const m2 = str.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
        if (m2) return Date.UTC(parseInt(m2[1], 10), parseInt(m2[2], 10) - 1, parseInt(m2[3], 10));

        const m3 = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (m3) return Date.UTC(parseInt(m3[3], 10), parseInt(m3[2], 10) - 1, parseInt(m3[1], 10));

        const m4 = str.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/);
        if (m4) {
            const day = parseInt(m4[1], 10);
            const monthName = m4[2].slice(0, 3).toLowerCase();
            const year = parseInt(m4[3], 10);
            const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
            const month = months[monthName];
            if (!month) return null;
            return Date.UTC(year, month - 1, day);
        }

        const parsed = Date.parse(str);
        if (isNaN(parsed)) return null;
        const d = new Date(parsed);
        return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    },

    calculateDaysRunning(batch) {
        const records = Array.isArray(batch?.records) ? batch.records : [];
        if (records.length === 0) return 0;

        const sortedRecordDates = records
            .map((record) => String(record?.date || '').trim())
            .filter(Boolean)
            .sort((a, b) => {
                const aMs = this.parseDateToUTCms(a);
                const bMs = this.parseDateToUTCms(b);
                return (aMs ?? 0) - (bMs ?? 0);
            });

        const startDate = sortedRecordDates[0] || null;
        const endDate = (batch.status === 'finished' && batch.output && batch.output.date)
            ? batch.output.date
            : (sortedRecordDates[sortedRecordDates.length - 1] || null);

        const startMs = this.parseDateToUTCms(startDate);
        const endMs = this.parseDateToUTCms(endDate);
        if (startMs === null || endMs === null) return 0;
        const diff = Math.floor((endMs - startMs) / (1000 * 60 * 60 * 24));
        return diff >= 0 ? diff + 1 : 0;
    },

    updateOutputDurationDisplay() {
        const batch = this.data.currentBatch;
        if (!batch) return;
        const outputDateEl = document.getElementById('outputDate');
        const durationEl = document.getElementById('outputDuration');
        if (!outputDateEl || !durationEl) return;
        const startMs = this.parseDateToUTCms(batch.startDate);
        const endMs = this.parseDateToUTCms(outputDateEl.value);
        if (startMs == null || endMs == null) {
            durationEl.textContent = '0 days';
            return;
        }
        const diff = Math.floor((endMs - startMs) / (1000 * 60 * 60 * 24));
        const days = diff >= 0 ? diff + 1 : 0;
        durationEl.textContent = `${days} ${days === 1 ? 'day' : 'days'}`;
    },

    calculateTotalInput(batch) {
        return this.calculateBatchMaterialTotals(batch).totalMaterialInput;
    },

    calculateTotalWaterAdded(batch) {
        if (!batch || !Array.isArray(batch.records)) return 0;
        return batch.records.reduce((sum, record) => {
            const raw = (record?.actionTaken?.waterAddedAmount != null ? record.actionTaken.waterAddedAmount : record?.waterAddedAmount);
            const legacy = record?.process?.waterAddedAmount;
            const picked = raw != null ? raw : legacy;
            const value = picked == null ? 0 : parseFloat(picked);
            return sum + (isNaN(value) ? 0 : value);
        }, 0);
    },

    calculateInitialStockAmount(batch) {
        const initial = this.getInitialStockState(batch);
        if (!initial.exists || !Array.isArray(initial.materials)) return 0;
        return initial.materials.reduce((sum, item) => {
            const value = item?.materialWeight != null ? parseFloat(item.materialWeight) : 0;
            return sum + (isNaN(value) ? 0 : value);
        }, 0);
    },

    normalizeAdditionalMaterialType(type) {
        const raw = String(type || '').toLowerCase();
        return raw.includes('struct') ? 'structural' : 'organic';
    },

    calculateAdditionalInputTotals(additionalInputs = [], explicitOrganic = null, explicitStructural = null) {
        const items = Array.isArray(additionalInputs) ? additionalInputs : [];
        const derived = items.reduce((acc, item) => {
            const normalizedType = this.normalizeAdditionalMaterialType(item?.type);
            const rawAmount = item?.amount != null ? item.amount : item?.weight;
            const amount = rawAmount != null && !isNaN(rawAmount) ? (parseFloat(rawAmount) || 0) : 0;
            if (normalizedType === 'structural') acc.structural += amount;
            else acc.organic += amount;
            return acc;
        }, { organic: 0, structural: 0 });

        const additionalOrganicMaterial = (explicitOrganic != null && !isNaN(explicitOrganic))
            ? (parseFloat(explicitOrganic) || 0)
            : derived.organic;
        const additionalStructuralMaterial = (explicitStructural != null && !isNaN(explicitStructural))
            ? (parseFloat(explicitStructural) || 0)
            : derived.structural;
        const totalAdditionalInput = additionalOrganicMaterial + additionalStructuralMaterial;

        return {
            additionalOrganicMaterial,
            additionalStructuralMaterial,
            totalAdditionalInput
        };
    },

    calculateRecordMaterialBreakdown(record) {
        const input = record?.input || {};
        const maintenance = record?.maintenance || {};

        const rawAdditionalInputs = Array.isArray(maintenance.additionalInputs) && maintenance.additionalInputs.length > 0
            ? maintenance.additionalInputs
            : (Array.isArray(input.additionalInputs) ? input.additionalInputs : []);

        const additionalInputs = rawAdditionalInputs.map((item) => ({
            source: item?.source || '',
            type: this.normalizeAdditionalMaterialType(item?.type),
            description: item?.description || '',
            amount: item?.amount != null
                ? ((item.amount != null && !isNaN(item.amount)) ? (parseFloat(item.amount) || 0) : 0)
                : ((item?.weight != null && !isNaN(item.weight)) ? (parseFloat(item.weight) || 0) : 0)
        }));

        const regularOrganicWaste = (maintenance.totalFoodWaste != null && !isNaN(maintenance.totalFoodWaste))
            ? (parseFloat(maintenance.totalFoodWaste) || 0)
            : (
                (input.regularOrganicWaste != null && !isNaN(input.regularOrganicWaste))
                    ? (parseFloat(input.regularOrganicWaste) || 0)
                    : (
                        (input.totalWasteInput != null && !isNaN(input.totalWasteInput))
                            ? (parseFloat(input.totalWasteInput) || 0)
                            : ((input.cocina || 0) + (input.planta0 || 0) + (input.planta1 || 0) + (input.planta3 || 0))
                    )
            );

        const regularStructuralMaterial = (maintenance.regularStructuralMaterial != null && !isNaN(maintenance.regularStructuralMaterial))
            ? (parseFloat(maintenance.regularStructuralMaterial) || 0)
            : (
                (maintenance.totalStructuralMaterial != null && !isNaN(maintenance.totalStructuralMaterial) && (maintenance.additionalStructuralMaterial == null || isNaN(maintenance.additionalStructuralMaterial)))
                    ? (parseFloat(maintenance.totalStructuralMaterial) || 0)
                    : (
                        (input.regularStructuralMaterial != null && !isNaN(input.regularStructuralMaterial))
                            ? (parseFloat(input.regularStructuralMaterial) || 0)
                            : (
                                Array.isArray(input.structuringMaterials)
                                    ? input.structuringMaterials.reduce((sum, item) => sum + ((item && item.kg != null && !isNaN(item.kg)) ? (parseFloat(item.kg) || 0) : 0), 0)
                                    : ((input.woodFusta || 0) + (input.woodChips || 0))
                            )
                    )
            );

        const additionalTotals = this.calculateAdditionalInputTotals(
            additionalInputs,
            maintenance.additionalOrganicMaterial ?? input.additionalOrganicMaterial,
            maintenance.additionalStructuralMaterial ?? input.additionalStructuralMaterial
        );

        const totalOrganicWaste = (maintenance.totalOrganicWaste != null && !isNaN(maintenance.totalOrganicWaste))
            ? (parseFloat(maintenance.totalOrganicWaste) || 0)
            : (
                (input.totalOrganicWaste != null && !isNaN(input.totalOrganicWaste))
                    ? (parseFloat(input.totalOrganicWaste) || 0)
                    : (regularOrganicWaste + additionalTotals.additionalOrganicMaterial)
            );

        const totalStructuralMaterial = (maintenance.totalStructuralMaterial != null && !isNaN(maintenance.totalStructuralMaterial) && maintenance.additionalStructuralMaterial != null && !isNaN(maintenance.additionalStructuralMaterial))
            ? (parseFloat(maintenance.totalStructuralMaterial) || 0)
            : (
                (input.totalStructuralMaterial != null && !isNaN(input.totalStructuralMaterial))
                    ? (parseFloat(input.totalStructuralMaterial) || 0)
                    : (regularStructuralMaterial + additionalTotals.additionalStructuralMaterial)
            );

        const totalMaterialInput = (maintenance.totalMaterialInput != null && !isNaN(maintenance.totalMaterialInput))
            ? (parseFloat(maintenance.totalMaterialInput) || 0)
            : (
                (maintenance.totalOrganicInput != null && !isNaN(maintenance.totalOrganicInput))
                    ? (parseFloat(maintenance.totalOrganicInput) || 0)
                    : (
                        (input.totalMaterialInput != null && !isNaN(input.totalMaterialInput))
                            ? (parseFloat(input.totalMaterialInput) || 0)
                            : (
                                (input.totalOrganicInput != null && !isNaN(input.totalOrganicInput))
                                    ? (parseFloat(input.totalOrganicInput) || 0)
                                    : (totalOrganicWaste + totalStructuralMaterial)
                            )
                    )
            );

        return {
            additionalInputs,
            regularOrganicWaste,
            regularStructuralMaterial,
            additionalOrganicMaterial: additionalTotals.additionalOrganicMaterial,
            additionalStructuralMaterial: additionalTotals.additionalStructuralMaterial,
            totalAdditionalInput: additionalTotals.totalAdditionalInput,
            totalOrganicWaste,
            totalStructuralMaterial,
            totalMaterialInput,
            totalOrganicInput: totalMaterialInput
        };
    },

    calculateBatchMaterialTotals(batch) {
        if (!batch || !Array.isArray(batch.records)) {
            return {
                regularOrganicWaste: 0,
                regularStructuralMaterial: 0,
                additionalOrganicMaterial: 0,
                additionalStructuralMaterial: 0,
                totalAdditionalInput: 0,
                totalOrganicWaste: 0,
                totalStructuralMaterial: 0,
                totalMaterialInput: 0,
                totalOrganicInput: 0
            };
        }

        return batch.records.reduce((acc, record) => {
            const breakdown = this.calculateRecordMaterialBreakdown(record);
            acc.regularOrganicWaste += breakdown.regularOrganicWaste;
            acc.regularStructuralMaterial += breakdown.regularStructuralMaterial;
            acc.additionalOrganicMaterial += breakdown.additionalOrganicMaterial;
            acc.additionalStructuralMaterial += breakdown.additionalStructuralMaterial;
            acc.totalAdditionalInput += breakdown.totalAdditionalInput;
            acc.totalOrganicWaste += breakdown.totalOrganicWaste;
            acc.totalStructuralMaterial += breakdown.totalStructuralMaterial;
            acc.totalMaterialInput += breakdown.totalMaterialInput;
            acc.totalOrganicInput += breakdown.totalMaterialInput;
            return acc;
        }, {
            regularOrganicWaste: 0,
            regularStructuralMaterial: 0,
            additionalOrganicMaterial: 0,
            additionalStructuralMaterial: 0,
            totalAdditionalInput: 0,
            totalOrganicWaste: 0,
            totalStructuralMaterial: 0,
            totalMaterialInput: 0,
            totalOrganicInput: 0
        });
    },

    calculateBatchTotalMaterialInput(batch) {
        return this.calculateBatchMaterialTotals(batch).totalMaterialInput;
    },

    calculateRecordTotalMaterialInput(record) {
        return this.calculateRecordMaterialBreakdown(record).totalMaterialInput;
    },

    calculateRecordTotalOrganicInput(record) {
        return this.calculateRecordTotalMaterialInput(record);
    },

    calculateAvgTemperature(record) {
        const monitoring = record?.monitoring || null;
        const process = record?.process || null;
        if (!monitoring && !process) return null;
        const core = monitoring?.coreTemperature != null ? monitoring.coreTemperature : process?.core;
        const transition = monitoring?.transitionTemperature != null ? monitoring.transitionTemperature : process?.transition;
        const outer = monitoring?.outerTemperature != null ? monitoring.outerTemperature : process?.outer;
        const values = [core, transition, outer].filter(v => v !== null && !isNaN(v));
        if (values.length === 0) return null;
        return Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 10) / 10;
    },

    getBatchPhaseTracking(records) {
        const sortedRecords = Array.isArray(records)
            ? [...records].sort((a, b) => new Date(a.date) - new Date(b.date))
            : [];
        const phaseByRecordId = new Map();
        let state = 'Mesophilic';
        let hasEnteredThermophilic = false;
        let lowStreak = 0;

        for (const record of sortedRecords) {
            const avg = this.calculateAvgTemperature(record);
            if (avg === null) {
                phaseByRecordId.set(record.id, state);
                continue;
            }

            if (avg >= 45) {
                state = 'Thermophilic';
                hasEnteredThermophilic = true;
                lowStreak = 0;
            } else if (hasEnteredThermophilic) {
                lowStreak += 1;
                state = lowStreak >= 3 ? 'Cooling & Maturation' : 'Thermophilic';
            } else {
                state = 'Mesophilic';
                lowStreak = 0;
            }

            phaseByRecordId.set(record.id, state);
        }

        return { sortedRecords, phaseByRecordId };
    },

    getPhaseInfo(batch) {
        const phases = ['Mesophilic', 'Thermophilic', 'Cooling & Maturation', 'Finished'];
        if (!batch || batch.records.length === 0) {
            return { phase: 'Phase cannot be determined (no data available)', index: -1, avgTemp: null, status: 'no_data', duration: 0 };
        }

        const { sortedRecords, phaseByRecordId } = this.getBatchPhaseTracking(batch.records);
        const latestTempRecord = [...sortedRecords].reverse().find((record) => this.calculateAvgTemperature(record) !== null);
        const latestAvgTemp = latestTempRecord ? this.calculateAvgTemperature(latestTempRecord) : null;

        if (batch.status === 'finished') {
            return { phase: 'Finished', index: phases.indexOf('Finished'), avgTemp: latestAvgTemp, status: 'ok', duration: 0 };
        }

        if (!latestTempRecord || latestAvgTemp === null) {
            return { phase: 'Phase cannot be determined (no data available)', index: -1, avgTemp: null, status: 'no_data', duration: 0 };
        }

        const currentPhase = phaseByRecordId.get(latestTempRecord.id) || 'Mesophilic';
        const currentIndex = phases.indexOf(currentPhase);

        let duration = 0;
        const latestTempIndex = sortedRecords.findIndex((record) => record.id === latestTempRecord.id);
        for (let i = latestTempIndex; i >= 0; i--) {
            const r = sortedRecords[i];
            const avg = this.calculateAvgTemperature(r);
            if (avg === null) continue;
            const p = phaseByRecordId.get(r.id);
            if (p === currentPhase) duration += 1;
            else break;
        }

        return { phase: currentPhase, index: currentIndex, avgTemp: latestAvgTemp, status: 'ok', duration };
    },

    getCurrentPhase(batch) {
        const info = this.getPhaseInfo(batch);
        return info.phase;
    },

    hasMonitoringData(record) {
        const monitoring = this.getICTAMonitoringState(record);
        const process = record?.process || {};
        const temperatureFields = [
            monitoring.ambientTemperature,
            monitoring.coreTemperature,
            monitoring.transitionTemperature,
            monitoring.outerTemperature,
            process.ambient,
            process.core,
            process.transition,
            process.outer
        ];
        const hasTemperature = temperatureFields.some((value) => value != null && !isNaN(value));
        const hasEnvironmental = monitoring.ambientHumidity != null && !isNaN(monitoring.ambientHumidity);
        const hasMoisture = (monitoring.moistureValue != null && !isNaN(monitoring.moistureValue))
            || !!monitoring.moistureQualitative;
        const hasOdour = monitoring.odourDetected === true
            || monitoring.odourDetected === false
            || !!monitoring.odourType
            || !!monitoring.odourDistance
            || (!!monitoring.odourLevel && monitoring.odourLevel !== 'no_odour');
        const hasLeachate = !!monitoring.leachateObserved && monitoring.leachateObserved !== 'not_assessed';
        const advanced = monitoring.advancedMonitoring || {};
        const hasAdvanced = ['laboratoryMoisture', 'oxygen', 'ammonia', 'carbonDioxide', 'methane', 'hydrogenSulfide', 'voc', 'nitrousOxide', 'organicMatter', 'electricalConductivity']
            .some((key) => advanced?.[key]?.value != null && advanced[key].value !== '' && !isNaN(advanced[key].value))
            || !!advanced.notes;
        return hasTemperature || hasEnvironmental || hasMoisture || hasOdour || hasLeachate || hasAdvanced;
    },

    hasMaintenanceData(record) {
        return this.calculateRecordTotalMaterialInput(record) > 0;
    },

    getVisitTypeInfo(record) {
        const hasMonitoring = this.hasMonitoringData(record);
        const hasMaintenance = this.hasMaintenanceData(record);

        if (hasMonitoring && hasMaintenance) {
            return { label: 'Monitoring & Maintenance', badgeClass: 'combined', icon: '🔵' };
        }
        if (hasMonitoring) {
            return { label: 'Monitoring', badgeClass: 'monitoring', icon: '🟢' };
        }
        if (hasMaintenance) {
            return { label: 'Maintenance', badgeClass: 'maintenance', icon: '🟠' };
        }
        return { label: 'Not Recorded', badgeClass: 'empty', icon: '⚪' };
    },

    viewDailyRecord(recordId) {
        const batch = this.data.currentBatch;
        if (!batch) return;
        const record = batch.records.find((item) => String(item.id) === String(recordId));
        if (!record) return;

        const visitType = this.getVisitTypeInfo(record);
        const coreTemperature = record?.monitoring?.coreTemperature != null
            ? (parseFloat(record.monitoring.coreTemperature) || 0)
            : (record?.process?.core != null ? (parseFloat(record.process.core) || 0) : null);
        const temperatureDisplay = coreTemperature != null && !isNaN(coreTemperature)
            ? `${this.formatNumber(coreTemperature, 1)}°C`
            : 'Not Recorded';
        const status = (this.hasMonitoringData(record) || this.hasMaintenanceData(record)) ? '✅ Complete' : '🟡 Draft';

        const body = `
            <div style="display:grid; gap: 12px; line-height: 1.6;">
                <div><strong>Date:</strong> ${this.formatDate(record.date)}</div>
                <div><strong>Composter ID:</strong> ${record.composterId || '—'}</div>
                <div><strong>Visit Type:</strong> ${visitType.icon} ${visitType.label}</div>
                <div><strong>Temperature:</strong> ${temperatureDisplay}</div>
                <div><strong>Status:</strong> ${status}</div>
            </div>
        `;
        this.showInfoModal('Daily Record Details', body);
    },

    deleteDailyRecord(recordId) {
        const batch = this.data.currentBatch;
        if (!batch) return;
        const record = batch.records.find((item) => String(item.id) === String(recordId));
        if (!record) return;
        const routeId = this.getBatchRouteId(batch);

        this.showConfirmModal({
            id: 'deleteDailyRecordModal',
            title: 'Delete Daily Record?',
            message: `This will permanently delete the record from ${this.formatDate(record.date)}.`,
            confirmText: 'Delete',
            cancelText: 'Cancel',
            confirmClass: 'btn btn-danger',
            cancelClass: 'btn btn-secondary',
            onConfirm: async () => {
                const removedPhotoPaths = this.getPhotoStoragePaths(record?.uploadedPhotos || []);
                batch.records = batch.records.filter((item) => String(item.id) !== String(recordId));
                this.saveData();
                try {
                    await this.deleteDailyRecordFromCloud(batch, recordId, removedPhotoPaths);
                    await this.upsertBatchToCloud(batch, { skipCreatedAt: true });
                } catch (error) {
                }
                this.navigate('batchDetail', { batchId: routeId });
            }
        });
    },

    formatShortDate(dateStr) {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
    },

    getBatchTrendData(batch) {
        const sortedRecords = Array.isArray(batch?.records)
            ? [...batch.records].sort((a, b) => new Date(a.date) - new Date(b.date))
            : [];
        let cumulativeMaterialInput = 0;

        return sortedRecords.map((record) => {
            const coreTemperature = record?.monitoring?.coreTemperature != null
                ? (parseFloat(record.monitoring.coreTemperature) || 0)
                : (record?.process?.core != null ? (parseFloat(record.process.core) || 0) : null);
            const materialInputAddedToday = this.calculateRecordTotalMaterialInput(record);
            cumulativeMaterialInput += materialInputAddedToday;
            return {
                id: record.id,
                date: record.date,
                shortDate: this.formatShortDate(record.date),
                fullDate: this.formatDate(record.date),
                coreTemperature,
                materialInputAddedToday,
                cumulativeMaterialInput
            };
        });
    },

    renderLineTrendChart(options = {}) {
        const {
            points = [],
            yAxisLabel = '',
            emptyMessage = 'No data available yet.',
            tooltipFormatter = null
        } = options;

        const width = 700;
        const height = 220;
        const margin = { top: 20, right: 18, bottom: 48, left: 50 };
        const chartWidth = width - margin.left - margin.right;
        const chartHeight = height - margin.top - margin.bottom;
        const validPoints = points.filter((point) => point && point.value != null && !isNaN(point.value));

        if (points.length === 0 || validPoints.length === 0) {
            return `
                <div class="trend-chart-empty">
                    <div>${emptyMessage}</div>
                    <div class="trend-chart-empty-sub">Add Daily Records to visualize this trend.</div>
                </div>
            `;
        }

        const minValue = Math.min(...validPoints.map((point) => point.value));
        const maxValue = Math.max(...validPoints.map((point) => point.value));
        const range = maxValue - minValue;
        const padding = range === 0 ? Math.max(1, Math.abs(maxValue || 1) * 0.1) : range * 0.12;
        const yMin = Math.max(0, minValue - padding);
        const yMax = maxValue + padding;
        const yRange = yMax - yMin || 1;
        const xStep = points.length > 1 ? chartWidth / (points.length - 1) : 0;
        const xForIndex = (index) => margin.left + (points.length > 1 ? xStep * index : chartWidth / 2);
        const yForValue = (value) => margin.top + chartHeight - ((value - yMin) / yRange) * chartHeight;

        const polylinePoints = points
            .map((point, index) => point.value != null && !isNaN(point.value) ? `${xForIndex(index)},${yForValue(point.value)}` : null)
            .filter(Boolean)
            .join(' ');

        const gridLines = Array.from({ length: 5 }, (_, index) => {
            const ratio = index / 4;
            const value = yMax - (yRange * ratio);
            const y = margin.top + chartHeight * ratio;
            return `
                <g>
                    <line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" class="trend-grid-line"></line>
                    <text x="${margin.left - 10}" y="${y + 4}" text-anchor="end" class="trend-axis-label">${this.formatNumber(value, 1)}</text>
                </g>
            `;
        }).join('');

        const xLabels = points.map((point, index) => `
            <text x="${xForIndex(index)}" y="${height - 18}" text-anchor="middle" class="trend-axis-label">${point.label}</text>
        `).join('');

        const circles = points.map((point, index) => {
            if (point.value == null || isNaN(point.value)) return '';
            const tooltipText = tooltipFormatter
                ? tooltipFormatter(point)
                : `${point.fullDate}\n${this.formatNumber(point.value, 1)}`;
            return `
                <circle cx="${xForIndex(index)}" cy="${yForValue(point.value)}" r="4.5" class="trend-point">
                    <title>${tooltipText}</title>
                </circle>
            `;
        }).join('');

        return `
            <div class="trend-chart-shell">
                <div class="trend-axis-title">${yAxisLabel}</div>
                <svg viewBox="0 0 ${width} ${height}" class="trend-chart-svg" role="img" aria-label="${yAxisLabel} trend chart">
                    ${gridLines}
                    <line x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}" class="trend-axis-line"></line>
                    <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}" class="trend-axis-line"></line>
                    <polyline fill="none" points="${polylinePoints}" class="trend-line"></polyline>
                    ${circles}
                    ${xLabels}
                </svg>
            </div>
        `;
    },

    renderBatchTrendSection(batch) {
        const inputUnit = this.getBatchInputUnitName(batch);
        const trendData = this.getBatchTrendData(batch);
        const coreTemperaturePoints = trendData.map((item) => ({
            label: item.shortDate,
            fullDate: item.fullDate,
            value: item.coreTemperature
        }));
        const materialInputPoints = trendData.map((item) => ({
            label: item.shortDate,
            fullDate: item.fullDate,
            value: item.cumulativeMaterialInput,
            addedToday: item.materialInputAddedToday
        }));

        return `
            <div class="card">
                <div class="trend-panel">
                    <div class="trend-chart-card">
                        <div class="trend-chart-title">Core Temperature Trend</div>
                        ${this.renderLineTrendChart({
                            points: coreTemperaturePoints,
                            yAxisLabel: 'Temperature (°C)',
                            emptyMessage: 'No core temperature records yet.',
                            tooltipFormatter: (point) => `${point.fullDate}\nCore Temperature: ${this.formatNumber(point.value, 1)}°C`
                        })}
                    </div>
                    <div class="trend-chart-card">
                        <div class="trend-chart-title">Total Material Input Trend</div>
                        ${this.renderLineTrendChart({
                            points: materialInputPoints,
                            yAxisLabel: `Material Input (${inputUnit})`,
                            emptyMessage: 'No material input records yet.',
                            tooltipFormatter: (point) => `${point.fullDate}\nAdded Today: ${this.formatNumber(point.addedToday, 3)} ${inputUnit}\nCumulative Material Input: ${this.formatNumber(point.value, 3)} ${inputUnit}`
                        })}
                    </div>
                </div>
            </div>
        `;
    },

    render() {
        const app = document.getElementById('app');
        if (this.data.currentUser === null && this.data.currentPage !== 'login' && this.data.currentPage !== 'register') {
            this.navigate('login');
            return;
        }
        switch (this.data.currentPage) {
            case 'login':
                app.innerHTML = this.renderLogin();
                break;
            case 'register':
                app.innerHTML = this.renderRegister();
                break;
            case 'dashboard':
                app.innerHTML = this.renderDashboard();
                break;
            case 'createBatch':
                app.innerHTML = this.renderCreateBatch();
                break;
            case 'batchDetail':
                app.innerHTML = this.renderBatchDetail();
                break;
            case 'dailyRecord':
                app.innerHTML = this.renderDailyRecord();
                break;
            case 'output':
                app.innerHTML = this.renderOutput();
                break;
            case 'export':
                app.innerHTML = this.renderExport();
                break;
            default:
                app.innerHTML = this.renderLogin();
        }
        this.attachEventListeners();
    },

    renderLogin() {
        const rememberMeChecked = this.data.rememberMe ? 'checked' : '';
        return `
            <div class="header">
                <h1>🔐 Login</h1>
            </div>
            <div class="container">
                <div class="card" style="max-width: 520px; margin: 40px auto;">
                    <form id="loginForm" novalidate onsubmit="event.preventDefault(); app.handleLoginSubmit()">
                        <div class="form-group">
                            <label class="form-label required">Email</label>
                            <input type="email" class="form-input" id="loginEmail" placeholder="Enter your email" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label required">Password</label>
                            <div style="display: flex; gap: 8px; align-items: center;">
                                <input type="password" class="form-input" id="loginPassword" placeholder="Enter your password" required>
                                <button type="button" id="loginPasswordToggle" style="border: none; background: transparent; color: #999; font-size: 1rem; cursor: pointer; padding: 0 4px;" onclick="app.togglePasswordVisibility('loginPassword', 'loginPasswordToggle')">👀</button>
                            </div>
                        </div>
                        <div class="form-group" style="margin-top: -10px; margin-bottom: 10px;">
                            <label class="checkbox-item">
                                <input type="checkbox" id="loginRememberMe" ${rememberMeChecked}>
                                Remember Me
                            </label>
                        </div>
                        <div class="form-group" style="margin-top: -8px; margin-bottom: 12px;">
                            <button type="button" class="btn btn-secondary" style="padding: 8px 14px; font-size: 0.9rem;" onclick="app.handleForgotPassword()">
                                Forgot Password?
                            </button>
                        </div>
                        <div class="btn-group" style="margin-top: 10px;">
                            <button type="button" class="btn btn-primary" onclick="app.handleLoginSubmit()">Login</button>
                            <button type="button" class="btn btn-secondary" onclick="app.navigate('register')">Register</button>
                        </div>
                    </form>
                </div>
            </div>
        `;
    },

    renderRegister() {
        return `
            <div class="header">
                <h1>📝 Register</h1>
            </div>
            <div class="container">
                <div class="card" style="max-width: 520px; margin: 40px auto;">
                    <form id="registerForm">
                        <div class="form-group">
                            <label class="form-label required">Organization Name</label>
                            <input type="text" class="form-input" id="registerOrganization" placeholder="Enter your organization name" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label required">Community Type</label>
                            <div class="radio-group" id="registerCommunityTypeGroup">
                                <label class="radio-item">
                                    <input type="radio" name="registerCommunityType" value="School">
                                    School
                                </label>
                                <label class="radio-item">
                                    <input type="radio" name="registerCommunityType" value="Community Garden">
                                    Community Garden
                                </label>
                                <label class="radio-item">
                                    <input type="radio" name="registerCommunityType" value="Neighborhood Composting">
                                    Neighborhood Composting
                                </label>
                                <label class="radio-item">
                                    <input type="radio" name="registerCommunityType" value="Urban Agriculture">
                                    Urban Agriculture
                                </label>
                                <label class="radio-item">
                                    <input type="radio" name="registerCommunityType" value="Research / University">
                                    Research / University
                                </label>
                                <label class="radio-item">
                                    <input type="radio" name="registerCommunityType" value="Other">
                                    Other
                                </label>
                            </div>
                            <input type="text" class="form-input" id="registerCommunityTypeOther" placeholder="Please specify" style="display:none; margin-top: 12px;">
                        </div>
                        <div class="form-group">
                            <label class="form-label required">Email</label>
                            <input type="email" class="form-input" id="registerEmail" placeholder="Enter your email" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label required">Password</label>
                            <div style="display: flex; gap: 8px; align-items: center;">
                                <input type="password" class="form-input" id="registerPassword" placeholder="Enter your password" required>
                                <button type="button" id="registerPasswordToggle" style="border: none; background: transparent; color: #999; font-size: 1rem; cursor: pointer; padding: 0 4px;" onclick="app.togglePasswordVisibility('registerPassword', 'registerPasswordToggle')">👀</button>
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="form-label required">Confirm Password</label>
                            <div style="display: flex; gap: 8px; align-items: center;">
                                <input type="password" class="form-input" id="registerConfirmPassword" placeholder="Confirm your password" required>
                                <button type="button" id="registerConfirmPasswordToggle" style="border: none; background: transparent; color: #999; font-size: 1rem; cursor: pointer; padding: 0 4px;" onclick="app.togglePasswordVisibility('registerConfirmPassword', 'registerConfirmPasswordToggle')">👀</button>
                            </div>
                        </div>
                        <div class="btn-group" style="margin-top: 10px;">
                            <button type="submit" class="btn btn-primary">Register</button>
                            <button type="button" class="btn btn-secondary" onclick="app.navigate('login')">Back to Login</button>
                        </div>
                    </form>
                </div>
            </div>
        `;
    },

    renderDashboard() {
        const activeBatches = this.data.batches.filter(b => b.status === 'active');
        const finishedBatches = this.data.batches.filter(b => b.status === 'finished');
        const userEmail = this.data.currentUser?.email || 'Not logged in';
        const userOrganization = this.data.currentOrganization || '-';

        return `
            <div class="header">
                <h1>🌱 Compostopia</h1>
            </div>
            <div class="container">
                <div class="card">
                    <div class="card-header">
                        <h2 class="card-title">📊 Batch Overview</h2>
                        <div class="btn-group" style="justify-content: flex-end;">
                            <span class="status-badge" style="background: #E3F2FD; color: #1565C0;">👤 ${userEmail}</span>
                            <span class="status-badge" style="background: #F3E5F5; color: #6A1B9A;">🏢 ${userOrganization}</span>
                            <button class="btn btn-secondary" onclick="app.logoutUser()">🚪 Logout</button>
                            <button class="btn btn-primary" onclick="app.navigate('createBatch')">
                                ➕ Create Batch
                            </button>
                        </div>
                    </div>

                    ${activeBatches.length === 0 && finishedBatches.length === 0 ? `
                        <div class="empty-state">
                            <div class="empty-state-icon">📦</div>
                            <h3>No Batches Yet</h3>
                            <p>Create your first batch to start monitoring composting progress.</p>
                        </div>
                    ` : `
                        ${activeBatches.length > 0 ? `
                            <h3 style="margin: 20px 0 15px; color: var(--warning);">🟡 Active Batches (${activeBatches.length})</h3>
                            <div class="batch-list">
                                ${activeBatches.map(batch => this.renderBatchCard(batch)).join('')}
                            </div>
                        ` : ''}

                        ${finishedBatches.length > 0 ? `
                            <h3 style="margin: 30px 0 15px; color: var(--secondary);">🟢 Finished Batches (${finishedBatches.length})</h3>
                            <div class="batch-list">
                                ${finishedBatches.map(batch => this.renderBatchCard(batch)).join('')}
                            </div>
                        ` : ''}
                    `}
                </div>
            </div>
            <div class="footer">
                <p>Compostopia v1.0</p>
            </div>
        `;
    },

    renderBatchCard(batch) {
        const sortedRecords = [...(batch.records || [])].sort((a, b) => new Date(a.date) - new Date(b.date));
        const totalInput = this.calculateBatchTotalMaterialInput(batch);
        const inputUnit = this.getBatchInputUnitName(batch);
        const daysRunning = this.calculateDaysRunning(batch);
        const lastActivity = sortedRecords.length > 0
            ? this.formatDate(sortedRecords[sortedRecords.length - 1].date)
            : 'No records';
        const routeId = this.getBatchRouteId(batch);
        const safeRouteId = String(routeId).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const galleryCount = this.getBatchGalleryState(batch).totalCount;
        const collaborationType = batch?.collaborationSettings?.type || 'private';
        const collaborationBadge = collaborationType === 'shared'
            ? (this.isBatchOwner(batch) ? '🤝 Shared by you' : '🤝 Shared with you')
            : '🔒 Private';

        return `
            <div class="batch-card ${batch.status}">
                <div class="batch-info">
                    <div class="info-item">
                        <span class="info-label">Batch ID</span>
                        <span class="info-value batch-id-with-info">
                            <span>${batch.id}</span>
                            <button type="button" class="batch-id-info-btn" onclick="event.stopPropagation(); app.showBatchInfo('${safeRouteId}')">ⓘ</button>
                        </span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Start Date</span>
                        <span class="info-value">${this.formatDate(batch.startDate)}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Status</span>
                        <span class="status-badge ${batch.status}">${batch.status === 'active' ? '🟡 Active' : '🟢 Finished'}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Access</span>
                        <span class="info-value">${collaborationBadge}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Manager</span>
                        <span class="info-value">${batch.manager}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Total Material Input</span>
                        <span class="info-value">${this.formatNumber(totalInput, 3)} ${inputUnit}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Days Running</span>
                        <span class="info-value">${daysRunning}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Last Activity</span>
                        <span class="info-value">${lastActivity}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Current Phase</span>
                        <span class="info-value">${this.getCurrentPhase(batch)}</span>
                    </div>
                </div>
                <div class="btn-group">
                    <button class="btn btn-primary" onclick="app.navigate('batchDetail', {batchId: '${safeRouteId}'})">
                        👀 View
                    </button>
                    <button class="btn btn-secondary" onclick="app.showBatchGallery('${safeRouteId}')">
                        🖼 Gallery${galleryCount > 0 ? ` (${galleryCount})` : ''}
                    </button>
                    ${batch.status === 'active' ? `
                        <button class="btn btn-danger" onclick="app.showFinishModal('${safeRouteId}')">
                            🏁 Finish
                        </button>
                    ` : `
                        <button class="btn btn-secondary" onclick="app.navigate('output', {batchId: '${safeRouteId}'})">
                            📤 Output
                        </button>
                        <button class="btn btn-secondary" onclick="app.navigate('export', {batchId: '${safeRouteId}'})">
                            📥 Export
                        </button>
                    `}
                    ${this.canDeleteBatch(batch) ? `
                        <button class="btn btn-danger" style="margin-left: auto;" onclick="app.deleteBatch('${safeRouteId}')">
                            🗑️ Delete
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    },

    renderCollaboratorManagement(batch, options = {}) {
        const embedded = !!options.embedded;
        const routeId = this.escapeAttr(this.getBatchRouteId(batch));
        const collaborators = this.getBatchCollaborators(batch);
        const ownerEmail = batch?.ownerEmail || this.data.currentUser?.email || '—';
        const isOwner = this.isBatchOwner(batch);
        const isCollaborator = this.isCurrentUserCollaborator(batch);
        const accessType = collaborators.length > 0 ? 'Shared Batch' : 'Private Batch';
        const accessHint = isOwner
            ? (collaborators.length > 0 ? 'You manage who can access and edit this batch.' : 'Add collaborator emails to convert this batch into a shared batch.')
            : 'You can view and contribute to this batch because the owner shared it with you.';
        const wrapperClass = embedded
            ? 'collaborator-management-card collaborator-management-card-embedded'
            : 'card collaborator-management-card';

        return `
            <div class="${wrapperClass}">
                <div class="card-header collaborator-management-header">
                    <div>
                        <h2 class="card-title">🤝 Collaborator Management</h2>
                        <div class="collaborator-management-subtitle">${accessHint}</div>
                    </div>
                    <div class="collaborator-summary-badges">
                        <span class="collaborator-status-badge">${accessType}</span>
                        <span class="collaborator-count-badge">${collaborators.length} collaborator${collaborators.length === 1 ? '' : 's'}</span>
                    </div>
                </div>

                <div class="collaborator-owner-row">
                    <div class="collaborator-owner-label">Owner</div>
                    <div class="collaborator-owner-email">${this.escapeAttr(ownerEmail)}</div>
                </div>

                <div class="collaborator-chip-list">
                    ${collaborators.length > 0 ? collaborators.map((email) => `
                        <div class="collaborator-chip">
                            <span class="collaborator-chip-email">${this.escapeAttr(email)}</span>
                            ${isOwner ? `
                                <button type="button" class="collaborator-chip-remove" onclick="app.removeBatchCollaborator('${routeId}', '${this.escapeAttr(email)}')">Remove</button>
                            ` : ''}
                        </div>
                    `).join('') : `
                        <div class="collaborator-empty-state">No collaborators added yet.</div>
                    `}
                </div>

                ${isOwner ? `
                    <div class="collaborator-manager-form">
                        <div class="form-group" style="margin-bottom: 0;">
                            <label class="form-label">Invite Collaborators</label>
                            <input type="text" class="form-input" id="batchCollaboratorInput" placeholder="Enter one or more emails, separated by commas">
                        </div>
                        <button type="button" class="btn btn-primary" onclick="app.addBatchCollaborators('${routeId}')">
                            ${collaborators.length > 0 ? 'Add Collaborators' : 'Share Batch'}
                        </button>
                    </div>
                ` : ''}

                ${isCollaborator ? `
                    <div class="collaborator-leave-box">
                        <div class="collaborator-leave-copy">Need to stop contributing to this shared batch?</div>
                        <button type="button" class="btn btn-secondary" onclick="app.leaveSharedBatch('${routeId}')">Leave Shared Batch</button>
                    </div>
                ` : ''}
            </div>
        `;
    },

    getActiveBatchInfoPanel(batch) {
        const panelState = this.data.batchInfoPanel;
        const routeId = this.getBatchRouteId(batch);
        if (!panelState || panelState.batchId !== routeId) return '';
        return panelState.panel || '';
    },

    toggleBatchInfoPanel(batchId, panel) {
        const current = this.data.batchInfoPanel;
        if (current && current.batchId === batchId && current.panel === panel) {
            this.data.batchInfoPanel = null;
        } else {
            this.data.batchInfoPanel = { batchId, panel };
        }
        this.render();
    },

    renderBatchInfoInlinePanel(batch, activePanel) {
        if (activePanel === 'collaborators') {
            return this.renderCollaboratorManagement(batch, { embedded: true });
        }
        if (activePanel === 'activity') {
            return `
                <div class="activity-log-card activity-log-card-embedded">
                    <div class="card-header">
                        <h2 class="card-title">📜 Collaborator Activity Log</h2>
                    </div>
                    ${this.renderActivityLog(batch)}
                </div>
            `;
        }
        return '';
    },

    getBatchGalleryState(batch) {
        const records = Array.isArray(batch?.records) ? [...batch.records].sort((a, b) => new Date(b.date) - new Date(a.date)) : [];
        const sections = [];
        const allPhotos = [];

        records.forEach((record) => {
            const photos = this.normalizePhotoList(record?.uploadedPhotos || []);
            if (photos.length === 0) return;
            const items = photos.map((photo, idx) => {
                const src = this.getPhotoPreviewSrc(photo);
                const photoIndex = allPhotos.push({
                    src,
                    title: `${batch.id} • ${this.formatDate(record.date)} • Photo ${idx + 1}`
                }) - 1;
                return { src, photoIndex };
            });
            sections.push({
                title: `Daily Record • ${this.formatDate(record.date)}${record?.composterId ? ` • ${record.composterId}` : ''}`,
                subtitle: `${photos.length} photo${photos.length === 1 ? '' : 's'}`,
                items
            });
        });

        const finalPhotos = this.normalizePhotoList(batch?.finalAssessment?.finalCompostPhotos || []);
        if (finalPhotos.length > 0) {
            const items = finalPhotos.map((photo, idx) => {
                const src = this.getPhotoPreviewSrc(photo);
                const photoIndex = allPhotos.push({
                    src,
                    title: `${batch.id} • Final Compost Photo ${idx + 1}`
                }) - 1;
                return { src, photoIndex };
            });
            sections.push({
                title: 'Final Compost Photos',
                subtitle: `${finalPhotos.length} photo${finalPhotos.length === 1 ? '' : 's'}`,
                items
            });
        }

        return {
            totalCount: allPhotos.length,
            sections,
            allPhotos
        };
    },

    showBatchGallery(batchId) {
        const batch = this.findBatchByRouteId(batchId);
        if (!batch) return;

        const gallery = this.getBatchGalleryState(batch);
        this.data.batchGalleryPhotos = gallery.allPhotos;

        const body = gallery.totalCount === 0
            ? `
                <div class="empty-state" style="padding: 10px 0;">
                    <div class="empty-state-icon">🖼</div>
                    <h3>No Photos Yet</h3>
                    <p>This batch does not have any uploaded Daily Record or Final Compost photos yet.</p>
                </div>
            `
            : `
                <div style="display:grid; gap: 20px; max-height: 70vh; overflow-y: auto; padding-right: 4px;">
                    ${gallery.sections.map((section) => `
                        <div>
                            <div style="font-weight: 800; margin-bottom: 4px;">${section.title}</div>
                            <div style="color: var(--gray); font-size: 0.92rem; margin-bottom: 10px;">${section.subtitle}</div>
                            <div class="icta-photo-grid">
                                ${section.items.map((item) => `
                                    <div class="icta-photo-tile">
                                        <img class="icta-photo-thumb" src="${item.src}" alt="${section.title}">
                                        <div class="icta-photo-actions">
                                            <button type="button" class="btn btn-secondary icta-photo-btn" onclick="app.showBatchGalleryPhoto(${item.photoIndex})">View</button>
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;

        this.showInfoModal(`Batch Gallery — ${batch.id} (${gallery.totalCount})`, body);
    },

    showBatchGalleryPhoto(index) {
        const photo = Array.isArray(this.data.batchGalleryPhotos) ? this.data.batchGalleryPhotos[index] : null;
        if (!photo?.src) return;

        const existing = document.getElementById('batchGalleryPhotoModal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.id = 'batchGalleryPhotoModal';
        modal.innerHTML = `
            <div class="modal" style="max-width: 900px;">
                <div class="modal-header">
                    <h2 class="modal-title">${photo.title}</h2>
                </div>
                <div class="modal-body">
                    <img src="${photo.src}" alt="${photo.title}" style="max-width: 100%; max-height: 75vh; display:block; margin: 0 auto; border-radius: 12px;">
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="app.closeBatchGalleryPhotoModal()">Close</button>
                </div>
            </div>
        `;
        modal.addEventListener('click', (event) => {
            if (event.target === modal) this.closeBatchGalleryPhotoModal();
        });
        document.body.appendChild(modal);
    },

    closeBatchGalleryPhotoModal() {
        const modal = document.getElementById('batchGalleryPhotoModal');
        if (modal) modal.remove();
    },

    showBatchInfo(batchId) {
        const batch = this.findBatchByRouteId(batchId);
        if (!batch) return;

        const esc = (v) => String(v ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');

        const measurement = this.getBatchMeasurementSettings(batch);
        const methodLabel = measurement.inputMethod === 'volume'
            ? 'Volume (L)'
            : (measurement.inputMethod === 'other' ? 'Other' : 'Weight (kg)');
        const bucketSizeLabel = (measurement.inputMethod === 'volume' && measurement.bucketSizeL != null && !isNaN(measurement.bucketSizeL))
            ? `${this.formatNumber(measurement.bucketSizeL, 3)} L`
            : '—';
        const customUnitLabel = measurement.inputMethod === 'other' ? (measurement.customUnitName || measurement.unitName || '—') : '—';
        const initialStock = this.getInitialStockState(batch);
        const calculationSettings = this.getBatchCalculationSettings(batch);

        const compInfo = batch.compostingSystemInformation || {};
        const composters = Array.isArray(compInfo.composters) ? compInfo.composters : [];
        const composterCards = composters.length > 0
            ? `
                <div class="batch-info-composter-grid">
                    ${composters.map((c) => {
                        const id = c && c.composterId != null ? String(c.composterId) : '';
                        const cap = (c && c.capacityL != null && !isNaN(c.capacityL)) ? `${this.formatNumber(c.capacityL, 3)} L` : '—';
                        return `
                            <div class="batch-info-composter-card">
                                <div class="batch-info-composter-icon">🪵</div>
                                <div class="batch-info-composter-meta">
                                    <div class="batch-info-composter-label">Composter ID</div>
                                    <div class="batch-info-composter-value">${esc(id || '—')}</div>
                                </div>
                                <div class="batch-info-composter-capacity">${esc(cap)}</div>
                            </div>
                        `;
                    }).join('')}
                </div>
            `
            : `<div style="margin-top: 8px; color: var(--gray);">No composter table data.</div>`;

        const collaboration = batch.collaborationSettings || {};
        const collabType = collaboration.type || 'private';
        const collaborators = this.getBatchCollaborators(batch);
        const ownerEmail = batch.ownerEmail || this.data.currentUser?.email || '—';
        const statusLabel = batch.status === 'finished' ? 'Finished' : 'Active';
        const statusClass = batch.status === 'finished' ? 'finished' : 'active';
        const stockAmountLabel = initialStock.exists
            ? `${this.formatNumber(this.calculateInitialStockAmount(batch), 3)} ${measurement.unitName}`
            : '—';
        const conversionRateLabel = `${this.formatNumber(calculationSettings.compostConversionRate * 100, 2)}%`;
        const composterCountLabel = compInfo.numberOfCompostersUsed != null ? String(compInfo.numberOfCompostersUsed) : '—';
        const stockMaterialsTable = initialStock.exists && initialStock.materials.length > 0
            ? `
                <div class="batch-info-table-wrap">
                    <table class="table">
                        <thead>
                            <tr>
                                <th>Material Type</th>
                                <th>Weight</th>
                                <th>Height</th>
                                <th>Composter</th>
                                <th>Purpose</th>
                                <th>Notes</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${initialStock.materials.map((item) => `
                                <tr>
                                    <td>${esc(item.materialType === 'Other' ? (item.materialDescription || 'Other') : item.materialType || '—')}</td>
                                    <td>${esc(`${this.formatNumber(item.materialWeight || 0, 3)} ${measurement.unitName}`)}</td>
                                    <td>${esc(item.approximateHeightCm != null ? `${this.formatNumber(item.approximateHeightCm, 2)} cm` : '—')}</td>
                                    <td>${esc(item.composterId || '—')}</td>
                                    <td>${esc(item.purpose || '—')}</td>
                                    <td>${esc(item.notes || '—')}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `
            : `<div style="margin-top: 8px; color: var(--gray);">No initial materials recorded.</div>`;
        const selectedComposters = Array.from(new Set(initialStock.materials.map((item) => String(item.composterId || '').trim()).filter(Boolean)));

        const body = `
            <div class="batch-info-modal">
                <div class="batch-info-modal-hero">
                    <div>
                        <div class="batch-info-modal-eyebrow">Batch Overview</div>
                        <div class="batch-info-modal-title-row">
                            <div class="batch-info-modal-batch-id">${esc(batch.id)}</div>
                            <span class="status-badge ${statusClass}">${statusLabel}</span>
                        </div>
                        <div class="batch-info-modal-subtitle">Quick access to the full batch setup, system configuration, initial stock, and collaboration details.</div>
                    </div>
                </div>

                <div class="batch-info-modal-summary">
                    <div class="batch-info-modal-summary-card">
                        <div class="batch-info-modal-summary-label">Start Date</div>
                        <div class="batch-info-modal-summary-value">${esc(this.formatDate(batch.startDate))}</div>
                    </div>
                    <div class="batch-info-modal-summary-card">
                        <div class="batch-info-modal-summary-label">Input Method</div>
                        <div class="batch-info-modal-summary-value">${esc(methodLabel)}</div>
                    </div>
                    <div class="batch-info-modal-summary-card">
                        <div class="batch-info-modal-summary-label">Composters</div>
                        <div class="batch-info-modal-summary-value">${esc(composterCountLabel)}</div>
                    </div>
                    <div class="batch-info-modal-summary-card">
                        <div class="batch-info-modal-summary-label">Conversion Rate</div>
                        <div class="batch-info-modal-summary-value">${esc(conversionRateLabel)}</div>
                    </div>
                </div>

                <div class="batch-info-modal-sections">
                    <section class="batch-info-section-card batch-info-section-basic">
                        <div class="batch-info-section-title"><span class="batch-info-section-icon">📋</span><span>Batch Basic Information</span></div>
                        <div class="batch-info-kv-grid">
                            <div class="batch-info-kv-item"><span class="batch-info-kv-label">Batch ID</span><span class="batch-info-kv-value">${esc(batch.id)}</span></div>
                            <div class="batch-info-kv-item"><span class="batch-info-kv-label">Start Date</span><span class="batch-info-kv-value">${esc(this.formatDate(batch.startDate))}</span></div>
                            <div class="batch-info-kv-item"><span class="batch-info-kv-label">Manager</span><span class="batch-info-kv-value">${esc(batch.manager || '—')}</span></div>
                            <div class="batch-info-kv-item"><span class="batch-info-kv-label">Status</span><span class="batch-info-kv-value">${esc(statusLabel)}</span></div>
                            <div class="batch-info-kv-item batch-info-kv-item-wide"><span class="batch-info-kv-label">Location</span><span class="batch-info-kv-value">${esc(batch.location || '—')}</span></div>
                            <div class="batch-info-kv-item batch-info-kv-item-wide"><span class="batch-info-kv-label">Notes</span><span class="batch-info-kv-value">${esc(batch.notes || '—')}</span></div>
                        </div>
                    </section>

                    <section class="batch-info-section-card batch-info-section-measurement">
                        <div class="batch-info-section-title"><span class="batch-info-section-icon">📏</span><span>Measurement Settings</span></div>
                        <div class="batch-info-kv-grid">
                            <div class="batch-info-kv-item"><span class="batch-info-kv-label">Input Method</span><span class="batch-info-kv-value">${esc(methodLabel)}</span></div>
                            <div class="batch-info-kv-item"><span class="batch-info-kv-label">Unit Name</span><span class="batch-info-kv-value">${esc(measurement.unitName || '—')}</span></div>
                            <div class="batch-info-kv-item"><span class="batch-info-kv-label">Default Bucket Size</span><span class="batch-info-kv-value">${esc(bucketSizeLabel)}</span></div>
                            <div class="batch-info-kv-item"><span class="batch-info-kv-label">Custom Unit Name</span><span class="batch-info-kv-value">${esc(customUnitLabel)}</span></div>
                        </div>
                    </section>

                    <section class="batch-info-section-card batch-info-section-system">
                        <div class="batch-info-section-title"><span class="batch-info-section-icon">🧺</span><span>Composting System Information</span></div>
                        <div class="batch-info-kv-grid">
                            <div class="batch-info-kv-item"><span class="batch-info-kv-label">Number of Composters Used</span><span class="batch-info-kv-value">${esc(composterCountLabel)}</span></div>
                        </div>
                        <div class="batch-info-table-wrap">${composterCards}</div>
                    </section>

                    <section class="batch-info-section-card batch-info-section-stock">
                        <div class="batch-info-section-title"><span class="batch-info-section-icon">📦</span><span>Initial Composting Stock</span></div>
                        <div class="batch-info-kv-grid">
                            <div class="batch-info-kv-item"><span class="batch-info-kv-label">Exists</span><span class="batch-info-kv-value">${esc(initialStock.exists ? 'Yes' : 'No')}</span></div>
                            <div class="batch-info-kv-item"><span class="batch-info-kv-label">Total Existing Materials</span><span class="batch-info-kv-value">${esc(String(initialStock.materials.length))}</span></div>
                            <div class="batch-info-kv-item"><span class="batch-info-kv-label">Total Initial Stock Weight</span><span class="batch-info-kv-value">${esc(stockAmountLabel)}</span></div>
                            <div class="batch-info-kv-item"><span class="batch-info-kv-label">Selected Composter</span><span class="batch-info-kv-value">${esc(selectedComposters.length > 0 ? selectedComposters.join(', ') : '—')}</span></div>
                        </div>
                        ${stockMaterialsTable}
                    </section>

                    <section class="batch-info-section-card batch-info-section-calculation">
                        <div class="batch-info-section-title"><span class="batch-info-section-icon">⚙️</span><span>Calculation Settings</span></div>
                        <div class="batch-info-kv-grid">
                            <div class="batch-info-kv-item"><span class="batch-info-kv-label">Overall Compost Conversion Rate</span><span class="batch-info-kv-value">${esc(conversionRateLabel)}</span></div>
                            <div class="batch-info-kv-item"><span class="batch-info-kv-label">Mode</span><span class="batch-info-kv-value">${esc(calculationSettings.useCustomConversionRate ? 'Custom' : 'Default (ICTA-UAB Case)')}</span></div>
                            <div class="batch-info-kv-item"><span class="batch-info-kv-label">Monitoring Protocol</span><span class="batch-info-kv-value">${esc(calculationSettings.monitoringProtocol === 'advanced' ? 'Advanced Monitoring' : 'Basic Monitoring')}</span></div>
                        </div>
                    </section>

                    <section class="batch-info-section-card batch-info-section-collaboration">
                        <div class="batch-info-section-title"><span class="batch-info-section-icon">🤝</span><span>Collaboration Settings</span></div>
                        <div class="batch-info-kv-grid">
                            <div class="batch-info-kv-item"><span class="batch-info-kv-label">Type</span><span class="batch-info-kv-value">${esc(collabType === 'shared' ? 'Shared' : 'Private')}</span></div>
                            <div class="batch-info-kv-item"><span class="batch-info-kv-label">Owner</span><span class="batch-info-kv-value">${esc(ownerEmail)}</span></div>
                            <div class="batch-info-kv-item"><span class="batch-info-kv-label">Collaborator Count</span><span class="batch-info-kv-value">${esc(String(collaborators.length))}</span></div>
                            <div class="batch-info-kv-item batch-info-kv-item-wide"><span class="batch-info-kv-label">Collaborators</span><span class="batch-info-kv-value">${collaborators.length > 0 ? esc(collaborators.join(', ')) : '—'}</span></div>
                        </div>
                    </section>
                </div>
            </div>
        `;

        this.showInfoModal(`Batch Info — ${esc(batch.id)}`, body);
    },

    showMonitoringProtocolInfo(protocol) {
        const isAdvanced = String(protocol || '').toLowerCase() === 'advanced';
        const title = isAdvanced ? 'ⓘ Advanced Monitoring' : 'ⓘ Basic Monitoring';
        const body = isAdvanced
            ? `
                <div style="line-height: 1.65;">
                    <p><strong>Advanced Monitoring</strong></p>
                    <p>Designed for universities, research projects and professional composting systems.</p>
                    <p>Includes all Basic Monitoring parameters together with optional laboratory and research measurements.</p>
                    <p>Not all measurements are required for every monitoring session. Users should record only the parameters that are available.</p>
                </div>
            `
            : `
                <div style="line-height: 1.65;">
                    <p><strong>Basic Monitoring</strong></p>
                    <p>Designed for routine community composting operations.</p>
                    <p>Includes only the essential monitoring parameters required for daily compost management.</p>
                    <p>Suitable for community composting sites, schools, households and organisations without laboratory equipment.</p>
                </div>
            `;
        this.showInfoModal(title, body);
    },

    getCreateBatchInitialStockUnitLabel() {
        const method = document.querySelector('input[name="inputMethod"]:checked')?.value || 'weight';
        if (method === 'volume') return 'L';
        if (method === 'other') {
            const custom = document.getElementById('customUnitName')?.value || '';
            return String(custom).trim() || 'Unit';
        }
        return 'kg';
    },

    getCreateBatchComposterOptions() {
        const numEl = document.getElementById('numComposters');
        let count = numEl ? parseInt(numEl.value, 10) : 0;
        if (isNaN(count) || count < 1) count = 1;
        const options = [];
        for (let i = 1; i <= count; i++) {
            const rawId = document.getElementById(`composterId_${i}`)?.value || '';
            const composterId = String(rawId).trim() || String(i);
            if (composterId) options.push(composterId);
        }
        return Array.from(new Set(options));
    },

    renderCreateBatchMonitoringProtocolOption(value, label) {
        const checked = value === 'basic' ? 'checked' : '';
        return `
            <label class="monitoring-protocol-option">
                <div class="monitoring-protocol-option-main">
                    <input type="radio" name="monitoringProtocol" value="${value}" ${checked}>
                    <span>${label}</span>
                </div>
                <button type="button" class="btn btn-secondary monitoring-protocol-info-btn" onclick="event.preventDefault(); event.stopPropagation(); app.showMonitoringProtocolInfo('${value}')">ⓘ</button>
            </label>
        `;
    },

    renderCreateBatchCalculationSettingsSection() {
        return `
            <div class="module" style="background: #F4FAFF; border-color: #B3E5FC;">
                <h3 class="module-title" style="color: #0277BD; margin-bottom: 8px;">⚙️ Calculation Settings</h3>
                <div class="form-group">
                    <label class="form-label">Overall Compost Conversion Rate</label>
                    <div style="font-weight: 600; color: var(--gray); margin-bottom: 10px;">36% (ICTA-UAB Case)</div>
                    <div class="radio-group">
                        <label class="radio-item">
                            <input type="radio" name="conversionRateMode" value="default" checked onchange="app.updateCreateBatchCalculationSettingsVisibility()">
                            Default
                        </label>
                        <label class="radio-item">
                            <input type="radio" name="conversionRateMode" value="custom" onchange="app.updateCreateBatchCalculationSettingsVisibility()">
                            Custom
                        </label>
                    </div>
                </div>
                <div id="customConversionRateSection" style="display:none;">
                    <div class="form-group">
                        <label class="form-label required">Conversion Rate (%)</label>
                        <input type="number" class="form-input" id="customConversionRate" step="any" min="0" placeholder="e.g., 36">
                    </div>
                </div>

                <div class="form-group monitoring-protocol-group">
                    <label class="form-label">🔬 Monitoring Protocol</label>
                    <div class="monitoring-protocol-help">
                        Select the monitoring protocol for this composting batch.<br>
                        Basic Monitoring is recommended for routine community composting.<br>
                        Advanced Monitoring is intended for research projects and users with access to specialised monitoring equipment or laboratory analyses.
                    </div>
                    <div class="monitoring-protocol-list">
                        ${this.renderCreateBatchMonitoringProtocolOption('basic', 'Basic Monitoring')}
                        ${this.renderCreateBatchMonitoringProtocolOption('advanced', 'Advanced Monitoring')}
                    </div>
                </div>
            </div>
        `;
    },

    renderCreateBatchInitialStockMaterialCard(index, data = {}) {
        const materialId = this.escapeAttr(data.id || `initial-stock-${Date.now()}-${Math.floor(Math.random() * 1000)}`);
        const unit = this.getCreateBatchInitialStockUnitLabel();
        const composterOptions = this.getCreateBatchComposterOptions();
        const materialType = String(data.materialType || 'Mature Compost');
        const materialDescription = String(data.materialDescription || '');
        const purpose = String(data.purpose || '');
        const notes = String(data.notes || '');
        const materialWeight = data.materialWeight != null && !isNaN(data.materialWeight) ? this.formatNumber(data.materialWeight, 6) : '';
        const approximateHeightCm = data.approximateHeightCm != null && !isNaN(data.approximateHeightCm) ? this.formatNumber(data.approximateHeightCm, 6) : '';
        const defaultComposter = String(data.composterId || composterOptions[0] || '');
        const singleComposter = composterOptions.length <= 1;
        return `
            <div class="initial-stock-material-card" data-material-id="${materialId}">
                <div class="initial-stock-material-header" onclick="app.toggleCreateBatchInitialStockMaterialCard(this)">
                    <div>
                        <div class="initial-stock-material-title">Material ${index}</div>
                        <div class="initial-stock-material-subtitle">${this.escapeAttr(materialType === 'Other' ? (materialDescription || 'Other') : materialType)}</div>
                    </div>
                    <div class="initial-stock-material-actions">
                        <button type="button" class="btn btn-secondary initial-stock-header-btn">▾</button>
                        <button type="button" class="btn btn-danger initial-stock-remove-btn" onclick="event.stopPropagation(); app.removeCreateBatchInitialStockMaterial(this)">Remove</button>
                    </div>
                </div>
                <div class="initial-stock-material-body">
                    <div class="form-row">
                        <div class="form-group">
                            <label class="form-label required">Material Type</label>
                            <select class="form-input initial-stock-material-type" onchange="app.updateCreateBatchInitialStockMaterialFields(this)">
                                <option value="Mature Compost" ${materialType === 'Mature Compost' ? 'selected' : ''}>Mature Compost</option>
                                <option value="Active Compost" ${materialType === 'Active Compost' ? 'selected' : ''}>Active Compost</option>
                                <option value="Previous Batch Residues" ${materialType === 'Previous Batch Residues' ? 'selected' : ''}>Previous Batch Residues</option>
                                <option value="Structural Material" ${materialType === 'Structural Material' ? 'selected' : ''}>Structural Material</option>
                                <option value="Other" ${materialType === 'Other' ? 'selected' : ''}>Other</option>
                            </select>
                        </div>
                        <div class="form-group initial-stock-purpose-group" style="${materialType === 'Structural Material' ? '' : 'display:none;'}">
                            <label class="form-label">Purpose</label>
                            <select class="form-input initial-stock-purpose" onchange="app.updateCreateBatchInitialStockSummary()">
                                <option value="">Select purpose</option>
                                <option value="Base Layer" ${purpose === 'Base Layer' ? 'selected' : ''}>Base Layer</option>
                                <option value="Initial Mixing" ${purpose === 'Initial Mixing' ? 'selected' : ''}>Initial Mixing</option>
                                <option value="Other" ${purpose === 'Other' ? 'selected' : ''}>Other</option>
                            </select>
                        </div>
                    </div>
                    <div class="form-group initial-stock-material-description-group" style="${materialType === 'Other' ? '' : 'display:none;'}">
                        <label class="form-label required">Material Description</label>
                        <input type="text" class="form-input initial-stock-material-description" value="${this.escapeAttr(materialDescription)}" placeholder="Describe the material" oninput="app.updateCreateBatchInitialStockSummary()">
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label class="form-label required">Material Weight (${this.escapeAttr(unit)})</label>
                            <input type="number" class="form-input initial-stock-material-weight" step="any" value="${materialWeight}" placeholder="Enter amount" oninput="app.updateCreateBatchInitialStockSummary()">
                        </div>
                        <div class="form-group">
                            <label class="form-label required">Approximate Material Height (cm)</label>
                            <input type="number" class="form-input initial-stock-material-height" step="any" min="0" value="${approximateHeightCm}" placeholder="Enter height" oninput="app.updateCreateBatchInitialStockSummary()">
                        </div>
                        <div class="form-group">
                            <label class="form-label required">Composter</label>
                            <select class="form-input initial-stock-composter" ${singleComposter ? 'disabled' : ''} onchange="app.updateCreateBatchInitialStockSummary()">
                                ${composterOptions.map((id) => `<option value="${this.escapeAttr(id)}" ${defaultComposter === id ? 'selected' : ''}>${this.escapeAttr(id)}</option>`).join('')}
                            </select>
                        </div>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Notes (Optional)</label>
                        <textarea class="form-input initial-stock-material-notes" rows="2" placeholder="Purchased mature compost from previous season." oninput="app.updateCreateBatchInitialStockSummary()">${this.escapeAttr(notes)}</textarea>
                    </div>
                </div>
            </div>
        `;
    },

    renderCreateBatchInitialStockSection() {
        return `
            <div class="module" style="background: #FFF7F0; border-color: #FFE0B2;">
                <h3 class="module-title" style="color: #E65100; margin-bottom: 8px;">📦 Initial Composting Stock (Optional)</h3>
                <div class="initial-stock-intro">
                    Record any composting materials already present inside the selected composter before this batch begins.<br><br>
                    These materials help establish the initial composting environment and improve batch tracking, material balance and carbon accounting.
                </div>
                <div class="form-group">
                    <div class="radio-group">
                        <label class="radio-item">
                            <input type="radio" name="initialStockExists" value="no" checked onchange="app.updateCreateBatchInitialStockVisibility()">
                            No
                        </label>
                        <label class="radio-item">
                            <input type="radio" name="initialStockExists" value="yes" onchange="app.updateCreateBatchInitialStockVisibility()">
                            Yes
                        </label>
                    </div>
                </div>

                <div id="initialStockDetails" style="display:none;">
                    <div id="initialStockMaterialsList"></div>
                    <button type="button" class="btn btn-secondary initial-stock-add-btn" onclick="app.addCreateBatchInitialStockMaterial()">➕ Add Existing Material</button>
                    <div class="initial-stock-summary-card">
                        <div class="initial-stock-summary-title">Initial Composting Stock Summary</div>
                        <div class="initial-stock-summary-grid">
                            <div class="initial-stock-summary-item">
                                <div class="initial-stock-summary-label">Total Existing Materials</div>
                                <div class="initial-stock-summary-value" id="initialStockSummaryCount">0</div>
                            </div>
                            <div class="initial-stock-summary-item">
                                <div class="initial-stock-summary-label">Total Initial Stock Weight</div>
                                <div class="initial-stock-summary-value" id="initialStockSummaryWeight">0 ${this.escapeAttr(this.getCreateBatchInitialStockUnitLabel())}</div>
                            </div>
                            <div class="initial-stock-summary-item">
                                <div class="initial-stock-summary-label">Selected Composter</div>
                                <div class="initial-stock-summary-value" id="initialStockSummaryComposter">—</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    },

    addCreateBatchInitialStockMaterial(data = {}) {
        const list = document.getElementById('initialStockMaterialsList');
        if (!list) return;
        const nextIndex = list.querySelectorAll('.initial-stock-material-card').length + 1;
        list.insertAdjacentHTML('beforeend', this.renderCreateBatchInitialStockMaterialCard(nextIndex, data));
        this.updateCreateBatchInitialStockComposterOptions();
        this.updateCreateBatchInitialStockSummary();
    },

    removeCreateBatchInitialStockMaterial(buttonEl) {
        const list = document.getElementById('initialStockMaterialsList');
        const card = buttonEl?.closest?.('.initial-stock-material-card');
        if (!list || !card) return;
        card.remove();
        const cards = Array.from(list.querySelectorAll('.initial-stock-material-card'));
        cards.forEach((item, idx) => {
            const title = item.querySelector('.initial-stock-material-title');
            if (title) title.textContent = `Material ${idx + 1}`;
        });
        if (cards.length === 0 && document.querySelector('input[name="initialStockExists"]:checked')?.value === 'yes') {
            this.addCreateBatchInitialStockMaterial();
            return;
        }
        this.updateCreateBatchInitialStockSummary();
    },

    toggleCreateBatchInitialStockMaterialCard(triggerEl) {
        const card = triggerEl?.closest?.('.initial-stock-material-card');
        const body = card?.querySelector('.initial-stock-material-body');
        const btn = card?.querySelector('.initial-stock-header-btn');
        if (!card || !body || !btn) return;
        const collapsed = body.style.display === 'none';
        body.style.display = collapsed ? 'block' : 'none';
        btn.textContent = collapsed ? '▾' : '▸';
    },

    updateCreateBatchInitialStockMaterialFields(selectEl) {
        const card = selectEl?.closest?.('.initial-stock-material-card');
        if (!card) return;
        const type = selectEl.value || '';
        const otherGroup = card.querySelector('.initial-stock-material-description-group');
        const otherInput = card.querySelector('.initial-stock-material-description');
        const purposeGroup = card.querySelector('.initial-stock-purpose-group');
        const purposeSelect = card.querySelector('.initial-stock-purpose');
        const subtitle = card.querySelector('.initial-stock-material-subtitle');

        if (otherGroup) otherGroup.style.display = type === 'Other' ? 'block' : 'none';
        if (otherInput && type !== 'Other') otherInput.value = '';
        if (purposeGroup) purposeGroup.style.display = type === 'Structural Material' ? 'block' : 'none';
        if (purposeSelect && type !== 'Structural Material') purposeSelect.value = '';
        if (subtitle) subtitle.textContent = type || 'Material';
        this.updateCreateBatchInitialStockSummary();
    },

    updateCreateBatchInitialStockSummary() {
        const countEl = document.getElementById('initialStockSummaryCount');
        const weightEl = document.getElementById('initialStockSummaryWeight');
        const composterEl = document.getElementById('initialStockSummaryComposter');
        const list = document.getElementById('initialStockMaterialsList');
        const unit = this.getCreateBatchInitialStockUnitLabel();
        if (!countEl || !weightEl || !composterEl || !list) return;

        const cards = Array.from(list.querySelectorAll('.initial-stock-material-card'));
        const totalWeight = cards.reduce((sum, card) => {
            const value = parseFloat(card.querySelector('.initial-stock-material-weight')?.value || '');
            return sum + (isNaN(value) ? 0 : value);
        }, 0);
        const composters = Array.from(new Set(cards
            .map((card) => String(card.querySelector('.initial-stock-composter')?.value || '').trim())
            .filter(Boolean)));

        countEl.textContent = String(cards.length);
        weightEl.textContent = `${this.formatNumber(totalWeight, 3)} ${unit}`;
        composterEl.textContent = composters.length > 0 ? composters.join(', ') : '—';
    },

    renderCreateBatch() {
        return `
            <div class="header">
                <h1>➕ Create New Batch</h1>
            </div>
            <div class="container">
                <button class="back-btn" onclick="app.navigate('dashboard')" style="margin-bottom: 20px;">
                    ← Back to Dashboard
                </button>

                <div class="card">
                    <form id="createBatchForm">
                        <div class="form-row">
                            <div class="form-group">
                                <label class="form-label required">Batch ID</label>
                                <input type="text" class="form-input" id="batchId"
                                    value="B${new Date().getFullYear()}-${String(this.data.batches.length + 1).padStart(2, '0')}"
                                    required>
                            </div>
                            <div class="form-group">
                                <label class="form-label required">Start Date</label>
                                <input type="date" class="form-input" id="startDate"
                                    value="${new Date().toISOString().split('T')[0]}" required>
                            </div>
                        </div>

                        <div class="form-row">
                            <div class="form-group">
                                <label class="form-label">Location</label>
                                <input type="text" class="form-input" id="location"
                                    placeholder="Composting Place Name e.g.,ICTA Outdoor">
                            </div>
                            <div class="form-group">
                                <label class="form-label required">Manager</label>
                                <input type="text" class="form-input" id="manager"
                                    placeholder="Enter manager name" required>
                            </div>
                        </div>

                        <div class="form-group">
                            <label class="form-label">Notes</label>
                            <textarea class="form-input" id="notes" rows="3"
                                placeholder="Additional notes about this batch..."></textarea>
                        </div>

                        <div class="module" style="background: #F7F7FF; border-color: #DADAFB;">
                            <h3 class="module-title" style="color: #3F51B5; margin-bottom: 8px;">📏 Measurement Settings</h3>
                            <div class="form-group">
                                <label class="form-label">Input Method <span style="color: var(--danger);">*</span> <span style="font-weight: 400; color: var(--gray); font-size: 0.85rem;">Please select the unit used to record material inputs in your composting system</span></label>
                                <div class="radio-group" id="inputMethodGroup">
                                    <label class="radio-item">
                                        <input type="radio" name="inputMethod" value="weight" checked>
                                        Weight (kg)
                                    </label>
                                    <label class="radio-item">
                                        <input type="radio" name="inputMethod" value="volume">
                                        Volume (L)
                                    </label>
                                    <label class="radio-item">
                                        <input type="radio" name="inputMethod" value="other">
                                        Other
                                    </label>
                                </div>
                            </div>

                            <div id="volumeSettings" style="display:none;">
                                <div class="form-group">
                                    <label class="form-label required">Default Bucket Size</label>
                                    <div class="radio-group" id="bucketSizeGroup">
                                        <label class="radio-item">
                                            <input type="radio" name="bucketSize" value="1">
                                            1 L
                                        </label>
                                        <label class="radio-item">
                                            <input type="radio" name="bucketSize" value="2" checked>
                                            2 L
                                        </label>
                                        <label class="radio-item">
                                            <input type="radio" name="bucketSize" value="5">
                                            5 L
                                        </label>
                                        <label class="radio-item">
                                            <input type="radio" name="bucketSize" value="custom">
                                            Custom
                                        </label>
                                    </div>
                                    <input type="number" class="form-input" id="customBucketSizeL" step="any" placeholder="Custom Bucket Size (L)" style="display:none; margin-top: 12px;">
                                </div>
                            </div>

                            <div id="otherUnitSettings" style="display:none;">
                                <div class="form-group">
                                    <label class="form-label required">Custom Unit Name</label>
                                    <input type="text" class="form-input" id="customUnitName" placeholder="e.g., Buckets, Boxes, Containers, Bags, Crates" oninput="app.updateCreateBatchInitialStockVisibility()">
                                </div>
                            </div>
                        </div>

                        <div class="module" style="background: #F3FBF3; border-color: #C8E6C9;">
                            <h3 class="module-title" style="color: #2E7D32; margin-bottom: 8px;">Composting System Information</h3>
                            <div class="form-group">
                                <label class="form-label">Number of Composters Used</label>
                                <input type="number" class="form-input" id="numComposters" min="1" step="1" value="2" placeholder="Number">
                            </div>

                            <div class="form-group">
                                <div style="font-weight: 600; margin-bottom: 10px;">Composter Information Table</div>
                                <div id="composterTableContainer">
                                    <table class="table">
                                        <thead>
                                            <tr>
                                                <th>Composter ID</th>
                                                <th>Capacity (L)</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <tr>
                                                <td><input type="text" class="form-input" id="composterId_1" value="" placeholder="Composter ID"></td>
                                                <td><input type="number" class="form-input" id="composterCap_1" step="any" placeholder="Capacity (L)"></td>
                                            </tr>
                                            <tr>
                                                <td><input type="text" class="form-input" id="composterId_2" value="" placeholder="Composter ID"></td>
                                                <td><input type="number" class="form-input" id="composterCap_2" step="any" placeholder="Capacity (L)"></td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>

                        ${this.renderCreateBatchInitialStockSection()}

                        ${this.renderCreateBatchCalculationSettingsSection()}

                        <div class="module" style="background: #FFF3E0; border-color: #FFE0B2;">
                            <h3 class="module-title" style="color: #E65100; margin-bottom: 8px;">Collaboration Settings</h3>
                            <div class="form-group">
                                <label class="form-label">Collaboration Settings</label>
                                <div class="radio-group" id="collaborationSettingsGroup">
                                    <label class="radio-item">
                                        <input type="radio" name="collaborationType" value="private" checked>
                                        Private Batch
                                    </label>
                                    <label class="radio-item">
                                        <input type="radio" name="collaborationType" value="shared">
                                        Shared Batch
                                    </label>
                                </div>
                            </div>

                            <div id="inviteCollaboratorsSection" style="display:none;">
                                <div style="font-weight: 600; margin-bottom: 10px;">Invite Collaborators</div>
                                <div class="form-group">
                                    <label class="form-label">Email:</label>
                                    <input type="text" class="form-input" id="collaboratorsEmails" placeholder="Enter one or more emails, separated by commas">
                                </div>
                            </div>
                        </div>

                        <div class="btn-group">
                            <button type="submit" class="btn btn-primary">
                                💾 Save Batch
                            </button>
                            <button type="button" class="btn btn-secondary"
                                onclick="app.navigate('dashboard')">
                                Cancel
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        `;
    },

    renderBatchDetail() {
        const batch = this.data.currentBatch;
        if (!batch) {
            return `<div class="container"><p>Batch not found</p></div>`;
        }
        const routeId = this.getBatchRouteId(batch);
        const escapedRouteId = this.escapeAttr(routeId);
        const jsSafeRouteId = String(routeId).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

        const sortedRecords = [...(batch.records || [])].sort((a, b) => new Date(a.date) - new Date(b.date));
        const recordsDescending = [...sortedRecords].reverse();
        const inputUnit = this.getBatchInputUnitName(batch);
        const materialTotals = this.calculateBatchMaterialTotals(batch);
        const totalInput = materialTotals.totalMaterialInput;
        const daysRunning = this.calculateDaysRunning(batch);
        const lastActivity = sortedRecords.length > 0
            ? this.formatDate(sortedRecords[sortedRecords.length - 1].date)
            : 'No records';
        const phaseInfo = this.getPhaseInfo(batch);
        const currentPhase = phaseInfo.status === 'ok' ? phaseInfo.phase : '-';
        const totalMaterialInputDisplay = `${this.formatNumber(totalInput, 3)} ${inputUnit}`;
        const organicWasteDisplay = `${this.formatNumber(materialTotals.totalOrganicWaste, 3)} ${inputUnit}`;
        const structuralMaterialDisplay = `${this.formatNumber(materialTotals.totalStructuralMaterial, 3)} ${inputUnit}`;
        const daysRunningDisplay = `${daysRunning} ${daysRunning === 1 ? 'day' : 'days'}`;
        const activeBatchInfoPanel = this.getActiveBatchInfoPanel(batch);
        const collaborators = this.getBatchCollaborators(batch);
        const activityEntries = this.getBatchActivityLog(batch);
        const transferOverview = this.collectBatchTransferData(batch);
        const incomingTransferDisplay = this.formatTransferSummaryText(transferOverview.incomingCount, transferOverview.incomingAmount, inputUnit);
        const outgoingTransferDisplay = this.formatTransferSummaryText(transferOverview.outgoingCount, transferOverview.outgoingAmount, inputUnit);
        const transferHistoryExpanded = !!this.data.batchTransferHistoryExpanded;

        return `
            <div class="header">
                <h1>📋 Batch Detail - ${batch.id}</h1>
            </div>
            <div class="container" id="batchDetailPage">
                <button class="back-btn" onclick="app.navigate('dashboard')" style="margin-bottom: 20px;">
                    ← Back to Dashboard
                </button>

                <div class="card">
                    <div class="card-header" style="margin-bottom: 0; padding-bottom: 0; border-bottom: none;">
                        <h2 class="card-title">📊 Batch Information</h2>
                        ${batch.status === 'active' ? `
                            <div class="btn-group" style="justify-content: flex-end;">
                                <button class="btn btn-danger" onclick="app.showFinishModal('${escapedRouteId}')">
                                    🏁 Finish Batch
                                </button>
                            </div>
                        ` : `<div></div>`}
                    </div>
                    <div class="batch-info" style="margin-top: 20px;">
                        <div class="info-item">
                            <span class="info-label">Batch ID</span>
                            <span class="info-value">${batch.id}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Start Date</span>
                            <span class="info-value">${this.formatDate(batch.startDate)}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Status</span>
                            <span class="status-badge ${batch.status}">${batch.status === 'active' ? '🟡 Active' : '🟢 Finished'}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Manager</span>
                            <span class="info-value">${batch.manager}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Location</span>
                            <span class="info-value">${batch.location || '-'}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Notes</span>
                            <span class="info-value">${batch.notes || '-'}</span>
                        </div>
                    </div>
                    <div class="batch-info-action-strip">
                        <div class="batch-info-tool-buttons">
                            <button type="button" class="btn batch-info-tool-btn ${activeBatchInfoPanel === 'collaborators' ? 'active' : ''}" onclick="app.toggleBatchInfoPanel('${escapedRouteId}', 'collaborators')">
                                <span>🤝 Collaborator Management</span>
                                <span class="batch-info-tool-count">${collaborators.length}</span>
                            </button>
                            <button type="button" class="btn batch-info-tool-btn ${activeBatchInfoPanel === 'activity' ? 'active' : ''}" onclick="app.toggleBatchInfoPanel('${escapedRouteId}', 'activity')">
                                <span>📜 Collaborator Activity Log</span>
                                <span class="batch-info-tool-count">${activityEntries.length}</span>
                            </button>
                        </div>
                        <div class="batch-info-tool-hint">Open these when needed to manage access or review shared activity without keeping separate cards on the page.</div>
                        ${activeBatchInfoPanel ? `
                            <div class="batch-info-tool-panel">
                                ${this.renderBatchInfoInlinePanel(batch, activeBatchInfoPanel)}
                            </div>
                        ` : ''}
                    </div>
                </div>

                <div class="card">
                    <h2 class="card-title">📈 Batch Summary</h2>
                    <div class="summary-grid">
                        <div class="summary-item">
                            <div class="summary-label">Batch Total Material Input</div>
                            <div class="summary-value">${totalMaterialInputDisplay}</div>
                        </div>
                        <div class="summary-item">
                            <div class="summary-label">Organic Waste</div>
                            <div class="summary-value">${organicWasteDisplay}</div>
                        </div>
                        <div class="summary-item">
                            <div class="summary-label">Structural Material</div>
                            <div class="summary-value">${structuralMaterialDisplay}</div>
                        </div>
                        <div class="summary-item">
                            <div class="summary-label">Days Running</div>
                            <div class="summary-value">${daysRunningDisplay}</div>
                        </div>
                        <div class="summary-item">
                            <div class="summary-label">Last Activity</div>
                            <div class="summary-value">${lastActivity}</div>
                        </div>
                        <div class="summary-item">
                            <div class="summary-label">Current Phase</div>
                            <div class="summary-value">${currentPhase}</div>
                        </div>
                        <div class="summary-item">
                            <div class="summary-label">Incoming Transfers</div>
                            <div class="summary-value">${incomingTransferDisplay}</div>
                        </div>
                        <div class="summary-item">
                            <div class="summary-label">Outgoing Transfers</div>
                            <div class="summary-value">${outgoingTransferDisplay}</div>
                        </div>
                    </div>
                </div>

                <div class="card">
                    <div style="display: flex; align-items: center; justify-content: space-between; cursor: pointer;" onclick="app.toggleBatchTransferHistory()">
                        <h2 class="card-title" style="margin: 0;">🔄 Transfer History</h2>
                        <span id="batchTransferHistoryToggleIcon" style="color: var(--gray); font-weight: 700;">${transferHistoryExpanded ? '▾' : '▸'}</span>
                    </div>
                    <div id="batchTransferHistoryContent" style="${transferHistoryExpanded ? 'display:block; margin-top: 20px;' : 'display:none; margin-top: 20px;'}">
                        ${transferOverview.history.length === 0 ? `
                            <div class="empty-state">
                                <div class="empty-state-icon">🔄</div>
                                <h3>No Material Transfers Yet</h3>
                                <p>Transfers involving this batch will appear here.</p>
                            </div>
                        ` : `
                            <table class="table">
                                <thead>
                                    <tr>
                                        <th>Date</th>
                                        <th>Route</th>
                                        <th>Material</th>
                                        <th>Amount</th>
                                        <th>Notes</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${transferOverview.history.map((entry) => `
                                        <tr>
                                            <td>${this.formatDate(entry.effectiveDate || entry.recordDate)}</td>
                                            <td>${this.escapeHtml(`${entry.sourceBatchLabel} / ${entry.sourceComposterLabel} → ${entry.destinationBatchLabel} / ${entry.destinationComposterLabel}`)}</td>
                                            <td>${this.escapeHtml(entry.materialType || '—')}</td>
                                            <td>${this.formatNumber(entry.amount || 0, 3)} ${this.escapeHtml(entry.unit || inputUnit)}</td>
                                            <td>${this.escapeHtml(entry.notes || '—')}</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        `}
                    </div>
                </div>

                ${this.renderBatchTrendSection(batch)}

                <div class="card">
                    <div class="card-header">
                        <h2 class="card-title">📝 Daily Records List</h2>
                    </div>

                    ${recordsDescending.length === 0 ? `
                        <div class="empty-state">
                            <div class="empty-state-icon">📋</div>
                            <h3>No Records Yet</h3>
                            <p>Start adding daily records to track this batch.</p>
                        </div>
                    ` : `
                        <table class="table" id="dailyRecordsTable">
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Composter ID</th>
                                    <th>Visit Type</th>
                                    <th>Temperature</th>
                                    <th>Status</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${recordsDescending.map(record => {
                                    const normalizedRecord = this.normalizeRecordForCompatibility(record, batch);
                                    const metadata = this.normalizeRecordMetadata(normalizedRecord.metadata);
                                    const visitType = this.getVisitTypeInfo(record);
                                    const hasMonitoring = this.hasMonitoringData(record);
                                    const hasMaintenance = this.hasMaintenanceData(record);
                                    const coreTemperature = record?.monitoring?.coreTemperature != null
                                        ? (parseFloat(record.monitoring.coreTemperature) || 0)
                                        : (record?.process?.core != null ? (parseFloat(record.process.core) || 0) : null);
                                    const temperatureDisplay = coreTemperature != null && !isNaN(coreTemperature)
                                        ? `${this.formatNumber(coreTemperature, 1)}°C`
                                        : '—';

                                    let status = '✅ Complete';
                                    let statusClass = 'success';
                                    if (!hasMonitoring && !hasMaintenance) {
                                        status = '🟡 Draft';
                                        statusClass = 'warning';
                                    }

                                    const recordIdAttr = String(record.id)
                                        .replace(/&/g, '&amp;')
                                        .replace(/</g, '&lt;')
                                        .replace(/"/g, '&quot;');
                                    return `
                                        <tr>
                                            <td>
                                                <div>${this.formatDate(record.date)}</div>
                                                <div style="margin-top: 6px; font-size: 0.82rem; color: var(--gray);">
                                                    Created by: ${this.escapeHtml(metadata.createdByName || metadata.createdByEmail || '—')}
                                                </div>
                                                <div style="margin-top: 2px; font-size: 0.82rem; color: var(--gray);">
                                                    Last Edited by: ${this.escapeHtml(metadata.lastEditedByName || metadata.lastEditedByEmail || '—')}
                                                </div>
                                            </td>
                                            <td>${record.composterId || '—'}</td>
                                            <td><span class="visit-type-badge ${visitType.badgeClass}">${visitType.icon} ${visitType.label}</span></td>
                                            <td>${temperatureDisplay}</td>
                                            <td><span class="status-indicator ${statusClass}">${status}</span></td>
                                            <td>
                                                <div style="display:flex; gap:8px; flex-wrap:wrap;">
                                                    <button type="button" class="btn btn-secondary" style="padding: 6px 12px; font-size: 0.85rem;"
                                                        data-action="edit" data-batch-id="${escapedRouteId}" data-record-id="${recordIdAttr}">
                                                        ✏️ Edit
                                                    </button>
                                                    <button type="button" class="btn btn-danger" style="padding: 6px 12px; font-size: 0.85rem;"
                                                        data-action="delete" data-record-id="${recordIdAttr}">
                                                        🗑 Delete
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    `}
                </div>

                ${batch.status === 'finished' ? `
                    <div class="alert alert-success finish-lock-alert">
                        <strong>🔒 This batch has been completed.</strong><br>
                        Daily Records are locked, but historical records remain available for viewing.
                    </div>
                ` : ''}

                <div class="action-panel">
                    <div class="btn-group">
                        ${batch.status === 'active' ? `
                            <button type="button" class="btn btn-primary" id="addDailyRecordBtn"
                                data-batch-id="${escapedRouteId}">
                                ➕ Add Daily Record
                            </button>
                        ` : `
                            <button type="button" class="btn btn-secondary" onclick="app.navigate('output', {batchId: '${escapedRouteId}'})">
                                📤 View Output
                            </button>
                        `}
                        <button type="button" class="btn btn-secondary" onclick="app.navigate('export', {batchId: '${escapedRouteId}'})">
                            📥 Export Data
                        </button>
                    </div>
                </div>
            </div>
        `;
    },

    renderDailyRecord() {
        const batch = this.data.currentBatch;
        if (!batch) {
            return `<div class="container"><p>Batch not found</p></div>`;
        }

        const record = this.data.editingRecord
            ? batch.records.find(r => String(r.id) === String(this.data.editingRecord))
            : null;

        const isEdit = !!record;
        const selectedDate = record ? record.date : new Date().toISOString().split('T')[0];
        let composterId = record && record.composterId != null ? String(record.composterId) : '1';
        const composterIds = this.getBatchComposterIds(batch);
        if (!composterIds.includes(composterId)) composterId = composterIds[0] || '1';
        const composterOptionsHtml = composterIds
            .map((id) => `<option value="${this.escapeAttr(id)}" ${composterId === id ? 'selected' : ''}>${this.escapeHtml(this.formatComposterLabel(id))}</option>`)
            .join('');

        const monitoringState = this.getICTAMonitoringState(record);
        const isICTA = this.isICTAUser();
        const maintenanceState = isICTA
            ? this.getICTAMaintenanceState(record, batch)
            : this.getNonICTAMaintenanceState(record, batch);
        const materialTransferState = this.getMaterialTransferState(record, batch, selectedDate);
        const actionTakenState = this.getICTAActionTakenState(record);
        const photosState = this.getICTAPhotosState(record);
        const notesState = this.getICTANotesState(record);
        this.data.ictaPhotoDraft = [...photosState];
        this.data.ictaPhotoReplaceIndex = null;

        return `
            <div class="header">
                <h1>${isEdit ? '✏️ Edit Daily Record' : '➕ Add Daily Record'}</h1>
            </div>
            <div class="container">
                <button class="back-btn" onclick="app.navigate('batchDetail', {batchId: '${this.escapeAttr(this.getBatchRouteId(batch))}'})" style="margin-bottom: 20px;">
                    ← Back to Batch Detail
                </button>

                <form id="dailyRecordForm">
                    <div class="card">
                        <h2 class="card-title">📋 Basic Information</h2>
                        <div class="form-row" style="margin-top: 20px;">
                            <div class="form-group">
                                <label class="form-label required">Date</label>
                                <input type="date" class="form-input" id="recordDate" value="${selectedDate}" onchange="app.syncMaterialTransferDateWithRecordDate(); app.updateSystemRecommendationDom();" required>
                            </div>
                            <div class="form-group">
                                <label class="form-label">Batch ID</label>
                                <input type="text" class="form-input" value="${batch.id}" readonly>
                            </div>
                            <div class="form-group">
                                <label class="form-label required">Composter ID</label>
                                <select class="form-input" id="composterId" required>
                                    ${composterOptionsHtml}
                                </select>
                            </div>
                        </div>
                    </div>

                    ${isICTA ? this.renderICTAMonitoringModule(monitoringState) : this.renderNonICTAMonitoringModule(monitoringState)}

                    ${isICTA ? this.renderICTAMaintenanceModule(batch, maintenanceState) : this.renderNonICTAMaintenanceModule(batch, maintenanceState)}

                    ${this.renderICTAActionTakenModule(actionTakenState)}
                    ${this.renderMaterialTransferModule(batch, materialTransferState)}
                    ${this.renderICTAPhotoUploadModule(photosState)}
                    ${this.renderICTANotesModule(notesState)}

                    <div class="action-panel">
                        <div class="btn-group">
                            <button type="submit" class="btn btn-primary">
                                Submit Daily Record
                            </button>
                            <button type="button" class="btn btn-secondary"
                                onclick="app.confirmCancelDailyRecord('${batch.id}')">
                                Cancel
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        `;
    },

    normalizeOptionalNumber(value) {
        if (value == null) return null;
        if (typeof value === 'string' && value.trim() === '') return null;
        const parsed = parseFloat(value);
        return isNaN(parsed) ? null : parsed;
    },

    formatCarbonMetric(value, unit = '', maxDecimals = 2) {
        if (value == null || isNaN(value)) return '—';
        const suffix = unit ? ` ${unit}` : '';
        return `${this.formatNumber(value, maxDecimals)}${suffix}`;
    },

    getCarbonReductionDraftState() {
        const draft = this.data.carbonReductionDraft || {};
        return {
            totalOrganicWaste: this.normalizeOptionalNumber(draft.totalOrganicWaste),
            municipalCollectionDistance: this.normalizeOptionalNumber(draft.municipalCollectionDistance),
            municipalVehiclePayloadCapacityT: this.normalizeOptionalNumber(draft.municipalVehiclePayloadCapacityT),
            municipalVehicleCo2EmissionFactor: this.normalizeOptionalNumber(draft.municipalVehicleCo2EmissionFactor),
            municipalVehicleEnergyConsumptionFactor: this.normalizeOptionalNumber(draft.municipalVehicleEnergyConsumptionFactor),
            compostProduced: this.normalizeOptionalNumber(draft.compostProduced),
            commercialCompostPurchasedPerEvent: this.normalizeOptionalNumber(draft.commercialCompostPurchasedPerEvent) ?? 105,
            commercialCompostSupplierDistance: this.normalizeOptionalNumber(draft.commercialCompostSupplierDistance),
            passengerVehicleCo2EmissionFactor: this.normalizeOptionalNumber(draft.passengerVehicleCo2EmissionFactor)
        };
    },

    setCarbonReductionDraftField(field, value) {
        this.data.carbonReductionDraft = {
            ...(this.data.carbonReductionDraft || {}),
            [field]: value
        };
    },

    buildCarbonReductionMetrics(overrides = {}) {
        const draft = {
            ...this.getCarbonReductionDraftState(),
            ...overrides
        };

        const totalOrganicWaste = this.normalizeOptionalNumber(draft.totalOrganicWaste);
        const municipalCollectionDistance = this.normalizeOptionalNumber(draft.municipalCollectionDistance);
        const municipalVehiclePayloadCapacityT = this.normalizeOptionalNumber(draft.municipalVehiclePayloadCapacityT);
        const municipalVehicleCo2EmissionFactor = this.normalizeOptionalNumber(draft.municipalVehicleCo2EmissionFactor);
        const municipalVehicleEnergyConsumptionFactor = this.normalizeOptionalNumber(draft.municipalVehicleEnergyConsumptionFactor);
        const compostProduced = this.normalizeOptionalNumber(draft.compostProduced);
        const commercialCompostPurchasedPerEvent = this.normalizeOptionalNumber(draft.commercialCompostPurchasedPerEvent) ?? 105;
        const commercialCompostSupplierDistance = this.normalizeOptionalNumber(draft.commercialCompostSupplierDistance);
        const passengerVehicleCo2EmissionFactor = this.normalizeOptionalNumber(draft.passengerVehicleCo2EmissionFactor);

        const organicWasteTonnes = totalOrganicWaste != null ? totalOrganicWaste / 1000 : null;
        const vehiclePayloadCapacityKg = municipalVehiclePayloadCapacityT != null
            ? municipalVehiclePayloadCapacityT * 1000
            : null;
        const normalisedCo2Ef = municipalVehiclePayloadCapacityT != null && municipalVehiclePayloadCapacityT > 0 && municipalVehicleCo2EmissionFactor != null
            ? municipalVehicleCo2EmissionFactor / municipalVehiclePayloadCapacityT
            : null;
        const normalisedEnergyEf = municipalVehiclePayloadCapacityT != null && municipalVehiclePayloadCapacityT > 0 && municipalVehicleEnergyConsumptionFactor != null
            ? municipalVehicleEnergyConsumptionFactor / municipalVehiclePayloadCapacityT
            : null;
        const transportationWorkload = organicWasteTonnes != null && municipalCollectionDistance != null
            ? organicWasteTonnes * municipalCollectionDistance
            : null;
        const impact1AvoidedCo2 = transportationWorkload != null && normalisedCo2Ef != null
            ? transportationWorkload * normalisedCo2Ef
            : null;
        const impact1AvoidedEnergy = transportationWorkload != null && normalisedEnergyEf != null
            ? transportationWorkload * normalisedEnergyEf
            : null;

        const equivalentCommercialCompostReplaced = compostProduced;
        const procurementEvents = equivalentCommercialCompostReplaced != null && commercialCompostPurchasedPerEvent > 0
            ? equivalentCommercialCompostReplaced / commercialCompostPurchasedPerEvent
            : null;
        const impact2AvoidedCo2 = procurementEvents != null
            && commercialCompostSupplierDistance != null
            && passengerVehicleCo2EmissionFactor != null
            ? procurementEvents * commercialCompostSupplierDistance * passengerVehicleCo2EmissionFactor
            : null;

        const totalCarbonSaved = impact1AvoidedCo2 != null || impact2AvoidedCo2 != null
            ? (impact1AvoidedCo2 || 0) + (impact2AvoidedCo2 || 0)
            : null;

        return {
            impact1: {
                totalOrganicWaste,
                municipalCollectionDistance,
                municipalVehiclePayloadCapacityT,
                vehiclePayloadCapacityKg,
                municipalVehicleCo2EmissionFactor,
                municipalVehicleEnergyConsumptionFactor,
                organicWasteTonnes,
                transportationWorkload,
                normalisedCo2Ef,
                normalisedEnergyEf,
                avoidedCo2: impact1AvoidedCo2,
                avoidedEnergy: impact1AvoidedEnergy
            },
            impact2: {
                compostProduced,
                commercialCompostPurchasedPerEvent,
                equivalentCommercialCompostReplaced,
                procurementEvents,
                commercialCompostSupplierDistance,
                passengerVehicleCo2EmissionFactor,
                avoidedCo2: impact2AvoidedCo2
            },
            summary: {
                impact1AvoidedCo2,
                impact2AvoidedCo2,
                totalCarbonSaved,
                avoidedEnergyConsumption: impact1AvoidedEnergy
            }
        };
    },

    renderCarbonReductionCalculatedContent(metrics, detailsExpanded = false) {
        const renderFlow = (steps) => steps.map((step, idx) => `
            ${idx > 0 ? '<div class="carbon-flow-arrow">↓</div>' : ''}
            <div class="carbon-flow-step">
                <div class="carbon-flow-label">${step.label}</div>
                <div class="carbon-flow-value">${step.value}</div>
            </div>
        `).join('');

        const impact1Steps = [
            { label: 'Total Organic Waste', value: this.formatCarbonMetric(metrics.impact1.totalOrganicWaste, 'kg', 2) },
            { label: 'Transportation Workload', value: this.formatCarbonMetric(metrics.impact1.transportationWorkload, 't·km', 2) },
            { label: 'Normalised CO2 EF', value: this.formatCarbonMetric(metrics.impact1.normalisedCo2Ef, 'kg CO2/t·km', 3) },
            { label: 'Avoided CO2', value: this.formatCarbonMetric(metrics.impact1.avoidedCo2, 'kg CO2', 2) },
            { label: 'Normalised Energy EF', value: this.formatCarbonMetric(metrics.impact1.normalisedEnergyEf, 'MJ/t·km', 3) },
            { label: 'Avoided Energy', value: this.formatCarbonMetric(metrics.impact1.avoidedEnergy, 'MJ', 2) }
        ];
        const impact2Steps = [
            { label: 'Compost Produced', value: this.formatCarbonMetric(metrics.impact2.compostProduced, 'kg', 2) },
            { label: 'Equivalent Commercial Compost Replaced', value: this.formatCarbonMetric(metrics.impact2.equivalentCommercialCompostReplaced, 'kg', 2) },
            { label: 'Commercial Compost Purchased per Procurement Event', value: this.formatCarbonMetric(metrics.impact2.commercialCompostPurchasedPerEvent, 'kg/event', 2) },
            { label: 'Procurement Events', value: this.formatCarbonMetric(metrics.impact2.procurementEvents, 'events', 2) },
            { label: 'Commercial Compost Supplier Distance', value: this.formatCarbonMetric(metrics.impact2.commercialCompostSupplierDistance, 'km', 2) },
            { label: 'Passenger Vehicle CO2 Emission Factor', value: this.formatCarbonMetric(metrics.impact2.passengerVehicleCo2EmissionFactor, 'kg CO2/km', 3) },
            { label: 'Avoided CO2', value: this.formatCarbonMetric(metrics.impact2.avoidedCo2, 'kg CO2', 2) }
        ];

        return `
            <div class="carbon-results-grid">
                <div class="carbon-result-card">
                    <div class="carbon-result-label">Impact 1</div>
                    <div class="carbon-result-value">${this.formatCarbonMetric(metrics.summary.impact1AvoidedCo2, 'kg CO2', 2)}</div>
                    <div class="carbon-result-note">Avoided municipal organic waste collection and transportation</div>
                </div>
                <div class="carbon-result-card">
                    <div class="carbon-result-label">Impact 2</div>
                    <div class="carbon-result-value">${this.formatCarbonMetric(metrics.summary.impact2AvoidedCo2, 'kg CO2', 2)}</div>
                    <div class="carbon-result-note">Avoided commercial compost procurement and transportation</div>
                </div>
                <div class="carbon-result-card carbon-result-card-highlight">
                    <div class="carbon-result-label">Total Carbon Saved</div>
                    <div class="carbon-result-value">${this.formatCarbonMetric(metrics.summary.totalCarbonSaved, 'kg CO2', 2)}</div>
                    <div class="carbon-result-note">Impact 1 + Impact 2</div>
                </div>
                <div class="carbon-result-card">
                    <div class="carbon-result-label">Avoided Energy Consumption</div>
                    <div class="carbon-result-value">${this.formatCarbonMetric(metrics.summary.avoidedEnergyConsumption, 'MJ', 2)}</div>
                    <div class="carbon-result-note">Derived from Impact 1 only</div>
                </div>
            </div>

            <div class="carbon-details-toggle-row">
                <button type="button" class="btn btn-secondary carbon-details-toggle-btn" id="carbonCalculationDetailsBtn" onclick="app.toggleCarbonCalculationDetails()">
                    ${detailsExpanded ? 'Hide Calculation Details' : 'Show Calculation Details'}
                </button>
            </div>

            <div class="carbon-details-panel" id="carbonCalculationDetails" data-expanded="${detailsExpanded ? 'true' : 'false'}" style="${detailsExpanded ? '' : 'display:none;'}">
                <div class="carbon-detail-section">
                    <div class="carbon-detail-title">Impact 1</div>
                    <div class="carbon-detail-subtitle">Avoided Municipal Organic Waste Collection & Transportation</div>
                    <div class="carbon-detail-meta">
                        <div class="carbon-detail-meta-item">Vehicle Payload Capacity: ${this.formatCarbonMetric(metrics.impact1.municipalVehiclePayloadCapacityT, 't', 2)}</div>
                        <div class="carbon-detail-meta-item">Vehicle Payload Capacity: ${this.formatCarbonMetric(metrics.impact1.vehiclePayloadCapacityKg, 'kg', 2)}</div>
                    </div>
                    <div class="carbon-flow">
                        ${renderFlow(impact1Steps)}
                    </div>
                </div>

                <div class="carbon-detail-section">
                    <div class="carbon-detail-title">Impact 2</div>
                    <div class="carbon-detail-subtitle">Avoided Commercial Compost Procurement & Transportation</div>
                    <div class="carbon-flow">
                        ${renderFlow(impact2Steps)}
                    </div>
                </div>

                <div class="carbon-summary-section">
                    <div class="carbon-summary-title">Carbon Emission Reduction Summary</div>
                    <div class="carbon-summary-list">
                        <div class="carbon-summary-line"><span>Impact 1</span><strong>${this.formatCarbonMetric(metrics.summary.impact1AvoidedCo2, 'kg CO2', 2)}</strong></div>
                        <div class="carbon-summary-line"><span>Impact 2</span><strong>${this.formatCarbonMetric(metrics.summary.impact2AvoidedCo2, 'kg CO2', 2)}</strong></div>
                        <div class="carbon-summary-line carbon-summary-line-total"><span>Total Carbon Saved</span><strong>${this.formatCarbonMetric(metrics.summary.totalCarbonSaved, 'kg CO2', 2)}</strong></div>
                        <div class="carbon-summary-line"><span>Avoided Energy Consumption</span><strong>${this.formatCarbonMetric(metrics.summary.avoidedEnergyConsumption, 'MJ', 2)}</strong></div>
                    </div>
                </div>
            </div>
        `;
    },

    renderCarbonInputField(id, label, unit, value, placeholder, helpText) {
        const safeValue = value != null ? this.formatNumber(value, 6) : '';
        return `
            <div class="form-group carbon-form-group">
                <label class="form-label">${label}</label>
                <div class="carbon-input-with-unit">
                    <input type="number" class="form-input carbon-input-field" id="${id}" step="any" value="${safeValue}" placeholder="${placeholder}">
                    <span class="carbon-input-unit">${unit}</span>
                </div>
                ${helpText ? `<div class="carbon-field-help">${helpText}</div>` : ''}
            </div>
        `;
    },

    toggleCarbonReductionModule() {
        this.data.carbonReductionExpanded = !this.data.carbonReductionExpanded;
        if (!this.data.carbonReductionExpanded) {
            this.data.carbonCalculationDetailsExpanded = false;
        }
        this.render();
    },

    renderCarbonReductionModule() {
        const draft = this.getCarbonReductionDraftState();
        const metrics = this.buildCarbonReductionMetrics(draft);
        const expanded = !!this.data.carbonReductionExpanded;

        return `
            <div class="card carbon-module-card">
                <div class="card-header carbon-module-header carbon-module-header-collapsible">
                    <div>
                        <h2 class="card-title">Carbon Emission Reduction</h2>
                        <div class="carbon-module-subtitle">Independent carbon calculator for batch analysis. Inputs are temporary and do not modify any Batch data.</div>
                    </div>
                    <button type="button" class="btn btn-secondary carbon-module-expand-btn" onclick="app.toggleCarbonReductionModule()">
                        ${expanded ? '▼ Collapse' : '▶ Expand'}
                    </button>
                </div>

                ${expanded ? `
                <div class="alert alert-info carbon-module-intro">
                    Results update automatically as you edit the carbon input fields below. These values are used only for the current carbon calculation and are not written back to the Batch.
                </div>

                <div class="carbon-impact-layout">
                    <section class="carbon-impact-section">
                        <div class="carbon-impact-title">Impact 1</div>
                        <div class="carbon-impact-subtitle">Avoided Municipal Organic Waste Collection & Transportation</div>
                        <div class="carbon-input-grid">
                            ${this.renderCarbonInputField('carbonTotalOrganicWaste', 'Total Organic Waste', 'kg', draft.totalOrganicWaste, 'Enter value', '')}
                            ${this.renderCarbonInputField('carbonMunicipalCollectionDistance', 'Municipal Collection Distance', 'km', draft.municipalCollectionDistance, 'Enter value', 'One-way distance from the composting site to the municipal organic waste treatment facility.')}
                            ${this.renderCarbonInputField('carbonMunicipalVehiclePayloadCapacityT', 'Vehicle Payload Capacity', 't', draft.municipalVehiclePayloadCapacityT, 'Enter value', 'Payload capacity of the municipal organic waste collection vehicle.')}
                            ${this.renderCarbonInputField('carbonMunicipalVehicleCo2Ef', 'Vehicle CO2 Emission Factor', 'kg CO2/km', draft.municipalVehicleCo2EmissionFactor, 'Enter value', 'Please obtain an appropriate emission factor from your local LCA database, government guidance, or published literature.')}
                            ${this.renderCarbonInputField('carbonMunicipalVehicleEnergyEf', 'Vehicle Energy Consumption Factor', 'MJ/km', draft.municipalVehicleEnergyConsumptionFactor, 'Enter value', 'Please obtain an appropriate energy consumption factor from your local LCA database, government guidance, or published literature.')}
                        </div>
                    </section>

                    <section class="carbon-impact-section">
                        <div class="carbon-impact-title">Impact 2</div>
                        <div class="carbon-impact-subtitle">Avoided Commercial Compost Procurement & Transportation</div>
                        <div class="carbon-input-grid">
                            ${this.renderCarbonInputField('carbonCompostProduced', 'Compost Produced', 'kg', draft.compostProduced, 'Enter value', 'Enter the amount of compost produced that will be used or applied. This amount is assumed to replace the same quantity of commercial compost.')}
                            ${this.renderCarbonInputField('carbonCommercialCompostPerEvent', 'Commercial Compost Purchased per Procurement Event', 'kg/event', draft.commercialCompostPurchasedPerEvent, '105', 'Average amount of commercial compost purchased each procurement event.')}
                            ${this.renderCarbonInputField('carbonCommercialSupplierDistance', 'Commercial Compost Supplier Distance', 'km', draft.commercialCompostSupplierDistance, 'Enter value', 'Round-trip travel distance between the compost supplier and the compost application site.')}
                            ${this.renderCarbonInputField('carbonPassengerVehicleCo2Ef', 'Passenger Vehicle CO2 Emission Factor', 'kg CO2/km', draft.passengerVehicleCo2EmissionFactor, 'Enter value', 'Please obtain an appropriate emission factor from your local database or published literature.')}
                        </div>
                    </section>
                </div>

                <div id="carbonReductionCalculatedContent">
                    ${this.renderCarbonReductionCalculatedContent(metrics, this.data.carbonCalculationDetailsExpanded)}
                </div>
                ` : ''}
            </div>
        `;
    },

    getCarbonReductionDraftFromDom() {
        const getValue = (id) => document.getElementById(id)?.value;
        return {
            totalOrganicWaste: this.normalizeOptionalNumber(getValue('carbonTotalOrganicWaste')),
            municipalCollectionDistance: this.normalizeOptionalNumber(getValue('carbonMunicipalCollectionDistance')),
            municipalVehiclePayloadCapacityT: this.normalizeOptionalNumber(getValue('carbonMunicipalVehiclePayloadCapacityT')),
            municipalVehicleCo2EmissionFactor: this.normalizeOptionalNumber(getValue('carbonMunicipalVehicleCo2Ef')),
            municipalVehicleEnergyConsumptionFactor: this.normalizeOptionalNumber(getValue('carbonMunicipalVehicleEnergyEf')),
            compostProduced: this.normalizeOptionalNumber(getValue('carbonCompostProduced')),
            commercialCompostSupplierDistance: this.normalizeOptionalNumber(getValue('carbonCommercialSupplierDistance')),
            passengerVehicleCo2EmissionFactor: this.normalizeOptionalNumber(getValue('carbonPassengerVehicleCo2Ef')),
            commercialCompostPurchasedPerEvent: this.normalizeOptionalNumber(getValue('carbonCommercialCompostPerEvent')) ?? 105
        };
    },

    updateCarbonReductionPreview() {
        if (this.data.currentPage !== 'output' || !this.data.carbonReductionExpanded) return;
        const container = document.getElementById('carbonReductionCalculatedContent');
        if (!container) return;
        this.data.carbonReductionDraft = {
            ...this.data.carbonReductionDraft,
            ...this.getCarbonReductionDraftFromDom()
        };
        const metrics = this.buildCarbonReductionMetrics();
        container.innerHTML = this.renderCarbonReductionCalculatedContent(metrics, this.data.carbonCalculationDetailsExpanded);
    },

    toggleCarbonCalculationDetails() {
        this.data.carbonCalculationDetailsExpanded = !this.data.carbonCalculationDetailsExpanded;
        this.updateCarbonReductionPreview();
    },

    renderOutput() {
        const batch = this.data.currentBatch;
        if (!batch || batch.status !== 'finished') {
            return `<div class="container"><p>Batch not found or not finished</p></div>`;
        }

        const inputUnit = this.getBatchInputUnitName(batch);
        const initialStockAmount = this.calculateInitialStockAmount(batch);
        const totalMaterialInput = this.calculateTotalMaterialInput(batch);
        const totalWaterAdded = this.calculateTotalWaterAdded(batch);
        const output = batch.output || {};
        const harvestStatus = output.harvestStatus || 'pending';
        const estimatedOutput = output.estimatedOutput != null ? output.estimatedOutput : this.calculateEstimatedCompostOutput(batch);
        const harvestDate = output.date || '';
        const compostOutput = output.compostOutput != null && !isNaN(output.compostOutput) ? output.compostOutput : '';
        const harvestNotes = output.notes || '';
        const showHarvestForm = harvestStatus === 'completed';
        const finishedDate = batch.finishedDate || this.getTodayISODateInTimeZone('Europe/Madrid');
        const durationDays = (() => {
            const startMs = this.parseDateToUTCms(batch.startDate);
            const endMs = this.parseDateToUTCms(finishedDate);
            if (startMs == null || endMs == null) return 0;
            const diff = Math.floor((endMs - startMs) / (1000 * 60 * 60 * 24));
            return diff >= 0 ? diff : 0;
        })();

        return `
            <div class="header">
                <h1>📤 Batch Output</h1>
            </div>
            <div class="container">
                <button class="back-btn" onclick="app.navigate('dashboard')" style="margin-bottom: 20px;">
                    ← Back to Batch Overview
                </button>

                <form id="outputForm">
                    <div class="card">
                        <h2 class="card-title">📋 Basic Information</h2>
                        <div style="margin-top: 16px; overflow-x: auto;">
                            <table class="table">
                                <thead>
                                    <tr>
                                        <th>Batch ID</th>
                                        <th>Start Date</th>
                                        <th>End Date</th>
                                        <th>Duration</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td>${batch.id}</td>
                                        <td>${this.formatDate(batch.startDate)}</td>
                                        <td>${this.formatDate(finishedDate)}</td>
                                        <td><span id="outputDuration">${durationDays} days</span></td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div class="card">
                        <h2 class="card-title">📊 Input Summary</h2>
                        <div class="summary-grid" style="margin-top: 18px;">
                            <div class="summary-item">
                                <div class="summary-value">${this.formatNumber(initialStockAmount, 1)}</div>
                                <div class="summary-label">Initial Composting Stock (${inputUnit})</div>
                                <div style="margin-top: 6px; color: var(--gray); font-size: 0.9rem;">
                                    Existing materials already inside the composter at batch start
                                </div>
                            </div>
                            <div class="summary-item">
                                <div class="summary-value">${this.formatNumber(totalMaterialInput, 1)}</div>
                                <div class="summary-label">Batch Total Material Input (${inputUnit})</div>
                                <div style="margin-top: 6px; color: var(--gray); font-size: 0.9rem;">
                                    Organic Waste + Structural Material
                                </div>
                            </div>
                            <div class="summary-item">
                                <div class="summary-value">${this.formatNumber(totalWaterAdded, 1)}</div>
                                <div class="summary-label">Total Water Added (L)</div>
                                <div style="margin-top: 6px; color: var(--gray); font-size: 0.9rem;">
                                    Recorded separately from Total Material Input
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="card">
                        <h2 class="card-title">📦 Harvest Record</h2>
                        <div class="summary-grid" style="margin-top: 18px;">
                            <div class="summary-item">
                                <div class="summary-value">${this.formatNumber(estimatedOutput, 1)}</div>
                                <div class="summary-label">Estimated Compost Output (${inputUnit})</div>
                                <div style="margin-top: 6px; color: var(--gray); font-size: 0.9rem;">
                                    Read-only estimate based on Initial Composting Stock + Total Material Input and conversion rate
                                </div>
                            </div>
                            <div class="summary-item">
                                <div class="summary-value">${harvestStatus === 'completed' ? 'Completed' : 'Pending'}</div>
                                <div class="summary-label">Harvest Status</div>
                                <div style="margin-top: 6px;">
                                    <span class="status-badge ${harvestStatus === 'completed' ? 'finished' : 'active'}">${harvestStatus === 'completed' ? '🟢 Completed' : '🟡 Pending'}</span>
                                </div>
                            </div>
                        </div>

                        <div style="margin-top: 10px;">
                            <button type="button" class="btn btn-secondary" onclick="app.toggleHarvestForm()">
                                ${harvestStatus === 'completed' ? '✏️ Edit Harvest' : '📝 Record Harvest'}
                            </button>
                        </div>

                        <div id="harvestFormSection" style="${showHarvestForm ? '' : 'display:none;'} margin-top: 18px;">
                            <div class="form-row">
                                <div class="form-group">
                                    <label class="form-label required">Harvest Date</label>
                                    <input type="date" class="form-input" id="outputDate" value="${harvestDate}">
                                </div>
                                <div class="form-group">
                                    <label class="form-label required">Actual Compost Output (${inputUnit})</label>
                                    <input type="number" class="form-input" id="compostOutput" min="0" step="0.1" value="${compostOutput}" placeholder="Enter number">
                                </div>
                            </div>
                            <div class="form-group">
                                <label class="form-label">Notes</label>
                                <textarea class="form-input" id="harvestNotes" rows="3" placeholder="Add harvest notes...">${String(harvestNotes).replace(/</g, '&lt;')}</textarea>
                            </div>
                        </div>
                    </div>

                    ${this.renderCarbonReductionModule()}

                    <div class="action-panel">
                        <div class="btn-group">
                            <button type="submit" class="btn btn-primary" id="saveHarvestBtn" style="${showHarvestForm ? '' : 'display:none;'}">
                                💾 Save Harvest
                            </button>
                            <button type="button" class="btn btn-secondary"
                                onclick="app.navigate('dashboard')">
                                Return to Batch Overview
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        `;
    },

    renderExportFieldOption(moduleId, checkboxId, title, description, checked = true) {
        return `
            <label class="checkbox-item export-field-item" data-export-module="${moduleId}">
                <input type="checkbox" id="${checkboxId}" ${checked ? 'checked' : ''}>
                <div class="export-field-copy">
                    <div class="export-field-title">${title}</div>
                    <div class="export-field-description">${description}</div>
                </div>
            </label>
        `;
    },

    renderExport() {
        const batch = this.data.currentBatch;
        const isICTA = this.isICTAUser();

        return `
            <div class="header">
                <h1>📥 Export Data</h1>
            </div>
            <div class="container">
                <button class="back-btn" onclick="app.navigate('batchDetail', {batchId: '${batch ? this.escapeAttr(this.getBatchRouteId(batch)) : ''}'})" style="margin-bottom: 20px;">
                    ← Back to Batch Detail
                </button>

                <form id="exportForm">
                    <div class="card">
                        <h2 class="card-title">📋 Export Configuration</h2>

                        <div class="form-group" style="margin-top: 20px;">
                            <label class="form-label required">Select Batch</label>
                            <select class="form-input" id="exportBatchId" required>
                                <option value="">Choose a batch...</option>
                                ${this.data.batches.map(b => `
                                    <option value="${this.escapeAttr(this.getBatchRouteId(b))}" ${batch && this.getBatchRouteId(b) === this.getBatchRouteId(batch) ? 'selected' : ''}>
                                        ${b.id} - ${this.formatDate(b.startDate)} (${b.status})
                                    </option>
                                `).join('')}
                            </select>
                        </div>

                        <div class="form-group">
                            <label class="form-label">Date Range (Optional)</label>
                            <div class="form-row">
                                <div>
                                    <label class="form-label" style="font-size: 0.9rem;">From</label>
                                    <input type="date" class="form-input" id="exportDateFrom">
                                </div>
                                <div>
                                    <label class="form-label" style="font-size: 0.9rem;">To</label>
                                    <input type="date" class="form-input" id="exportDateTo">
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="card">
                        <h2 class="card-title">☑️ Field Selection</h2>

                        <div class="export-selection-helper">
                            Choose modules first, then expand each module to fine-tune specific fields.
                        </div>

                        <div class="export-options export-options-modular">
                            <div class="export-module-card" id="exportModuleCard-batchSummary">
                                <div class="export-module-header">
                                    <label class="export-module-main">
                                        <input type="checkbox" id="exportModule-batchSummary" checked onchange="app.setExportModule('batchSummary', this.checked)">
                                        <div>
                                            <div class="export-module-title">📋 Batch Summary</div>
                                            <div class="export-module-subtitle">Overview, dates, totals, and calculation settings</div>
                                        </div>
                                    </label>
                                    <button type="button" class="export-module-expand" onclick="app.toggleExportModule('batchSummary')">
                                        <span id="exportModuleIcon-batchSummary">▾</span>
                                    </button>
                                </div>
                                <div class="export-module-content" id="exportModuleContent-batchSummary">
                                    <div class="export-module-fields">
                                        ${this.renderExportFieldOption('batchSummary', 'exportSummaryBasic', 'Basic Overview', 'Exports batch ID, status, organization, community type, and input unit.')}
                                        ${this.renderExportFieldOption('batchSummary', 'exportSummaryDates', 'Dates and Filters', 'Exports batch start date, finished date, selected date range, and record count.')}
                                        ${this.renderExportFieldOption('batchSummary', 'exportSummaryTotals', 'System Totals', 'Exports initial stock, total material input, and total water added.')}
                                        ${this.renderExportFieldOption('batchSummary', 'exportSummaryCalculation', 'Calculation Settings', 'Exports the compost conversion rate used for estimation.')}
                                    </div>
                                </div>
                            </div>

                            <div class="export-module-card" id="exportModuleCard-dailyRecords">
                                <div class="export-module-header">
                                    <label class="export-module-main">
                                        <input type="checkbox" id="exportModule-dailyRecords" checked onchange="app.setExportModule('dailyRecords', this.checked)">
                                        <div>
                                            <div class="export-module-title">🗂️ Daily Records</div>
                                            <div class="export-module-subtitle">Inputs, monitoring, actions, and observations by record date</div>
                                        </div>
                                    </label>
                                    <button type="button" class="export-module-expand" onclick="app.toggleExportModule('dailyRecords')">
                                        <span id="exportModuleIcon-dailyRecords">▾</span>
                                    </button>
                                </div>
                                <div class="export-module-content" id="exportModuleContent-dailyRecords">
                                    <div class="export-module-fields">
                                        ${this.renderExportFieldOption('dailyRecords', 'exportTotalInput', 'Organic Waste / Structural Material / Total Material Input', 'Exports the total organic waste, total structural material, and total material input for each daily record.')}
                                        ${isICTA ? `
                                            ${this.renderExportFieldOption('dailyRecords', 'exportCocinaPlanta', 'Cocina / Planta Breakdown', 'Exports the ICTA food waste breakdown by Cocina and Planta collection points.')}
                                            ${this.renderExportFieldOption('dailyRecords', 'exportStructural', 'Structuring Material Breakdown', 'Exports ICTA structural inputs such as ratio, wood, and wood chips.')}
                                        ` : `
                                            ${this.renderExportFieldOption('dailyRecords', 'exportTotalWasteInput', 'Regular Organic Waste', 'Exports the main organic waste amount entered for each record, before additional materials are added.')}
                                            ${this.renderExportFieldOption('dailyRecords', 'exportStructuralMaterials', 'Structural Materials', 'Exports the detailed list of structural materials entered for each record.')}
                                        `}
                                        ${this.renderExportFieldOption('dailyRecords', 'exportAdditionalInput', 'Additional Input Breakdown', 'Exports extra materials added to the system, including their source, type, and amount.')}
                                        ${this.renderExportFieldOption('dailyRecords', 'exportQuality', 'Input Quality', 'Exports the quality rating or condition of the input materials.')}
                                        ${this.renderExportFieldOption('dailyRecords', 'exportTemperature', 'Temperature', 'Exports ambient, core, transition, outer, and average temperature values.')}
                                        ${this.renderExportFieldOption('dailyRecords', 'exportMoisture', 'Moisture', 'Exports moisture type, moisture percentage, or qualitative moisture assessment.')}
                                        ${this.renderExportFieldOption('dailyRecords', 'exportPhase', 'Phase', 'Exports the composting phase tracked for each record.')}
                                        ${this.renderExportFieldOption('dailyRecords', 'exportOperations', 'Actions and Operations', 'Exports turning, mixing, water added (+ amount), removed impurities (+ description), and other action (+ description).')}
                                        ${this.renderExportFieldOption('dailyRecords', 'exportOdour', 'Odour', 'Exports odour detected, odour type, detection distance, and any odour notes recorded on that date.')}
                                        ${this.renderExportFieldOption('dailyRecords', 'exportLeachate', 'Leachate', 'Exports leachate observed status and any related notes recorded on that date.')}
                                        ${this.renderExportFieldOption('dailyRecords', 'exportRecordMetadata', 'Operator Traceability', 'Exports created by, created email, created time, last edited by, and last edited time for each daily record.')}
                                    </div>
                                </div>
                            </div>

                            <div class="export-module-card" id="exportModuleCard-transferRecords">
                                <div class="export-module-header">
                                    <label class="export-module-main">
                                        <input type="checkbox" id="exportModule-transferRecords" checked onchange="app.setExportModule('transferRecords', this.checked)">
                                        <div>
                                            <div class="export-module-title">🔄 Material Transfer</div>
                                            <div class="export-module-subtitle">Transfer summary and transfer history involving the selected batch</div>
                                        </div>
                                    </label>
                                    <button type="button" class="export-module-expand" onclick="app.toggleExportModule('transferRecords')">
                                        <span id="exportModuleIcon-transferRecords">▾</span>
                                    </button>
                                </div>
                                <div class="export-module-content" id="exportModuleContent-transferRecords">
                                    <div class="export-module-fields">
                                        ${this.renderExportFieldOption('transferRecords', 'exportTransferSummary', 'Transfer Summary', 'Exports incoming and outgoing transfer totals for the selected batch.')}
                                        ${this.renderExportFieldOption('transferRecords', 'exportTransferHistory', 'Transfer History', 'Exports each material transfer involving the selected batch as a separate record.')}
                                    </div>
                                </div>
                            </div>

                            <div class="export-module-card" id="exportModuleCard-harvest">
                                <div class="export-module-header">
                                    <label class="export-module-main">
                                        <input type="checkbox" id="exportModule-harvest" checked onchange="app.setExportModule('harvest', this.checked)">
                                        <div>
                                            <div class="export-module-title">📦 Harvest Summary</div>
                                            <div class="export-module-subtitle">Estimated output, actual output, and optional final moisture</div>
                                        </div>
                                    </label>
                                    <button type="button" class="export-module-expand" onclick="app.toggleExportModule('harvest')">
                                        <span id="exportModuleIcon-harvest">▾</span>
                                    </button>
                                </div>
                                <div class="export-module-content" id="exportModuleContent-harvest">
                                    <div class="export-module-fields">
                                        ${this.renderExportFieldOption('harvest', 'exportOutput', 'Harvest Output Details', 'Exports harvest status, estimated output, harvest date, actual compost output, and notes.')}
                                        ${this.renderExportFieldOption('harvest', 'exportMoistureFinal', 'Final Moisture in Harvest Summary', 'Adds final moisture type, value, and assessment into the harvest summary section.')}
                                    </div>
                                </div>
                            </div>

                            <div class="export-module-card" id="exportModuleCard-finalAssessment">
                                <div class="export-module-header">
                                    <label class="export-module-main">
                                        <input type="checkbox" id="exportModule-finalAssessment" checked onchange="app.setExportModule('finalAssessment', this.checked)">
                                        <div>
                                            <div class="export-module-title">🟣 Final Assessment</div>
                                            <div class="export-module-subtitle">Final compost measurements and assessment details</div>
                                        </div>
                                    </label>
                                    <button type="button" class="export-module-expand" onclick="app.toggleExportModule('finalAssessment')">
                                        <span id="exportModuleIcon-finalAssessment">▾</span>
                                    </button>
                                </div>
                                <div class="export-module-content" id="exportModuleContent-finalAssessment">
                                    <div class="export-module-fields">
                                        ${this.renderExportFieldOption('finalAssessment', 'exportFinalAssessment', 'Final Compost Assessment', 'Exports final temperature, moisture, odour, and final compost photo count.')}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="card">
                        <h2 class="card-title">📄 Export Format</h2>
                        <div class="radio-group" style="margin-top: 15px;">
                            <label class="radio-item">
                                <input type="radio" name="exportFormat" value="csv" checked>
                                ○ CSV
                            </label>
                            <label class="radio-item">
                                <input type="radio" name="exportFormat" value="excel">
                                ○ Excel (.xls)
                            </label>
                        </div>
                    </div>

                    <div class="action-panel">
                        <div class="btn-group">
                            <button type="button" class="btn btn-primary" onclick="app.exportData()">
                                📥 Export Data
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        `;
    },

    toggleExportModule(moduleId) {
        const content = document.getElementById(`exportModuleContent-${moduleId}`);
        const icon = document.getElementById(`exportModuleIcon-${moduleId}`);
        if (!content || !icon) return;
        const isHidden = content.style.display === 'none';
        content.style.display = isHidden ? 'block' : 'none';
        icon.textContent = isHidden ? '▾' : '▸';
    },

    setExportModule(moduleId, checked) {
        const card = document.getElementById(`exportModuleCard-${moduleId}`);
        const fieldItems = Array.from(document.querySelectorAll(`[data-export-module="${moduleId}"]`));
        fieldItems.forEach((item) => {
            item.classList.toggle('export-field-item-disabled', !checked);
            const input = item.querySelector('input[type="checkbox"]');
            if (input) input.disabled = !checked;
        });
        if (card) card.classList.toggle('export-module-card-disabled', !checked);
    },

    initializeExportFieldSelection() {
        ['batchSummary', 'dailyRecords', 'harvest', 'finalAssessment'].forEach((moduleId) => {
            const master = document.getElementById(`exportModule-${moduleId}`);
            this.setExportModule(moduleId, !!master?.checked);
        });
    },

    attachEventListeners() {
        const loginForm = document.getElementById('loginForm');
        if (loginForm) {
            loginForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleLoginSubmit();
            });
        }
        const rememberMeEl = document.getElementById('loginRememberMe');
        if (rememberMeEl) {
            rememberMeEl.addEventListener('change', () => {
                this.data.rememberMe = !!rememberMeEl.checked;
                localStorage.setItem('compostRememberMe', this.data.rememberMe ? 'true' : 'false');
            });
        }

        const registerForm = document.getElementById('registerForm');
        if (registerForm) {
            registerForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleRegisterSubmit();
            });
        }

        const communityTypeOther = document.getElementById('registerCommunityTypeOther');
        const communityTypeRadios = document.querySelectorAll('input[name="registerCommunityType"]');
        if (communityTypeRadios && communityTypeRadios.length > 0 && communityTypeOther) {
            communityTypeRadios.forEach((radio) => {
                radio.addEventListener('change', () => {
                    this.updateRegisterCommunityTypeOtherVisibility();
                });
            });
            this.updateRegisterCommunityTypeOtherVisibility();
        }

        const createBatchForm = document.getElementById('createBatchForm');
        if (createBatchForm) {
            createBatchForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.saveBatch();
            });
        }
        const inputMethodRadios = document.querySelectorAll('input[name="inputMethod"]');
        if (inputMethodRadios && inputMethodRadios.length > 0) {
            inputMethodRadios.forEach((radio) => {
                radio.addEventListener('change', () => {
                    this.updateCreateBatchMeasurementSettingsVisibility();
                });
            });
            this.updateCreateBatchMeasurementSettingsVisibility();
        }
        const bucketSizeRadios = document.querySelectorAll('input[name="bucketSize"]');
        if (bucketSizeRadios && bucketSizeRadios.length > 0) {
            bucketSizeRadios.forEach((radio) => {
                radio.addEventListener('change', () => {
                    this.updateCreateBatchBucketCustomVisibility();
                });
            });
            this.updateCreateBatchBucketCustomVisibility();
        }
        const conversionRateRadios = document.querySelectorAll('input[name="conversionRateMode"]');
        if (conversionRateRadios && conversionRateRadios.length > 0) {
            conversionRateRadios.forEach((radio) => {
                radio.addEventListener('change', () => {
                    this.updateCreateBatchCalculationSettingsVisibility();
                });
            });
            this.updateCreateBatchCalculationSettingsVisibility();
        }
        const numCompostersEl = document.getElementById('numComposters');
        if (numCompostersEl) {
            numCompostersEl.addEventListener('input', () => {
                this.updateCreateBatchComposterTable();
            });
            numCompostersEl.addEventListener('change', () => {
                this.updateCreateBatchComposterTable();
            });
            this.updateCreateBatchComposterTable();
        }
        const collaborationRadios = document.querySelectorAll('input[name="collaborationType"]');
        if (collaborationRadios && collaborationRadios.length > 0) {
            collaborationRadios.forEach((radio) => {
                radio.addEventListener('change', () => {
                    this.updateCreateBatchCollaborationVisibility();
                });
            });
            this.updateCreateBatchCollaborationVisibility();
        }

        const dailyRecordForm = document.getElementById('dailyRecordForm');
        if (dailyRecordForm) {
            dailyRecordForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.saveDailyRecord();
            });
        }

        const outputForm = document.getElementById('outputForm');
        if (outputForm) {
            outputForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.saveOutput();
            });

            const outputDate = document.getElementById('outputDate');
            if (outputDate) {
                outputDate.addEventListener('input', () => {
                    this.updateOutputDurationDisplay();
                });
            }

            [
                ['carbonTotalOrganicWaste', 'totalOrganicWaste'],
                ['carbonMunicipalCollectionDistance', 'municipalCollectionDistance'],
                ['carbonMunicipalVehiclePayloadCapacityT', 'municipalVehiclePayloadCapacityT'],
                ['carbonMunicipalVehicleCo2Ef', 'municipalVehicleCo2EmissionFactor'],
                ['carbonMunicipalVehicleEnergyEf', 'municipalVehicleEnergyConsumptionFactor'],
                ['carbonCompostProduced', 'compostProduced'],
                ['carbonCommercialCompostPerEvent', 'commercialCompostPurchasedPerEvent'],
                ['carbonCommercialSupplierDistance', 'commercialCompostSupplierDistance'],
                ['carbonPassengerVehicleCo2Ef', 'passengerVehicleCo2EmissionFactor']
            ].forEach(([id, field]) => {
                const element = document.getElementById(id);
                if (!element) return;
                element.addEventListener('input', () => {
                    this.setCarbonReductionDraftField(field, element.value);
                    this.updateCarbonReductionPreview();
                });
            });

            this.updateOutputDurationDisplay();
            if (this.data.carbonReductionExpanded) {
                this.updateCarbonReductionPreview();
            }
        }

        if (this.data.currentPage === 'export') {
            this.initializeExportFieldSelection();
        }

        if (this.data.currentPage === 'dailyRecord') {
            const dailyRecordForm = document.getElementById('dailyRecordForm');
            if (dailyRecordForm && dailyRecordForm.dataset.moduleCompletionBound !== 'true') {
                dailyRecordForm.dataset.moduleCompletionBound = 'true';
                const refreshModuleStates = () => this.refreshDailyRecordModuleCompletionStates();
                dailyRecordForm.addEventListener('input', refreshModuleStates);
                dailyRecordForm.addEventListener('change', refreshModuleStates);
            }
            this.updateICTAMoistureAssessmentVisibility();
            this.updateOdourAssessmentVisibility();
            this.updateAdvancedMonitoringFieldVisibility();
            this.initializeSystemRecommendationRealtime();
            this.initializeToggleableMonitoringRadios();
            this.syncMaterialTransferDateWithRecordDate();
            this.updateMaterialTransferVisibility();
            this.updateSystemRecommendationDom();
            this.updateMaintenanceTotals();
            this.updateICTAActionTakenVisibility();
            this.updateICTAPhotoGridDom();
            this.refreshDailyRecordModuleCompletionStates();
            if (!this.isICTAUser()) {
                this.updateNonICTAMaintenanceRowVisibility();
                this.updateNonICTAMaintenanceTotals();
            }

            const takeInput = document.getElementById('ictaTakePhotoInput');
            if (takeInput) {
                takeInput.addEventListener('change', () => {
                    const files = Array.from(takeInput.files || []);
                    this.handleICTAPhotoFiles(files);
                    takeInput.value = '';
                });
            }
            const uploadInput = document.getElementById('ictaUploadPhotoInput');
            if (uploadInput) {
                uploadInput.addEventListener('change', () => {
                    const files = Array.from(uploadInput.files || []);
                    this.handleICTAPhotoFiles(files);
                    uploadInput.value = '';
                });
            }
            const chooseInput = document.getElementById('ictaChooseFileInput');
            if (chooseInput) {
                chooseInput.addEventListener('change', () => {
                    const files = Array.from(chooseInput.files || []);
                    this.handleICTAPhotoFiles(files);
                    chooseInput.value = '';
                });
            }
            const replaceInput = document.getElementById('ictaReplacePhotoInput');
            if (replaceInput) {
                replaceInput.addEventListener('change', () => {
                    const files = Array.from(replaceInput.files || []);
                    this.handleICTAReplacePhotoFiles(files);
                    replaceInput.value = '';
                });
            }
        }
    },

    async handleLoginSubmit() {
        if (this.data.authSubmitting) return;
        const email = this.normalizeEmail(document.getElementById('loginEmail')?.value);
        const password = document.getElementById('loginPassword')?.value || '';
        if (!email || !password) {
            alert('Please fill in all required fields');
            return;
        }
        this.data.authSubmitting = true;
        const submitBtn = document.querySelector('#loginForm button[type="submit"]');
        if (submitBtn) submitBtn.disabled = true;
        try {
            await this.loginUser(email, password);
        } finally {
            this.data.authSubmitting = false;
            if (submitBtn) submitBtn.disabled = false;
        }
    },

    updateRegisterCommunityTypeOtherVisibility() {
        const otherInput = document.getElementById('registerCommunityTypeOther');
        if (!otherInput) return;
        const selected = document.querySelector('input[name="registerCommunityType"]:checked')?.value || '';
        const isOther = selected === 'Other';
        otherInput.style.display = isOther ? 'block' : 'none';
        if (!isOther) otherInput.value = '';
    },

    updateCreateBatchMeasurementSettingsVisibility() {
        const method = document.querySelector('input[name="inputMethod"]:checked')?.value || 'weight';
        const volumeSettings = document.getElementById('volumeSettings');
        const otherUnitSettings = document.getElementById('otherUnitSettings');
        if (volumeSettings) volumeSettings.style.display = method === 'volume' ? 'block' : 'none';
        if (otherUnitSettings) otherUnitSettings.style.display = method === 'other' ? 'block' : 'none';
        if (method !== 'other') {
            const customUnitName = document.getElementById('customUnitName');
            if (customUnitName) customUnitName.value = '';
        }
        if (method !== 'volume') {
            const customBucketSize = document.getElementById('customBucketSizeL');
            if (customBucketSize) customBucketSize.value = '';
        }
        this.updateCreateBatchBucketCustomVisibility();
        this.updateCreateBatchInitialStockVisibility();
    },

    updateCreateBatchInitialStockVisibility() {
        const details = document.getElementById('initialStockDetails');
        const list = document.getElementById('initialStockMaterialsList');
        if (!details || !list) return;

        const selected = document.querySelector('input[name="initialStockExists"]:checked')?.value || 'no';
        const show = selected === 'yes';
        details.style.display = show ? 'block' : 'none';
        if (!show) {
            list.innerHTML = '';
            this.updateCreateBatchInitialStockSummary();
            return;
        }
        if (list.querySelectorAll('.initial-stock-material-card').length === 0) {
            this.addCreateBatchInitialStockMaterial();
        } else {
            this.updateCreateBatchInitialStockComposterOptions();
            this.updateCreateBatchInitialStockSummary();
        }
    },

    updateCreateBatchInitialStockComposterOptions() {
        const selects = Array.from(document.querySelectorAll('.initial-stock-composter'));
        if (selects.length === 0) return;
        const options = this.getCreateBatchComposterOptions();
        const singleComposter = options.length <= 1;
        selects.forEach((selectEl) => {
            const previousValue = selectEl.value;
            selectEl.innerHTML = options.map((id) => `<option value="${this.escapeAttr(id)}">${this.escapeAttr(id)}</option>`).join('');
            selectEl.disabled = singleComposter;
            if (options.includes(previousValue)) selectEl.value = previousValue;
            else if (options[0]) selectEl.value = options[0];
        });
        document.querySelectorAll('.initial-stock-material-card').forEach((card) => {
            const typeSelect = card.querySelector('.initial-stock-material-type');
            if (typeSelect) this.updateCreateBatchInitialStockMaterialFields(typeSelect);
        });
        this.updateCreateBatchInitialStockSummary();
    },

    updateCreateBatchCalculationSettingsVisibility() {
        const selected = document.querySelector('input[name="conversionRateMode"]:checked')?.value || 'default';
        const customSection = document.getElementById('customConversionRateSection');
        const customInput = document.getElementById('customConversionRate');
        const isCustom = selected === 'custom';
        if (customSection) customSection.style.display = isCustom ? 'block' : 'none';
        if (customInput) {
            customInput.required = isCustom;
            if (!isCustom) customInput.value = '';
        }
    },

    updateCreateBatchBucketCustomVisibility() {
        const method = document.querySelector('input[name="inputMethod"]:checked')?.value || 'weight';
        const customInput = document.getElementById('customBucketSizeL');
        if (!customInput) return;
        if (method !== 'volume') {
            customInput.style.display = 'none';
            return;
        }
        const bucketSize = document.querySelector('input[name="bucketSize"]:checked')?.value || '2';
        const isCustom = bucketSize === 'custom';
        customInput.style.display = isCustom ? 'block' : 'none';
        if (!isCustom) customInput.value = '';
    },

    updateCreateBatchCollaborationVisibility() {
        const type = document.querySelector('input[name="collaborationType"]:checked')?.value || 'private';
        const invite = document.getElementById('inviteCollaboratorsSection');
        if (!invite) return;
        const isShared = type === 'shared';
        invite.style.display = isShared ? 'block' : 'none';
        if (!isShared) {
            const emailsEl = document.getElementById('collaboratorsEmails');
            if (emailsEl) emailsEl.value = '';
        }
    },

    async addBatchCollaborators(batchId) {
        const batch = this.findBatchByRouteId(batchId);
        if (!batch) return;
        if (!this.isBatchOwner(batch)) {
            alert('Only the batch owner can add collaborators.');
            return;
        }
        const inputEl = document.getElementById('batchCollaboratorInput');
        const raw = inputEl?.value || '';
        const emails = raw
            .split(/[,\n;]+/)
            .map((value) => this.normalizeEmail(value))
            .filter(Boolean);

        if (emails.length === 0) {
            alert('Please enter at least one collaborator email.');
            return;
        }

        const invalid = emails.filter((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
        if (invalid.length > 0) {
            alert(`Invalid email(s): ${invalid.join(', ')}`);
            return;
        }

        const ownerEmail = this.normalizeEmail(batch.ownerEmail || this.data.currentUser?.email || '');
        const current = this.getBatchCollaborators(batch);
        const merged = Array.from(new Set([...current, ...emails])).filter((email) => email !== ownerEmail);

        if (merged.length === current.length) {
            alert('All of these collaborators are already added.');
            return;
        }

        this.updateBatchCollaborationFields(batch, merged);
        this.appendBatchActivity(
            batch,
            'collaborators_added',
            `${emails.length === 1 ? 'Added collaborator' : 'Added collaborators'}: ${emails.join(', ')}`,
            { collaborators: emails }
        );
        await this.syncBatchCollaboration(batch);
        if (inputEl) inputEl.value = '';
        this.render();
        this.showTransientSuccessMessage('✅ Collaborators updated successfully', 2200);
    },

    async removeBatchCollaborator(batchId, email) {
        const batch = this.findBatchByRouteId(batchId);
        if (!batch) return;
        if (!this.isBatchOwner(batch)) {
            alert('Only the batch owner can remove collaborators.');
            return;
        }

        const targetEmail = this.normalizeEmail(email);
        if (!targetEmail) return;
        if (!confirm(`Remove ${targetEmail} from this shared batch?`)) return;

        const next = this.getBatchCollaborators(batch).filter((value) => value !== targetEmail);
        this.updateBatchCollaborationFields(batch, next);
        this.appendBatchActivity(
            batch,
            'collaborator_removed',
            `Removed collaborator: ${targetEmail}`,
            { collaborator: targetEmail }
        );
        await this.syncBatchCollaboration(batch);
        this.render();
        this.showTransientSuccessMessage('✅ Collaborator removed', 2200);
    },

    async leaveSharedBatch(batchId) {
        const batch = this.findBatchByRouteId(batchId);
        if (!batch) return;
        if (!this.isCurrentUserCollaborator(batch)) {
            alert('You are not listed as a collaborator on this batch.');
            return;
        }

        const currentEmail = this.normalizeEmail(this.data.currentUser?.email || '');
        if (!currentEmail) return;
        if (!confirm('Leave this shared batch? You can only access it again if the owner shares it with you again.')) return;

        const next = this.getBatchCollaborators(batch).filter((email) => email !== currentEmail);
        this.updateBatchCollaborationFields(batch, next);
        this.appendBatchActivity(
            batch,
            'collaborator_left',
            `Left shared batch: ${currentEmail}`,
            { collaborator: currentEmail }
        );
        await this.syncBatchCollaboration(batch);
        this.data.batches = this.data.batches.filter((item) => this.getBatchRouteId(item) !== this.getBatchRouteId(batch));
        if (this.data.currentBatch && this.getBatchRouteId(this.data.currentBatch) === this.getBatchRouteId(batch)) {
            this.data.currentBatch = null;
        }
        this.data.batchInfoPanel = null;
        this.saveData();
        this.navigate('dashboard');
        this.showTransientSuccessMessage('✅ You left the shared batch', 2200);
    },

    updateCreateBatchComposterTable() {
        const numEl = document.getElementById('numComposters');
        const container = document.getElementById('composterTableContainer');
        if (!numEl || !container) return;

        let count = parseInt(numEl.value, 10);
        if (isNaN(count) || count < 1) count = 1;
        if (count > 50) count = 50;
        if (String(count) !== String(numEl.value)) numEl.value = String(count);

        const existing = [];
        for (let i = 1; i <= 50; i++) {
            const idEl = document.getElementById(`composterId_${i}`);
            const capEl = document.getElementById(`composterCap_${i}`);
            if (!idEl && !capEl) continue;
            const idVal = idEl ? String(idEl.value || '').trim() : '';
            const capVal = capEl && capEl.value !== '' ? parseFloat(capEl.value) : null;
            existing[i] = { id: idVal, cap: capVal };
        }

        const rowsHtml = Array.from({ length: count }, (_, idx) => {
            const i = idx + 1;
            const prev = existing[i] || {};
            const idValue = prev.id ? String(prev.id) : '';
            const capValue = (prev.cap != null && !isNaN(prev.cap)) ? prev.cap : '';
            return `
                <tr>
                    <td><input type="text" class="form-input" id="composterId_${i}" value="${String(idValue).replace(/"/g, '&quot;')}" placeholder="Composter ID"></td>
                    <td><input type="number" class="form-input" id="composterCap_${i}" step="any" value="${capValue}" placeholder="Capacity (L)"></td>
                </tr>
            `;
        }).join('');

        container.innerHTML = `
            <table class="table">
                <thead>
                    <tr>
                        <th>Composter ID</th>
                        <th>Capacity (L)</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                </tbody>
            </table>
        `;
        const composterIdInputs = container.querySelectorAll('input[id^="composterId_"]');
        composterIdInputs.forEach((input) => {
            input.addEventListener('input', () => {
                this.updateCreateBatchInitialStockComposterOptions();
            });
            input.addEventListener('change', () => {
                this.updateCreateBatchInitialStockComposterOptions();
            });
        });
        this.updateCreateBatchInitialStockComposterOptions();
    },

    togglePasswordVisibility(inputId, toggleId) {
        const input = document.getElementById(inputId);
        const toggle = document.getElementById(toggleId);
        if (!input || !toggle) return;
        const isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';
        toggle.textContent = isPassword ? '🙈' : '👀';
    },

    toggleObservations() {
        const content = document.getElementById('observationsContent');
        const icon = document.getElementById('observationsToggleIcon');
        if (!content || !icon) return;
        const isHidden = content.style.display === 'none' || content.style.display === '';
        content.style.display = isHidden ? 'block' : 'none';
        icon.textContent = isHidden ? '▾' : '▸';
    },

    toggleICTAMonitoringModule() {
        const content = document.getElementById('monitoringModuleContent');
        const icon = document.getElementById('monitoringModuleToggleIcon');
        const text = document.getElementById('monitoringModuleToggleText');
        if (!content || !icon || !text) return;
        const isHidden = content.style.display === 'none' || content.style.display === '';
        content.style.display = isHidden ? 'block' : 'none';
        icon.textContent = isHidden ? '▾' : '▸';
        this.syncModuleToggleText(text, 'Monitoring Module');
    },

    updateICTAMoistureAssessmentVisibility() {
        const type = document.querySelector('input[name="moistureAssessmentType"]:checked')?.value || '';
        const quantitativeSection = document.getElementById('moistureQuantitativeSection');
        const qualitativeSection = document.getElementById('moistureQualitativeSection');
        if (quantitativeSection) quantitativeSection.style.display = type === 'quantitative' ? 'block' : 'none';
        if (qualitativeSection) qualitativeSection.style.display = type === 'qualitative' ? 'block' : 'none';
        if (type === 'quantitative') {
            const qualitative = document.querySelectorAll('input[name="moistureQualitative"]');
            qualitative.forEach(radio => { radio.checked = false; });
            this.updateSystemRecommendationDom();
            return;
        }

        if (type === 'qualitative') {
            const moistureValue = document.getElementById('moistureValue');
            if (moistureValue) moistureValue.value = '';
            this.updateSystemRecommendationDom();
            return;
        }

        const moistureValue = document.getElementById('moistureValue');
        if (moistureValue) moistureValue.value = '';
        const qualitative = document.querySelectorAll('input[name="moistureQualitative"]');
        qualitative.forEach(radio => { radio.checked = false; });
        this.updateSystemRecommendationDom();
    },

    updateOdourAssessmentVisibility() {
        const choice = document.querySelector('input[name="odourDetected"]:checked')?.value || '';
        const details = document.getElementById('odourDetectedDetails');
        if (!details) return;
        const show = choice === 'detected';
        details.style.display = show ? 'block' : 'none';
        if (!show) {
            document.querySelectorAll('input[name="odourType"]').forEach((radio) => {
                radio.checked = false;
            });
            document.querySelectorAll('input[name="odourDistance"]').forEach((radio) => {
                radio.checked = false;
            });
        }
        this.updateSystemRecommendationDom();
    },

    initializeSystemRecommendationRealtime() {
        const content = document.getElementById('monitoringModuleContent');
        if (!content) return;
        if (content.dataset.systemRecommendationBound === 'true') return;
        content.dataset.systemRecommendationBound = 'true';
        const handler = () => {
            this.updateSystemRecommendationDom();
            this.refreshDailyRecordModuleCompletionStates();
        };
        content.addEventListener('input', handler);
        content.addEventListener('change', handler);
    },

    initializeToggleableMonitoringRadios() {
        const content = document.getElementById('monitoringModuleContent');
        if (!content) return;
        if (content.dataset.toggleableRadiosBound === 'true') return;
        content.dataset.toggleableRadiosBound = 'true';

        const getRadioTarget = (event) => {
            const raw = event.target;
            const target = raw && raw.nodeType === 3 ? raw.parentElement : raw;
            if (!target || !target.closest) return null;
            const direct = target.closest('input[type="radio"]');
            if (direct) return direct;
            const label = target.closest('label');
            if (!label) return null;
            return label.querySelector('input[type="radio"]');
        };

        content.addEventListener('pointerdown', (event) => {
            const radio = getRadioTarget(event);
            if (!radio) return;
            radio.dataset.wasChecked = radio.checked ? 'true' : 'false';
        }, true);

        content.addEventListener('click', (event) => {
            const radio = getRadioTarget(event);
            if (!radio) return;
            if (radio.dataset.wasChecked === 'true') {
                radio.checked = false;
                radio.dispatchEvent(new Event('change', { bubbles: true }));
                radio.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }, true);
    },

    getMonitoringDraftStateFromDom() {
        const getNumericValue = (id) => {
            const el = document.getElementById(id);
            if (!el || el.value === '') return null;
            const n = parseFloat(el.value);
            return isNaN(n) ? null : n;
        };
        const moistureAssessmentType = document.querySelector('input[name="moistureAssessmentType"]:checked')?.value || '';
        const moistureValue = moistureAssessmentType === 'quantitative' ? getNumericValue('moistureValue') : null;
        const moistureQualitative = moistureAssessmentType === 'qualitative'
            ? (document.querySelector('input[name="moistureQualitative"]:checked')?.value || '')
            : '';

        const odourDetectedChoice = document.querySelector('input[name="odourDetected"]:checked')?.value || '';
        const odourDetected = odourDetectedChoice === 'detected'
            ? true
            : (odourDetectedChoice === 'no' ? false : null);
        const odourType = odourDetected === true
            ? (document.querySelector('input[name="odourType"]:checked')?.value || null)
            : null;
        const odourDistance = odourDetected === true
            ? (document.querySelector('input[name="odourDistance"]:checked')?.value || null)
            : null;

        const leachateObserved = document.querySelector('input[name="leachateObserved"]:checked')?.value || '';

        const getAdvancedDraftField = (baseId) => {
            const enabled = !!document.getElementById(`${baseId}Enabled`)?.checked;
            const value = enabled ? getNumericValue(`${baseId}Value`) : null;
            return { value };
        };
        const advancedMonitoringNotes = document.getElementById('advancedMonitoringNotes')?.value?.trim?.() || '';
        const advancedMonitoring = {
            laboratoryMoisture: getAdvancedDraftField('advancedLaboratoryMoisture'),
            oxygen: getAdvancedDraftField('advancedOxygen'),
            ammonia: getAdvancedDraftField('advancedAmmonia'),
            carbonDioxide: getAdvancedDraftField('advancedCarbonDioxide'),
            methane: getAdvancedDraftField('advancedMethane'),
            hydrogenSulfide: getAdvancedDraftField('advancedHydrogenSulfide'),
            voc: getAdvancedDraftField('advancedVoc'),
            nitrousOxide: getAdvancedDraftField('advancedNitrousOxide'),
            organicMatter: getAdvancedDraftField('advancedOrganicMatter'),
            electricalConductivity: getAdvancedDraftField('advancedElectricalConductivity'),
            notes: advancedMonitoringNotes
        };

        return {
            ambientTemperature: getNumericValue('ambientTemperature'),
            ambientHumidity: getNumericValue('ambientHumidity'),
            coreTemperature: getNumericValue('coreTemperature'),
            transitionTemperature: getNumericValue('transitionTemperature'),
            outerTemperature: getNumericValue('outerTemperature'),
            moistureAssessmentType,
            moistureValue,
            moistureQualitative,
            odourDetected,
            odourType,
            odourDistance,
            leachateObserved,
            advancedMonitoring
        };
    },

    getSystemRecommendationResult(batch, monitoringDraft, recordDate) {
        const interpretations = [];
        const actions = [];

        const pushInterpretation = (text) => {
            const t = String(text || '').trim();
            if (t) interpretations.push(t);
        };
        const pushAction = (text) => {
            const t = String(text || '').trim();
            if (t) actions.push(t);
        };

        const coreTemp = monitoringDraft?.coreTemperature;
        if (coreTemp != null && !isNaN(coreTemp)) {
            if (coreTemp > 60) {
                pushInterpretation('The compost temperature is too high.');
                pushInterpretation('Excessive temperatures may inhibit microbial activity.');
                pushAction('Turn the compost.');
                pushAction('Add water while turning.');
                pushAction('Avoid reducing the temperature below 40°C.');
                pushAction('Avoid excessive watering.');
                pushAction('Add structural material if necessary.');
            } else if (coreTemp >= 40 && coreTemp <= 60) {
                pushInterpretation('The compost is in the normal thermophilic phase.');
                pushAction('No maintenance required.');
                pushAction('Continue monitoring.');
            } else if (coreTemp < 40) {
                const hasReachedThermophilic = this.hasBatchReachedThermophilicPeak(batch, recordDate, coreTemp);
                if (!hasReachedThermophilic) {
                    pushInterpretation('The compost is still in the mesophilic phase.');
                    pushAction('Increase nitrogen-rich organic materials.');
                    pushAction('Do not turn the compost.');
                    pushAction('Do not add water.');
                } else {
                    pushInterpretation('The compost is currently in the cooling or maturation phase.');
                    pushAction('No maintenance required.');
                    pushAction('Continue monitoring.');
                }
            }
        }

        const moisture = String(monitoringDraft?.moistureQualitative || '').trim();
        if (moisture === 'wet') {
            pushInterpretation('The compost contains excessive moisture.');
            pushInterpretation('Poor aeration may occur.');
            pushAction('Add structural material.');
            pushAction('Turn the compost.');
        } else if (moisture === 'optimal') {
            pushInterpretation('Moisture conditions are appropriate.');
            pushAction('No maintenance required.');
        } else if (moisture === 'dry') {
            pushInterpretation('The compost is too dry.');
            pushInterpretation('Microbial activity may decrease.');
            pushAction('Turn the compost.');
            pushAction('Add water gradually.');
            pushAction('Adjust water according to ambient conditions and the next maintenance schedule.');
        }

        const odourDetected = monitoringDraft?.odourDetected;
        const odourType = String(monitoringDraft?.odourType || '').trim();
        if (odourDetected === true) {
            if (odourType === 'earth') {
                pushInterpretation('The composting process is progressing normally.');
                pushAction('No maintenance required.');
            } else if (odourType === 'vinegar') {
                pushInterpretation('Excess acidic compounds are present.');
                pushAction('Reduce fruit and vegetable inputs.');
            } else if (odourType === 'rotten') {
                pushInterpretation('Insufficient oxygen.');
                pushInterpretation('Possible anaerobic conditions.');
                pushAction('Turn the compost immediately.');
                pushAction('Improve aeration.');
            } else if (odourType === 'ammonia') {
                pushInterpretation('Excess nitrogen.');
                pushAction('Reduce nitrogen-rich organic waste.');
                pushAction('Add structural material.');
                pushAction('Restore approximately a 1:1 Organic Waste : Structural Material ratio.');
            }
        }

        const uniqueInterpretations = [];
        const seenInterpretations = new Set();
        interpretations.forEach((item) => {
            if (seenInterpretations.has(item)) return;
            seenInterpretations.add(item);
            uniqueInterpretations.push(item);
        });

        const uniqueActions = [];
        const seenActions = new Set();
        actions.forEach((item) => {
            if (seenActions.has(item)) return;
            seenActions.add(item);
            uniqueActions.push(item);
        });

        return { interpretations: uniqueInterpretations, actions: uniqueActions };
    },

    hasBatchReachedThermophilicPeak(batch, recordDate, draftCoreTemperature) {
        const records = Array.isArray(batch?.records) ? batch.records : [];
        const dateStr = String(recordDate || '').trim();
        const draftCore = draftCoreTemperature != null && !isNaN(draftCoreTemperature) ? draftCoreTemperature : null;
        const merged = records.map((r) => {
            if (dateStr && String(r?.date || '') === dateStr) {
                const next = { ...(r || {}) };
                next.monitoring = { ...(r?.monitoring || {}), coreTemperature: draftCore };
                next.process = { ...(r?.process || {}), core: draftCore };
                return next;
            }
            return r;
        });
        if (dateStr && !records.some((r) => String(r?.date || '') === dateStr)) {
            merged.push({
                id: 'draft',
                date: dateStr,
                monitoring: { coreTemperature: draftCore },
                process: { core: draftCore }
            });
        }
        return merged.some((r) => {
            const core = r?.monitoring?.coreTemperature != null ? r.monitoring.coreTemperature : r?.process?.core;
            return core != null && !isNaN(core) && Number(core) >= 40;
        });
    },

    updateSystemRecommendationDom() {
        const module = document.getElementById('systemRecommendationModule');
        if (!module) return;
        const batch = this.data.currentBatch;
        if (!batch) {
            module.style.display = 'none';
            return;
        }
        const recordDate = document.getElementById('recordDate')?.value || '';
        const monitoringDraft = this.getMonitoringDraftStateFromDom();
        const shouldShow = this.hasMonitoringStateContent(monitoringDraft);
        if (!shouldShow) {
            module.style.display = 'none';
            return;
        }
        const result = this.getSystemRecommendationResult(batch, monitoringDraft, recordDate);
        const interpretationsEl = document.getElementById('systemRecommendationInterpretations');
        const actionsEl = document.getElementById('systemRecommendationActions');
        if (interpretationsEl) {
            interpretationsEl.innerHTML = result.interpretations.map((text) => (
                `<div class="system-recommendation-item">• ${this.escapeHtml(text)}</div>`
            )).join('');
        }
        if (actionsEl) {
            actionsEl.innerHTML = result.actions.map((text) => (
                `<div class="system-recommendation-item">✔ ${this.escapeHtml(text)}</div>`
            )).join('');
        }
        module.style.display = 'block';
    },

    toggleICTAMaintenanceModule() {
        const content = document.getElementById('maintenanceModuleContent');
        const icon = document.getElementById('maintenanceModuleToggleIcon');
        const text = document.getElementById('maintenanceModuleToggleText');
        if (!content || !icon || !text) return;
        const isHidden = content.style.display === 'none' || content.style.display === '';
        content.style.display = isHidden ? 'block' : 'none';
        icon.textContent = isHidden ? '▾' : '▸';
        this.syncModuleToggleText(text, 'Maintenance Module');
    },

    toggleICTAOtherOrganicInput() {
        const content = document.getElementById('otherOrganicContent');
        const icon = document.getElementById('otherOrganicToggleIcon');
        const text = document.getElementById('otherOrganicToggleText');
        if (!content || !icon || !text) return;
        const isHidden = content.style.display === 'none' || content.style.display === '';
        content.style.display = isHidden ? 'block' : 'none';
        icon.textContent = isHidden ? '▾' : '▸';
        text.textContent = isHidden ? '☑ Other Organic Input (Optional)' : '☐ Other Organic Input (Optional)';
        if (isHidden) this.updateMaintenanceTotals();
    },

    addMaintenanceAdditionalInputRow() {
        const list = document.getElementById('maintenanceAdditionalInputsList');
        if (!list) return;
        const idx = list.querySelectorAll('.maintenance-additional-row').length;
        const inputUnit = this.getBatchInputUnitName(this.data.currentBatch);
        const sourceOptions = [
            'Organic waste generated during events',
            'Garden clean-up residues',
            'Seasonal pruning residues',
            'Research or experimental materials',
            'Other occasional organic inputs'
        ];
        const row = document.createElement('div');
        row.className = 'maintenance-additional-row';
        row.innerHTML = `
            <div class="maintenance-additional-grid">
                <div class="form-group">
                    <label class="form-label">Source</label>
                    <select class="form-input maintenance-additional-source">
                        <option value="">Select source...</option>
                        ${sourceOptions.map(opt => `<option value="${opt.replace(/"/g, '&quot;')}">${opt}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">Type</label>
                    <div class="radio-group" style="gap: 14px;">
                        <label class="radio-item">
                            <input type="radio" name="maintenanceAdditionalType_${idx}" value="organic" checked>
                            Organic Material
                        </label>
                        <label class="radio-item">
                            <input type="radio" name="maintenanceAdditionalType_${idx}" value="structural">
                            Structural Material
                        </label>
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label">Material Description</label>
                    <input type="text" class="form-input maintenance-additional-desc" value="">
                </div>
                <div class="form-group">
                    <label class="form-label">Amount (${inputUnit})</label>
                    <input type="number" class="form-input maintenance-additional-amount" step="any" value="" />
                </div>
            </div>
            <div style="display:flex; justify-content:flex-end; margin-top: 10px;">
                <button type="button" class="btn btn-secondary" style="padding: 8px 12px;">− Remove</button>
            </div>
        `;
        const removeBtn = row.querySelector('button');
        if (removeBtn) removeBtn.onclick = () => this.removeMaintenanceAdditionalInputRow(removeBtn);
        const inputs = row.querySelectorAll('input, select');
        inputs.forEach((el) => {
            el.addEventListener('input', () => this.updateMaintenanceTotals());
            el.addEventListener('change', () => this.updateMaintenanceTotals());
        });
        list.appendChild(row);
        this.updateMaintenanceTotals();
    },

    removeMaintenanceAdditionalInputRow(buttonEl) {
        const row = buttonEl?.closest?.('.maintenance-additional-row');
        const list = document.getElementById('maintenanceAdditionalInputsList');
        if (!row || !list) return;
        row.remove();
        if (list.querySelectorAll('.maintenance-additional-row').length === 0) {
            this.addMaintenanceAdditionalInputRow();
            return;
        }
        this.updateMaintenanceTotals();
    },

    updateMaintenanceTotals() {
        if (this.isICTAUser()) this.updateICTAMaintenanceTotals();
        else this.updateNonICTAMaintenanceTotals();
    },

    updateICTAMaintenanceTotals() {
        if (!this.isICTAUser()) return;
        const batch = this.data.currentBatch;
        if (!batch) return;
        const method = this.getBatchMeasurementSettings(batch)?.inputMethod || '';
        const getNumber = (id) => {
            const el = document.getElementById(id);
            if (!el || el.value === '') return 0;
            const n = parseFloat(el.value);
            return isNaN(n) ? 0 : n;
        };
        const regularOrganicWaste = getNumber('foodWasteCocina') + getNumber('foodWastePlanta0') + getNumber('foodWastePlanta1') + getNumber('foodWastePlanta3');
        const regularStructuralMaterial = getNumber('woodFusta') + getNumber('woodChips');
        const additionalRows = Array.from(document.querySelectorAll('#maintenanceAdditionalInputsList .maintenance-additional-row'));
        const additionalInputs = additionalRows.map((row) => {
            const type = row.querySelector('input[type="radio"]:checked')?.value || 'organic';
            const amountEl = row.querySelector('.maintenance-additional-amount');
            const n = (amountEl && amountEl.value !== '') ? parseFloat(amountEl.value) : 0;
            return { type, amount: isNaN(n) ? 0 : n };
        });
        const additionalTotals = this.calculateAdditionalInputTotals(additionalInputs);
        const totalOrganicWaste = regularOrganicWaste + additionalTotals.additionalOrganicMaterial;
        const totalStructuralMaterial = regularStructuralMaterial + additionalTotals.additionalStructuralMaterial;
        const totalMaterialInput = totalOrganicWaste + totalStructuralMaterial;

        const regularOrganicWasteEl = document.getElementById('regularOrganicWaste');
        const regularStructuralEl = document.getElementById('regularStructuralMaterial');
        const additionalOrganicEl = document.getElementById('additionalOrganicMaterial');
        const additionalStructuralEl = document.getElementById('additionalStructuralMaterial');
        const totalAdditionalEl = document.getElementById('totalAdditionalInput');
        const totalOrganicWasteEl = document.getElementById('totalOrganicWaste');
        const totalStructuralOverallEl = document.getElementById('totalStructuralMaterialOverall');
        const totalMaterialInputEl = document.getElementById('totalMaterialInput');
        if (regularOrganicWasteEl) regularOrganicWasteEl.textContent = this.formatNumber(regularOrganicWaste, 3);
        if (regularStructuralEl) regularStructuralEl.textContent = this.formatNumber(regularStructuralMaterial, 3);
        if (additionalOrganicEl) additionalOrganicEl.textContent = this.formatNumber(additionalTotals.additionalOrganicMaterial, 3);
        if (additionalStructuralEl) additionalStructuralEl.textContent = this.formatNumber(additionalTotals.additionalStructuralMaterial, 3);
        if (totalAdditionalEl) totalAdditionalEl.textContent = this.formatNumber(additionalTotals.totalAdditionalInput, 3);
        if (totalOrganicWasteEl) totalOrganicWasteEl.textContent = this.formatNumber(totalOrganicWaste, 3);
        if (totalStructuralOverallEl) totalStructuralOverallEl.textContent = this.formatNumber(totalStructuralMaterial, 3);
        if (totalMaterialInputEl) totalMaterialInputEl.textContent = this.formatNumber(totalMaterialInput, 3);

        const ratioEl = document.getElementById('foodStructuralRatio');
        if (ratioEl) {
            ratioEl.textContent = method === 'volume' ? this.simplifyRatio(totalOrganicWaste, totalStructuralMaterial) : '';
        }
        this.refreshDailyRecordModuleCompletionStates();
    },

    updateNonICTAMaintenanceRowVisibility() {
        return;
    },

    async persistNonICTAMaterialLibraryChange(successMessage = '✅ Material library updated') {
        const batch = this.data.currentBatch;
        if (!batch) return;
        this.saveData();
        try {
            await this.upsertBatchToCloud(batch, { skipCreatedAt: true });
        } catch (error) {
            alert('Material library was saved locally, but cloud sync failed. Please try again after refreshing.');
        }
        this.refreshNonICTAMaintenanceModule();
        this.showTransientSuccessMessage(successMessage, 2200);
    },

    applyNonICTAMaintenanceOpenState(draft) {
        const content = document.getElementById('maintenanceModuleContent');
        const icon = document.getElementById('maintenanceModuleToggleIcon');
        const text = document.getElementById('maintenanceModuleToggleText');
        if (content && icon && text && draft?.moduleExpanded) {
            content.style.display = 'block';
            icon.textContent = '▾';
            this.syncModuleToggleText(text, 'Maintenance Module');
        }

        const otherContent = document.getElementById('otherOrganicContent');
        const otherIcon = document.getElementById('otherOrganicToggleIcon');
        const otherText = document.getElementById('otherOrganicToggleText');
        if (otherContent && otherIcon && otherText && draft?.otherOrganicExpanded) {
            otherContent.style.display = 'block';
            otherIcon.textContent = '▾';
            otherText.textContent = '☑ Other Organic Input (Optional)';
        }
    },

    refreshNonICTAMaintenanceModule() {
        if (this.isICTAUser() || this.data.currentPage !== 'dailyRecord') return;
        const batch = this.data.currentBatch;
        if (!batch) return;
        const wrapper = document.getElementById('nonIctaMaintenanceCard');
        if (!wrapper) return;

        const record = this.data.editingRecord
            ? batch.records.find((item) => String(item.id) === String(this.data.editingRecord)) || null
            : null;
        const draft = this.getNonICTAMaintenanceDraftFromDom();
        const nextState = this.getNonICTAMaintenanceState(record, batch, draft);
        wrapper.outerHTML = this.renderNonICTAMaintenanceModule(batch, nextState);
        this.applyNonICTAMaintenanceOpenState(draft);
        this.updateNonICTAMaintenanceTotals();
    },

    addNonICTAFoodWasteSource() {
        const batch = this.data.currentBatch;
        if (!batch) return;
        this.ensureNonICTAMaterialLibraries(batch);
        const typeOptions = this.getNonICTAFoodTypeOptions();
        const suggested = 'Mixed Organic Waste';
        this.showFormModal({
            id: 'addFoodWasteSourceModal',
            title: 'Add Food Waste Source',
            confirmText: 'Add',
            fields: [
                { id: 'foodWasteSourceName', label: 'Source Name', type: 'text', value: '', placeholder: 'e.g., Community kitchen', required: true },
                { id: 'foodWasteSourceType', label: 'Food Waste Type', type: 'select', value: suggested, options: typeOptions, required: true },
                { id: 'foodWasteSourceTypeOther', label: 'Please Specify', type: 'text', value: '', placeholder: 'e.g., Seaweed waste', required: false, hidden: true }
            ],
            onAfterOpen: (modal) => {
                const typeEl = modal.querySelector('#foodWasteSourceType');
                const otherGroup = modal.querySelector('[data-field-id="foodWasteSourceTypeOther"]');
                const otherInput = modal.querySelector('#foodWasteSourceTypeOther');
                if (!typeEl || !otherGroup || !otherInput) return;
                const apply = () => {
                    const isOther = String(typeEl.value || '') === 'Other';
                    otherGroup.style.display = isOther ? 'block' : 'none';
                    if (!isOther) otherInput.value = '';
                };
                typeEl.addEventListener('change', apply);
                apply();
            },
            onConfirm: async (values) => {
                const source = String(values.foodWasteSourceName || '').trim();
                const selectedType = String(values.foodWasteSourceType || '').trim();
                const otherType = String(values.foodWasteSourceTypeOther || '').trim();
                const type = selectedType === 'Other' ? otherType : selectedType;
                if (!source) throw new Error('Source Name is required.');
                if (!selectedType) throw new Error('Food Waste Type is required.');
                if (selectedType === 'Other' && !otherType) throw new Error('Please specify the Food Waste Type.');

                const exists = batch.foodWasteLibrary.some((item) => item.active !== false
                    && String(item.source || '').trim().toLowerCase() === source.toLowerCase()
                    && String(item.type || '').trim().toLowerCase() === type.toLowerCase());
                if (exists) throw new Error('This food waste source and type already exist in the Batch library.');

                batch.foodWasteLibrary.push({
                    id: this.makeNonICTALibraryItemId('food'),
                    source,
                    type,
                    active: true
                });
                await this.persistNonICTAMaterialLibraryChange('✅ Food waste source added');
            }
        });
    },

    renameNonICTAFoodWasteSource(sourceId) {
        const batch = this.data.currentBatch;
        if (!batch) return;
        this.ensureNonICTAMaterialLibraries(batch);
        const item = batch.foodWasteLibrary.find((entry) => String(entry.id) === String(sourceId));
        if (!item) return;
        this.showFormModal({
            id: 'renameFoodWasteSourceModal',
            title: 'Rename Food Waste Source',
            confirmText: 'Save',
            fields: [
                { id: 'renameFoodWasteSourceName', label: 'Source Name', type: 'text', value: item.source || '', required: true }
            ],
            onConfirm: async (values) => {
                const nextSource = String(values.renameFoodWasteSourceName || '').trim();
                if (!nextSource || nextSource === item.source) return;
                item.source = nextSource;
                await this.persistNonICTAMaterialLibraryChange('✅ Food waste source renamed');
            }
        });
    },

    editNonICTAFoodWasteType(sourceId) {
        const batch = this.data.currentBatch;
        if (!batch) return;
        this.ensureNonICTAMaterialLibraries(batch);
        const item = batch.foodWasteLibrary.find((entry) => String(entry.id) === String(sourceId));
        if (!item) return;
        const baseOptions = this.getNonICTAFoodTypeOptions();
        const options = baseOptions.includes(item.type) ? baseOptions : [item.type, ...baseOptions];
        this.showFormModal({
            id: 'editFoodWasteTypeModal',
            title: 'Edit Food Waste Type',
            confirmText: 'Save',
            fields: [
                { id: 'editFoodWasteTypeValue', label: 'Food Waste Type', type: 'select', value: item.type || '', options, required: true },
                { id: 'editFoodWasteTypeOther', label: 'Please Specify', type: 'text', value: '', placeholder: 'e.g., Seaweed waste', required: false, hidden: true }
            ],
            onAfterOpen: (modal) => {
                const typeEl = modal.querySelector('#editFoodWasteTypeValue');
                const otherGroup = modal.querySelector('[data-field-id="editFoodWasteTypeOther"]');
                const otherInput = modal.querySelector('#editFoodWasteTypeOther');
                if (!typeEl || !otherGroup || !otherInput) return;
                const apply = () => {
                    const isOther = String(typeEl.value || '') === 'Other';
                    otherGroup.style.display = isOther ? 'block' : 'none';
                    if (!isOther) otherInput.value = '';
                };
                typeEl.addEventListener('change', apply);
                apply();
            },
            onConfirm: async (values) => {
                const selectedType = String(values.editFoodWasteTypeValue || '').trim();
                const otherType = String(values.editFoodWasteTypeOther || '').trim();
                if (!selectedType) return;
                const nextType = selectedType === 'Other' ? otherType : selectedType;
                if (selectedType === 'Other' && !otherType) throw new Error('Please specify the Food Waste Type.');
                if (!nextType || nextType === item.type) return;
                item.type = nextType;
                await this.persistNonICTAMaterialLibraryChange('✅ Food waste type updated');
            }
        });
    },

    async removeNonICTAFoodWasteSource(sourceId) {
        const batch = this.data.currentBatch;
        if (!batch) return;
        this.ensureNonICTAMaterialLibraries(batch);
        const item = batch.foodWasteLibrary.find((entry) => String(entry.id) === String(sourceId));
        if (!item) return;
        if (!confirm(`Remove "${item.source}" from future Daily Records? Historical records will remain linked.`)) return;
        item.active = false;
        await this.persistNonICTAMaterialLibraryChange('✅ Food waste source removed from active library');
    },

    addNonICTAStructuralMaterial() {
        const batch = this.data.currentBatch;
        if (!batch) return;
        this.ensureNonICTAMaterialLibraries(batch);
        this.showFormModal({
            id: 'addStructuralMaterialModal',
            title: 'Add Structural Material',
            confirmText: 'Add',
            fields: [
                { id: 'addStructuralMaterialName', label: 'Material Name', type: 'text', value: '', placeholder: 'e.g., Wood chips', required: true }
            ],
            onConfirm: async (values) => {
                const material = String(values.addStructuralMaterialName || '').trim();
                if (!material) throw new Error('Material Name is required.');

                const exists = batch.structuralMaterialLibrary.some((item) => item.active !== false
                    && String(item.material || '').trim().toLowerCase() === material.toLowerCase());
                if (exists) throw new Error('This structural material already exists in the Batch library.');

                batch.structuralMaterialLibrary.push({
                    id: this.makeNonICTALibraryItemId('struct'),
                    material,
                    active: true
                });
                await this.persistNonICTAMaterialLibraryChange('✅ Structural material added');
            }
        });
    },

    renameNonICTAStructuralMaterial(materialId) {
        const batch = this.data.currentBatch;
        if (!batch) return;
        this.ensureNonICTAMaterialLibraries(batch);
        const item = batch.structuralMaterialLibrary.find((entry) => String(entry.id) === String(materialId));
        if (!item) return;
        this.showFormModal({
            id: 'renameStructuralMaterialModal',
            title: 'Rename Structural Material',
            confirmText: 'Save',
            fields: [
                { id: 'renameStructuralMaterialName', label: 'Material Name', type: 'text', value: item.material || '', required: true }
            ],
            onConfirm: async (values) => {
                const nextMaterial = String(values.renameStructuralMaterialName || '').trim();
                if (!nextMaterial || nextMaterial === item.material) return;
                item.material = nextMaterial;
                await this.persistNonICTAMaterialLibraryChange('✅ Structural material renamed');
            }
        });
    },

    async removeNonICTAStructuralMaterial(materialId) {
        const batch = this.data.currentBatch;
        if (!batch) return;
        this.ensureNonICTAMaterialLibraries(batch);
        const item = batch.structuralMaterialLibrary.find((entry) => String(entry.id) === String(materialId));
        if (!item) return;
        if (!confirm(`Remove "${item.material}" from future Daily Records? Historical records will remain linked.`)) return;
        item.active = false;
        await this.persistNonICTAMaterialLibraryChange('✅ Structural material removed from active library');
    },

    updateNonICTAMaintenanceTotals() {
        if (this.isICTAUser()) return;
        const batch = this.data.currentBatch;
        if (!batch) return;

        const foodRows = Array.from(document.querySelectorAll('#nonIctaFoodWasteRows .nonicta-library-row'));
        const regularOrganicWaste = foodRows.reduce((s, row) => {
            const amountEl = row.querySelector('.nonicta-food-amount');
            const n = (amountEl && amountEl.value !== '') ? parseFloat(amountEl.value) : 0;
            return s + (isNaN(n) ? 0 : n);
        }, 0);

        const structRows = Array.from(document.querySelectorAll('#nonIctaStructuralRows .nonicta-library-row'));
        const regularStructuralMaterial = structRows.reduce((s, row) => {
            const amountEl = row.querySelector('.nonicta-struct-amount');
            const n = (amountEl && amountEl.value !== '') ? parseFloat(amountEl.value) : 0;
            return s + (isNaN(n) ? 0 : n);
        }, 0);

        const additionalRows = Array.from(document.querySelectorAll('#maintenanceAdditionalInputsList .maintenance-additional-row'));
        const additionalInputs = additionalRows.map((row) => {
            const type = row.querySelector('input[type="radio"]:checked')?.value || 'organic';
            const amountEl = row.querySelector('.maintenance-additional-amount');
            const n = (amountEl && amountEl.value !== '') ? parseFloat(amountEl.value) : 0;
            return { type, amount: isNaN(n) ? 0 : n };
        });
        const additionalTotals = this.calculateAdditionalInputTotals(additionalInputs);
        const totalOrganicWaste = regularOrganicWaste + additionalTotals.additionalOrganicMaterial;
        const totalStructuralMaterial = regularStructuralMaterial + additionalTotals.additionalStructuralMaterial;
        const totalMaterialInput = totalOrganicWaste + totalStructuralMaterial;

        const regularOrganicWasteEl = document.getElementById('regularOrganicWaste');
        const regularStructuralEl = document.getElementById('regularStructuralMaterial');
        const additionalOrganicEl = document.getElementById('additionalOrganicMaterial');
        const additionalStructuralEl = document.getElementById('additionalStructuralMaterial');
        const totalAdditionalEl = document.getElementById('totalAdditionalInput');
        const totalOrganicWasteEl = document.getElementById('totalOrganicWaste');
        const totalStructuralOverallEl = document.getElementById('totalStructuralMaterialOverall');
        const totalMaterialInputEl = document.getElementById('totalMaterialInput');
        if (regularOrganicWasteEl) regularOrganicWasteEl.textContent = this.formatNumber(regularOrganicWaste, 3);
        if (regularStructuralEl) regularStructuralEl.textContent = this.formatNumber(regularStructuralMaterial, 3);
        if (additionalOrganicEl) additionalOrganicEl.textContent = this.formatNumber(additionalTotals.additionalOrganicMaterial, 3);
        if (additionalStructuralEl) additionalStructuralEl.textContent = this.formatNumber(additionalTotals.additionalStructuralMaterial, 3);
        if (totalAdditionalEl) totalAdditionalEl.textContent = this.formatNumber(additionalTotals.totalAdditionalInput, 3);
        if (totalOrganicWasteEl) totalOrganicWasteEl.textContent = this.formatNumber(totalOrganicWaste, 3);
        if (totalStructuralOverallEl) totalStructuralOverallEl.textContent = this.formatNumber(totalStructuralMaterial, 3);
        if (totalMaterialInputEl) totalMaterialInputEl.textContent = this.formatNumber(totalMaterialInput, 3);
        this.refreshDailyRecordModuleCompletionStates();
    },

    toggleICTAActionTakenModule() {
        const content = document.getElementById('actionTakenContent');
        const icon = document.getElementById('actionTakenToggleIcon');
        const text = document.getElementById('actionTakenToggleText');
        if (!content || !icon || !text) return;
        const isHidden = content.style.display === 'none' || content.style.display === '';
        content.style.display = isHidden ? 'block' : 'none';
        icon.textContent = isHidden ? '▾' : '▸';
        this.syncModuleToggleText(text, 'Action Taken');
    },

    updateICTAActionTakenVisibility() {
        const chips = Array.from(document.querySelectorAll('.action-chip'));
        chips.forEach((chip) => {
            const cb = chip.querySelector('input[type="checkbox"]');
            if (cb && cb.checked) chip.classList.add('selected');
            else chip.classList.remove('selected');
        });

        const addedWater = !!document.getElementById('actionAddedWater')?.checked;
        const removedImpurities = !!document.getElementById('actionRemovedImpurities')?.checked;
        const other = !!document.getElementById('actionOther')?.checked;

        const waterFields = document.getElementById('actionWaterFields');
        const removedFields = document.getElementById('actionRemovedFields');
        const otherFields = document.getElementById('actionOtherFields');

        if (waterFields) waterFields.style.display = addedWater ? 'block' : 'none';
        if (removedFields) removedFields.style.display = removedImpurities ? 'block' : 'none';
        if (otherFields) otherFields.style.display = other ? 'block' : 'none';

        if (!addedWater) {
            const amount = document.getElementById('waterAddedAmount');
            if (amount) amount.value = '';
        }
        if (!removedImpurities) {
            const desc = document.getElementById('removedImpuritiesDescription');
            if (desc) desc.value = '';
        }
        if (!other) {
            const desc = document.getElementById('otherActionDescription');
            if (desc) desc.value = '';
        }
        this.refreshDailyRecordModuleCompletionStates();
    },

    toggleICTAMaterialTransferModule() {
        const content = document.getElementById('materialTransferModuleContent');
        const icon = document.getElementById('materialTransferToggleIcon');
        const text = document.getElementById('materialTransferToggleText');
        if (!content || !icon || !text) return;
        const isHidden = content.style.display === 'none' || content.style.display === '';
        content.style.display = isHidden ? 'block' : 'none';
        icon.textContent = isHidden ? '▾' : '▸';
        this.syncModuleToggleText(text, 'Material Transfer');
        if (isHidden) this.updateMaterialTransferVisibility();
    },

    updateMaterialTransferVisibility() {
        const performed = document.querySelector('input[name="materialTransferPerformed"]:checked')?.value === 'yes';
        const fields = document.getElementById('materialTransferFields');
        const unitInput = document.getElementById('materialTransferUnit');
        const sourceBatchSelect = document.getElementById('materialTransferSourceBatchId');
        const sourceComposterSelect = document.getElementById('materialTransferSourceComposterId');
        const destinationBatchSelect = document.getElementById('materialTransferDestinationBatchId');
        const destinationComposterSelect = document.getElementById('materialTransferDestinationComposterId');
        const transferDateInput = document.getElementById('materialTransferDate');
        const recordDateInput = document.getElementById('recordDate');
        const inputUnit = this.getBatchInputUnitName(this.data.currentBatch);

        if (fields) fields.style.display = performed ? 'block' : 'none';
        if (unitInput) unitInput.value = inputUnit;

        if (transferDateInput && performed && !transferDateInput.value) {
            transferDateInput.value = recordDateInput?.value || '';
        }

        const updateComposterSelect = (batchSelect, composterSelect) => {
            if (!batchSelect || !composterSelect) return;
            const selectedValue = composterSelect.value || '';
            composterSelect.innerHTML = this.renderTransferComposterOptions(batchSelect.value, selectedValue);
        };

        updateComposterSelect(sourceBatchSelect, sourceComposterSelect);
        updateComposterSelect(destinationBatchSelect, destinationComposterSelect);
        this.refreshDailyRecordModuleCompletionStates();
    },

    syncMaterialTransferDateWithRecordDate() {
        const recordDate = document.getElementById('recordDate')?.value || '';
        const transferDateInput = document.getElementById('materialTransferDate');
        if (!transferDateInput) return;
        const previousRecordDate = transferDateInput.dataset.recordDate || '';
        if (!transferDateInput.value || transferDateInput.value === previousRecordDate) {
            transferDateInput.value = recordDate;
        }
        transferDateInput.dataset.recordDate = recordDate;
        this.refreshDailyRecordModuleCompletionStates();
    },

    toggleBatchTransferHistory() {
        this.data.batchTransferHistoryExpanded = !this.data.batchTransferHistoryExpanded;
        this.render();
    },

    toggleICTAPhotoUploadModule() {
        const content = document.getElementById('photoUploadContent');
        const icon = document.getElementById('photoUploadToggleIcon');
        const text = document.getElementById('photoUploadToggleText');
        if (!content || !icon || !text) return;
        const isHidden = content.style.display === 'none' || content.style.display === '';
        content.style.display = isHidden ? 'block' : 'none';
        icon.textContent = isHidden ? '▾' : '▸';
        this.syncModuleToggleText(text, 'Photo Upload');
        if (isHidden) this.updateICTAPhotoGridDom();
    },

    toggleICTANotesModule() {
        const content = document.getElementById('ictaNotesContent');
        const icon = document.getElementById('ictaNotesToggleIcon');
        const text = document.getElementById('ictaNotesToggleText');
        if (!content || !icon || !text) return;
        const isHidden = content.style.display === 'none' || content.style.display === '';
        content.style.display = isHidden ? 'block' : 'none';
        icon.textContent = isHidden ? '▾' : '▸';
        this.syncModuleToggleText(text, 'Notes (Optional)');
    },

    openICTAPhotoPicker(type) {
        this.data.ictaPhotoReplaceIndex = null;
        const input = type === 'take'
            ? document.getElementById('ictaTakePhotoInput')
            : type === 'upload'
                ? document.getElementById('ictaUploadPhotoInput')
                : document.getElementById('ictaChooseFileInput');
        if (!input) return;
        input.click();
    },

    openICTAPhotoReplace(index) {
        this.data.ictaPhotoReplaceIndex = Number.isFinite(index) ? index : null;
        const input = document.getElementById('ictaReplacePhotoInput');
        if (!input) return;
        input.click();
    },

    async handleICTAPhotoFiles(files) {
        if (!Array.isArray(this.data.ictaPhotoDraft)) this.data.ictaPhotoDraft = [];
        const validFiles = files.filter((file) => {
            const type = String(file?.type || '').toLowerCase();
            return type === 'image/jpeg' || type === 'image/jpg' || type === 'image/png';
        });
        if (validFiles.length !== files.length) {
            alert('Only JPG, JPEG, and PNG files are supported.');
        }
        const remaining = Math.max(0, 9 - this.data.ictaPhotoDraft.length);
        const picked = validFiles.slice(0, remaining);
        if (validFiles.length > remaining) {
            alert(`You can upload up to 9 photos. Only ${remaining} more photo(s) can be added.`);
        }
        for (const file of picked) {
            const dataUrl = await this.convertImageFileToDataUrl(file);
            if (!dataUrl) continue;
            this.data.ictaPhotoDraft.push(dataUrl);
        }
        this.data.ictaPhotoDraft = this.data.ictaPhotoDraft.slice(0, 9);
        this.updateICTAPhotoGridDom();
    },

    async handleICTAReplacePhotoFiles(files) {
        if (!Array.isArray(this.data.ictaPhotoDraft)) this.data.ictaPhotoDraft = [];
        const idx = this.data.ictaPhotoReplaceIndex;
        if (idx == null || idx < 0 || idx >= this.data.ictaPhotoDraft.length) {
            await this.handleICTAPhotoFiles(files);
            return;
        }
        const file = files[0];
        if (!file) return;
        const type = String(file.type || '').toLowerCase();
        if (!(type === 'image/jpeg' || type === 'image/jpg' || type === 'image/png')) {
            alert('Only JPG, JPEG, and PNG files are supported.');
            return;
        }
        const dataUrl = await this.convertImageFileToDataUrl(file);
        if (!dataUrl) return;
        this.data.ictaPhotoDraft[idx] = dataUrl;
        this.updateICTAPhotoGridDom();
    },

    async convertImageFileToDataUrl(file) {
        if (!file) return null;
        const type = (file.type || '').toLowerCase();
        if (!(type === 'image/jpeg' || type === 'image/jpg' || type === 'image/png')) return null;
        const dataUrl = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(file);
        });
        if (!dataUrl) return null;
        const img = await new Promise((resolve) => {
            const i = new Image();
            i.onload = () => resolve(i);
            i.onerror = () => resolve(null);
            i.src = dataUrl;
        });
        if (!img) return null;

        const maxDim = 1280;
        const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
        const w = Math.max(1, Math.round((img.width || 1) * scale));
        const h = Math.max(1, Math.round((img.height || 1) * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return dataUrl;
        ctx.drawImage(img, 0, 0, w, h);

        const outType = type === 'image/png' ? 'image/png' : 'image/jpeg';
        const out = outType === 'image/jpeg'
            ? canvas.toDataURL(outType, 0.85)
            : canvas.toDataURL(outType);
        return out || dataUrl;
    },

    updateICTAPhotoGridDom() {
        const grid = document.getElementById('ictaPhotoGrid');
        if (!grid) return;
        const photos = Array.isArray(this.data.ictaPhotoDraft) ? this.data.ictaPhotoDraft : [];
        grid.innerHTML = this.renderICTAPhotoGridHtml(photos);
        this.refreshDailyRecordModuleCompletionStates();
    },

    viewICTAPhoto(index) {
        const photos = Array.isArray(this.data.ictaPhotoDraft) ? this.data.ictaPhotoDraft : [];
        const src = this.getPhotoPreviewSrc(photos[index]);
        if (!src) return;
        const body = `<img src="${src}" alt="Photo ${index + 1}" style="max-width: 100%; border-radius: 12px;">`;
        this.showInfoModal(`Photo ${index + 1}`, body);
    },

    deleteICTAPhoto(index) {
        if (!Array.isArray(this.data.ictaPhotoDraft)) return;
        this.data.ictaPhotoDraft.splice(index, 1);
        this.updateICTAPhotoGridDom();
    },

    showOrganicStructuralRatioGuide() {
        const body = `
            <div style="line-height: 1.8;">
                <div style="font-weight: 700; margin-bottom: 8px;">Recommended Ratio</div>
                <div style="margin-bottom: 14px;">
                    <div style="color: var(--gray);">Food Waste : Structural Material</div>
                    <div style="font-weight: 700;">Recommended: 2 : 1 to 1 : 1</div>
                </div>
                <div style="font-weight: 700; margin-bottom: 8px;">Example</div>
                <div style="margin-bottom: 10px;">2 buckets food waste + 1 bucket structural material = <strong>2 : 1</strong></div>
                <div>1 bucket food waste + 1 bucket structural material = <strong>1 : 1</strong></div>
            </div>
        `;
        this.showInfoModal('ⓘ Organic : Structural Ratio Guide', body);
    },

    showTemperatureGuide(type) {
        const labelMap = {
            core: 'Core Temperature',
            transition: 'Transition Temperature',
            outer: 'Outer Temperature'
        };
        const title = `How to Measure ${labelMap[type] || 'Temperature'}`;
        const guideImgMap = {
            core: 'assets/temperature-guides/core.jpg',
            transition: 'assets/temperature-guides/transition.jpg',
            outer: 'assets/temperature-guides/outer.jpg'
        };
        const guideSrc = guideImgMap[type] || '';
        const illustration = guideSrc
            ? `
                <div class="temperature-guide-illustration">
                    <img class="temperature-guide-image" src="${guideSrc}" alt="${labelMap[type] || 'Temperature'} guide image" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
                    <div style="display:none;">${this.renderMonitoringPlaceholder('Thermometer insertion into compost pile')}</div>
                </div>
            `
            : this.renderMonitoringPlaceholder('Thermometer insertion into compost pile');
        const body = `
            <div style="margin-bottom: 16px;">
                <div style="font-weight: 700; margin-bottom: 8px;">Illustration:</div>
                ${illustration}
            </div>
            <div style="font-weight: 700; margin-bottom: 8px;">Procedure</div>
            <ol style="padding-left: 20px; line-height: 1.7;">
                <li>Insert the thermometer into the compost pile.</li>
                <li>Ensure a depth of approximately 30–50 cm.</li>
                <li>Wait at least 2 minutes.</li>
                <li>Measure temperature before turning or mixing the compost.</li>
            </ol>
        `;
        this.showInfoModal(title, body);
    },

    showOdourGuide() {
        const body = `
            <div style="line-height: 1.8;">
                <div style="margin-bottom: 12px; color: var(--gray);">
                    Estimated detection distance under normal outdoor conditions (without strong wind).
                </div>
                <div style="margin-bottom: 10px;">• <strong>Detected &lt;1 m:</strong><br>Odour only noticeable close to the composter.</div>
                <div style="margin-bottom: 10px;">• <strong>Detected 1–5 m:</strong><br>Odour detectable around the composting area.</div>
                <div>• <strong>Detected &gt;5 m:</strong><br>Strong odour detectable at a considerable distance.</div>
            </div>
        `;
        this.showInfoModal('🌿 Odour Assessment Guide', body);
    },

    showMaintenanceSummaryInfo(title, description) {
        const body = `
            <div style="line-height: 1.75;">
                <div style="font-weight: 700; margin-bottom: 8px;">How this value is calculated</div>
                <div style="color: var(--gray);">${description}</div>
            </div>
        `;
        this.showInfoModal(`ⓘ ${title}`, body);
    },

    showInfoModal(title, bodyHtml) {
        this.closeInfoModal();
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.id = 'infoModal';
        modal.innerHTML = `
            <div class="modal" style="max-width: 640px;">
                <div class="modal-header">
                    <h2 class="modal-title">${title}</h2>
                </div>
                <div class="modal-body">${bodyHtml}</div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="app.closeInfoModal()">Close</button>
                </div>
            </div>
        `;
        modal.addEventListener('click', (event) => {
            if (event.target === modal) this.closeInfoModal();
        });
        document.body.appendChild(modal);
    },

    closeInfoModal() {
        const modal = document.getElementById('infoModal');
        if (modal) modal.remove();
    },

    showConfirmModal(options = {}) {
        const {
            id = 'confirmModal',
            title = 'Confirm',
            message = '',
            confirmText = 'Confirm',
            cancelText = 'Cancel',
            confirmClass = 'btn btn-danger',
            cancelClass = 'btn btn-secondary',
            onConfirm = null,
            onCancel = null
        } = options;

        const existing = document.getElementById(id);
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.id = id;
        modal.innerHTML = `
            <div class="modal" style="max-width: 520px;">
                <div class="modal-header">
                    <h2 class="modal-title">${title}</h2>
                </div>
                <div class="modal-body">${message}</div>
                <div class="modal-footer">
                    <button class="${cancelClass}" data-role="cancel">${cancelText}</button>
                    <button class="${confirmClass}" data-role="confirm">${confirmText}</button>
                </div>
            </div>
        `;

        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                modal.remove();
                if (typeof onCancel === 'function') onCancel();
            }
        });

        const cancelBtn = modal.querySelector('[data-role="cancel"]');
        const confirmBtn = modal.querySelector('[data-role="confirm"]');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                modal.remove();
                if (typeof onCancel === 'function') onCancel();
            });
        }
        if (confirmBtn) {
            confirmBtn.addEventListener('click', () => {
                modal.remove();
                if (typeof onConfirm === 'function') onConfirm();
            });
        }

        document.body.appendChild(modal);
    },

    showFormModal(options = {}) {
        const {
            id = 'formModal',
            title = 'Input',
            fields = [],
            confirmText = 'Save',
            cancelText = 'Cancel',
            confirmClass = 'btn btn-primary',
            cancelClass = 'btn btn-secondary',
            onConfirm = null,
            onCancel = null,
            onAfterOpen = null
        } = options;

        try {
            document.querySelectorAll('.modal-overlay').forEach((el) => el.remove());
        } catch (error) {
        }

        const existing = document.getElementById(id);
        if (existing) existing.remove();

        const renderField = (field) => {
            const fieldId = String(field?.id || '');
            const label = String(field?.label || '');
            const type = String(field?.type || 'text');
            const value = field?.value != null ? String(field.value) : '';
            const placeholder = field?.placeholder != null ? String(field.placeholder) : '';
            const required = field?.required === true;
            const helpText = field?.helpText != null ? String(field.helpText) : '';
            const hidden = field?.hidden === true;
            const optionsList = Array.isArray(field?.options) ? field.options : [];
            const optionsHtml = optionsList.map((opt) => {
                const raw = String(opt);
                return `<option value="${this.escapeAttr(raw)}" ${raw === value ? 'selected' : ''}>${this.escapeHtml(raw)}</option>`;
            }).join('');

            const control = type === 'select'
                ? `<select class="form-input" id="${this.escapeAttr(fieldId)}" ${required ? 'required' : ''}>
                        <option value="">Select...</option>
                        ${optionsHtml}
                   </select>`
                : `<input class="form-input" id="${this.escapeAttr(fieldId)}" type="${this.escapeAttr(type)}" value="${this.escapeAttr(value)}" placeholder="${this.escapeAttr(placeholder)}" ${required ? 'required' : ''}>`;

            return `
                <div class="form-group" data-field-id="${this.escapeAttr(fieldId)}" style="${hidden ? 'display:none;' : ''}">
                    <label class="form-label ${required ? 'required' : ''}" for="${this.escapeAttr(fieldId)}">${this.escapeHtml(label)}</label>
                    ${helpText ? `<div style="margin-bottom: 8px; color: var(--gray); font-size: 0.9rem;">${this.escapeHtml(helpText)}</div>` : ''}
                    ${control}
                </div>
            `;
        };

        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.id = id;
        modal.innerHTML = `
            <div class="modal" style="max-width: 560px;">
                <div class="modal-header">
                    <h2 class="modal-title">${this.escapeHtml(title)}</h2>
                </div>
                <div class="modal-body">
                    <form id="${this.escapeAttr(id)}Form">
                        ${fields.map(renderField).join('')}
                        <div class="modal-footer" style="padding: 0; border-top: none; justify-content: flex-end; gap: 10px;">
                            <button type="button" class="${this.escapeAttr(cancelClass)}" data-role="cancel">${this.escapeHtml(cancelText)}</button>
                            <button type="submit" class="${this.escapeAttr(confirmClass)}" data-role="confirm">${this.escapeHtml(confirmText)}</button>
                        </div>
                    </form>
                </div>
            </div>
        `;

        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                modal.remove();
                if (typeof onCancel === 'function') onCancel();
            }
        });

        const form = modal.querySelector('form');
        const cancelBtn = modal.querySelector('[data-role="cancel"]');
        const confirmBtn = modal.querySelector('[data-role="confirm"]');

        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                modal.remove();
                if (typeof onCancel === 'function') onCancel();
            });
        }

        if (form) {
            form.addEventListener('submit', async (event) => {
                event.preventDefault();
                const values = {};
                for (const field of fields) {
                    const fieldId = String(field?.id || '');
                    if (!fieldId) continue;
                    const el = document.getElementById(fieldId);
                    const value = el ? String(el.value || '').trim() : '';
                    values[fieldId] = value;
                    if (field?.required && !value) {
                        alert(`Please fill in: ${field?.label || fieldId}`);
                        return;
                    }
                }

                if (typeof onConfirm !== 'function') {
                    modal.remove();
                    return;
                }

                try {
                    if (confirmBtn) confirmBtn.disabled = true;
                    await onConfirm(values);
                    modal.remove();
                } catch (error) {
                    alert(error?.message || 'Operation failed. Please try again.');
                    if (confirmBtn) confirmBtn.disabled = false;
                }
            });
        }

        document.body.appendChild(modal);
        if (typeof onAfterOpen === 'function') {
            try {
                onAfterOpen(modal);
            } catch (error) {
            }
        }

        const firstId = fields.find((f) => f?.id)?.id;
        if (firstId) {
            try {
                const rawId = String(firstId);
                const escaped = (window.CSS && typeof window.CSS.escape === 'function')
                    ? window.CSS.escape(rawId)
                    : rawId.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
                const firstEl = modal.querySelector(`#${escaped}`);
                if (firstEl && typeof firstEl.focus === 'function') firstEl.focus();
            } catch (error) {
            }
        }
    },

    showTransientSuccessMessage(message, duration = 2300) {
        const existing = document.getElementById('transientSuccessMessage');
        if (existing) existing.remove();
        const toast = document.createElement('div');
        toast.id = 'transientSuccessMessage';
        toast.className = 'transient-success-message';
        toast.textContent = message;
        document.body.appendChild(toast);
        window.setTimeout(() => {
            const current = document.getElementById('transientSuccessMessage');
            if (current) current.remove();
        }, duration);
    },

    confirmCancelDailyRecord(batchId) {
        this.showConfirmModal({
            id: 'discardDailyRecordModal',
            title: 'Discard Changes?',
            message: 'Any unsaved changes will be lost.<br>Are you sure you want to leave this page?',
            confirmText: 'Yes, Discard',
            cancelText: 'No, Continue Editing',
            confirmClass: 'btn btn-danger',
            cancelClass: 'btn btn-secondary',
            onConfirm: () => this.navigate('batchDetail', { batchId })
        });
    },

    toggleContaminantDetail(type) {
        const checkbox = document.getElementById(`contaminant${type.charAt(0).toUpperCase()}${type.slice(1)}`);
        const detail = document.getElementById(`contaminant${type.charAt(0).toUpperCase()}${type.slice(1)}Detail`);
        if (!checkbox || !detail) return;
        if (checkbox.checked) {
            detail.style.display = 'block';
        } else {
            detail.style.display = 'none';
            detail.value = '';
        }
    },

    async handleForgotPassword() {
        const email = document.getElementById('loginEmail')?.value.trim() || '';
        if (!email) {
            alert('Please enter your email first, then click Forgot Password.');
            return;
        }
        try {
            await firebaseAuth.sendPasswordResetEmail(email);
            alert('Password reset email sent. Please check your inbox.');
        } catch (error) {
            alert(error.message || 'Failed to send password reset email');
        }
    },

    async handleRegisterSubmit() {
        if (this.data.authSubmitting) return;
        const organization = document.getElementById('registerOrganization')?.value.trim() || '';
        const communityType = document.querySelector('input[name="registerCommunityType"]:checked')?.value || '';
        const communityTypeOther = document.getElementById('registerCommunityTypeOther')?.value.trim() || '';
        const email = this.normalizeEmail(document.getElementById('registerEmail')?.value);
        const password = document.getElementById('registerPassword')?.value || '';
        const confirmPassword = document.getElementById('registerConfirmPassword')?.value || '';
        if (!organization || !communityType || !email || !password || !confirmPassword) {
            alert('Please fill in all required fields');
            return;
        }
        if (communityType === 'Other' && !communityTypeOther) {
            alert('Please specify your Community Type');
            return;
        }
        if (password !== confirmPassword) {
            alert('Passwords do not match');
            return;
        }
        this.data.authSubmitting = true;
        const submitBtn = document.querySelector('#registerForm button[type="submit"]');
        if (submitBtn) submitBtn.disabled = true;
        try {
            await this.registerUser(email, password, {
                organization,
                communityType,
                communityTypeOther: communityType === 'Other' ? communityTypeOther : ''
            });
        } finally {
            this.data.authSubmitting = false;
            if (submitBtn) submitBtn.disabled = false;
        }
    },

    async registerUser(email, password, profile) {
        try {
            const credential = await firebaseAuth.createUserWithEmailAndPassword(email, password);
            const uid = credential?.user?.uid;
            if (uid) await this.saveUserProfile(uid, profile);
            alert('Register successful');
        } catch (error) {
            const code = error?.code || '';
            if (code === 'auth/email-already-in-use') {
                let methods = null;
                try {
                    methods = await firebaseAuth.fetchSignInMethodsForEmail(this.normalizeEmail(email));
                } catch (e) {
                    methods = null;
                }
                const details = (methods && methods.length > 0) ? `\nSign-in methods: ${methods.join(', ')}` : '';
                alert(`This email is already registered.\nEmail: ${email}${details}\n\nPlease go back to Login or use Forgot Password.`);
                return;
            }
            alert(`${error?.message || 'Register failed'}${code ? ` (${code})` : ''}${email ? `\nEmail: ${email}` : ''}`);
        }
    },

    async loginUser(email, password) {
        try {
            const persistence = this.data.rememberMe
                ? firebase.auth.Auth.Persistence.LOCAL
                : firebase.auth.Auth.Persistence.SESSION;
            await firebaseAuth.setPersistence(persistence);
            await firebaseAuth.signInWithEmailAndPassword(this.normalizeEmail(email), password);
        } catch (error) {
            const code = error?.code || '';
            const normalizedEmail = this.normalizeEmail(email);

            if (code === 'auth/invalid-credential' || code === 'auth/user-not-found' || code === 'auth/wrong-password') {
                let methods = null;
                try {
                    methods = await firebaseAuth.fetchSignInMethodsForEmail(normalizedEmail);
                } catch (e) {
                    methods = null;
                }
                if (!methods) {
                    alert(`Login failed.\nEmail: ${normalizedEmail}\n\nUnable to verify account status right now. Please check your network / Firebase configuration, then try again. You can also click Forgot Password.`);
                    return;
                }
                if (methods.length === 0) {
                    alert(`No account found for:\n${normalizedEmail}\n\nPlease Register first.`);
                    return;
                }
                if (!methods.includes('password')) {
                    alert(`This email is registered, but not with a password.\nEmail: ${normalizedEmail}\nSign-in methods: ${methods.join(', ')}\n\nPlease use the correct sign-in method for this account.`);
                    return;
                }
                alert(`Incorrect email or password.\nEmail: ${normalizedEmail}\n\nTry again, or click Forgot Password.`);
                return;
            }

            if (code === 'auth/too-many-requests') {
                alert('Too many attempts. Please wait a bit and try again, or use Forgot Password.');
                return;
            }

            alert(`${error?.message || 'Login failed'}${code ? ` (${code})` : ''}${normalizedEmail ? `\nEmail: ${normalizedEmail}` : ''}`);
        }
    },

    async logoutUser() {
        try {
            await firebaseAuth.signOut();
        } catch (error) {
            alert(error.message || 'Logout failed');
        }
    },

    async saveBatch() {
        const batchId = document.getElementById('batchId').value.trim();
        const startDate = document.getElementById('startDate').value;
        const manager = document.getElementById('manager').value.trim();
        const location = document.getElementById('location').value.trim();
        const notes = document.getElementById('notes').value.trim();
        const inputMethod = document.querySelector('input[name="inputMethod"]:checked')?.value || '';

        if (!batchId || !startDate || !manager || !inputMethod) {
            alert('Please fill in all required fields');
            return;
        }

        let measurementSettings = null;
        if (inputMethod === 'weight') {
            measurementSettings = { inputMethod: 'weight', unitName: 'kg', bucketSizeL: null, bucketConversionEnabled: false, customUnitName: '' };
        } else if (inputMethod === 'volume') {
            const bucketSizeValue = document.querySelector('input[name="bucketSize"]:checked')?.value || '2';
            const customBucketSizeL = document.getElementById('customBucketSizeL')?.value;
            let bucketSizeL = null;
            if (bucketSizeValue === 'custom') {
                bucketSizeL = (customBucketSizeL !== '' && customBucketSizeL != null) ? parseFloat(customBucketSizeL) : null;
            } else {
                bucketSizeL = parseFloat(bucketSizeValue);
            }
            if (bucketSizeL == null || isNaN(bucketSizeL) || bucketSizeL <= 0) {
                alert('Please enter a valid Bucket Size (L)');
                return;
            }
            measurementSettings = { inputMethod: 'volume', unitName: 'L', bucketSizeL, bucketConversionEnabled: false, customUnitName: '' };
        } else if (inputMethod === 'other') {
            const customUnitName = document.getElementById('customUnitName')?.value.trim() || '';
            if (!customUnitName) {
                alert('Please enter Custom Unit Name');
                return;
            }
            measurementSettings = { inputMethod: 'other', unitName: customUnitName, bucketSizeL: null, bucketConversionEnabled: false, customUnitName };
        } else {
            alert('Please select an Input Method');
            return;
        }

        const numCompostersEl = document.getElementById('numComposters');
        let numberOfCompostersUsed = numCompostersEl ? parseInt(numCompostersEl.value, 10) : 2;
        if (isNaN(numberOfCompostersUsed) || numberOfCompostersUsed < 1) numberOfCompostersUsed = 1;
        if (numberOfCompostersUsed > 50) numberOfCompostersUsed = 50;
        const composters = Array.from({ length: numberOfCompostersUsed }, (_, idx) => {
            const i = idx + 1;
            const idEl = document.getElementById(`composterId_${i}`);
            const capEl = document.getElementById(`composterCap_${i}`);
            const composterId = idEl ? (idEl.value || '').trim() : '';
            const capacityL = capEl && capEl.value !== '' ? parseFloat(capEl.value) : null;
            return {
                composterId: composterId || String(i),
                capacityL: (capacityL != null && !isNaN(capacityL) && capacityL >= 0) ? capacityL : null
            };
        });
        const compostingSystemInformation = { numberOfCompostersUsed, composters };

        const collaborationType = document.querySelector('input[name="collaborationType"]:checked')?.value || 'private';
        const collaboratorsRaw = document.getElementById('collaboratorsEmails')?.value || '';
        const ownerEmail = this.normalizeEmail(this.data.currentUser?.email || '');
        const collaborators = collaborationType === 'shared'
            ? this.normalizeCollaboratorEmails(
                collaboratorsRaw
                    .split(/[,\n;]+/)
                    .map((s) => s.trim())
                    .filter(Boolean)
            ).filter((email) => email !== ownerEmail)
            : [];
        const invalid = collaborators.filter(e => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
        if (invalid.length > 0) {
            alert(`Invalid email(s): ${invalid.join(', ')}`);
            return;
        }
        const collaborationSettings = {
            type: collaborationType,
            collaborators
        };

        const initialStockSelected = document.querySelector('input[name="initialStockExists"]:checked')?.value || 'no';
        const hasInitialStock = initialStockSelected === 'yes';
        const initialStockCards = Array.from(document.querySelectorAll('#initialStockMaterialsList .initial-stock-material-card'));
        let initialStockMaterials = [];
        if (hasInitialStock) {
            if (initialStockCards.length === 0) {
                alert('Please add at least one existing material to the Initial Composting Stock section.');
                return;
            }
            try {
                initialStockMaterials = initialStockCards.map((card, index) => {
                    const materialType = card.querySelector('.initial-stock-material-type')?.value || '';
                    const materialDescription = (card.querySelector('.initial-stock-material-description')?.value || '').trim();
                    const materialWeightRaw = card.querySelector('.initial-stock-material-weight')?.value;
                    const approximateHeightRaw = card.querySelector('.initial-stock-material-height')?.value;
                    const composterId = (card.querySelector('.initial-stock-composter')?.value || '').trim();
                    const notes = (card.querySelector('.initial-stock-material-notes')?.value || '').trim();
                    const purpose = materialType === 'Structural Material'
                        ? (card.querySelector('.initial-stock-purpose')?.value || '')
                        : '';
                    const materialWeight = materialWeightRaw != null && String(materialWeightRaw).trim() !== '' ? parseFloat(materialWeightRaw) : NaN;
                    const approximateHeightCm = approximateHeightRaw != null && String(approximateHeightRaw).trim() !== '' ? parseFloat(approximateHeightRaw) : NaN;

                    if (!materialType) throw new Error(`Please select Material Type for Material ${index + 1}.`);
                    if (materialType === 'Other' && !materialDescription) throw new Error(`Please enter Material Description for Material ${index + 1}.`);
                    if (isNaN(materialWeight) || materialWeight < 0) throw new Error(`Please enter a valid Material Weight (${measurementSettings.unitName}) for Material ${index + 1}.`);
                    if (isNaN(approximateHeightCm) || approximateHeightCm < 0) throw new Error(`Please enter a valid Approximate Material Height (cm) for Material ${index + 1}.`);
                    if (!composterId) throw new Error(`Please select the Composter for Material ${index + 1}.`);

                    return {
                        id: card.getAttribute('data-material-id') || `initial-stock-${Date.now()}-${index + 1}`,
                        materialType,
                        materialDescription: materialType === 'Other' ? materialDescription : '',
                        materialWeight,
                        approximateHeightCm,
                        composterId,
                        notes,
                        purpose
                    };
                });
            } catch (error) {
                alert(error?.message || 'Please review the Initial Composting Stock section.');
                return;
            }
        }
        const initialStock = {
            exists: hasInitialStock,
            materials: initialStockMaterials
        };

        const conversionRateMode = document.querySelector('input[name="conversionRateMode"]:checked')?.value || 'default';
        const monitoringProtocol = document.querySelector('input[name="monitoringProtocol"]:checked')?.value || 'basic';
        const customConversionRateRaw = document.getElementById('customConversionRate')?.value;
        let compostConversionRate = 0.36;
        if (conversionRateMode === 'custom') {
            const parsed = customConversionRateRaw != null && String(customConversionRateRaw).trim() !== '' ? parseFloat(customConversionRateRaw) : NaN;
            if (isNaN(parsed) || parsed < 0) {
                alert('Please enter a valid Conversion Rate (%)');
                return;
            }
            compostConversionRate = parsed / 100;
        }
        const settings = {
            useCustomConversionRate: conversionRateMode === 'custom',
            compostConversionRate,
            monitoringProtocol: monitoringProtocol === 'advanced' ? 'advanced' : 'basic'
        };

        const existingIndex = this.data.batches.findIndex((b) => (
            String(b.id || '') === batchId && (this.isBatchOwner(b) || !b.ownerUid)
        ));
        if (existingIndex >= 0 && this.data.editingBatch === null) {
            alert('Batch ID already exists. Please use a unique ID.');
            return;
        }

        const previousBatch = this.data.editingBatch !== null ? this.data.batches[this.data.editingBatch] : null;
        const batch = {
            id: batchId,
            startDate,
            manager,
            location,
            notes,
            measurementSettings,
            settings,
            initialStock,
            compostingSystemInformation,
            foodWasteLibrary: Array.isArray(previousBatch?.foodWasteLibrary) ? previousBatch.foodWasteLibrary : [],
            structuralMaterialLibrary: Array.isArray(previousBatch?.structuralMaterialLibrary) ? previousBatch.structuralMaterialLibrary : [],
            collaborationSettings,
            status: 'active',
            records: [],
            output: null,
            ownerUid: previousBatch?.ownerUid || this.data.currentUser?.uid || '',
            ownerEmail: previousBatch?.ownerEmail || this.normalizeEmail(this.data.currentUser?.email || ''),
            cloudId: previousBatch?.cloudId || null
        };
        if (!previousBatch && collaborationSettings.type === 'shared' && collaborators.length > 0) {
            this.appendBatchActivity(
                batch,
                'collaborators_added',
                `${collaborators.length === 1 ? 'Added collaborator' : 'Added collaborators'} during batch creation: ${collaborators.join(', ')}`,
                { collaborators }
            );
        }

        if (this.data.editingBatch !== null) {
            this.data.batches[this.data.editingBatch] = batch;
        } else {
            this.data.batches.push(batch);
        }

        this.saveData();
        try {
            await this.upsertBatchToCloud(batch);
            this.saveData();
        } catch (error) {
            alert('Batch saved locally, but cloud sync failed. Please try again after refreshing.');
        }
        this.navigate('batchDetail', { batchId: this.getBatchRouteId(batch) });
    },

    async saveDailyRecord() {
        const batch = this.data.currentBatch;
        if (!batch) return;
        const batchRouteId = this.getBatchRouteId(batch);
        const previousRecord = this.data.editingRecord
            ? this.normalizeRecordForCompatibility(batch.records.find((r) => String(r.id) === String(this.data.editingRecord)) || null, batch)
            : null;

        const date = document.getElementById('recordDate').value;
        const composterId = (document.getElementById('composterId')?.value || '').trim();
        const duplicateDateRecord = !this.data.editingRecord
            ? this.normalizeRecordForCompatibility(batch.records.find((r) => String(r.date || '') === String(date || '')) || null, batch)
            : null;

        const isICTA = this.isICTAUser();

        const safeChecked = (id) => {
            const el = document.getElementById(id);
            return !!(el && el.checked);
        };

        const contaminants = {
            plastic: safeChecked('contaminantPlastic'),
            paper: safeChecked('contaminantPaper'),
            metal: safeChecked('contaminantMetal'),
            glass: safeChecked('contaminantGlass'),
            other: safeChecked('contaminantOther')
        };

        const hasAdditionalInputEl = document.getElementById('hasAdditionalInput');
        const qualityEl = document.getElementById('quality');

        const input = {
            additionalInput: {
                enabled: !!(hasAdditionalInputEl && hasAdditionalInputEl.checked)
            },
            additionalInputs: [],
            regularOrganicWaste: 0,
            additionalOrganicMaterial: 0,
            additionalStructuralMaterial: 0,
            totalAdditionalInput: 0,
            totalOrganicWaste: 0,
            regularStructuralMaterial: 0,
            totalStructuralMaterial: 0,
            totalMaterialInput: 0,
            totalOrganicInput: 0,
            quality: qualityEl ? qualityEl.value : '',
            contaminants,
            contaminantDetails: {
                plastic: contaminants.plastic ? (document.getElementById('contaminantPlasticDetail')?.value || '') : '',
                paper: contaminants.paper ? (document.getElementById('contaminantPaperDetail')?.value || '') : '',
                metal: contaminants.metal ? (document.getElementById('contaminantMetalDetail')?.value || '') : '',
                glass: contaminants.glass ? (document.getElementById('contaminantGlassDetail')?.value || '') : '',
                other: contaminants.other ? (document.getElementById('contaminantOtherDetail')?.value || '') : ''
            }
        };

        if (!isICTA && input.additionalInput.enabled) {
            const rows = Array.from(document.querySelectorAll('#additionalInputsList .additional-row'));
            input.additionalInputs = rows.map(row => {
                const source = row.querySelector('.additional-source')?.value || '';
                const type = row.querySelector('.additional-type')?.value || '';
                const weightVal = row.querySelector('.additional-weight')?.value;
                const weight = (weightVal !== '' && weightVal != null) ? parseFloat(weightVal) : null;
                return { source, type, weight };
            }).filter(a => (a.source || '') !== '' || (a.type || '') !== '' || (a.weight != null && !isNaN(a.weight)));
        } else {
            input.additionalInputs = [];
        }

        let maintenance = null;
        if (isICTA) {
            const getNumber = (id) => {
                const el = document.getElementById(id);
                if (!el || el.value === '') return 0;
                const n = parseFloat(el.value);
                return isNaN(n) ? 0 : n;
            };

            const foodWasteCocina = getNumber('foodWasteCocina');
            const foodWastePlanta0 = getNumber('foodWastePlanta0');
            const foodWastePlanta1 = getNumber('foodWastePlanta1');
            const foodWastePlanta3 = getNumber('foodWastePlanta3');
            const totalFoodWaste = foodWasteCocina + foodWastePlanta0 + foodWastePlanta1 + foodWastePlanta3;

            const woodFusta = getNumber('woodFusta');
            const woodChips = getNumber('woodChips');
            const regularStructuralMaterial = woodFusta + woodChips;

            const additionalRows = Array.from(document.querySelectorAll('#maintenanceAdditionalInputsList .maintenance-additional-row'));
            const additionalInputs = additionalRows.map((row) => {
                const source = row.querySelector('.maintenance-additional-source')?.value || '';
                const type = row.querySelector('input[type="radio"]:checked')?.value || 'organic';
                const description = row.querySelector('.maintenance-additional-desc')?.value || '';
                const amountVal = row.querySelector('.maintenance-additional-amount')?.value;
                const amount = (amountVal !== '' && amountVal != null) ? parseFloat(amountVal) : 0;
                return { source, type, description, amount: isNaN(amount) ? 0 : amount };
            }).filter(a => (a.source || '') !== '' || (a.description || '') !== '' || (a.amount || 0) > 0);
            const additionalTotals = this.calculateAdditionalInputTotals(additionalInputs);
            const totalOrganicWaste = totalFoodWaste + additionalTotals.additionalOrganicMaterial;
            const totalStructuralMaterial = regularStructuralMaterial + additionalTotals.additionalStructuralMaterial;
            const totalMaterialInput = totalOrganicWaste + totalStructuralMaterial;
            const inputMethod = this.getBatchMeasurementSettings(batch)?.inputMethod || '';
            const foodStructuralRatio = inputMethod === 'volume' ? this.simplifyRatio(totalOrganicWaste, totalStructuralMaterial) : '';

            maintenance = {
                foodWasteCocina,
                foodWastePlanta0,
                foodWastePlanta1,
                foodWastePlanta3,
                totalFoodWaste,
                woodFusta,
                woodChips,
                regularStructuralMaterial,
                additionalOrganicMaterial: additionalTotals.additionalOrganicMaterial,
                additionalStructuralMaterial: additionalTotals.additionalStructuralMaterial,
                totalStructuralMaterial,
                additionalInputs,
                totalAdditionalInput: additionalTotals.totalAdditionalInput,
                totalOrganicWaste,
                totalMaterialInput,
                totalOrganicInput: totalMaterialInput,
                foodStructuralRatio
            };

            input.cocina = foodWasteCocina;
            input.planta0 = foodWastePlanta0;
            input.planta1 = foodWastePlanta1;
            input.planta3 = foodWastePlanta3;
            input.woodFusta = woodFusta;
            input.woodChips = woodChips;
            input.additionalInputs = additionalInputs.map(a => ({
                source: a.source,
                type: a.type === 'structural' ? 'Structural Material' : 'Organic Material',
                description: a.description,
                weight: a.amount
            }));
            input.additionalInput = { enabled: input.additionalInputs.length > 0 };
            input.regularOrganicWaste = totalFoodWaste;
            input.additionalOrganicMaterial = additionalTotals.additionalOrganicMaterial;
            input.additionalStructuralMaterial = additionalTotals.additionalStructuralMaterial;
            input.totalAdditionalInput = additionalTotals.totalAdditionalInput;
            input.totalOrganicWaste = totalOrganicWaste;
            input.regularStructuralMaterial = regularStructuralMaterial;
            input.totalStructuralMaterial = totalStructuralMaterial;
            input.totalMaterialInput = totalMaterialInput;
            input.totalOrganicInput = totalMaterialInput;
            input.totalWasteInput = totalOrganicWaste;
            input.ratio = (totalOrganicWaste > 0) ? `1:${Math.round((totalStructuralMaterial / totalOrganicWaste) * 100) / 100}` : '';
        } else {
            const parseAmount = (value) => {
                if (value === '' || value == null) return 0;
                const n = parseFloat(value);
                return isNaN(n) ? 0 : n;
            };

            this.ensureNonICTAMaterialLibraries(batch);
            const foodRows = Array.from(document.querySelectorAll('#nonIctaFoodWasteRows .nonicta-library-row'));
            const foodWasteEntries = foodRows.map((row) => {
                const sourceId = row.getAttribute('data-source-id') || '';
                const amount = parseAmount(row.querySelector('.nonicta-food-amount')?.value);
                return { sourceId, amount };
            }).filter((entry) => (entry.sourceId || '') !== '' && (entry.amount || 0) > 0);

            const structRows = Array.from(document.querySelectorAll('#nonIctaStructuralRows .nonicta-library-row'));
            const structuralMaterialEntries = structRows.map((row) => {
                const materialId = row.getAttribute('data-material-id') || '';
                const amount = parseAmount(row.querySelector('.nonicta-struct-amount')?.value);
                return { materialId, amount };
            }).filter((entry) => (entry.materialId || '') !== '' && (entry.amount || 0) > 0);

            const totalFoodWaste = foodWasteEntries.reduce((s, r) => s + ((r && r.amount != null && !isNaN(r.amount)) ? (parseFloat(r.amount) || 0) : 0), 0);
            const regularStructuralMaterial = structuralMaterialEntries.reduce((s, r) => s + ((r && r.amount != null && !isNaN(r.amount)) ? (parseFloat(r.amount) || 0) : 0), 0);

            const additionalRows = Array.from(document.querySelectorAll('#maintenanceAdditionalInputsList .maintenance-additional-row'));
            const additionalInputs = additionalRows.map((row) => {
                const source = row.querySelector('.maintenance-additional-source')?.value || '';
                const type = row.querySelector('input[type="radio"]:checked')?.value || 'organic';
                const description = row.querySelector('.maintenance-additional-desc')?.value || '';
                const amount = parseAmount(row.querySelector('.maintenance-additional-amount')?.value);
                return { source, type, description, amount };
            }).filter(a => (a.source || '') !== '' || (a.description || '') !== '' || (a.amount || 0) > 0);
            const additionalTotals = this.calculateAdditionalInputTotals(additionalInputs);
            const totalOrganicWaste = totalFoodWaste + additionalTotals.additionalOrganicMaterial;
            const totalStructuralMaterial = regularStructuralMaterial + additionalTotals.additionalStructuralMaterial;
            const totalMaterialInput = totalOrganicWaste + totalStructuralMaterial;

            maintenance = {
                foodWasteEntries,
                totalFoodWaste,
                structuralMaterialEntries,
                regularStructuralMaterial,
                additionalOrganicMaterial: additionalTotals.additionalOrganicMaterial,
                additionalStructuralMaterial: additionalTotals.additionalStructuralMaterial,
                totalStructuralMaterial,
                additionalInputs,
                totalAdditionalInput: additionalTotals.totalAdditionalInput,
                totalOrganicWaste,
                totalMaterialInput,
                totalOrganicInput: totalMaterialInput
            };

            input.regularOrganicWaste = totalFoodWaste;
            const structuralLibraryById = new Map(
                (Array.isArray(batch.structuralMaterialLibrary) ? batch.structuralMaterialLibrary : []).map((item) => [String(item.id), item])
            );
            input.structuringMaterials = structuralMaterialEntries.map((entry) => {
                const libraryItem = structuralLibraryById.get(String(entry.materialId || ''));
                return {
                    type: libraryItem?.material || '',
                    kg: (entry.amount != null && !isNaN(entry.amount)) ? (parseFloat(entry.amount) || 0) : 0
                };
            }).filter(m => (m.type || '') !== '' || (m.kg != null && !isNaN(m.kg)));
            input.additionalInputs = additionalInputs.map(a => ({
                source: a.source,
                type: a.type === 'structural' ? 'Structural Material' : 'Organic Material',
                description: a.description,
                weight: a.amount
            }));
            input.additionalInput = { enabled: input.additionalInputs.length > 0 };
            input.additionalOrganicMaterial = additionalTotals.additionalOrganicMaterial;
            input.additionalStructuralMaterial = additionalTotals.additionalStructuralMaterial;
            input.totalAdditionalInput = additionalTotals.totalAdditionalInput;
            input.totalOrganicWaste = totalOrganicWaste;
            input.totalWasteInput = totalOrganicWaste;
            input.regularStructuralMaterial = regularStructuralMaterial;
            input.totalStructuralMaterial = totalStructuralMaterial;
            input.totalMaterialInput = totalMaterialInput;
            input.totalOrganicInput = totalMaterialInput;
            input.ratio = (totalOrganicWaste > 0) ? `1:${Math.round((totalStructuralMaterial / totalOrganicWaste) * 100) / 100}` : '';
        }

        const getNumericValue = (id) => {
            const el = document.getElementById(id);
            if (!el || el.value === '') return null;
            return parseFloat(el.value);
        };
        let monitoring = null;
        let process;
        let observation;
        let notes = '';
        let uploadedPhotos = [];
        let actionTaken = null;
        let actionTurning = false;
        let actionMixing = false;
        let actionAddedWater = false;
        let waterAddedAmount = 0;
        let actionRemovedImpurities = false;
        let removedImpuritiesDescription = '';
        let actionOther = false;
        let otherActionDescription = '';

        notes = document.getElementById('ictaNotesTextarea')?.value || '';
        uploadedPhotos = Array.isArray(this.data.ictaPhotoDraft) ? this.data.ictaPhotoDraft.slice(0, 9) : [];

        actionTurning = !!document.getElementById('actionTurning')?.checked;
        actionMixing = !!document.getElementById('actionMixing')?.checked;
        actionAddedWater = !!document.getElementById('actionAddedWater')?.checked;
        waterAddedAmount = actionAddedWater ? (parseFloat(document.getElementById('waterAddedAmount')?.value) || 0) : 0;
        actionRemovedImpurities = !!document.getElementById('actionRemovedImpurities')?.checked;
        removedImpuritiesDescription = actionRemovedImpurities ? (document.getElementById('removedImpuritiesDescription')?.value || '') : '';
        actionOther = !!document.getElementById('actionOther')?.checked;
        otherActionDescription = actionOther ? (document.getElementById('otherActionDescription')?.value || '') : '';
        actionTaken = {
            actionTurning,
            actionMixing,
            actionAddedWater,
            waterAddedAmount,
            actionRemovedImpurities,
            removedImpuritiesDescription,
            actionOther,
            otherActionDescription
        };

        const moistureAssessmentType = document.querySelector('input[name="moistureAssessmentType"]:checked')?.value || '';
        const moistureValue = moistureAssessmentType === 'quantitative' ? getNumericValue('moistureValue') : null;
        const moistureQualitative = moistureAssessmentType === 'qualitative'
            ? (document.querySelector('input[name="moistureQualitative"]:checked')?.value || '')
            : '';
        const odourDetectedChoice = document.querySelector('input[name="odourDetected"]:checked')?.value || '';
        const odourDetected = odourDetectedChoice === 'detected'
            ? true
            : (odourDetectedChoice === 'no' ? false : null);
        const odourType = odourDetected === true
            ? (document.querySelector('input[name="odourType"]:checked')?.value || null)
            : null;
        const odourDistance = odourDetected === true
            ? (document.querySelector('input[name="odourDistance"]:checked')?.value || null)
            : null;
        const leachateObserved = document.querySelector('input[name="leachateObserved"]:checked')?.value || '';
        const monitoringProtocol = this.getBatchMonitoringProtocol(batch);
        const getAdvancedField = (baseId) => {
            const enabled = !!document.getElementById(`${baseId}Enabled`)?.checked;
            const value = enabled ? getNumericValue(`${baseId}Value`) : null;
            return { enabled, value };
        };
        const advancedMonitoring = monitoringProtocol === 'advanced'
            ? {
                samplingDate: recordDate,
                measurementDate: document.getElementById('advancedMeasurementDate')?.value || recordDate,
                laboratoryMoistureEnabled: !!document.getElementById('advancedLaboratoryMoistureEnabled')?.checked,
                laboratoryMoisture: getAdvancedField('advancedLaboratoryMoisture').value,
                oxygenEnabled: !!document.getElementById('advancedOxygenEnabled')?.checked,
                oxygen: getAdvancedField('advancedOxygen').value,
                ammoniaEnabled: !!document.getElementById('advancedAmmoniaEnabled')?.checked,
                ammonia: getAdvancedField('advancedAmmonia').value,
                carbonDioxideEnabled: !!document.getElementById('advancedCarbonDioxideEnabled')?.checked,
                carbonDioxide: getAdvancedField('advancedCarbonDioxide').value,
                methaneEnabled: !!document.getElementById('advancedMethaneEnabled')?.checked,
                methane: getAdvancedField('advancedMethane').value,
                hydrogenSulfideEnabled: !!document.getElementById('advancedHydrogenSulfideEnabled')?.checked,
                hydrogenSulfide: getAdvancedField('advancedHydrogenSulfide').value,
                vocEnabled: !!document.getElementById('advancedVocEnabled')?.checked,
                voc: getAdvancedField('advancedVoc').value,
                nitrousOxideEnabled: !!document.getElementById('advancedNitrousOxideEnabled')?.checked,
                nitrousOxide: getAdvancedField('advancedNitrousOxide').value,
                organicMatterEnabled: !!document.getElementById('advancedOrganicMatterEnabled')?.checked,
                organicMatter: getAdvancedField('advancedOrganicMatter').value,
                electricalConductivityEnabled: !!document.getElementById('advancedElectricalConductivityEnabled')?.checked,
                electricalConductivity: getAdvancedField('advancedElectricalConductivity').value,
                notes: document.getElementById('advancedMonitoringNotes')?.value?.trim?.() || ''
            }
            : null;

        monitoring = {
            ambientTemperature: getNumericValue('ambientTemperature'),
            ambientHumidity: getNumericValue('ambientHumidity'),
            coreTemperature: getNumericValue('coreTemperature'),
            transitionTemperature: getNumericValue('transitionTemperature'),
            outerTemperature: getNumericValue('outerTemperature'),
            moistureAssessmentType,
            moistureValue,
            moistureQualitative,
            odourDetected,
            odourType,
            odourDistance,
            leachateObserved,
            advancedMonitoring
        };

        let odour = previousRecord?.observation?.odour != null ? previousRecord.observation.odour : '';
        if (odourDetected === true) {
            if (odourDistance === 'gt_5m') odour = 'Strong';
            else if (odourDistance === 'lt_1m' || odourDistance === '1_5m') odour = 'Slight';
            else odour = 'Slight';
        } else if (odourDetected === false) {
            odour = 'None';
        }

        let leachate = 'None';
        if (leachateObserved === 'yes') leachate = 'Yes';
        else if (leachateObserved === 'no') leachate = 'No';

        process = {
            ambient: monitoring.ambientTemperature,
            core: monitoring.coreTemperature,
            transition: monitoring.transitionTemperature,
            outer: monitoring.outerTemperature,
            moisture: moistureValue,
            waterAddedAmount: waterAddedAmount
        };

        observation = {
            odour,
            odourNote: previousRecord?.observation?.odourNote != null ? String(previousRecord.observation.odourNote) : '',
            leachate,
            leachateNote: previousRecord?.observation?.leachateNote != null ? String(previousRecord.observation.leachateNote) : '',
            notes
        };

        if (duplicateDateRecord) {
            if (!confirm(`A record for ${this.formatDate(date)} already exists. Do you want to update it?`)) {
                return;
            }
        }

        const materialTransfer = this.getMaterialTransferFormState(batch, date);
        const metadataSourceRecord = previousRecord || duplicateDateRecord;
        const previousMetadata = this.normalizeRecordMetadata(metadataSourceRecord?.metadata);
        const operator = this.getCurrentOperatorIdentity();
        const nowIso = new Date().toISOString();
        const metadata = metadataSourceRecord
            ? {
                ...previousMetadata,
                createdByUID: previousMetadata.createdByUID || operator.uid,
                createdByEmail: previousMetadata.createdByEmail || operator.email,
                createdByName: previousMetadata.createdByName || operator.name,
                createdAt: previousMetadata.createdAt || nowIso,
                lastEditedByUID: operator.uid,
                lastEditedByEmail: operator.email,
                lastEditedByName: operator.name,
                lastEditedAt: nowIso
            }
            : {
                ...previousMetadata,
                createdByUID: operator.uid,
                createdByEmail: operator.email,
                createdByName: operator.name,
                createdAt: nowIso
            };

        const record = this.normalizeRecordForCompatibility({
            id: this.data.editingRecord
                ? String(this.data.editingRecord)
                : String(metadataSourceRecord?.id || Date.now()),
            date,
            composterId,
            input,
            process,
            observation,
            monitoring,
            maintenance,
            materialTransfer,
            metadata,
            actionTaken,
            actionTurning,
            actionMixing,
            actionAddedWater,
            waterAddedAmount,
            actionRemovedImpurities,
            removedImpuritiesDescription,
            actionOther,
            otherActionDescription,
            uploadedPhotos,
            notes
        }, batch);

        const isNewRecord = !previousRecord && !duplicateDateRecord;

        if (this.data.editingRecord) {
            const index = batch.records.findIndex(r => r.id === this.data.editingRecord);
            if (index >= 0) {
                batch.records[index] = record;
            }
        } else {
            const existingIndex = batch.records.findIndex(r => String(r.date || '') === String(date || ''));
            if (existingIndex >= 0) {
                batch.records[existingIndex] = record;
            } else {
                batch.records.push(record);
            }
        }

        try {
            if (!batch.cloudId) {
                await this.upsertBatchToCloud(batch, { skipCreatedAt: false });
            }
        } catch (error) {
        }

        const cloudPhotosEnabled = this.isCloudPhotoStorageEnabled();
        const sharedBatch = this.isBatchShared(batch);
        const priorPhotoPaths = cloudPhotosEnabled ? this.getPhotoStoragePaths(metadataSourceRecord?.uploadedPhotos || []) : [];
        const priorPhotoCount = cloudPhotosEnabled ? this.normalizePhotoList(metadataSourceRecord?.uploadedPhotos || []).length : 0;
        let removedPhotoPaths = [];
        let nextPhotoCount = this.normalizePhotoList(record.uploadedPhotos).length;
        if (cloudPhotosEnabled) {
            record.uploadedPhotos = await this.syncPhotoListToCloud(batch, record.uploadedPhotos, 'daily-record', record.id);
            const nextPhotoPaths = this.getPhotoStoragePaths(record.uploadedPhotos);
            removedPhotoPaths = priorPhotoPaths.filter((path) => !nextPhotoPaths.includes(path));
            nextPhotoCount = this.normalizePhotoList(record.uploadedPhotos).length;
        }

        if (isNewRecord) {
            this.appendBatchActivity(
                batch,
                'record_added',
                `Added daily record for ${this.formatDate(record.date)}${record.composterId ? ` (Composter ID: ${record.composterId})` : ''}`,
                { recordId: record.id, date: record.date, composterId: record.composterId || '' }
            );
        }
        if (cloudPhotosEnabled && nextPhotoCount > priorPhotoCount) {
            const addedPhotoCount = nextPhotoCount - priorPhotoCount;
            this.appendBatchActivity(
                batch,
                'record_photos_uploaded',
                `Uploaded ${addedPhotoCount} photo${addedPhotoCount === 1 ? '' : 's'} to daily record ${this.formatDate(record.date)}`,
                { recordId: record.id, date: record.date, addedPhotoCount }
            );
        }

        batch.records.sort((a, b) => new Date(a.date) - new Date(b.date));
        this.saveData();
        try {
            await this.upsertBatchToCloud(batch, { skipCreatedAt: true });
            await this.upsertDailyRecordToCloud(batch, record);
            if (cloudPhotosEnabled) {
                await this.deleteStorageFiles(removedPhotoPaths);
            }
            this.saveData();
        } catch (error) {
            alert('Daily Record saved locally, but cloud sync failed. Please try again after refreshing.');
        }
        const successMessage = sharedBatch && !cloudPhotosEnabled && nextPhotoCount > 0
            ? '✅ Daily Record Submitted (Photos saved locally only)'
            : '✅ Daily Record Submitted Successfully';
        this.showTransientSuccessMessage(successMessage, 2300);
        window.setTimeout(() => {
            if (this.getBatchRouteId(this.data.currentBatch) === batchRouteId) {
                this.navigate('batchDetail', { batchId: batchRouteId });
            }
        }, 2300);
    },

    async saveOutput() {
        const batch = this.data.currentBatch;
        if (!batch) return;

        const outputDate = document.getElementById('outputDate')?.value;
        const compostOutputRaw = document.getElementById('compostOutput')?.value;
        const notes = document.getElementById('harvestNotes')?.value.trim() || '';
        if (!outputDate) {
            alert('Please select the Harvest Date.');
            return;
        }
        if (compostOutputRaw == null || String(compostOutputRaw).trim() === '') {
            alert('Please enter the Actual Compost Output before saving.');
            return;
        }
        const compostOutput = parseFloat(compostOutputRaw);
        if (isNaN(compostOutput) || compostOutput < 0) {
            alert('Please enter a valid Actual Compost Output.');
            return;
        }

        batch.output = {
            ...(batch.output || {}),
            estimatedOutput: batch.output?.estimatedOutput != null ? batch.output.estimatedOutput : this.calculateEstimatedCompostOutput(batch),
            harvestStatus: 'completed',
            date: outputDate,
            compostOutput,
            notes
        };

        this.saveData();
        try {
            await this.upsertBatchToCloud(batch, { skipCreatedAt: true });
        } catch (error) {
            alert('Harvest saved locally, but cloud sync failed. Please try again after refreshing.');
        }
        this.render();
        this.showTransientSuccessMessage('✅ Harvest Saved Successfully', 2300);
    },

    toggleHarvestForm() {
        const section = document.getElementById('harvestFormSection');
        const saveBtn = document.getElementById('saveHarvestBtn');
        if (!section) return;
        const hidden = section.style.display === 'none' || section.style.display === '';
        section.style.display = hidden ? 'block' : 'none';
        if (saveBtn) saveBtn.style.display = hidden ? '' : 'none';
    },

    updateInputTotals() {
        const totalWasteInputEl = document.getElementById('totalWasteInput');
        const hasNonICTAInput = !!totalWasteInputEl;

        const getNumber = (el) => {
            if (!el || el.value === '') return 0;
            const n = parseFloat(el.value);
            return isNaN(n) ? 0 : n;
        };

        const totalWaste = hasNonICTAInput
            ? getNumber(totalWasteInputEl)
            : (getNumber(document.getElementById('cocina')) + getNumber(document.getElementById('planta0')) + getNumber(document.getElementById('planta1')) + getNumber(document.getElementById('planta3')));

        const woodFustaEl = document.getElementById('woodFusta');
        const woodChipsEl = document.getElementById('woodChips');
        const totalStructuring = (woodFustaEl && woodChipsEl)
            ? (getNumber(woodFustaEl) + getNumber(woodChipsEl))
            : Array.from(document.querySelectorAll('#structuringMaterialsList .struct-kg')).reduce((s, el) => s + getNumber(el), 0);

        const additionalEnabled = !!document.getElementById('hasAdditionalInput')?.checked;
        const additionalRows = additionalEnabled ? Array.from(document.querySelectorAll('#additionalInputsList .additional-row')) : [];
        const additionalInputs = additionalRows.map((row) => ({
            type: row.querySelector('.additional-type')?.value || 'organic',
            amount: getNumber(row.querySelector('.additional-weight'))
        }));
        const additionalTotals = this.calculateAdditionalInputTotals(additionalInputs);
        const totalOrganicWaste = totalWaste + additionalTotals.additionalOrganicMaterial;
        const totalStructuralMaterial = totalStructuring + additionalTotals.additionalStructuralMaterial;
        const totalInput = totalOrganicWaste + totalStructuralMaterial;

        const totalWasteEl = document.getElementById('totalWaste');
        const totalStructuringEl = document.getElementById('totalStructuring');
        const totalInputEl = document.getElementById('totalInput');
        const autoRatioValueEl = document.getElementById('autoRatioValue');
        const autoRatioNoteEl = document.getElementById('autoRatioNote');

        if (totalWasteEl) totalWasteEl.textContent = this.formatNumber(totalOrganicWaste, 3);
        if (totalStructuringEl) totalStructuringEl.textContent = this.formatNumber(totalStructuralMaterial, 3);
        if (totalInputEl) totalInputEl.textContent = this.formatNumber(totalInput, 3);
        if (autoRatioValueEl) {
            if (totalOrganicWaste > 0) {
                const ratio = totalStructuralMaterial / totalOrganicWaste;
                autoRatioValueEl.textContent = `1 : ${this.formatNumber(ratio, 2)}`;
                if (autoRatioNoteEl) {
                    autoRatioNoteEl.textContent = ratio < 0.6 ? 'Low structural ratio → consider adding more structural material.' : '';
                }
            } else {
                autoRatioValueEl.textContent = '-';
                if (autoRatioNoteEl) autoRatioNoteEl.textContent = '';
            }
        }
    },

    addStructuringMaterialRow() {
        const list = document.getElementById('structuringMaterialsList');
        if (!list) return;
        const row = document.createElement('div');
        row.className = 'struct-row';
        row.style.display = 'flex';
        row.style.gap = '10px';
        row.style.alignItems = 'center';
        row.style.marginBottom = '10px';
        row.innerHTML = `
            <input type="text" class="form-input struct-type" placeholder="Structural Material Type">
            <input type="number" class="form-input struct-kg" step="any" placeholder="kg" style="width: 120px;">
            <button type="button" class="btn btn-secondary" style="padding: 8px 12px;">−</button>
        `;
        const removeBtn = row.querySelector('button');
        const kgInput = row.querySelector('.struct-kg');
        if (removeBtn) removeBtn.onclick = () => this.removeStructuringMaterialRow(removeBtn);
        if (kgInput) kgInput.oninput = () => this.updateInputTotals();
        list.appendChild(row);
        this.updateInputTotals();
    },

    removeStructuringMaterialRow(buttonEl) {
        const row = buttonEl?.closest?.('.struct-row');
        if (!row) return;
        row.remove();
        this.updateInputTotals();
    },

    toggleAdditionalInput() {
        const checkbox = document.getElementById('hasAdditionalInput');
        const section = document.getElementById('additionalInputSection');
        const list = document.getElementById('additionalInputsList');

        if (checkbox.checked) {
            section.style.display = 'block';
            if (list && list.querySelectorAll('.additional-row').length === 0) {
                this.addAdditionalInputRow();
            }
        } else {
            section.style.display = 'none';
            if (list) {
                list.innerHTML = '';
                const row = document.createElement('div');
                row.className = 'additional-row';
                row.style.display = 'flex';
                row.style.gap = '10px';
                row.style.alignItems = 'center';
                row.style.marginBottom = '10px';
                row.innerHTML = `
                    <input type="text" class="form-input additional-source" placeholder="Source 1">
                    <input type="text" class="form-input additional-type" placeholder="Type">
                    <input type="number" class="form-input additional-weight" step="any" placeholder="kg" style="width: 140px;">
                    <button type="button" class="btn btn-secondary" style="padding: 8px 12px;" onclick="app.removeAdditionalInputRow(this)">−</button>
                `;
                const w = row.querySelector('.additional-weight');
                if (w) w.oninput = () => this.updateInputTotals();
                list.appendChild(row);
            }
            this.updateInputTotals();
        }
    },

    addAdditionalInputRow() {
        const list = document.getElementById('additionalInputsList');
        if (!list) return;
        const row = document.createElement('div');
        row.className = 'additional-row';
        row.style.display = 'flex';
        row.style.gap = '10px';
        row.style.alignItems = 'center';
        row.style.marginBottom = '10px';
        row.innerHTML = `
            <input type="text" class="form-input additional-source" placeholder="">
            <input type="text" class="form-input additional-type" placeholder="Type">
            <input type="number" class="form-input additional-weight" step="any" placeholder="kg" style="width: 140px;">
            <button type="button" class="btn btn-secondary" style="padding: 8px 12px;">−</button>
        `;
        const removeBtn = row.querySelector('button');
        const weightInput = row.querySelector('.additional-weight');
        if (removeBtn) removeBtn.onclick = () => this.removeAdditionalInputRow(removeBtn);
        if (weightInput) weightInput.oninput = () => this.updateInputTotals();
        list.appendChild(row);
        this.renumberAdditionalInputRows();
        this.updateInputTotals();
    },

    removeAdditionalInputRow(buttonEl) {
        const list = document.getElementById('additionalInputsList');
        const row = buttonEl?.closest?.('.additional-row');
        if (!list || !row) return;
        row.remove();
        if (list.querySelectorAll('.additional-row').length === 0) {
            this.addAdditionalInputRow();
            return;
        }
        this.renumberAdditionalInputRows();
        this.updateInputTotals();
    },

    renumberAdditionalInputRows() {
        const rows = Array.from(document.querySelectorAll('#additionalInputsList .additional-row'));
        rows.forEach((row, idx) => {
            const source = row.querySelector('.additional-source');
            if (source) source.placeholder = `Source ${idx + 1}`;
        });
    },

    toggleWaterAdded() {
        const checkbox = document.getElementById('waterAdded');
        const amountInput = document.getElementById('waterAddedAmount');

        if (checkbox.checked) {
            amountInput.style.display = 'inline-block';
            amountInput.disabled = false;
        } else {
            amountInput.style.display = 'none';
            amountInput.disabled = true;
            amountInput.value = 0;
        }
    },

    updateLossCalculation() {
        const batch = this.data.currentBatch;
        if (!batch) return;

        const totalInput = this.calculateBatchTotalMaterialInput(batch);
        const compostOutput = parseFloat(document.getElementById('compostOutput')?.value) || 0;
        const estimatedLoss = totalInput - compostOutput;

        const estimatedLossEl = document.getElementById('estimatedLoss');
        if (estimatedLossEl) {
            estimatedLossEl.textContent = estimatedLoss;
        }
    },

    getFinalAssessmentState(batch) {
        const finalAssessment = batch?.finalAssessment || {};
        const photos = this.normalizePhotoList(finalAssessment.finalCompostPhotos || []);
        return {
            finalCoreTemperature: finalAssessment.finalCoreTemperature != null ? finalAssessment.finalCoreTemperature : '',
            ambientTemperature: finalAssessment.ambientTemperature != null ? finalAssessment.ambientTemperature : '',
            finalMoistureType: finalAssessment.finalMoistureType || 'quantitative',
            finalMoistureValue: finalAssessment.finalMoistureValue != null ? finalAssessment.finalMoistureValue : '',
            finalMoistureAssessment: finalAssessment.finalMoistureAssessment || '',
            finalOdour: finalAssessment.finalOdour || '',
            finalCompostPhotos: photos
        };
    },

    renderFinishPhotoGridHtml(photos) {
        if (!Array.isArray(photos) || photos.length === 0) {
            return `<div class="icta-photo-empty">No final compost photos uploaded yet.</div>`;
        }
        return photos.map((photo, idx) => `
            <div class="icta-photo-tile">
                <img class="icta-photo-thumb" src="${this.getPhotoPreviewSrc(photo)}" alt="Final compost photo ${idx + 1}">
                <div class="icta-photo-actions">
                    <button type="button" class="btn btn-secondary icta-photo-btn" onclick="app.viewFinishPhoto(${idx})">View</button>
                    <button type="button" class="btn btn-secondary icta-photo-btn" onclick="app.openFinishPhotoReplace(${idx})">Replace</button>
                    <button type="button" class="btn btn-danger icta-photo-btn" onclick="app.deleteFinishPhoto(${idx})">Delete</button>
                </div>
            </div>
        `).join('');
    },

    showFinalCoreTemperatureGuide() {
        const body = `
            <ol style="padding-left: 20px; line-height: 1.8; margin: 0;">
                <li>Insert thermometer into the center of the compost pile.</li>
                <li>Ensure a depth of approximately 30–50 cm.</li>
                <li>Wait at least 2 minutes.</li>
                <li>Measure before turning or mixing.</li>
            </ol>
        `;
        this.showInfoModal('How to Measure Final Core Temperature', body);
    },

    updateFinishTemperatureAssessment() {
        const coreEl = document.getElementById('finishFinalCoreTemperature');
        const ambientEl = document.getElementById('finishAmbientTemperature');
        const diffValueEl = document.getElementById('finishTemperatureDifferenceValue');
        const validationEl = document.getElementById('finishTemperatureValidation');
        if (!coreEl || !ambientEl || !diffValueEl || !validationEl) return;

        const core = coreEl.value === '' ? null : parseFloat(coreEl.value);
        const ambient = ambientEl.value === '' ? null : parseFloat(ambientEl.value);
        if (core == null || ambient == null || isNaN(core) || isNaN(ambient)) {
            diffValueEl.textContent = '—';
            validationEl.style.display = 'none';
            validationEl.className = 'alert';
            validationEl.innerHTML = '';
            return;
        }

        const difference = Math.abs(core - ambient);
        diffValueEl.textContent = `${this.formatNumber(difference, 1)} °C`;
        validationEl.style.display = 'block';
        if (difference > 8) {
            validationEl.className = 'alert alert-warning finish-validation-box';
            validationEl.innerHTML = `
                <strong>⚠ Warning</strong><br>
                The compost temperature is still significantly higher than ambient temperature.
                It is recommended to continue maturation until the temperature difference is below 8°C.
            `;
        } else {
            validationEl.className = 'alert alert-success finish-validation-box';
            validationEl.innerHTML = `<strong>✅ Temperature Stability Achieved</strong>`;
        }
    },

    updateFinishMoistureAssessmentVisibility() {
        const type = document.querySelector('input[name="finishMoistureType"]:checked')?.value || 'quantitative';
        const quantitative = document.getElementById('finishMoistureQuantitativeSection');
        const qualitative = document.getElementById('finishMoistureQualitativeSection');
        if (quantitative) quantitative.style.display = type === 'quantitative' ? 'block' : 'none';
        if (qualitative) qualitative.style.display = type === 'qualitative' ? 'block' : 'none';
        if (type === 'quantitative') {
            const qualitativeOptions = document.querySelectorAll('input[name="finishMoistureAssessment"]');
            qualitativeOptions.forEach((option) => { option.checked = false; });
        } else {
            const moistureValue = document.getElementById('finishMoistureValue');
            if (moistureValue) moistureValue.value = '';
        }
    },

    updateFinishOdourValidation() {
        const odour = document.querySelector('input[name="finishOdour"]:checked')?.value || '';
        const validationEl = document.getElementById('finishOdourValidation');
        if (!validationEl) return;
        if (!odour) {
            validationEl.style.display = 'none';
            validationEl.className = 'alert';
            validationEl.innerHTML = '';
            return;
        }
        const acceptable = ['earthy', 'musty', 'mushroom_like', 'odorless'];
        validationEl.style.display = 'block';
        if (acceptable.includes(odour)) {
            validationEl.className = 'alert alert-success finish-validation-box';
            validationEl.innerHTML = `<strong>✅ Odour indicates acceptable compost maturity.</strong>`;
        } else {
            validationEl.className = 'alert alert-danger finish-validation-box';
            validationEl.innerHTML = `
                <strong>❌ Compost should not be used at this stage.</strong><br>
                Continue composting and adjust operating conditions.
            `;
        }
    },

    openFinishPhotoPicker(type) {
        this.data.finishPhotoReplaceIndex = null;
        const input = type === 'take'
            ? document.getElementById('finishTakePhotoInput')
            : type === 'upload'
                ? document.getElementById('finishUploadPhotoInput')
                : document.getElementById('finishChooseFileInput');
        if (!input) return;
        input.click();
    },

    openFinishPhotoReplace(index) {
        this.data.finishPhotoReplaceIndex = Number.isFinite(index) ? index : null;
        const input = document.getElementById('finishReplacePhotoInput');
        if (!input) return;
        input.click();
    },

    async handleFinishPhotoFiles(files) {
        if (!Array.isArray(this.data.finishPhotoDraft)) this.data.finishPhotoDraft = [];
        const validFiles = files.filter((file) => {
            const type = String(file?.type || '').toLowerCase();
            return type === 'image/jpeg' || type === 'image/jpg' || type === 'image/png';
        });
        if (validFiles.length !== files.length) {
            alert('Only JPG, JPEG, and PNG files are supported.');
        }
        const remaining = Math.max(0, 9 - this.data.finishPhotoDraft.length);
        const picked = validFiles.slice(0, remaining);
        if (validFiles.length > remaining) {
            alert(`You can upload up to 9 photos. Only ${remaining} more photo(s) can be added.`);
        }
        for (const file of picked) {
            const dataUrl = await this.convertImageFileToDataUrl(file);
            if (!dataUrl) continue;
            this.data.finishPhotoDraft.push(dataUrl);
        }
        this.data.finishPhotoDraft = this.data.finishPhotoDraft.slice(0, 9);
        this.updateFinishPhotoGridDom();
    },

    async handleFinishReplacePhotoFiles(files) {
        if (!Array.isArray(this.data.finishPhotoDraft)) this.data.finishPhotoDraft = [];
        const idx = this.data.finishPhotoReplaceIndex;
        if (idx == null || idx < 0 || idx >= this.data.finishPhotoDraft.length) {
            await this.handleFinishPhotoFiles(files);
            return;
        }
        const file = files[0];
        if (!file) return;
        const type = String(file.type || '').toLowerCase();
        if (!(type === 'image/jpeg' || type === 'image/jpg' || type === 'image/png')) {
            alert('Only JPG, JPEG, and PNG files are supported.');
            return;
        }
        const dataUrl = await this.convertImageFileToDataUrl(file);
        if (!dataUrl) return;
        this.data.finishPhotoDraft[idx] = dataUrl;
        this.updateFinishPhotoGridDom();
    },

    updateFinishPhotoGridDom() {
        const grid = document.getElementById('finishPhotoGrid');
        if (!grid) return;
        const photos = Array.isArray(this.data.finishPhotoDraft) ? this.data.finishPhotoDraft : [];
        grid.innerHTML = this.renderFinishPhotoGridHtml(photos);
    },

    viewFinishPhoto(index) {
        const photos = Array.isArray(this.data.finishPhotoDraft) ? this.data.finishPhotoDraft : [];
        const src = this.getPhotoPreviewSrc(photos[index]);
        if (!src) return;
        this.showInfoModal(`Final Compost Photo ${index + 1}`, `<img src="${src}" alt="Final compost photo ${index + 1}" style="max-width: 100%; border-radius: 12px;">`);
    },

    deleteFinishPhoto(index) {
        if (!Array.isArray(this.data.finishPhotoDraft)) return;
        this.data.finishPhotoDraft.splice(index, 1);
        this.updateFinishPhotoGridDom();
    },

    showFinishModal(batchId) {
        const batch = this.findBatchByRouteId(batchId);
        if (!batch) return;
        const routeId = this.getBatchRouteId(batch);
        const assessment = this.getFinalAssessmentState(batch);
        const inputUnit = this.getBatchInputUnitName(batch);
        const conversionSettings = this.getBatchCalculationSettings(batch);
        const estimatedOutput = this.calculateEstimatedCompostOutput(batch);
        const odourOptions = [
            { value: 'earthy', label: 'Earthy' },
            { value: 'musty', label: 'Musty' },
            { value: 'mushroom_like', label: 'Mushroom-like' },
            { value: 'odorless', label: 'Odorless' },
            { value: 'ammonia', label: 'Ammonia' },
            { value: 'urine_like', label: 'Urine-like' },
            { value: 'rotten_odour', label: 'Rotten Odour' },
            { value: 'sour', label: 'Sour' },
            { value: 'vinegar_like', label: 'Vinegar-like' },
            { value: 'rotten_egg_odour', label: 'Rotten Egg Odour' },
            { value: 'fecal', label: 'Fecal' }
        ];

        this.data.finishPhotoDraft = [...assessment.finalCompostPhotos];
        this.data.finishPhotoReplaceIndex = null;

        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.id = 'finishModal';
        modal.innerHTML = `
            <div class="modal finish-assessment-modal">
                <div class="modal-header">
                    <h2 class="modal-title">Finish Batch Confirmation</h2>
                </div>
                <div class="modal-body">
                    <div class="finish-batch-intro">
                        <div><strong>Batch ID:</strong> ${batch.id}</div>
                        <div style="margin-top: 8px; color: var(--gray);">Please complete the final compost assessment before closing this batch.</div>
                    </div>

                    <div class="finish-section-card">
                        <h3 class="card-title" style="margin-bottom: 16px;">Final Compost Quality</h3>

                        <div class="module" style="background: #F4FBF4; border-color: #C8E6C9;">
                            <h3 class="module-title process">Final Temperature Assessment</h3>
                            <div class="finish-temperature-grid">
                                <div class="form-group">
                                    <label class="form-label">Final Core Temperature (°C)</label>
                                    <button type="button" class="btn btn-secondary monitoring-help-btn" onclick="app.showFinalCoreTemperatureGuide()">ⓘ How to Measure</button>
                                    <input type="number" class="form-input" id="finishFinalCoreTemperature" step="any" value="${assessment.finalCoreTemperature}" oninput="app.updateFinishTemperatureAssessment()">
                                </div>
                                <div class="form-group">
                                    <label class="form-label">Ambient Temperature (°C)</label>
                                    <input type="number" class="form-input" id="finishAmbientTemperature" step="any" value="${assessment.ambientTemperature}" oninput="app.updateFinishTemperatureAssessment()">
                                </div>
                            </div>
                            <div class="finish-difference-row">Temperature Difference: <strong id="finishTemperatureDifferenceValue">—</strong></div>
                            <div id="finishTemperatureValidation" class="alert finish-validation-box" style="display:none;"></div>
                        </div>

                        <div class="module" style="background: #FFFDF4; border-color: #FFE082;">
                            <h3 class="module-title" style="color: #F57C00;">Final Moisture Assessment</h3>
                            <div class="form-label" style="margin-bottom: 10px;">Moisture Assessment</div>
                            <div class="radio-group" style="margin-bottom: 15px;">
                                <label class="radio-item">
                                    <input type="radio" name="finishMoistureType" value="quantitative" ${assessment.finalMoistureType === 'quantitative' ? 'checked' : ''} onchange="app.updateFinishMoistureAssessmentVisibility()">
                                    Quantitative
                                </label>
                                <label class="radio-item">
                                    <input type="radio" name="finishMoistureType" value="qualitative" ${assessment.finalMoistureType === 'qualitative' ? 'checked' : ''} onchange="app.updateFinishMoistureAssessmentVisibility()">
                                    Qualitative
                                </label>
                            </div>
                            <div id="finishMoistureQuantitativeSection" style="${assessment.finalMoistureType === 'quantitative' ? '' : 'display:none;'}">
                                <div class="form-group">
                                    <label class="form-label">Moisture (%)</label>
                                    <input type="number" class="form-input" id="finishMoistureValue" step="any" value="${assessment.finalMoistureValue}">
                                </div>
                            </div>
                            <div id="finishMoistureQualitativeSection" style="${assessment.finalMoistureType === 'qualitative' ? '' : 'display:none;'}">
                                <div style="margin-bottom: 12px; color: var(--gray);">Take a handful of compost and squeeze firmly.</div>
                                <div class="moisture-card-grid">
                                    <label class="moisture-card">
                                        <input type="radio" name="finishMoistureAssessment" value="dry" ${assessment.finalMoistureAssessment === 'dry' ? 'checked' : ''}>
                                        <div class="moisture-card-content">
                                            <div class="moisture-card-image">${this.renderMoistureGuideImage('dry', true)}</div>
                                            <div class="moisture-card-title">Dry</div>
                                            <div class="moisture-card-desc">No shape remains after squeezing</div>
                                        </div>
                                    </label>
                                    <label class="moisture-card">
                                        <input type="radio" name="finishMoistureAssessment" value="optimal" ${assessment.finalMoistureAssessment === 'optimal' ? 'checked' : ''}>
                                        <div class="moisture-card-content">
                                            <div class="moisture-card-image">${this.renderMoistureGuideImage('optimal', true)}</div>
                                            <div class="moisture-card-title">Optimal</div>
                                            <div class="moisture-card-desc">Keeps shape and releases 1–2 drops</div>
                                        </div>
                                    </label>
                                    <label class="moisture-card">
                                        <input type="radio" name="finishMoistureAssessment" value="wet" ${assessment.finalMoistureAssessment === 'wet' ? 'checked' : ''}>
                                        <div class="moisture-card-content">
                                            <div class="moisture-card-image">${this.renderMoistureGuideImage('wet', true)}</div>
                                            <div class="moisture-card-title">Wet</div>
                                            <div class="moisture-card-desc">Water flows out when squeezed</div>
                                        </div>
                                    </label>
                                </div>
                            </div>
                        </div>

                        <div class="module" style="background: #F3F8FF; border-color: #BBDEFB;">
                            <h3 class="module-title" style="color: #1976D2;">Final Odour Assessment</h3>
                            <div class="finish-odour-grid">
                                ${odourOptions.map((option) => `
                                    <label class="radio-item finish-odour-option">
                                        <input type="radio" name="finishOdour" value="${option.value}" ${assessment.finalOdour === option.value ? 'checked' : ''} onchange="app.updateFinishOdourValidation()">
                                        ${option.label}
                                    </label>
                                `).join('')}
                            </div>
                            <div id="finishOdourValidation" class="alert finish-validation-box" style="display:none;"></div>
                        </div>

                        <div class="module" style="background: #F7FBF7; border-color: #C8E6C9;">
                            <h3 class="module-title maintenance">Estimated Compost Output</h3>
                            <div class="summary-grid" style="margin: 0;">
                                <div class="summary-item">
                                    <div class="summary-value">${this.formatNumber(estimatedOutput, 1)}</div>
                                    <div class="summary-label">Estimated Compost Output (${inputUnit})</div>
                                    <div style="margin-top: 6px; color: var(--gray); font-size: 0.9rem;">
                                        (Initial Composting Stock + Total Material Input) × ${this.formatNumber(conversionSettings.compostConversionRate * 100, 2)}% conversion rate
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="module" style="background: #FAFFFA; border-color: #C8E6C9;">
                            <h3 class="module-title maintenance" style="margin-bottom: 12px;">Final Compost Photos</h3>
                            ${this.isBatchShared(batch) && !this.isCloudPhotoStorageEnabled()
                                ? `<div class="alert alert-warning" style="margin-bottom: 14px;">
                                        <strong>Photos are local-only</strong><br>
                                        Photos will be saved on this device but will not be shared with collaborators until cloud photo storage is enabled.
                                   </div>`
                                : ''}
                            <div class="icta-photo-toolbar">
                                <button type="button" class="btn btn-secondary" onclick="app.openFinishPhotoPicker('take')">📷 Take Photo</button>
                                <button type="button" class="btn btn-secondary" onclick="app.openFinishPhotoPicker('upload')">⬆ Upload Photo</button>
                                <button type="button" class="btn btn-secondary" onclick="app.openFinishPhotoPicker('file')">📁 Choose File</button>
                                <div class="icta-photo-hint">JPG / JPEG / PNG • Up to 9 photos</div>
                            </div>
                            <input id="finishTakePhotoInput" type="file" accept="image/jpeg,image/jpg,image/png" capture="environment" style="display:none;">
                            <input id="finishUploadPhotoInput" type="file" accept="image/jpeg,image/jpg,image/png" multiple style="display:none;">
                            <input id="finishChooseFileInput" type="file" accept="image/jpeg,image/jpg,image/png" multiple style="display:none;">
                            <input id="finishReplacePhotoInput" type="file" accept="image/jpeg,image/jpg,image/png" style="display:none;">
                            <div id="finishPhotoGrid" class="icta-photo-grid">
                                ${this.renderFinishPhotoGridHtml(assessment.finalCompostPhotos)}
                            </div>
                        </div>
                    </div>

                    <div class="finish-confirm-card">
                        <div class="finish-confirm-title">Finish Confirmation</div>
                        <div>Are you sure you want to finish Batch <strong>${batch.id}</strong>?</div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="app.closeModal()">
                        Go Back
                    </button>
                    <button class="btn btn-danger" onclick="app.finishBatch('${String(routeId).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')">
                        Continue to Finish
                    </button>
                </div>
            </div>
        `;
        modal.addEventListener('click', (event) => {
            if (event.target === modal) this.closeModal();
        });
        document.body.appendChild(modal);

        const takeInput = document.getElementById('finishTakePhotoInput');
        if (takeInput) {
            takeInput.addEventListener('change', () => {
                const files = Array.from(takeInput.files || []);
                this.handleFinishPhotoFiles(files);
                takeInput.value = '';
            });
        }
        const uploadInput = document.getElementById('finishUploadPhotoInput');
        if (uploadInput) {
            uploadInput.addEventListener('change', () => {
                const files = Array.from(uploadInput.files || []);
                this.handleFinishPhotoFiles(files);
                uploadInput.value = '';
            });
        }
        const chooseInput = document.getElementById('finishChooseFileInput');
        if (chooseInput) {
            chooseInput.addEventListener('change', () => {
                const files = Array.from(chooseInput.files || []);
                this.handleFinishPhotoFiles(files);
                chooseInput.value = '';
            });
        }
        const replaceInput = document.getElementById('finishReplacePhotoInput');
        if (replaceInput) {
            replaceInput.addEventListener('change', () => {
                const files = Array.from(replaceInput.files || []);
                this.handleFinishReplacePhotoFiles(files);
                replaceInput.value = '';
            });
        }

        this.updateFinishTemperatureAssessment();
        this.updateFinishMoistureAssessmentVisibility();
        this.updateFinishOdourValidation();
    },

    closeModal() {
        const modal = document.getElementById('finishModal');
        if (modal) modal.remove();
        this.data.finishPhotoDraft = null;
        this.data.finishPhotoReplaceIndex = null;
    },

    async finishBatch(batchId) {
        const batch = this.findBatchByRouteId(batchId);
        if (!batch) return;
        const routeId = this.getBatchRouteId(batch);
        const previousFinalPhotos = this.normalizePhotoList(batch?.finalAssessment?.finalCompostPhotos || []);
        const cloudPhotosEnabled = this.isCloudPhotoStorageEnabled();
        const sharedBatch = this.isBatchShared(batch);
        const getNumber = (id) => {
            const el = document.getElementById(id);
            if (!el || el.value === '') return null;
            const value = parseFloat(el.value);
            return isNaN(value) ? null : value;
        };
        const finalCoreTemperature = getNumber('finishFinalCoreTemperature');
        const ambientTemperature = getNumber('finishAmbientTemperature');
        const finalMoistureType = document.querySelector('input[name="finishMoistureType"]:checked')?.value || 'quantitative';
        const finalMoistureValue = finalMoistureType === 'quantitative' ? getNumber('finishMoistureValue') : null;
        const finalMoistureAssessment = finalMoistureType === 'qualitative'
            ? (document.querySelector('input[name="finishMoistureAssessment"]:checked')?.value || '')
            : '';
        const finalOdour = document.querySelector('input[name="finishOdour"]:checked')?.value || '';
        const temperatureDifference = (finalCoreTemperature != null && ambientTemperature != null)
            ? Math.abs(finalCoreTemperature - ambientTemperature)
            : null;

        if (finalCoreTemperature == null || ambientTemperature == null) {
            alert('Please complete the final temperature assessment before finishing this batch.');
            return;
        }
        if (finalMoistureType === 'quantitative' && finalMoistureValue == null) {
            alert('Please enter the final moisture percentage before finishing this batch.');
            return;
        }
        if (finalMoistureType === 'qualitative' && !finalMoistureAssessment) {
            alert('Please select the final qualitative moisture assessment before finishing this batch.');
            return;
        }
        if (!finalOdour) {
            alert('Please select the final odour assessment before finishing this batch.');
            return;
        }
        if (temperatureDifference != null && temperatureDifference > 8) {
            alert('The compost is not yet temperature-stable. Continue maturation until the temperature difference is 8°C or lower.');
            return;
        }
        if (!['earthy', 'musty', 'mushroom_like', 'odorless'].includes(finalOdour)) {
            alert('The final odour assessment indicates the compost is not mature enough to finish this batch yet.');
            return;
        }

        try {
            if (!batch.cloudId) {
                await this.upsertBatchToCloud(batch, { skipCreatedAt: false });
            }
        } catch (error) {
        }

        batch.finalAssessment = {
            finalCoreTemperature,
            ambientTemperature,
            temperatureDifference,
            finalMoistureType,
            finalMoistureValue,
            finalMoistureAssessment,
            finalOdour,
            finalCompostPhotos: Array.isArray(this.data.finishPhotoDraft) ? this.data.finishPhotoDraft.slice(0, 9) : []
        };
        const previousFinalPhotoCount = cloudPhotosEnabled ? this.normalizePhotoList(previousFinalPhotos).length : 0;
        let nextFinalPhotoCount = this.normalizePhotoList(batch.finalAssessment.finalCompostPhotos).length;
        if (cloudPhotosEnabled) {
            batch.finalAssessment.finalCompostPhotos = await this.syncPhotoListToCloud(
                batch,
                batch.finalAssessment.finalCompostPhotos,
                'final-assessment',
                'final'
            );
            nextFinalPhotoCount = this.normalizePhotoList(batch.finalAssessment.finalCompostPhotos).length;
            if (nextFinalPhotoCount > previousFinalPhotoCount) {
                const addedPhotoCount = nextFinalPhotoCount - previousFinalPhotoCount;
                this.appendBatchActivity(
                    batch,
                    'batch_final_photos_uploaded',
                    `Uploaded ${addedPhotoCount} final compost photo${addedPhotoCount === 1 ? '' : 's'}`,
                    { addedPhotoCount }
                );
            }
        }
        const estimatedOutput = this.calculateEstimatedCompostOutput(batch);
        batch.status = 'finished';
        batch.currentPhase = 'Finished';
        batch.finishedDate = this.getTodayISODateInTimeZone('Europe/Madrid');
        batch.output = {
            estimatedOutput,
            harvestStatus: batch.output?.harvestStatus === 'completed' ? 'completed' : 'pending',
            date: batch.output?.harvestStatus === 'completed' ? (batch.output?.date || '') : '',
            compostOutput: batch.output?.harvestStatus === 'completed' ? batch.output?.compostOutput : null,
            notes: batch.output?.notes || ''
        };
        this.appendBatchActivity(
            batch,
            'batch_finished',
            `Finished batch ${batch.id}`,
            {
                batchId: batch.id,
                estimatedOutput
            }
        );
        this.saveData();
        try {
            await this.upsertBatchToCloud(batch, { skipCreatedAt: true });
            if (cloudPhotosEnabled) {
                const previousPaths = this.getPhotoStoragePaths(previousFinalPhotos);
                const nextPaths = this.getPhotoStoragePaths(batch.finalAssessment.finalCompostPhotos);
                await this.deleteStorageFiles(previousPaths.filter((path) => !nextPaths.includes(path)));
            }
        } catch (error) {
            alert('Batch finished locally, but cloud sync failed. Please try again after refreshing.');
        }
        this.closeModal();
        const successMessage = sharedBatch && !cloudPhotosEnabled && nextFinalPhotoCount > 0
            ? '✅ Batch Successfully Finished (Photos saved locally only)'
            : '✅ Batch Successfully Finished';
        this.showTransientSuccessMessage(successMessage, 2300);
        window.setTimeout(() => {
            this.navigate('batchDetail', { batchId: routeId });
        }, 2300);
    },

    async deleteBatch(batchId) {
        const batch = this.findBatchByRouteId(batchId);
        const index = batch ? this.data.batches.findIndex((item) => this.getBatchRouteId(item) === this.getBatchRouteId(batch)) : -1;
        if (index < 0) return;
        if (!this.canDeleteBatch(batch)) {
            alert('Only the batch owner can delete this shared batch.');
            return;
        }

        if (!confirm(`Delete batch ${batch.id}? This action cannot be undone.`)) {
            return;
        }

        this.data.batches.splice(index, 1);
        if (this.data.currentBatch && this.getBatchRouteId(this.data.currentBatch) === this.getBatchRouteId(batch)) {
            this.data.currentBatch = null;
        }
        this.saveData();
        try {
            await this.deleteBatchFromCloud(batch);
        } catch (error) {
            alert('Batch deleted locally, but cloud delete failed. Please refresh and try again.');
        }
        this.navigate('dashboard');
    },

    exportData() {
        const batchId = document.getElementById('exportBatchId')?.value;
        if (!batchId) {
            alert('Please select a batch to export');
            return;
        }

        const batch = this.findBatchByRouteId(batchId);
        if (!batch) return;

        const dateFrom = document.getElementById('exportDateFrom')?.value;
        const dateTo = document.getElementById('exportDateTo')?.value;
        const format = document.querySelector('input[name="exportFormat"]:checked')?.value || 'csv';

        let records = (Array.isArray(batch.records) ? batch.records : []).map((record) => this.normalizeRecordForCompatibility(record, batch));
        if (dateFrom) {
            records = records.filter(r => r.date >= dateFrom);
        }
        if (dateTo) {
            records = records.filter(r => r.date <= dateTo);
        }

        const isICTA = this.isICTAUser();
        const batchSummaryEnabled = document.getElementById('exportModule-batchSummary')?.checked ?? true;
        const dailyRecordsEnabled = document.getElementById('exportModule-dailyRecords')?.checked ?? true;
        const transferRecordsEnabled = document.getElementById('exportModule-transferRecords')?.checked ?? true;
        const harvestEnabled = document.getElementById('exportModule-harvest')?.checked ?? true;
        const finalAssessmentEnabled = document.getElementById('exportModule-finalAssessment')?.checked ?? true;
        const inputUnit = this.getBatchInputUnitName(batch);
        const headers = ['Date', 'Composter'];
        const finalAssessment = batch.finalAssessment || {};
        const finishedDate = batch.finishedDate || '';
        const initialStockAmount = this.calculateInitialStockAmount(batch);
        const totalMaterialInput = this.calculateTotalMaterialInput(batch);
        const totalWaterAdded = this.calculateTotalWaterAdded(batch);
        const calculationSettings = this.getBatchCalculationSettings(batch);
        const communityType = this.data.currentCommunityType === 'Other'
            ? (this.data.currentCommunityTypeOther || 'Other')
            : (this.data.currentCommunityType || '');
        const getRecordActionExportValues = (record) => {
            const action = this.getICTAActionTakenState(record);
            const waterAddedAmount = action.waterAddedAmount != null && !isNaN(action.waterAddedAmount)
                ? (parseFloat(action.waterAddedAmount) || 0)
                : 0;
            return {
                turning: !!action.actionTurning,
                mixing: !!action.actionMixing,
                waterAdded: !!action.actionAddedWater || waterAddedAmount > 0,
                waterAddedAmount,
                removedImpurities: !!action.actionRemovedImpurities,
                removedImpuritiesDescription: String(action.removedImpuritiesDescription || '').trim(),
                otherAction: !!action.actionOther,
                otherActionDescription: String(action.otherActionDescription || '').trim()
            };
        };
        const getRecordMoistureExportValues = (record) => {
            const monitoring = this.getICTAMonitoringState(record);
            const type = monitoring.moistureAssessmentType || (monitoring.moistureQualitative ? 'qualitative' : 'quantitative');
            const quantitativeRaw = monitoring.moistureValue;
            const quantitative = quantitativeRaw != null && quantitativeRaw !== '' && !isNaN(quantitativeRaw) ? (parseFloat(quantitativeRaw) || 0) : '';
            const qualitative = monitoring.moistureQualitative || '';
            return {
                type,
                value: type === 'quantitative' ? quantitative : '',
                assessment: type === 'qualitative' ? qualitative : ''
            };
        };
        const formatOdourTypeLabel = (value) => {
            const v = String(value || '').trim();
            if (!v) return '';
            const map = {
                earth: 'Earthy',
                vinegar: 'Vinegar-like',
                rotten: 'Rotten',
                ammonia: 'Ammonia'
            };
            return map[v] || v;
        };
        const formatOdourDistanceLabel = (value) => {
            const v = String(value || '').trim();
            if (!v) return '';
            const map = {
                lt_1m: '<1 m',
                '1_5m': '1–5 m',
                gt_5m: '>5 m'
            };
            return map[v] || v;
        };
        const formatLeachateLabel = (value) => {
            const v = String(value || '').trim();
            if (!v) return '';
            const map = {
                yes: 'Yes',
                no: 'No',
                not_assessed: 'Not assessed'
            };
            return map[v] || v;
        };
        if (dailyRecordsEnabled) {
            if (document.getElementById('exportTotalInput')?.checked) headers.push(`Organic Waste (${inputUnit})`, `Structural Material (${inputUnit})`, `Total Material Input (${inputUnit})`);
            if (isICTA) {
                if (document.getElementById('exportCocinaPlanta')?.checked) {
                    headers.push(`Cocina (${inputUnit})`, `Planta 0 (${inputUnit})`, `Planta 1 (${inputUnit})`, `Planta 3 (${inputUnit})`);
                }
                if (document.getElementById('exportStructural')?.checked) headers.push('Ratio', `Wood (Fusta) (${inputUnit})`, `Wood chips (${inputUnit})`);
            } else {
                if (document.getElementById('exportTotalWasteInput')?.checked) headers.push(`Regular Organic Waste (${inputUnit})`);
                if (document.getElementById('exportStructuralMaterials')?.checked) headers.push('Structural Materials');
            }
            if (document.getElementById('exportAdditionalInput')?.checked) headers.push(`Additional Organic Material (${inputUnit})`, `Additional Structural Material (${inputUnit})`, `Total Additional Input (${inputUnit})`, 'Additional Source', 'Additional Type', `Additional Amount (${inputUnit})`);
            if (document.getElementById('exportQuality')?.checked) headers.push('Quality');

            if (document.getElementById('exportTemperature')?.checked) {
                headers.push('Ambient (°C)', 'Ambient Humidity (%)', 'Core (°C)', 'Transition (°C)', 'Outer (°C)', 'Avg Temp (°C)');
            }
            if (document.getElementById('exportMoisture')?.checked) headers.push('Moisture Type', 'Moisture (%)', 'Moisture Assessment');
            if (document.getElementById('exportPhase')?.checked) headers.push('Phase');
            if (document.getElementById('exportOperations')?.checked) {
                headers.push(
                    'Turning',
                    'Mixing',
                    'Water Added',
                    'Water Added Amount (L)',
                    'Removed Impurities',
                    'Removed Impurities Description',
                    'Other Action',
                    'Other Action Description'
                );
            }

            if (document.getElementById('exportOdour')?.checked) headers.push('Odour Detected', 'Odour Type', 'Odour Distance', 'Odour Note');
            if (document.getElementById('exportLeachate')?.checked) headers.push('Leachate Observed', 'Leachate Note');
            if (document.getElementById('exportRecordMetadata')?.checked) headers.push('Created By', 'Created Email', 'Created Time', 'Last Edited By', 'Last Edited Time');
        }

        const escapeCsv = (value) => {
            if (value === null || value === undefined) return '';
            const str = String(value);
            if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
            return str;
        };

        const escapeHtml = (value) => String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');

        const csvRows = [];
        const exportRows = [];
        const addBlankRow = () => {
            csvRows.push('');
            exportRows.push({ kind: 'blank', values: [] });
        };
        const pushExportRow = (values = [], kind = 'data') => {
            csvRows.push(values.map(escapeCsv).join(','));
            exportRows.push({
                kind,
                values: values.map((value) => value == null ? '' : String(value))
            });
        };
        const addSectionTitle = (title) => {
            if (csvRows.length > 0) addBlankRow();
            pushExportRow([title], 'section');
        };
        const addFieldValueSection = (title, entries) => {
            addSectionTitle(title);
            pushExportRow(['Field', 'Value'], 'header');
            entries.forEach(([label, value]) => pushExportRow([label, value], 'data'));
        };

        if (batchSummaryEnabled) {
            const batchSummaryEntries = [];
            if (document.getElementById('exportSummaryBasic')?.checked) {
                batchSummaryEntries.push(
                    ['Batch ID', batch.id],
                    ['Batch Status', batch.status || 'active'],
                    ['Organization', this.data.currentOrganization || ''],
                    ['Community Type', communityType],
                    ['Input Unit', inputUnit]
                );
            }
            if (document.getElementById('exportSummaryDates')?.checked) {
                batchSummaryEntries.push(
                    ['Start Date', batch.startDate ? this.formatDate(batch.startDate) : ''],
                    ['Finished Date', finishedDate ? this.formatDate(finishedDate) : ''],
                    ['Date Filter From', dateFrom ? this.formatDate(dateFrom) : 'All'],
                    ['Date Filter To', dateTo ? this.formatDate(dateTo) : 'All'],
                    ['Records Included', records.length]
                );
            }
            if (document.getElementById('exportSummaryTotals')?.checked) {
                batchSummaryEntries.push(
                    [`Initial Composting Stock (${inputUnit})`, initialStockAmount],
                    [`Total Material Input (${inputUnit})`, totalMaterialInput],
                    ['Total Water Added (L)', totalWaterAdded]
                );
            }
            if (document.getElementById('exportSummaryCalculation')?.checked) {
                batchSummaryEntries.push(
                    ['Compost Conversion Rate', `${this.formatNumber(calculationSettings.compostConversionRate * 100, 2)}%`]
                );
            }
            if (batchSummaryEntries.length > 0) {
                addFieldValueSection('BATCH SUMMARY', batchSummaryEntries);
            }
        }

        let phaseByRecordId = null;
        if (dailyRecordsEnabled && document.getElementById('exportPhase')?.checked) {
            phaseByRecordId = this.getBatchPhaseTracking(records).phaseByRecordId;
        }

        if (dailyRecordsEnabled) {
            addSectionTitle('DAILY RECORDS');
            if (records.length === 0) {
                pushExportRow(['No daily records found for the selected date range.'], 'note');
            } else {
                pushExportRow(headers, 'header');
            }

            records.forEach(r => {
                    const row = [r.date, r.composterId || ''];
                const materialBreakdown = this.calculateRecordMaterialBreakdown(r);
                const monitoringState = this.getICTAMonitoringState(r);
                const actionExport = getRecordActionExportValues(r);
                const metadata = this.normalizeRecordMetadata(r?.metadata);

                if (document.getElementById('exportTotalInput')?.checked) {
                    row.push(materialBreakdown.totalOrganicWaste, materialBreakdown.totalStructuralMaterial, materialBreakdown.totalMaterialInput);
                }
                if (isICTA) {
                    if (document.getElementById('exportCocinaPlanta')?.checked) {
                        if (r.input) {
                            row.push(r.input.cocina || 0, r.input.planta0 || 0, r.input.planta1 || 0, r.input.planta3 || 0);
                        } else {
                            row.push(0, 0, 0, 0);
                        }
                    }
                    if (document.getElementById('exportStructural')?.checked) {
                        row.push(r.input?.ratio || '', r.input?.woodFusta || 0, r.input?.woodChips || 0);
                    }
                } else {
                    if (document.getElementById('exportTotalWasteInput')?.checked) {
                        row.push(materialBreakdown.regularOrganicWaste);
                    }
                    if (document.getElementById('exportStructuralMaterials')?.checked) {
                        const materials = (r.input && Array.isArray(r.input.structuringMaterials)) ? r.input.structuringMaterials : [];
                        const formatted = materials
                            .map((m) => {
                                const name = String(m?.type || '').trim();
                                const amt = (m?.kg != null && !isNaN(m.kg)) ? (parseFloat(m.kg) || 0) : null;
                                if (!name && amt == null) return '';
                                if (amt == null) return name;
                                return `${name}: ${amt}`;
                            })
                            .filter(Boolean)
                            .join('; ');
                        row.push(formatted);
                    }
                }
                if (document.getElementById('exportAdditionalInput')?.checked) {
                    const items = Array.isArray(materialBreakdown.additionalInputs) ? materialBreakdown.additionalInputs : [];
                    if (items.length > 0) {
                        const sources = items
                            .map((i) => {
                                const source = String(i?.source || '').trim();
                                const desc = String(i?.description || '').trim();
                                if (!source && !desc) return '';
                                if (source && desc) return `${source} - ${desc}`;
                                return source || desc;
                            })
                            .filter(Boolean)
                            .join('; ');
                        const types = items
                            .map((i) => {
                                const t = String(i?.type || '').trim();
                                if (t === 'structural') return 'Structural Material';
                                if (t === 'organic') return 'Organic Material';
                                return t;
                            })
                            .filter(Boolean)
                            .join('; ');
                        const amounts = items
                            .map((i) => (i?.amount != null && !isNaN(i.amount)) ? String(parseFloat(i.amount) || 0) : '')
                            .filter(Boolean)
                            .join('; ');
                        row.push(
                            materialBreakdown.additionalOrganicMaterial,
                            materialBreakdown.additionalStructuralMaterial,
                            materialBreakdown.totalAdditionalInput,
                            sources,
                            types,
                            amounts
                        );
                    } else {
                        row.push(0, 0, 0, '', '', '');
                    }
                }
                if (document.getElementById('exportQuality')?.checked) {
                    row.push(r.input?.quality || '');
                }

                if (document.getElementById('exportTemperature')?.checked) {
                    if (monitoringState) {
                        const avg = this.calculateAvgTemperature(r);
                        row.push(
                            monitoringState.ambientTemperature ?? '',
                            monitoringState.ambientHumidity ?? '',
                            monitoringState.coreTemperature ?? '',
                            monitoringState.transitionTemperature ?? '',
                            monitoringState.outerTemperature ?? '',
                            avg
                        );
                    } else {
                        row.push('', '', '', '', '', '');
                    }
                }
                if (document.getElementById('exportMoisture')?.checked) {
                    const moistureExport = getRecordMoistureExportValues(r);
                    row.push(moistureExport.type, moistureExport.value, moistureExport.assessment);
                }
                if (document.getElementById('exportPhase')?.checked) {
                    row.push(phaseByRecordId ? (phaseByRecordId.get(r.id) || '') : '');
                }
                if (document.getElementById('exportOperations')?.checked) {
                    row.push(actionExport.turning ? 'Yes' : 'No');
                    row.push(actionExport.mixing ? 'Yes' : 'No');
                    row.push(actionExport.waterAdded ? 'Yes' : 'No');
                    row.push(actionExport.waterAddedAmount);
                    row.push(actionExport.removedImpurities ? 'Yes' : 'No');
                    row.push(actionExport.removedImpuritiesDescription || '');
                    row.push(actionExport.otherAction ? 'Yes' : 'No');
                    row.push(actionExport.otherActionDescription || '');
                }

                if (document.getElementById('exportOdour')?.checked) {
                    const odourDetected = monitoringState?.odourDetected;
                    row.push(odourDetected === true ? 'Yes' : (odourDetected === false ? 'No' : ''));
                    row.push(formatOdourTypeLabel(monitoringState?.odourType));
                    row.push(formatOdourDistanceLabel(monitoringState?.odourDistance));
                    row.push(r.observation?.odourNote || '');
                }
                if (document.getElementById('exportLeachate')?.checked) {
                    row.push(formatLeachateLabel(monitoringState?.leachateObserved));
                    row.push(r.observation?.leachateNote || '');
                }
                if (document.getElementById('exportRecordMetadata')?.checked) {
                    row.push(
                        metadata.createdByName || metadata.createdByEmail || '',
                        metadata.createdByEmail || '',
                        metadata.createdAt || '',
                        metadata.lastEditedByName || metadata.lastEditedByEmail || '',
                        metadata.lastEditedAt || ''
                    );
                }

                pushExportRow(row, 'data');
            });
        }

        if (transferRecordsEnabled) {
            const transferOverview = this.collectBatchTransferData(batch, { dateFrom, dateTo });
            if (document.getElementById('exportTransferSummary')?.checked) {
                addFieldValueSection('MATERIAL TRANSFER SUMMARY', [
                    ['Incoming Transfers', this.formatTransferSummaryText(transferOverview.incomingCount, transferOverview.incomingAmount, inputUnit)],
                    ['Outgoing Transfers', this.formatTransferSummaryText(transferOverview.outgoingCount, transferOverview.outgoingAmount, inputUnit)]
                ]);
            }
            if (document.getElementById('exportTransferHistory')?.checked) {
                addSectionTitle('MATERIAL TRANSFER HISTORY');
                if (transferOverview.history.length === 0) {
                    pushExportRow(['No material transfers found for the selected date range.'], 'note');
                } else {
                    pushExportRow([
                        'Transfer Date',
                        'Record Date',
                        'Source Batch',
                        'Source Composter',
                        'Destination Batch',
                        'Destination Composter',
                        'Material Type',
                        'Transferred Amount',
                        'Unit',
                        'Notes'
                    ], 'header');
                    transferOverview.history.forEach((entry) => {
                        pushExportRow([
                            entry.effectiveDate || '',
                            entry.recordDate || '',
                            entry.sourceBatchLabel || '',
                            entry.sourceComposterLabel || '',
                            entry.destinationBatchLabel || '',
                            entry.destinationComposterLabel || '',
                            entry.materialType || '',
                            entry.amount || 0,
                            entry.unit || inputUnit,
                            entry.notes || ''
                        ], 'data');
                    });
                }
            }
        }

        if (harvestEnabled && batch.output) {
            if (document.getElementById('exportOutput')?.checked) {
                const harvestEntries = [
                    ['Harvest Status', batch.output.harvestStatus || 'pending'],
                    [`Estimated Compost Output (${inputUnit})`, batch.output.estimatedOutput ?? ''],
                    ['Harvest Date', batch.output.date ? this.formatDate(batch.output.date) : ''],
                    [`Actual Compost Output (${inputUnit})`, batch.output.compostOutput ?? '']
                ];
                if (document.getElementById('exportMoistureFinal')?.checked) {
                    harvestEntries.push(
                        ['Final Moisture Type', finalAssessment.finalMoistureType || ''],
                        ['Final Moisture Value (%)', finalAssessment.finalMoistureValue ?? ''],
                        ['Final Moisture Assessment', finalAssessment.finalMoistureAssessment || '']
                    );
                }
                harvestEntries.push(['Notes', batch.output.notes || '']);
                addFieldValueSection('HARVEST SUMMARY', harvestEntries);
            }
        }

        if (finalAssessmentEnabled && document.getElementById('exportFinalAssessment')?.checked && batch.finalAssessment) {
            addFieldValueSection('FINAL COMPOST ASSESSMENT', [
                ['Final Core Temperature (°C)', finalAssessment.finalCoreTemperature ?? ''],
                ['Ambient Temperature (°C)', finalAssessment.ambientTemperature ?? ''],
                ['Temperature Difference (°C)', finalAssessment.temperatureDifference ?? ''],
                ['Final Moisture Type', finalAssessment.finalMoistureType || ''],
                ['Final Moisture Value (%)', finalAssessment.finalMoistureValue ?? ''],
                ['Final Moisture Assessment', finalAssessment.finalMoistureAssessment || ''],
                ['Final Odour', finalAssessment.finalOdour || ''],
                ['Final Compost Photos Count', Array.isArray(finalAssessment.finalCompostPhotos) ? finalAssessment.finalCompostPhotos.length : 0]
            ]);
        }

        if (exportRows.length === 0) {
            alert('Please select at least one export module or field.');
            return;
        }

        let blob;
        let downloadName;
        if (format === 'excel') {
            const renderTable = (rows) => {
                const maxCols = Math.max(1, ...rows.map((r) => r.values.length || 0));
                const renderRow = (row) => {
                    const isHeader = row.kind === 'header';
                    const isNote = row.kind === 'note';
                    const tag = isHeader ? 'th' : 'td';
                    const baseStyle = isHeader
                        ? 'background:#EEF4FB; color:#2F3A48; font-weight:700; padding:8px 10px; border:1px solid #D7E2EE; text-align:left; white-space:nowrap;'
                        : isNote
                            ? 'background:#FFFBEA; color:#7A6222; padding:9px 10px; border:1px solid #F1E1A6;'
                            : 'background:#FFFFFF; color:#2F3A48; padding:8px 10px; border:1px solid #E3EAF2; vertical-align:top; white-space:normal;';
                    const cells = [];
                    for (let i = 0; i < maxCols; i += 1) {
                        const value = row.values[i] || '';
                        cells.push(`<${tag} style="${baseStyle}">${escapeHtml(value)}</${tag}>`);
                    }
                    return `<tr>${cells.join('')}</tr>`;
                };
                return `
                    <table style="border-collapse: collapse; width: 100%; margin-top: 8px; margin-bottom: 16px;">
                        ${rows.map(renderRow).join('\n')}
                    </table>
                `;
            };

            const parts = [];
            let currentTableRows = [];
            const flushTable = () => {
                if (currentTableRows.length === 0) return;
                parts.push(renderTable(currentTableRows));
                currentTableRows = [];
            };

            exportRows.forEach((row) => {
                if (row.kind === 'section') {
                    flushTable();
                    parts.push(`<div style="margin-top:18px; background:#DCEBFF; color:#1E3A5F; font-weight:700; font-size:15px; padding:10px 12px; border:1px solid #BFD2EC;">${escapeHtml(row.values[0] || '')}</div>`);
                    return;
                }
                if (row.kind === 'blank') {
                    flushTable();
                    parts.push(`<div style="height: 10px;"></div>`);
                    return;
                }
                currentTableRows.push(row);
            });
            flushTable();

            const workbookHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
body { font-family: Arial, sans-serif; }
</style>
</head>
<body>
${parts.join('\n')}
</body>
</html>`;
            blob = new Blob([workbookHtml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
            downloadName = `${batch.id}_export.xls`;
        } else {
            const csvContent = csvRows.join('\n');
            blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            downloadName = `${batch.id}_export.csv`;
        }
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', downloadName);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        alert(`Data exported successfully as ${format === 'excel' ? 'Excel (.xls)' : 'CSV'}!`);
    }
};

document.addEventListener('DOMContentLoaded', () => {
    window.app = App;
    App.init();
});
