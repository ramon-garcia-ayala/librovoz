// LibroVoz - Capa de persistencia IndexedDB
const DB = {
  dbName: 'librovoz-db',
  storeName: 'books',
  quotaStore: 'quota',
  version: 2,
  _db: null,

  QUOTA_KEY: 'singleton',

  defaultQuota() {
    return {
      id: this.QUOTA_KEY,
      freeBooksUsed: 0,
      freeChatUsed: 0,
      paidBooksRemaining: 0,
      paidChatRemaining: 0,
      summaryUnlocked: false,
      purchasedPacks: [],
      updatedAt: new Date().toISOString()
    };
  },

  async open() {
    if (this._db) return this._db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(this.quotaStore)) {
          db.createObjectStore(this.quotaStore, { keyPath: 'id' });
        }
      };

      request.onsuccess = (e) => {
        this._db = e.target.result;
        resolve(this._db);
      };

      request.onerror = () => {
        console.error('Error abriendo IndexedDB');
        reject(request.error);
      };
    });
  },

  // ── Quota helpers ────────────────────────────────────────────────────
  async getQuota() {
    try {
      const db = await this.open();
      return new Promise((resolve) => {
        const tx = db.transaction(this.quotaStore, 'readonly');
        const store = tx.objectStore(this.quotaStore);
        const request = store.get(this.QUOTA_KEY);
        request.onsuccess = () => resolve(request.result || this.defaultQuota());
        request.onerror = () => resolve(this.defaultQuota());
      });
    } catch {
      return this.defaultQuota();
    }
  },

  async updateQuota(updates) {
    try {
      const current = await this.getQuota();
      const next = { ...current, ...updates, updatedAt: new Date().toISOString() };
      const db = await this.open();
      return new Promise((resolve) => {
        const tx = db.transaction(this.quotaStore, 'readwrite');
        tx.objectStore(this.quotaStore).put(next);
        tx.oncomplete = () => resolve(next);
        tx.onerror = () => resolve(current);
      });
    } catch {
      return this.defaultQuota();
    }
  },

  async consumeFreeBook() {
    const q = await this.getQuota();
    return this.updateQuota({ freeBooksUsed: q.freeBooksUsed + 1 });
  },

  async consumePaidBook() {
    const q = await this.getQuota();
    return this.updateQuota({ paidBooksRemaining: Math.max(0, q.paidBooksRemaining - 1) });
  },

  async consumeFreeChat() {
    const q = await this.getQuota();
    return this.updateQuota({ freeChatUsed: q.freeChatUsed + 1 });
  },

  async consumePaidChat() {
    const q = await this.getQuota();
    return this.updateQuota({ paidChatRemaining: Math.max(0, q.paidChatRemaining - 1) });
  },

  async addPaidBooks(n) {
    const q = await this.getQuota();
    return this.updateQuota({
      paidBooksRemaining: q.paidBooksRemaining + n,
      summaryUnlocked: true
    });
  },

  async addPaidChat(n) {
    const q = await this.getQuota();
    return this.updateQuota({ paidChatRemaining: q.paidChatRemaining + n });
  },

  async getAll() {
    try {
      const db = await this.open();
      return new Promise((resolve) => {
        const tx = db.transaction(this.storeName, 'readonly');
        const store = tx.objectStore(this.storeName);
        const request = store.getAll();

        request.onsuccess = () => {
          const books = request.result || [];
          books.sort((a, b) => (b.lastPlayedAt || b.savedAt || '').localeCompare(a.lastPlayedAt || a.savedAt || ''));
          resolve(books);
        };

        request.onerror = () => resolve([]);
      });
    } catch {
      return [];
    }
  },

  async get(id) {
    try {
      const db = await this.open();
      return new Promise((resolve) => {
        const tx = db.transaction(this.storeName, 'readonly');
        const store = tx.objectStore(this.storeName);
        const request = store.get(id);

        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  },

  async save(book) {
    try {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);
        store.put(book);

        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      console.error('Error guardando libro:', err);
      return false;
    }
  },

  async delete(id) {
    try {
      const db = await this.open();
      return new Promise((resolve) => {
        const tx = db.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);
        store.delete(id);

        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
    } catch {
      return false;
    }
  },

  async updatePlaybackState(id, updates) {
    try {
      const book = await this.get(id);
      if (!book) return false;

      Object.assign(book, updates, { lastPlayedAt: new Date().toISOString() });
      return this.save(book);
    } catch {
      return false;
    }
  }
};
