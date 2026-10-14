/**
 * Deterministic PRNG using mulberry32 algorithm.
 * Ported from doodle-anim by feitangyuan (MIT License).
 * Repository: https://github.com/feitangyuan/doodle-anim
 *
 * Copyright (c) feitangyuan
 * Licensed under the MIT License.
 */

/**
 * 32-bit Mulberry32 Pseudo-Random Number Generator.
 * Returns a generator function yielding deterministic floats in [0, 1).
 */
export function RNG(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 32-bit FNV-1a non-cryptographic hash function.
 * Produces a stable, deterministic 32-bit unsigned integer from any string.
 */
export function hashString32(str: string): number {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Derive deterministic seed for a specific scene from jobId and sceneId.
 * sceneSeed = hashString32(jobId + ":" + sceneId)
 */
export function getSceneSeed(jobId: string, sceneId: string): number {
  return hashString32(`${jobId}:${sceneId}`);
}

/**
 * Derive deterministic seed for an element within a scene.
 * elementSeed = hashString32(sceneSeed + ":" + elementId)
 */
export function getElementSeed(sceneSeed: number | string, elementId: string): number {
  return hashString32(`${sceneSeed}:${elementId}`);
}

/**
 * Create a random helper function embedded into components or tests.
 * Returns a float in [min, max) or [0, 1) when called with no arguments.
 */
export function createRandHelper(
  seedOrRng: number | (() => number)
): (min?: number, max?: number) => number {
  const next = typeof seedOrRng === "function" ? seedOrRng : RNG(seedOrRng);
  return function rand(min?: number, max?: number): number {
    const val = next();
    if (min === undefined && max === undefined) return val;
    if (min !== undefined && max === undefined) return val * min;
    const lower = min ?? 0;
    const upper = max ?? 1;
    return lower + val * (upper - lower);
  };
}

/**
 * Standalone JavaScript source code for RNG & hash runtime to inject into HTML.
 */
export const DETERMINISTIC_RUNTIME_JS = `
// Deterministic PRNG using mulberry32 algorithm.
// Ported from doodle-anim by feitangyuan (MIT License).
// Repository: https://github.com/feitangyuan/doodle-anim
function RNG(seed) {
    var a = (seed >>> 0);
    return function next() {
        a = (a + 0x6D2B79F5) >>> 0;
        var t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function hashString32(str) {
    var hash = 2166136261;
    for (var i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

window.RNG = RNG;
window.hashString32 = hashString32;
window.getSceneSeed = function(jobId, sceneId) {
    return hashString32(jobId + ":" + sceneId);
};
window.getElementSeed = function(sceneSeed, elementId) {
    return hashString32(sceneSeed + ":" + elementId);
};
`;
