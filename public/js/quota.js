// LibroVoz - Helper de cuota gratuita (client-side, Fase 1)
const Quota = {
  async getStatus() {
    const books = await DB.getAll();
    const used = books.length;
    const limit = LIMITS.FREE_TIER_BOOKS;
    return {
      used,
      limit,
      remaining: Math.max(0, limit - used),
      atLimit: used >= limit
    };
  },

  // Mensaje breve para mostrar en UI: "2 de 3 libros gratis"
  async getLabel() {
    const { used, limit, atLimit } = await this.getStatus();
    if (atLimit) return `Has usado tus ${limit} libros gratis`;
    return `Has usado ${used} de ${limit} libros gratis`;
  }
};
