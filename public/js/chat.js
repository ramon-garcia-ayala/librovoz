// LibroVoz - Chat con IA sobre el libro actual
const Chat = {
  book: null,         // libro activo del player
  messages: [],       // historial cargado (se sincroniza con book.chatHistory)
  sending: false,

  // ── Abrir / cerrar modal ─────────────────────────────────────────────
  async open() {
    // Cargar el libro activo desde DB para tener su fullText + chatHistory
    const bookId = App.state._loadedBookId;
    if (!bookId) {
      App.showToast('No hay libro activo', 'error');
      return;
    }
    this.book = await DB.get(bookId);
    if (!this.book) {
      App.showToast('Libro no encontrado', 'error');
      return;
    }
    this.messages = this.book.chatHistory || [];

    // Inyectar markup si no existe
    if (!document.getElementById('chat-modal')) {
      await this.injectMarkup();
    }
    document.getElementById('chat-modal').classList.add('chat-open');
    document.body.classList.add('chat-locked');

    this.renderMessages();
    await this.updateCounter();
    this.setupHandlers();

    // Focus input después del slide-in
    setTimeout(() => {
      const input = document.getElementById('chat-input');
      if (input) input.focus();
    }, 300);
  },

  close() {
    const modal = document.getElementById('chat-modal');
    if (modal) modal.classList.remove('chat-open');
    document.body.classList.remove('chat-locked');
  },

  async injectMarkup() {
    try {
      const res = await fetch('/pages/chat.html');
      const html = await res.text();
      const wrapper = document.createElement('div');
      wrapper.innerHTML = html;
      document.body.appendChild(wrapper.firstElementChild || wrapper);
    } catch (err) {
      console.error('Error cargando chat partial:', err);
    }
  },

  setupHandlers() {
    const form = document.getElementById('chat-form');
    if (form && !form._wired) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = document.getElementById('chat-input');
        if (!input) return;
        const text = input.value.trim();
        if (text) this.send(text);
        input.value = '';
      });
      form._wired = true;
    }
  },

  // ── Render mensajes ───────────────────────────────────────────────────
  renderMessages() {
    const body = document.getElementById('chat-body');
    if (!body) return;

    if (this.messages.length === 0) {
      body.innerHTML = `
        <div class="chat-empty">
          <p>Pregúntale al libro lo que quieras saber. Por ejemplo:</p>
          <div class="chat-suggestions">
            ${this.suggestQuestions().map(q => `
              <button class="chat-chip" onclick="Chat.send('${q.replace(/'/g, "\\'")}')">${q}</button>
            `).join('')}
          </div>
        </div>
      `;
      return;
    }

    body.innerHTML = this.messages.map(m => `
      <div class="chat-msg chat-msg-${m.role}">
        <div class="chat-bubble">${this.escapeHtml(m.content)}</div>
      </div>
    `).join('');

    body.scrollTop = body.scrollHeight;
  },

  suggestQuestions() {
    const title = this.book?.title || 'este libro';
    return [
      `¿De qué trata ${title}?`,
      '¿Quién es el personaje principal?',
      '¿Cuál es la idea más importante?'
    ];
  },

  // ── Enviar pregunta ──────────────────────────────────────────────────
  async send(question) {
    if (this.sending) return;
    if (!question || !question.trim()) return;

    // Verificar cuota
    if (!(await Quota.canUseChat())) {
      this.showOutOfCreditsModal();
      return;
    }

    this.sending = true;

    // Mostrar mensaje del usuario + placeholder de IA
    this.messages.push({ role: 'user', content: question, ts: Date.now() });
    this.messages.push({ role: 'assistant', content: '...', ts: Date.now(), pending: true });
    this.renderMessages();

    try {
      // Historia previa (sin el placeholder)
      const history = this.messages
        .slice(0, -1)
        .filter(m => !m.pending)
        .slice(-LIMITS.MAX_CHAT_HISTORY);

      const result = await API.chat(
        this.book.fullText || '',
        this.book.title || '',
        history,
        question
      );

      // Reemplazar placeholder con respuesta real
      this.messages[this.messages.length - 1] = {
        role: 'assistant',
        content: result.answer || 'No pude responder esta pregunta.',
        ts: Date.now()
      };

      // Consumir crédito
      await Quota.consumeChat();

      // Guardar en DB
      this.book.chatHistory = this.messages;
      await DB.save(this.book);

      this.renderMessages();
      await this.updateCounter();
    } catch (err) {
      this.messages.pop(); // remove placeholder
      this.renderMessages();
      App.showToast(err.message || 'Error al enviar la pregunta', 'error');
    } finally {
      this.sending = false;
    }
  },

  // ── Counter de créditos ──────────────────────────────────────────────
  async updateCounter() {
    const el = document.getElementById('chat-counter');
    if (!el) return;
    const status = await Quota.getStatus();
    const label = await Quota.getChatLabel();

    el.textContent = label;
    el.classList.remove('warning', 'danger');
    if (status.atChatLimit) el.classList.add('danger');
    else if (status.totalChatRemaining <= 3) el.classList.add('warning');
  },

  showOutOfCreditsModal() {
    App.showToast(
      `Sin preguntas. Compra ${LIMITS.CHAT_PACK_QUESTIONS} más por $${LIMITS.CHAT_PACK_PRICE_MXN} MXN`,
      'error'
    );
    setTimeout(() => {
      this.close();
      App.go('paywall');
    }, 1500);
  },

  escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
};
