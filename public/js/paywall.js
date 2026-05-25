// LibroVoz - Paywall (Fase 1: scaffolding, sin pago real)
const Paywall = {
  init() {
    // Rellenar info pack principal
    const titleEl = document.getElementById('paywall-package-title');
    const priceEl = document.getElementById('paywall-price-amount');
    const detailEl = document.getElementById('paywall-package-detail');

    if (titleEl) titleEl.textContent = `Pack ${LIMITS.PACKAGE_BOOKS} libros con IA`;
    if (priceEl) priceEl.textContent = `$${LIMITS.PACKAGE_PRICE_MXN}`;
    if (detailEl) {
      const perBook = (LIMITS.PACKAGE_PRICE_MXN / LIMITS.PACKAGE_BOOKS).toFixed(2);
      detailEl.textContent = `Solo $${perBook} por libro`;
    }

    // Pack chat extra
    const chatTitle = document.getElementById('paywall-chat-title');
    const chatPrice = document.getElementById('paywall-chat-amount');
    if (chatTitle) chatTitle.textContent = `Pack ${LIMITS.CHAT_PACK_QUESTIONS} preguntas extra`;
    if (chatPrice) chatPrice.textContent = `$${LIMITS.CHAT_PACK_PRICE_MXN}`;
  },

  buyPackage(type) {
    // Fase 2: aquí se llamará a POST /api/checkout con { type }
    const label = type === 'chat' ? 'preguntas extra' : 'libros';
    App.showToast(`Pagos próximamente disponibles (${label})`, 'info');
  }
};
