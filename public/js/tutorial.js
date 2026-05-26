// LibroVoz - Tutorial
const Tutorial = {
  currentStep: 0,
  totalSteps: 3,
  touchStartX: 0,

  init() {
    // Si ya se completó el tutorial, saltar al scanner
    if (localStorage.getItem('librovoz-tutorial-done')) {
      App.go('scanner');
      return;
    }

    this.currentStep = 0;
    this.updateUI();
    this.setupSwipe();
  },

  setupSwipe() {
    const slider = document.getElementById('tutorial-slider');
    if (!slider) return;

    let startX = 0, startY = 0;

    slider.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    }, { passive: true });

    slider.addEventListener('touchend', (e) => {
      const diffX = startX - e.changedTouches[0].clientX;
      const diffY = startY - e.changedTouches[0].clientY;
      // Solo dispara si el swipe es CLARAMENTE horizontal (no scroll vertical
      // accidental). Threshold subido a 80px + diffX debe dominar diffY 1.5×.
      if (Math.abs(diffX) > 80 && Math.abs(diffX) > Math.abs(diffY) * 1.5) {
        if (diffX > 0) this.next();
        else this.prev();
      }
    }, { passive: true });
  },

  updateUI() {
    const track = document.getElementById('tutorial-track');
    const dots = document.querySelectorAll('.dot');
    const btnNext = document.getElementById('btn-next');

    // Guard defensivo: si el DOM crítico no está montado, no continuar
    // y dejar log para debugging
    if (!track) {
      console.warn('[Tutorial] DOM no está montado aún, updateUI() abortado');
      return;
    }

    track.style.transform = `translateX(-${this.currentStep * 100}%)`;

    dots.forEach((dot, i) => {
      const isActive = i === this.currentStep;
      dot.classList.toggle('active', isActive);
      // Accesibilidad WCAG 2.1 AA: lectores de pantalla anuncian el paso actual
      if (isActive) {
        dot.setAttribute('aria-current', 'page');
      } else {
        dot.removeAttribute('aria-current');
      }
      dot.setAttribute('aria-label', `Paso ${i + 1} de ${this.totalSteps}`);
    });

    if (btnNext) {
      if (this.currentStep === this.totalSteps - 1) {
        btnNext.textContent = 'Comenzar a escanear';
      } else {
        btnNext.textContent = 'Siguiente';
      }
    }
  },

  next() {
    if (this.currentStep < this.totalSteps - 1) {
      this.currentStep++;
      this.updateUI();
    } else {
      this.complete();
    }
  },

  prev() {
    if (this.currentStep > 0) {
      this.currentStep--;
      this.updateUI();
    }
  },

  skip() {
    this.complete();
  },

  complete() {
    localStorage.setItem('librovoz-tutorial-done', '1');
    App.go('scanner');
  }
};
