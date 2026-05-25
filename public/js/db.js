// LibroVoz - Capa de persistencia IndexedDB
const DB = {
  dbName: 'librovoz-db',
  storeName: 'books',
  version: 1,
  _db: null,

  async open() {
    if (this._db) return this._db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'id' });
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
