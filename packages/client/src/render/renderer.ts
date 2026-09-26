import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export type Quality = 'low' | 'medium' | 'high';

/** Screen grading: thermal vision palette, EMP glitch, cyberspace scanlines. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    thermal: { value: 0 },
    emp: { value: 0 },
    cyber: { value: 0 },
    time: { value: 0 },
    hurt: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float thermal, emp, cyber, time, hurt;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    vec3 heat(float t) {
      t = clamp(t, 0.0, 1.0);
      vec3 a = vec3(0.02, 0.02, 0.12);
      vec3 b = vec3(0.35, 0.05, 0.55);
      vec3 c = vec3(1.0, 0.25, 0.05);
      vec3 d = vec3(1.0, 0.95, 0.55);
      if (t < 0.33) return mix(a, b, t / 0.33);
      if (t < 0.66) return mix(b, c, (t - 0.33) / 0.33);
      return mix(c, d, (t - 0.66) / 0.34);
    }
    void main() {
      vec2 uv = vUv;
      if (emp > 0.0) {
        float line = floor(uv.y * 90.0 + time * 30.0);
        float jitter = (hash(vec2(line, floor(time * 24.0))) - 0.5) * 0.04 * emp;
        if (hash(vec2(line * 0.37, floor(time * 12.0))) > 1.0 - emp * 0.35) uv.x += jitter;
      }
      vec3 col;
      if (cyber > 0.0) {
        float ca = 0.0018 * cyber;
        col = vec3(texture2D(tDiffuse, uv + vec2(ca, 0.0)).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - vec2(ca, 0.0)).b);
        col *= 0.92 + 0.08 * sin(uv.y * 900.0);
      } else {
        col = texture2D(tDiffuse, uv).rgb;
      }
      if (thermal > 0.0) {
        float l = dot(col, vec3(0.299, 0.587, 0.114));
        col = mix(col, heat(pow(l, 0.8) * 1.15), thermal);
      }
      if (emp > 0.0) {
        float n = hash(uv * vec2(640.0, 360.0) + time);
        float g = dot(col, vec3(0.333));
        col = mix(col, vec3(g) * vec3(0.7, 0.9, 1.1), emp * 0.6) + (n - 0.5) * 0.25 * emp;
      }
      if (hurt > 0.0) {
        float v = smoothstep(0.35, 0.9, length(vUv - 0.5) * 1.4);
        col = mix(col, vec3(0.8, 0.0, 0.05), v * hurt * 0.7);
      }
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  /** First-person weapon, drawn on top of the world. */
  readonly viewScene = new THREE.Scene();
  readonly viewCamera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass | null = null;
  private grade: ShaderPass;
  quality: Quality;
  private readonly meatFog = new THREE.FogExp2(0x0a0716, 0.00018);
  private readonly cyberFog = new THREE.FogExp2(0x000206, 0.00016);
  readonly hemi: THREE.HemisphereLight;
  readonly sun: THREE.DirectionalLight;
  baseFov = 74;

  constructor(container: HTMLElement, quality: Quality) {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({ antialias: quality !== 'low', powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'high' ? 2 : quality === 'medium' ? 1.25 : 0.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(this.baseFov, window.innerWidth / window.innerHeight, 2, 14000);
    this.viewCamera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 200);
    this.scene.background = new THREE.Color(0x07030f);
    this.scene.fog = this.meatFog;

    this.hemi = new THREE.HemisphereLight(0xb0c8ff, 0x2a1830, 1.6);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffe6d0, 1.1);
    this.sun.position.set(0.4, 1, 0.3);
    this.scene.add(this.sun);
    const vh = new THREE.HemisphereLight(0xcfe0ff, 0x302030, 2.2);
    this.viewScene.add(vh);
    const vd = new THREE.DirectionalLight(0xffffff, 1.4);
    vd.position.set(0.3, 1, 0.6);
    this.viewScene.add(vd);

    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (quality !== 'low') {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.7, 0.5, 0.96);
      this.composer.addPass(this.bloom);
    }
    const vp = new RenderPass(this.viewScene, this.viewCamera);
    vp.clear = false;
    vp.clearDepth = true;
    this.composer.addPass(vp);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());

    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewCamera.aspect = w / h;
    this.viewCamera.updateProjectionMatrix();
  }

  setMode(opts: { cyber: boolean; thermal: boolean; emp: number; hurt: number; time: number; zoom: boolean }): void {
    this.scene.fog = opts.cyber ? this.cyberFog : this.meatFog;
    (this.scene.background as THREE.Color).set(opts.cyber ? 0x000104 : 0x07030f);
    const u = this.grade.uniforms as typeof GradeShader.uniforms;
    u.thermal.value = opts.thermal ? 1 : 0;
    u.emp.value = Math.min(1, opts.emp);
    u.cyber.value = opts.cyber ? 1 : 0;
    u.time.value = opts.time;
    u.hurt.value = opts.hurt;
    if (this.bloom) this.bloom.strength = opts.cyber ? 1.0 : 0.7;
    const fov = opts.zoom ? 40 : this.baseFov;
    if (Math.abs(this.camera.fov - fov) > 0.1) {
      this.camera.fov += (fov - this.camera.fov) * 0.35;
      this.camera.updateProjectionMatrix();
    }
  }

  render(): void {
    this.composer.render();
  }
}
