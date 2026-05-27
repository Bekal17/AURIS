import React, { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { GLView } from 'expo-gl';

const PARTICLE_COUNT = 540;

const normalizeState = (state) => {
  if (state === 'LISTENING') return 'listening';
  if (state === 'SPEAKING') return 'speaking';
  if (state === 'PROCESSING') return 'processing';
  return 'idle';
};

const compileShader = (gl, type, source) => {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn('AurelFace shader compile failed:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }

  return shader;
};

export default function AurelFace({ state }) {
  const stateRef = useRef(normalizeState(state));
  const animationFrameRef = useRef(null);
  const stoppedRef = useRef(false);

  useEffect(() => {
    stateRef.current = normalizeState(state);
  }, [state]);

  useEffect(() => () => {
    stoppedRef.current = true;
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
  }, []);

  const onContextCreate = async (gl) => {
    stoppedRef.current = false;

    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, `
      attribute vec2 position;
      attribute float size;
      attribute float alpha;
      varying float vAlpha;

      void main() {
        vAlpha = alpha;
        gl_Position = vec4(position, 0.0, 1.0);
        gl_PointSize = size;
      }
    `);

    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, `
      precision mediump float;
      varying float vAlpha;

      void main() {
        vec2 coord = gl_PointCoord - vec2(0.5);
        float dist = length(coord);
        if (dist > 0.5) discard;
        gl_FragColor = vec4(0.0, 1.0, 0.255, vAlpha * (1.0 - dist * 2.0));
      }
    `);

    if (!vertexShader || !fragmentShader) {
      return;
    }

    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn('AurelFace program link failed:', gl.getProgramInfoLog(program));
      return;
    }

    gl.useProgram(program);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0, 0, 0, 1);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const posLoc = gl.getAttribLocation(program, 'position');
    const sizeLoc = gl.getAttribLocation(program, 'size');
    const alphaLoc = gl.getAttribLocation(program, 'alpha');

    const particles = Array.from({ length: PARTICLE_COUNT }, (_, index) => {
      const ring = index < 180 ? 0 : index < 380 ? 1 : 2;
      const ringSize = ring === 0 ? 180 : ring === 1 ? 200 : 160;
      const ringIndex = ring === 0 ? index : ring === 1 ? index - 180 : index - 380;
      const baseAngle = (ringIndex / ringSize) * Math.PI * 2 + (Math.random() - 0.5) * 0.04;

      return {
        baseAngle,
        baseR: [0.48, 0.57, 0.66][ring] + (Math.random() - 0.5) * 0.04,
        angle: baseAngle,
        speed: 0.002 + Math.random() * 0.004,
        phase: Math.random() * Math.PI * 2,
        brightness: 0.3 + Math.random() * 0.7,
        spreadDir: Math.random() < 0.5 ? -(0.5 + Math.random() * 0.5) : (0.5 + Math.random() * 0.5),
        spreadMult: [1.0, 1.3, 1.7][ring],
        size: 2 + Math.random() * 4,
      };
    });

    const posData = new Float32Array(PARTICLE_COUNT * 2);
    const sizeData = new Float32Array(PARTICLE_COUNT);
    const alphaData = new Float32Array(PARTICLE_COUNT);
    const posBuf = gl.createBuffer();
    const sizeBuf = gl.createBuffer();
    const alphaBuf = gl.createBuffer();

    let t = 0;
    let currentSpread = 0;

    const uploadAttribute = (buffer, location, data, size) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    };

    const animate = () => {
      if (stoppedRef.current) {
        return;
      }

      const faceState = stateRef.current;
      const targetSpread = faceState === 'idle' ? 0 : faceState === 'listening' ? 1 : 0.6;
      currentSpread += (targetSpread - currentSpread) * 0.035;

      gl.clear(gl.COLOR_BUFFER_BIT);

      const idleBreath = Math.sin(t * 0.6) * 0.07;

      particles.forEach((particle, index) => {
        particle.angle += particle.speed;

        const idleMove = idleBreath * particle.spreadDir
          + Math.sin(t * 0.9 + particle.phase) * 0.04 * particle.spreadDir;
        const activeSpread = currentSpread
          * particle.spreadDir
          * particle.spreadMult
          * (0.26 + Math.sin(t * 0.7) * 0.09);
        const speakingPulse = faceState === 'speaking'
          ? Math.sin(t * 9 + particle.baseAngle * 4) * 0.1 * currentSpread
          : 0;
        const r = particle.baseR + idleMove * (1 - currentSpread * 0.6) + activeSpread + speakingPulse;

        posData[index * 2] = Math.cos(particle.angle) * r;
        posData[index * 2 + 1] = Math.sin(particle.angle) * r;
        alphaData[index] = Math.min(
          1,
          particle.brightness * (0.3 + currentSpread * 0.4 + Math.sin(t * 1.8 + particle.phase) * 0.15),
        );
        sizeData[index] = particle.size * (0.6 + currentSpread * 0.7 + Math.abs(r - particle.baseR) * 3);
      });

      uploadAttribute(posBuf, posLoc, posData, 2);
      uploadAttribute(sizeBuf, sizeLoc, sizeData, 1);
      uploadAttribute(alphaBuf, alphaLoc, alphaData, 1);

      gl.drawArrays(gl.POINTS, 0, PARTICLE_COUNT);
      gl.endFrameEXP();

      t += 0.016;
      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animate();
  };

  return (
    <View style={styles.container}>
      <GLView style={styles.glview} onContextCreate={onContextCreate} />
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
  glview: {
    flex: 1,
  },
});
