"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 滚动驱动的图片序列：相机往前推，图片一张张穿过；
 * 背景色和雾色跟着当前图片的氛围色渐变——整屏色调会随滚动变化。
 */
const SLIDES = [
  { src: "/images/hero-1.webp", color: 0x917160, label: "The late nights" },
  { src: "/images/hero-2.webp", color: 0xbeab8c, label: "The rebuilds" },
  { src: "/images/hero-3.webp", color: 0xa59f96, label: "The reviews" },
  { src: "/images/hero-4.webp", color: 0xd2a88d, label: "The wins nobody saw" },
  { src: "/images/hero-5.webp", color: 0xb07a6e, label: "The offer" },
] as const;

/** 每张图之间的纵深间距 */
const SPACING = 9;

const VERT = `
  varying vec2 vUv;
  varying float vDepth;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = `
  uniform sampler2D uMap;
  uniform vec3 uFog;
  uniform float uBlur;
  uniform float uNear;
  uniform float uFar;
  varying vec2 vUv;
  varying float vDepth;

  vec4 softSample(sampler2D tex, vec2 uv, float amount) {
    if (amount < 0.0005) return texture2D(tex, uv);
    vec4 sum = vec4(0.0);
    float total = 0.0;
    for (int i = -3; i <= 3; i++) {
      for (int j = -3; j <= 3; j++) {
        vec2 o = vec2(float(i), float(j)) * amount;
        float w = max(1.0 - length(vec2(float(i), float(j))) / 5.0, 0.0);
        sum += texture2D(tex, uv + o) * w;
        total += w;
      }
    }
    return sum / total;
  }

  void main() {
    vec4 tex = softSample(uMap, vUv, uBlur);

    // 边缘羽化，没有硬矩形边
    vec2 d = abs(vUv - 0.5) * 2.0;
    float edge = (1.0 - smoothstep(0.5, 1.0, d.x)) * (1.0 - smoothstep(0.5, 1.0, d.y));

    // 远处溶进当前的背景色；太近（穿过相机时）也淡出
    float far = smoothstep(uNear, uFar, vDepth);
    float near = 1.0 - smoothstep(0.0, 3.5, vDepth);
    vec3 color = mix(tex.rgb, uFog, far * 0.92);

    gl_FragColor = vec4(color, tex.a * edge * (1.0 - far) * (1.0 - near));
  }
`;

export function DepthHero({ onProgress }: { onProgress?: (p: number) => void }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let disposed = false;
    let cleanup: (() => void) | undefined;

    (async () => {
      try {
        const THREE = await import("three");
        if (disposed) return;

        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        mount.appendChild(renderer.domElement);
        Object.assign(renderer.domElement.style, {
          width: "100%",
          height: "100%",
          display: "block",
        });

        const scene = new THREE.Scene();
        const bg = new THREE.Color(SLIDES[0].color);
        scene.background = bg;
        renderer.setClearColor(bg, 1);

        const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 120);

        const loader = new THREE.TextureLoader();
        const meshes: InstanceType<typeof THREE.Mesh>[] = [];

        for (let i = 0; i < SLIDES.length; i++) {
          const texture = await new Promise<InstanceType<typeof THREE.Texture>>(
            (resolve, reject) => loader.load(SLIDES[i].src, resolve, undefined, reject)
          );
          if (disposed) return;
          texture.colorSpace = THREE.SRGBColorSpace;

          const image = texture.image as { width: number; height: number };
          const width = 7.2;
          const geometry = new THREE.PlaneGeometry(
            width,
            (width * image.height) / image.width,
            1,
            1
          );
          const material = new THREE.ShaderMaterial({
            vertexShader: VERT,
            fragmentShader: FRAG,
            transparent: true,
            depthWrite: false,
            uniforms: {
              uMap: { value: texture },
              uFog: { value: new THREE.Color(SLIDES[i].color) },
              uBlur: { value: 0 },
              uNear: { value: 6 },
              uFar: { value: 30 },
            },
          });

          const mesh = new THREE.Mesh(geometry, material);
          // 左右交替错开，滚动时不是正对着一张张糊上来
          mesh.position.set(i % 2 === 0 ? 1.1 : -1.3, i % 2 === 0 ? 0.2 : -0.3, -i * SPACING);
          mesh.rotation.z = (i % 2 === 0 ? -1 : 1) * 0.02;
          scene.add(mesh);
          meshes.push(mesh);
        }

        const resize = () => {
          const { clientWidth: w, clientHeight: h } = mount;
          renderer.setSize(w, h, false);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
        };
        resize();
        const ro = new ResizeObserver(resize);
        ro.observe(mount);

        let pointerX = 0;
        let pointerY = 0;
        const onPointer = (e: PointerEvent) => {
          pointerX = (e.clientX / window.innerWidth - 0.5) * 2;
          pointerY = (e.clientY / window.innerHeight - 0.5) * 2;
        };
        window.addEventListener("pointermove", onPointer, { passive: true });

        // 标签页切回来时 rAF 会暂停过，补一帧免得停在旧状态
        const onVisible = () => {
          if (document.visibilityState === "visible") renderer.render(scene, camera);
        };
        document.addEventListener("visibilitychange", onVisible);

        const colors = SLIDES.map((s) => new THREE.Color(s.color));
        const current = new THREE.Color(SLIDES[0].color);
        let camX = 0;
        let camY = 0;
        let smoothed = 0;
        let raf = 0;

        const render = () => {
          raf = requestAnimationFrame(render);

          // 滚动进度：0 → 1 走完整个序列
          const track = mount.closest("[data-scroll-track]") as HTMLElement | null;
          const el = track ?? mount;
          const rect = el.getBoundingClientRect();
          const total = el.offsetHeight - window.innerHeight;
          const raw = total > 0 ? Math.min(Math.max(-rect.top / total, 0), 1) : 0;
          smoothed += (raw - smoothed) * 0.08; // 缓动，避免生硬

          const t = smoothed * (SLIDES.length - 1);
          camera.position.z = 5 - t * SPACING;

          // 背景色在相邻两张之间插值——整屏色调随滚动渐变
          const i = Math.min(Math.floor(t), SLIDES.length - 2);
          current.copy(colors[i]).lerp(colors[i + 1], t - i);
          bg.copy(current);
          renderer.setClearColor(current, 1);

          for (const mesh of meshes) {
            const material = mesh.material as InstanceType<typeof THREE.ShaderMaterial>;
            material.uniforms.uFog.value.copy(current);
            const distance = camera.position.z - mesh.position.z;
            material.uniforms.uBlur.value = Math.min(
              Math.max((distance - 7) / 40, 0) * 0.005,
              0.005
            );
          }

          if (!reduced) {
            camX += (pointerX * 0.5 - camX) * 0.045;
            camY += (-pointerY * 0.3 - camY) * 0.045;
          }
          camera.position.x = camX;
          camera.position.y = camY;

          // 暴露当前色调，方便调试和验证（也让外层能读到）
          mount.dataset.tone = `#${current.getHexString()}`;
          mount.dataset.progress = smoothed.toFixed(3);

          onProgress?.(smoothed);
          renderer.render(scene, camera);
        };
        render();

        cleanup = () => {
          cancelAnimationFrame(raf);
          ro.disconnect();
          window.removeEventListener("pointermove", onPointer);
          document.removeEventListener("visibilitychange", onVisible);
          for (const mesh of meshes) {
            mesh.geometry.dispose();
            const material = mesh.material as InstanceType<typeof THREE.ShaderMaterial>;
            material.uniforms.uMap.value?.dispose?.();
            material.dispose();
          }
          renderer.dispose();
          renderer.domElement.remove();
        };
      } catch {
        if (!disposed) setFailed(true);
      }
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [onProgress]);

  if (failed) {
    return (
      <div
        aria-hidden
        className="absolute inset-0 bg-[#917160] bg-[url('/images/hero-1.webp')] bg-cover bg-center opacity-80"
      />
    );
  }

  return <div ref={mountRef} aria-hidden className="absolute inset-0" />;
}

export const HERO_SLIDES = SLIDES;
