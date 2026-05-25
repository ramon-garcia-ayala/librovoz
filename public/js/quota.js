// LibroVoz - Cuota tier-aware (free vs paid)
const Quota = {
  // ── Estado actual ────────────────────────────────────────────────────
  async getStatus() {
    const q = await DB.getQuota();
    const freeBooksRemaining = Math.max(0, LIMITS.FREE_TIER_BOOKS - q.freeBooksUsed);
    const freeChatRemaining = Math.max(0, LIMITS.FREE_TIER_CHAT - q.freeChatUsed);
    return {
      ...q,
      freeBooksRemaining,
      freeChatRemaining,
      totalBooksRemaining: freeBooksRemaining + q.paidBooksRemaining,
      totalChatRemaining: freeChatRemaining + q.paidChatRemaining,
      atBookLimit: freeBooksRemaining === 0 && q.paidBooksRemaining === 0,
      atChatLimit: freeChatRemaining === 0 && q.paidChatRemaining === 0,
      hasPaid: q.paidBooksRemaining > 0 || q.paidChatRemaining > 0 || q.summaryUnlocked
    };
  },

  // ── Capacidad ────────────────────────────────────────────────────────
  async canProcessBook() {
    const s = await this.getStatus();
    return !s.atBookLimit;
  },

  async canUseChat() {
    const s = await this.getStatus();
    return !s.atChatLimit;
  },

  // ── Qué tier consumirá el próximo crédito? ───────────────────────────
  async getBookTier() {
    const q = await DB.getQuota();
    if (q.paidBooksRemaining > 0) return 'paid';
    if (q.freeBooksUsed < LIMITS.FREE_TIER_BOOKS) return 'free';
    return null;
  },

  async getChatTier() {
    const q = await DB.getQuota();
    if (q.paidChatRemaining > 0) return 'paid';
    if (q.freeChatUsed < LIMITS.FREE_TIER_CHAT) return 'free';
    return null;
  },

  // ── Consumo (llamar después de uso exitoso) ──────────────────────────
  async consumeBook() {
    const tier = await this.getBookTier();
    if (tier === 'paid') await DB.consumePaidBook();
    else if (tier === 'free') await DB.consumeFreeBook();
    return tier;
  },

  async consumeChat() {
    const tier = await this.getChatTier();
    if (tier === 'paid') await DB.consumePaidChat();
    else if (tier === 'free') await DB.consumeFreeChat();
    return tier;
  },

  // ── Labels para UI ──────────────────────────────────────────────────
  async getBookLabel() {
    const s = await this.getStatus();
    if (s.paidBooksRemaining > 0) {
      return `${s.paidBooksRemaining} libro${s.paidBooksRemaining !== 1 ? 's' : ''} restante${s.paidBooksRemaining !== 1 ? 's' : ''}`;
    }
    if (s.atBookLimit) return `Has usado tus ${LIMITS.FREE_TIER_BOOKS} libros gratis`;
    return `Has usado ${s.freeBooksUsed} de ${LIMITS.FREE_TIER_BOOKS} libros gratis`;
  },

  async getChatLabel() {
    const s = await this.getStatus();
    if (s.paidChatRemaining > 0 && s.freeChatRemaining > 0) {
      return `${s.totalChatRemaining} preguntas restantes`;
    }
    if (s.paidChatRemaining > 0) {
      return `${s.paidChatRemaining} preguntas restantes`;
    }
    if (s.atChatLimit) return 'Sin preguntas disponibles';
    return `${s.freeChatRemaining} de ${LIMITS.FREE_TIER_CHAT} preguntas gratis`;
  }
};
