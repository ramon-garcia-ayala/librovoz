// LibroVoz - Paywall (Fase 1: scaffolding, sin pago real)
const Paywall = {
  init() {
    // Rellenar precios desde LIMITS
    const titleEl = document.getElementById('paywall-package-title');
    const priceEl = document.getElementById('paywall-price-amount');
    const detailEl = document.getElementById('paywall-package-detail');

    if (titleEl) titleEl.textContent = `${LIMITS.PACKAGE_BOOKS} libros`;
    if (priceEl) priceEl.textContent = `$${LIMITS.PACKAGE_PRICE_MXN}`;
    if (detailEl) {
      const perBook = (LIMITS.PACKAGE_PRICE_MXN / LIMITS.PACKAGE_BOOKS).toFixed(2);
      detailEl.textContent = `Solo $${perBook} por libro`;
    }
  },

  buyPackage() {
    // Fase 2: aquí se llamará a POST /api/checkout para iniciar Stripe
    App.showToast('Pagos próximamente disponibles. ¡Gracias por tu interés!', 'info');
  }
};
