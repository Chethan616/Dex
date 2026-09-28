// Resolves a (state, size) pair to its mode + fully-scaled draw options.
// Transcribed from src/presets.ts and src/engine/profiles.ts; the tuning
// numbers themselves live in the generated OrbSpec.kt.

package com.jakubantalik.thinkingorbs

import java.util.concurrent.ConcurrentHashMap
import kotlin.math.max
import kotlin.math.sqrt

class ResolvedPreset internal constructor(
    internal val mode: OrbMode,
    val speed: Double,
    internal val opts: Map<String, Double>,
)

/**
 * 2-D lattices come in pairs — each side takes sqrt(scale) so the TOTAL dot
 * count scales by `scale`; flat lists scale linearly.
 */
private fun scaleCounts(opts: Map<String, Double>, scale: Double): Map<String, Double> {
    val out = LinkedHashMap(opts)
    val done = HashSet<String>()
    val rt = sqrt(scale)

    for ((a, b) in OrbSpec.countPairs) {
        val va = out[a]
        val vb = out[b]
        if (va != null && vb != null && a !in done && b !in done) {
            out[a] = max(2.0, jsRound(va * rt))
            out[b] = max(2.0, jsRound(vb * rt))
            done += a
            done += b
        }
    }
    for (k in OrbSpec.countKeys) {
        val v = out[k]
        // 0 means the mode opted out of that layer entirely (ring has no ghost
        // sphere) — scaling must not resurrect it as a single stray dot
        if (v != null && v != 0.0 && k !in done) out[k] = max(1.0, jsRound(v * scale))
    }
    for (k in OrbSpec.iconDensityKeys) {
        val v = out[k]
        if (v != null) out[k] = max(0.02, v * scale)
    }
    return out
}

private fun scaleRadii(opts: Map<String, Double>, scale: Double): Map<String, Double> {
    val out = LinkedHashMap(opts)
    for (k in OrbSpec.radiusKeys) {
        val v = out[k]
        if (v != null) out[k] = v * scale
    }
    // remember the multiplier itself — spacing-derived radii (the morph
    // outline) use it, since they aren't based on any single radius key
    out["rSizeMul"] = (out["rSizeMul"] ?: 1.0) * scale
    return out
}

private val cache = ConcurrentHashMap<String, ResolvedPreset>()

/**
 * Resolve a (state, size) pair. Cached: the result is identical for the
 * lifetime of the process, and the render loop must never do this work.
 */
fun resolvePreset(state: OrbState, size: OrbSize): ResolvedPreset =
    cache.getOrPut("${state.id}-${size.px}") {
        val mode = state.mode
        val preset = OrbSpec.presets.getValue(mode).getValue(size)
        var opts: Map<String, Double> = OrbSpec.baseProfiles.getValue(mode)
        if (preset.count != 1.0) opts = scaleCounts(opts, preset.count)
        if (preset.size != 1.0) opts = scaleRadii(opts, preset.size)
        if (preset.extra.isNotEmpty()) opts = LinkedHashMap(opts).apply { putAll(preset.extra) }
        ResolvedPreset(mode, preset.speed, opts)
    }

/** Geometry for one instant. Mirrors MODE_FRAMES in the TypeScript engine. */
internal fun orbFrame(preset: ResolvedPreset, size: Double, t: Double): OrbFrame {
    val o = preset.opts
    return when (preset.mode) {
        OrbMode.Orbits -> frameOrbits(size, t, o)
        OrbMode.Globe -> frameGlobe(size, t, o)
        OrbMode.Rubik -> frameRubik(size, t, o)
        OrbMode.Wave -> frameWave(size, t, o)
        OrbMode.Web -> frameWeb(size, t, o)
        OrbMode.Braid -> frameBraid(size, t, o)
        // ring shares ribbon's geometry — the `faceOn` profile flag switches it
        OrbMode.Ribbon, OrbMode.Ring -> frameRibbon(size, t, o)
        OrbMode.Morph -> frameMorph(size, t, o)
    }
}

/** Convenience: resolve and build in one call. */
internal fun orbFrame(state: OrbState, size: OrbSize, t: Double): OrbFrame =
    orbFrame(resolvePreset(state, size), size.value, t)
