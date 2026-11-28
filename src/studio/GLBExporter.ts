import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import type { GlbExportMetrics } from '../types/studioTypes';

export interface GlbExportOptions {
  animations?: THREE.AnimationClip[];
  maxTextureSize?: number;
  encodeOpaqueAsJpeg?: boolean;
  jpegQuality?: number;
  targetFps?: number;
}

interface DetachedHelperRecord {
  node: THREE.Object3D;
  parent: THREE.Object3D;
}

interface SwappedTextureRecord {
  texture: THREE.Texture;
  originalImage: unknown;
}

/**
 * Resample animation tracks cleanly to 30 fps QuaternionKeyframeTrack / NumberKeyframeTrack
 * so UE5 imports crisp baked skeletal curves without bloat.
 */
export function bakeClipsToFps(
  clips: THREE.AnimationClip[],
  fps = 30
): THREE.AnimationClip[] {
  const step = 1 / Math.max(15, fps);
  return clips.map((clip) => {
    const duration = Math.max(clip.duration, step);
    const frameCount = Math.max(2, Math.round(duration * fps) + 1);
    const sampleTimes = new Float32Array(frameCount);
    for (let i = 0; i < frameCount; i++) {
      sampleTimes[i] = Math.min(duration, i * step);
    }

    const bakedTracks: THREE.KeyframeTrack[] = [];
    for (const track of clip.tracks) {
      if (track instanceof THREE.QuaternionKeyframeTrack) {
        const resultBuf = new Float32Array(4);
        const interp = new THREE.QuaternionLinearInterpolant(
          track.times,
          track.values,
          4,
          resultBuf
        );
        const values = new Float32Array(frameCount * 4);
        for (let i = 0; i < frameCount; i++) {
          const res = interp.evaluate(sampleTimes[i]);
          const qx = res[0];
          const qy = res[1];
          const qz = res[2];
          const qw = res[3];
          const len = Math.hypot(qx, qy, qz, qw) || 1;
          values[i * 4] = qx / len;
          values[i * 4 + 1] = qy / len;
          values[i * 4 + 2] = qz / len;
          values[i * 4 + 3] = qw / len;
        }
        bakedTracks.push(new THREE.QuaternionKeyframeTrack(track.name, sampleTimes, values));
      } else if (track instanceof THREE.VectorKeyframeTrack) {
        const stride = track.getValueSize();
        const resultBuf = new Float32Array(stride);
        const interp = new THREE.LinearInterpolant(
          track.times,
          track.values,
          stride,
          resultBuf
        );
        const values = new Float32Array(frameCount * stride);
        for (let i = 0; i < frameCount; i++) {
          const res = interp.evaluate(sampleTimes[i]);
          for (let k = 0; k < stride; k++) {
            values[i * stride + k] = res[k];
          }
        }
        bakedTracks.push(new THREE.VectorKeyframeTrack(track.name, sampleTimes, values));
      } else if (track instanceof THREE.NumberKeyframeTrack) {
        const stride = track.getValueSize();
        const resultBuf = new Float32Array(stride);
        const interp = new THREE.LinearInterpolant(
          track.times,
          track.values,
          stride,
          resultBuf
        );
        const values = new Float32Array(frameCount * stride);
        for (let i = 0; i < frameCount; i++) {
          const res = interp.evaluate(sampleTimes[i]);
          for (let k = 0; k < stride; k++) {
            values[i * stride + k] = res[k];
          }
        }
        bakedTracks.push(new THREE.NumberKeyframeTrack(track.name, sampleTimes, values));
      } else {
        bakedTracks.push(track.clone());
      }
    }

    return new THREE.AnimationClip(clip.name, duration, bakedTracks);
  });
}

async function encodeCanvasToJpegImage(
  sourceCanvas: HTMLCanvasElement,
  maxSize: number,
  quality: number
): Promise<HTMLImageElement | null> {
  if (typeof document === 'undefined') return null;

  const w = Math.min(sourceCanvas.width, maxSize);
  const h = Math.min(sourceCanvas.height, maxSize);

  let blob: Blob | null = null;
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      const off = new OffscreenCanvas(w, h);
      const ctx = off.getContext('2d');
      if (ctx) {
        ctx.drawImage(sourceCanvas, 0, 0, w, h);
        blob = await off.convertToBlob({ type: 'image/jpeg', quality });
      }
    }
  } catch {
    blob = null;
  }

  if (!blob) {
    const tmp = document.createElement('canvas');
    tmp.width = w;
    tmp.height = h;
    const ctx = tmp.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(sourceCanvas, 0, 0, w, h);
    blob = await new Promise<Blob | null>((resolve) =>
      tmp.toBlob((b) => resolve(b), 'image/jpeg', quality)
    );
  }

  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Failed to decode JPEG albedo blob'));
      el.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Strip `userData.excludeFromGLB === true` helpers, verify shared packed ORM textures
 * (so GLTFExporter skips slow buildMetalRoughTexture()), optionally JPEG-encode opaque
 * albedo maps via OffscreenCanvas.convertToBlob(), and export via async parseAsync().
 */
export async function exportSceneObjectToGLB(
  root: THREE.Object3D,
  options: GlbExportOptions = {}
): Promise<{ buffer: ArrayBuffer; metrics: GlbExportMetrics }> {
  const t0 = performance.now();
  const maxTextureSize = options.maxTextureSize ?? 1024;
  const encodeOpaqueAsJpeg = options.encodeOpaqueAsJpeg ?? true;
  const jpegQuality = options.jpegQuality ?? 0.88;
  const targetFps = options.targetFps ?? 30;

  // 1. Detach all nodes marked userData.excludeFromGLB = true or non-exportable runtime helpers
  const detached: DetachedHelperRecord[] = [];
  const toDetach: THREE.Object3D[] = [];
  root.traverse((obj) => {
    if (obj === root) return;
    if (
      obj.userData?.excludeFromGLB === true ||
      obj.userData?.isLensHelper === true ||
      obj instanceof THREE.Light ||
      obj instanceof THREE.Camera
    ) {
      toDetach.push(obj);
    }
  });
  for (const node of toDetach) {
    if (node.parent) {
      detached.push({ node, parent: node.parent });
      node.parent.remove(node);
    }
  }

  // 2. Ensure shared RGBAFormat packed ORM textures and pre-encode opaque albedo maps to JPEG
  const swappedTextures: SwappedTextureRecord[] = [];
  const processedTextures = new Set<THREE.Texture>();
  const opaqueAlbedoCandidates: THREE.Texture[] = [];

  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) {
      if (!mat) continue;
      const std = mat as THREE.MeshStandardMaterial;

      // Guarantee single shared ORM texture references so GLTFExporter skips buildMetalRoughTexture()
      if (std.roughnessMap && std.metalnessMap && std.roughnessMap !== std.metalnessMap) {
        std.metalnessMap = std.roughnessMap;
      }
      if (std.roughnessMap) {
        std.roughnessMap.format = THREE.RGBAFormat;
        std.roughnessMap.type = THREE.UnsignedByteType;
        std.roughnessMap.channel = 0;
      }
      if (std.aoMap) {
        std.aoMap.format = THREE.RGBAFormat;
        std.aoMap.type = THREE.UnsignedByteType;
        std.aoMap.channel = 0;
      }

      if (
        encodeOpaqueAsJpeg &&
        std.map &&
        !std.transparent &&
        std.alphaTest === 0 &&
        !std.alphaMap &&
        !processedTextures.has(std.map) &&
        typeof HTMLCanvasElement !== 'undefined' &&
        std.map.image instanceof HTMLCanvasElement
      ) {
        processedTextures.add(std.map);
        opaqueAlbedoCandidates.push(std.map);
      }
    }
  });

  try {
    if (opaqueAlbedoCandidates.length > 0) {
      await Promise.all(
        opaqueAlbedoCandidates.map(async (tex) => {
          const canvas = tex.image as HTMLCanvasElement;
          const img = await encodeCanvasToJpegImage(canvas, maxTextureSize, jpegQuality);
          if (img) {
            swappedTextures.push({ texture: tex, originalImage: tex.image });
            tex.image = img;
          }
        })
      );
    }

    root.updateMatrixWorld(true);

    const bakedAnimations =
      options.animations && options.animations.length > 0
        ? bakeClipsToFps(options.animations, targetFps)
        : [];

    const exporter = new GLTFExporter();
    const result = await exporter.parseAsync(root, {
      binary: true,
      onlyVisible: false,
      maxTextureSize,
      animations: bakedAnimations,
    });

    const buffer =
      result instanceof ArrayBuffer
        ? result
        : new TextEncoder().encode(JSON.stringify(result)).buffer;

    const durationMs = performance.now() - t0;
    return {
      buffer,
      metrics: {
        byteLength: buffer.byteLength,
        durationMs,
        clipCount: bakedAnimations.length,
        strippedHelperCount: detached.length,
      },
    };
  } finally {
    // Restore original CanvasTexture images
    for (const rec of swappedTextures) {
      rec.texture.image = rec.originalImage;
    }
    // Re-attach all excluded helpers back to their original parents
    for (let i = detached.length - 1; i >= 0; i--) {
      const rec = detached[i];
      rec.parent.add(rec.node);
    }
    root.updateMatrixWorld(true);
  }
}

export function triggerGlbDownload(buffer: ArrayBuffer, filename: string): void {
  const blob = new Blob([buffer], { type: 'model/gltf-binary' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
