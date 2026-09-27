// Shared primitives for the dotted 3D thought-orbs.
//
// Hand-transcribed from src/engine/core.ts. Every formula here must match the
// TypeScript exactly — OrbGoldenTest compares this package's output against
// spec/orbs-golden.json dot by dot, so a mistyped constant fails a test rather
// than shipping as a subtly wrong animation.
//
// Doubles throughout, deliberately: the golden vectors come from JavaScript
// numbers, which are IEEE-754 doubles. Using Float here would drift past the
// 1e-4 tolerance on the trig-heavy modes.

package com.jakubantalik.thinkingorbs

import kotlin.math.atan2
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/** Ink value convention: 0 = darkest ink on paper. Mirrored on dark themes. */
class Dot(
    @JvmField var x: Double,
    @JvmField var y: Double,
    @JvmField var z: Double,
    @JvmField var r: Double,
    @JvmField var white: Double,
    @JvmField var a: Double = 1.0,
)

/** A stroked edge between two projected points (the `connecting` web). */
class OrbLine(
    @JvmField val x1: Double,
    @JvmField val y1: Double,
    @JvmField val x2: Double,
    @JvmField val y2: Double,
    @JvmField val white: Double,
    @JvmField val a: Double,
    @JvmField val w: Double,
)

/**
 * One rendered instant: a complete, final set of draw instructions. `dots` is
 * already z-sorted into draw order and radius-clamped; `lines` are drawn first.
 */
class OrbFrame(
    @JvmField val dots: List<Dot>,
    @JvmField val lines: List<OrbLine>,
)

/**
 * JavaScript `Math.round`: ties break toward +infinity.
 *
 * DO NOT replace this with kotlin.math.round, which breaks ties toward EVEN.
 * Verified against spec/orbs-golden.json — ties-to-even silently changes:
 *   connecting@64  nodeN 40.5 -> 41 (ties-to-even gives 40)
 *   composing@64   lanes  2.5 -> 3  (ties-to-even gives 2)
 *   breathing@64   lanes  2.5 -> 3  (ties-to-even gives 2)
 *
 * `floor(x + 0.5)` is wrong twice over: (1) it rounds up at nextDown(0.5)
 * because the addition itself rounds to 1.0, and (2) `floor(x) + 1.0` always
 * returns +0.0, but JavaScript's Math.round returns -0.0 for x in [-0.5, 0).
 * Per ECMA-262, Math.round(-0.1) -> -0, not +0. This form using ceil(x) when
 * the fractional part >= 0.5 correctly handles both the precision issue and
 * the sign-of-zero edge case, matching JavaScript's behaviour exactly.
 */
internal fun jsRound(x: Double): Double {
    val frac = x - floor(x)
    return if (frac >= 0.5) ceil(x) else floor(x)
}

internal fun lerp(a: Double, b: Double, f: Double): Double = a + (b - a) * f

internal fun frac(x: Double): Double = x - floor(x)

/** Deterministic hash in [0, 1). */
internal fun hashD(a: Double, b: Double): Double {
    val h = sin(a * 12.9898 + b * 78.233) * 43758.5453
    return h - floor(h)
}

/** Value noise on a 2D lattice — smooth, deterministic, cheap. */
internal fun vnoise(x: Double, y: Double): Double {
    val xi = floor(x)
    val yi = floor(y)
    var fx = x - xi
    var fy = y - yi
    fx = fx * fx * (3 - 2 * fx)
    fy = fy * fy * (3 - 2 * fy)
    val a = hashD(xi, yi)
    val b = hashD(xi + 1, yi)
    val c = hashD(xi, yi + 1)
    val d = hashD(xi + 1, yi + 1)
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
}

/**
 * Stable directions on a unit sphere (Fibonacci lattice).
 *
 * Writes x, y, z into [out] rather than returning a tuple — this runs in the
 * inner loop of several modes and a per-call allocation is avoidable.
 */
internal fun fibDir(i: Int, n: Int, out: DoubleArray) {
    val golden = Math.PI * (3 - sqrt(5.0))
    val y = 1 - (2 * (i + 0.5)) / n
    val rad = sqrt(1 - y * y)
    val a = i * golden
    out[0] = rad * cos(a)
    out[1] = y
    out[2] = rad * sin(a)
}

/** Shortest signed angular distance, wrapped to (-PI, PI]. */
internal fun angleDelta(a: Double, b: Double): Double = atan2(sin(a - b), cos(a - b))

/**
 * Dot radii were tuned for a 300pt frame; sub-linear scaling keeps small
 * spinners legible. Lower pow = radii shrink less with size.
 */
internal fun radiusScale(size: Double, pow: Double): Double = (size / 300.0).pow(pow)

/**
 * Shared spin + tilt + orthographic projection.
 *
 * The TypeScript version returns a closure producing a tuple; a class with
 * output fields is the allocation-free Kotlin equivalent. Call [project], then
 * read [px], [py], [pz].
 */
internal class Projector(
    yaw: Double,
    tilt: Double,
    private val cx: Double,
    private val cy: Double,
    private val scale: Double,
) {
    private val st = sin(tilt)
    private val ct = cos(tilt)
    private val sy = sin(yaw)
    private val cyw = cos(yaw)

    @JvmField var px: Double = 0.0
    @JvmField var py: Double = 0.0
    @JvmField var pz: Double = 0.0

    fun project(x: Double, y: Double, z: Double) {
        val x1 = x * cyw + z * sy
        val z1 = -x * sy + z * cyw
        val y1 = y * ct - z1 * st
        pz = y * st + z1 * ct
        px = cx + x1 * scale
        py = cy - y1 * scale
    }
}

/**
 * Turn raw mode output into a finished frame: drop invisible marks, clamp radii
 * to the mode's floor, and z-sort far->near into draw order.
 *
 * This runs in the GEOMETRY step, not the painter, so a frame is a complete set
 * of draw instructions — which is what lets the golden tests compare numbers
 * instead of pixels.
 */
internal fun finalizeFrame(
    dots: MutableList<Dot>,
    lines: List<OrbLine>,
    rMin: Double = 0.3,
): OrbFrame {
    val visible = ArrayList<Dot>(dots.size)
    for (d in dots) {
        if (d.a < 0.02) continue
        if (d.r < rMin) d.r = rMin
        visible.add(d)
    }
    // Kotlin's sortWith is a stable TimSort, matching JS's (ES2019+) stable
    // Array.prototype.sort. Comparing with < / > rather than Double.compareTo
    // is deliberate: JS's `a.z - b.z` treats -0.0 and 0.0 as equal, while
    // compareTo orders -0.0 before 0.0 and would reorder co-planar dots.
    visible.sortWith { a, b -> if (a.z < b.z) -1 else if (a.z > b.z) 1 else 0 }
    return OrbFrame(visible, lines.filter { it.a >= 0.02 })
}
