import React, { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: #000;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    canvas {
      display: block;
      background: #000;
    }
  </style>
</head>
<body>
  <canvas id="aurel"></canvas>
  <script>
    const canvas = document.getElementById('aurel');
    const ctx = canvas.getContext('2d');

    let W = 0;
    let H = 0;
    let cx = 0;
    let cy = 0;
    let S = 1;
    let particles = [];
    let t = 0;
    let state = 'idle';
    let targetSpread = 0;
    let currentSpread = 0;

    let lookX = 0;
    let lookY = 0;
    let velX = 0;
    let velY = 0;
    let targetLX = 0;
    let targetLY = 0;
    let lookTimer = 0;
    let nextLook = 1;
    let blinkT = 0;
    let blinking = false;
    let blinkP = 0;
    let nextBlink = 2 + Math.random() * 2;

    function setState(nextState) {
      state = nextState || 'idle';
      targetSpread = state === 'idle' ? 0 : state === 'listening' ? 1 : 0.6;
    }

    window.setAurelState = setState;
    window.setState = setState;

    window.addEventListener('message', function(event) {
      try {
        const data = JSON.parse(event.data);
        if (data.state) setState(data.state);
      } catch (error) {}
    });
    document.addEventListener('message', function(event) {
      try {
        const data = JSON.parse(event.data);
        if (data.state) setState(data.state);
      } catch (error) {}
    });

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      const size = Math.min(window.innerWidth, window.innerHeight);
      W = size;
      H = size;
      cx = W / 2;
      cy = H / 2;
      S = W / 340;
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      canvas.width = Math.floor(W * dpr);
      canvas.height = Math.floor(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      createParticles();
    }

    function createParticles() {
      const rings = [
        { count: 180, baseR: 95 * S, sizeRange: [1.2 * S, 3.2 * S], spreadMult: 1.0 },
        { count: 200, baseR: 105 * S, sizeRange: [1.0 * S, 2.6 * S], spreadMult: 1.3 },
        { count: 160, baseR: 115 * S, sizeRange: [0.8 * S, 2.2 * S], spreadMult: 1.7 }
      ];

      particles = [];
      rings.forEach(function(ring) {
        for (let i = 0; i < ring.count; i += 1) {
          const baseAngle = (i / ring.count) * Math.PI * 2 + (Math.random() - 0.5) * 0.04;
          particles.push({
            baseAngle,
            baseR: ring.baseR + (Math.random() - 0.5) * 6 * S,
            angle: baseAngle,
            r: ring.baseR,
            x: 0,
            y: 0,
            size: ring.sizeRange[0] + Math.random() * (ring.sizeRange[1] - ring.sizeRange[0]),
            speed: 0.002 + Math.random() * 0.004,
            drift: (Math.random() - 0.5) * 0.015,
            phase: Math.random() * Math.PI * 2,
            brightness: 0.3 + Math.random() * 0.7,
            spreadDir: Math.random() < 0.5 ? -(0.5 + Math.random() * 0.5) : (0.5 + Math.random() * 0.5),
            spreadPhase: Math.random() * Math.PI * 2,
            spreadMult: ring.spreadMult
          });
        }
      });
    }

    function drawParticles() {
      currentSpread += (targetSpread - currentSpread) * 0.035;
      const idleBreath = Math.sin(t * 0.6) * 25 * S;

      particles.forEach(function(particle) {
        particle.angle += particle.speed + particle.drift * 0.08;
        const idleMove = idleBreath * particle.spreadDir * 0.5
          + Math.sin(t * 0.9 + particle.phase) * 15 * S * particle.spreadDir;
        const activeSpread = currentSpread
          * particle.spreadDir
          * particle.spreadMult
          * (90 * S + Math.sin(t * 0.7 + particle.spreadPhase) * 30 * S);
        const speakingWave = state === 'speaking'
          ? Math.sin(t * 9 + particle.baseAngle * 4) * 35 * S * currentSpread
          : 0;
        particle.r = particle.baseR + idleMove * (1 - currentSpread * 0.6) + activeSpread + speakingWave;
        particle.x = cx + Math.cos(particle.angle) * particle.r;
        particle.y = cy + Math.sin(particle.angle) * particle.r;
      });

      particles.forEach(function(particle) {
        const dist = Math.abs(particle.r - particle.baseR);
        const alpha = Math.max(
          0,
          Math.min(1, particle.brightness * (0.3 + currentSpread * 0.4 + Math.sin(t * 1.8 + particle.phase) * 0.15))
        );
        const size = particle.size * (0.6 + currentSpread * 0.7 + dist / (100 * S));
        const green = Math.floor(160 + particle.brightness * 95);
        const blue = Math.floor(20 + particle.brightness * 40);

        ctx.beginPath();
        ctx.arc(particle.x, particle.y, Math.max(0.5, size * 2.2), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,' + green + ',' + blue + ',' + (alpha * 0.22) + ')';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(particle.x, particle.y, Math.max(0.5, size), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,' + green + ',' + blue + ',' + alpha + ')';
        ctx.fill();

        if (particle.brightness > 0.75) {
          ctx.beginPath();
          ctx.arc(particle.x, particle.y, size * 4, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(0,255,65,' + (alpha * 0.07) + ')';
          ctx.fill();
        }
      });
    }

    function drawBall() {
      const innerGlow = ctx.createRadialGradient(cx, cy, 55 * S, cx, cy, 110 * S);
      innerGlow.addColorStop(0, 'rgba(0,0,0,0)');
      innerGlow.addColorStop(0.6, 'rgba(0,' + Math.floor(60 + currentSpread * 80) + ',15,0.07)');
      innerGlow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.beginPath();
      ctx.arc(cx, cy, 110 * S, 0, Math.PI * 2);
      ctx.fillStyle = innerGlow;
      ctx.fill();

      const ballGradient = ctx.createRadialGradient(cx - 18 * S, cy - 20 * S, 5 * S, cx, cy, 83 * S);
      ballGradient.addColorStop(0, '#152a18');
      ballGradient.addColorStop(0.4, '#0a1a0c');
      ballGradient.addColorStop(0.8, '#050e06');
      ballGradient.addColorStop(1, '#020604');
      ctx.beginPath();
      ctx.arc(cx, cy, 83 * S, 0, Math.PI * 2);
      ctx.fillStyle = ballGradient;
      ctx.fill();

      const rim = ctx.createRadialGradient(cx, cy, 78 * S, cx, cy, 88 * S);
      rim.addColorStop(0, 'rgba(0,0,0,0)');
      rim.addColorStop(0.5, 'rgba(0,' + Math.floor(140 + currentSpread * 90) + ',35,' + (0.1 + currentSpread * 0.1) + ')');
      rim.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.beginPath();
      ctx.arc(cx, cy, 88 * S, 0, Math.PI * 2);
      ctx.fillStyle = rim;
      ctx.fill();
    }

    function updateEyes() {
      lookTimer += 0.016;
      if (lookTimer > nextLook) {
        lookTimer = 0;
        nextLook = 0.4 + Math.random() * (state === 'idle' ? 1.8 : 0.5);
        targetLX = (Math.random() - 0.5) * 70 * S;
        targetLY = (Math.random() - 0.5) * 50 * S;
      }

      velX += (targetLX - lookX) * 0.28;
      velX *= 0.58;
      velY += (targetLY - lookY) * 0.28;
      velY *= 0.58;
      lookX += velX;
      lookY += velY;

      blinkT += 0.016;
      if (!blinking && blinkT > nextBlink) {
        blinking = true;
        blinkP = 0;
        nextBlink = 2 + Math.random() * 2;
        blinkT = 0;
      }
      if (blinking) {
        blinkP += 0.2;
        if (blinkP >= 1) {
          blinking = false;
          blinkP = 0;
        }
      }
    }

    function drawEyes() {
      updateEyes();
      const blinkScale = blinking ? Math.max(0.04, Math.abs(Math.cos(blinkP * Math.PI))) : 1;
      const eyeR = 5.2 * S;
      const eyeDistance = 17 * S;
      const eyeY = cy - 3 * S;
      const eyes = [
        [cx - eyeDistance + lookX, eyeY + lookY],
        [cx + eyeDistance + lookX, eyeY + lookY]
      ];

      eyes.forEach(function(eye) {
        ctx.save();
        ctx.translate(eye[0], eye[1]);
        ctx.scale(1, blinkScale);

        const glow = ctx.createRadialGradient(0, 0, eyeR * 0.4, 0, 0, eyeR * 4);
        glow.addColorStop(0, 'rgba(0,255,65,1)');
        glow.addColorStop(0.3, 'rgba(0,255,65,0.55)');
        glow.addColorStop(0.65, 'rgba(0,200,50,0.2)');
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.beginPath();
        ctx.arc(0, 0, eyeR * 4, 0, Math.PI * 2);
        ctx.fillStyle = glow;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(0, 0, eyeR, 0, Math.PI * 2);
        ctx.fillStyle = '#00ff41';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(-1 * S, -1.2 * S, eyeR * 0.38, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(200,255,200,0.9)';
        ctx.fill();

        ctx.restore();
      });
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);
      drawParticles();
      drawBall();
      drawEyes();
      t += 0.016;
      requestAnimationFrame(draw);
    }

    window.addEventListener('resize', resize);
    resize();
    draw();
  </script>
</body>
</html>`;

const normalizeState = (state) => {
  if (state === 'LISTENING' || state === 'listening') return 'listening';
  if (state === 'SPEAKING' || state === 'speaking') return 'speaking';
  return 'idle';
};

export default function AurelFace({ state }) {
  const webViewRef = useRef(null);

  useEffect(() => {
    const nextState = normalizeState(state);
    webViewRef.current?.injectJavaScript(`
      window.setAurelState && window.setAurelState('${nextState}');
      true;
    `);
  }, [state]);

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        source={{ html: htmlContent }}
        originWhitelist={['*']}
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        javaScriptEnabled
        style={styles.webview}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 300,
    height: 300,
    backgroundColor: '#000',
    borderRadius: 150,
    overflow: 'hidden',
  },
  webview: {
    flex: 1,
    backgroundColor: '#000',
  },
});
