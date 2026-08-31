// Bootstrap stub — replaced by the real App wiring in the integration phase.

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d');

function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

function draw(): void {
  if (!ctx) return;
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
  ctx.fillStyle = '#3a7d2c';
  ctx.font = 'bold 64px "Trebuchet MS", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('MADden', window.innerWidth / 2, window.innerHeight / 2 - 20);
  ctx.fillStyle = '#8b949e';
  ctx.font = '20px "Trebuchet MS", system-ui, sans-serif';
  ctx.fillText('Phase 0 scaffold — game under construction', window.innerWidth / 2, window.innerHeight / 2 + 24);
}

window.addEventListener('resize', resize);
resize();
