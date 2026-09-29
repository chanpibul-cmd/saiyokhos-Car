/**
 * ระบบจัดการลายเซ็นดิจิทัลบน Canvas (Signature Pad)
 * รองรับทั้งเมาส์และหน้าจอสัมผัส (Touch Screen / Mobile) พร้อมปรับ DPI คมชัด
 */

class DigitalSignature {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.isDrawing = false;
    this.strokes = [];
    this.currentStroke = [];

    this.init();
  }

  init() {
    this.resize();
    
    // Mouse events
    this.canvas.addEventListener('mousedown', (e) => this.start(e));
    this.canvas.addEventListener('mousemove', (e) => this.draw(e));
    this.canvas.addEventListener('mouseup', () => this.stop());
    this.canvas.addEventListener('mouseleave', () => this.stop());

    // Touch events
    this.canvas.addEventListener('touchstart', (e) => this.start(e), { passive: false });
    this.canvas.addEventListener('touchmove', (e) => this.draw(e), { passive: false });
    this.canvas.addEventListener('touchend', () => this.stop(), { passive: false });
    this.canvas.addEventListener('touchcancel', () => this.stop(), { passive: false });

    // Resize observer if available
    if (window.ResizeObserver && this.canvas.parentElement) {
      const ro = new ResizeObserver(() => this.resize());
      ro.observe(this.canvas.parentElement);
    }
  }

  resize() {
    if (!this.canvas || !this.canvas.parentElement) return;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const width = rect.width > 0 ? rect.width : 300;
    const height = 160;

    // Save previous drawing if exists
    const hasDrawn = !this.isEmpty();
    let prevData = null;
    if (hasDrawn) {
      prevData = this.canvas.toDataURL();
    }

    // Set display size
    this.canvas.style.width = width + 'px';
    this.canvas.style.height = height + 'px';

    // Set actual size in memory (scaled for HiDPI)
    const scale = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(width * scale);
    this.canvas.height = Math.floor(height * scale);

    // Normalize coordinate system to use CSS pixels
    this.ctx.scale(scale, scale);
    this.ctx.lineWidth = 2.5;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    this.ctx.strokeStyle = isDark ? '#38bdf8' : '#1e293b';

    // Restore if was drawn
    if (prevData) {
      const img = new Image();
      img.onload = () => {
        this.ctx.drawImage(img, 0, 0, width, height);
      };
      img.src = prevData;
    }
  }

  getPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    const clientX = e.touches && e.touches.length > 0 ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches && e.touches.length > 0 ? e.touches[0].clientY : e.clientY;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  }

  start(e) {
    e.preventDefault();
    this.isDrawing = true;
    const pos = this.getPos(e);
    this.ctx.beginPath();
    this.ctx.moveTo(pos.x, pos.y);
    this.currentStroke = [pos];
  }

  draw(e) {
    if (!this.isDrawing) return;
    e.preventDefault();
    const pos = this.getPos(e);
    this.ctx.lineTo(pos.x, pos.y);
    this.ctx.stroke();
    this.currentStroke.push(pos);
  }

  stop() {
    if (!this.isDrawing) return;
    this.isDrawing = false;
    this.ctx.closePath();
    if (this.currentStroke.length > 0) {
      this.strokes.push([...this.currentStroke]);
      this.currentStroke = [];
    }
  }

  clear() {
    const width = parseFloat(this.canvas.style.width) || this.canvas.width;
    const height = parseFloat(this.canvas.style.height) || this.canvas.height;
    this.ctx.clearRect(0, 0, width, height);
    this.strokes = [];
    this.currentStroke = [];
  }

  isEmpty() {
    return this.strokes.length === 0;
  }

  toDataURL() {
    return this.canvas.toDataURL('image/png');
  }
}

window.DigitalSignature = DigitalSignature;
