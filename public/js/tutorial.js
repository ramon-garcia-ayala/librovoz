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

    slider.addEventListener('touchstart', (e) => {
      this.touchStartX = e.touches[0].clientX;
    }, { passive: true });

    slider.addEventListener('touchend', (e) => {
      const diff = this.touchStartX - e.changedTouches[0].clientX;
      if (Math.abs(diff) > 50) {
        if (diff > 0) this.next();
        else this.prev();
      }
    }, { passive: true });
  },

  updateUI() {
    const track = document.getElementById('tutorial-track');
    const dots = document.querySelectorAll('.dot');
    const btnNext = document.getElementById('btn-next');

    if (track) {
      track.style.transform = `translateX(-${this.currentStep * 100}%)`;
    }

    dots.forEach((dot, i) => {
      dot.classList.toggle('active', i === this.currentStep);
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
