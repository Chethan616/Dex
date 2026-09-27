// Morph: a dotted outline cycling circle -> triangle -> square -> circle —
// the "shaping" state. Each shape is a continuous closed path parameterised
// by arc length (top-centre start, clockwise). Every frame the engine blends
// the two neighbouring paths, then lays the dots EVENLY along the blended
// outline. Transcribed from src/engine/morph.ts.

package com.jakubantalik.thinkingorbs

import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/** A closed 2D outline, sampled by arc-length fraction `f` in [0, 1). */
internal fun interface ShapePath {
    fun at(f: Double, out: DoubleArray)
}

private fun smoothE(x: Double): Double = x * x * (3 - 2 * x)

/** Per-edge segment lengths are precomputed once, not per frame. */
private fun polyPath(verts: Array<DoubleArray>): ShapePath {
    val v = verts.size
    val lens = DoubleArray(v)
    var total = 0.0
    for (i in 0 until v) {
        val a = verts[i]
        val b = verts[(i + 1) % v]
        val l = hypot(b[0] - a[0], b[1] - a[1])
        lens[i] = l
        total += l
    }
    return ShapePath { f, out ->
        var target = f * total
        var i = 0
        while (target > lens[i] && i < v - 1) {
            target -= lens[i]
            i++
        }
        val a = verts[i]
        val b = verts[(i + 1) % v]
        val ff = if (lens[i] != 0.0) min(1.0, target / lens[i]) else 0.0
        out[0] = a[0] + (b[0] - a[0]) * ff
        out[1] = a[1] + (b[1] - a[1]) * ff
    }
}

private val CIRCLE = ShapePath { f, out ->
    val a = -Math.PI / 2 + f * 2 * Math.PI
    out[0] = cos(a) * 0.24
    out[1] = sin(a) * 0.24
}

private val TRIANGLE = polyPath(
    arrayOf(
        doubleArrayOf(0.0, -0.26),
        doubleArrayOf(0.24, 0.16),
        doubleArrayOf(-0.24, 0.16),
    )
)

// 5-vertex walk so the path STARTS at top-centre like the other shapes
private val SQUARE = polyPath(
    arrayOf(
        doubleArrayOf(0.0, -0.2),
        doubleArrayOf(0.2, -0.2),
        doubleArrayOf(0.2, 0.2),
        doubleArrayOf(-0.2, 0.2),
        doubleArrayOf(-0.2, -0.2),
    )
)

private val CYCLE: Array<ShapePath> = arrayOf(CIRCLE, TRIANGLE, SQUARE)

// low floor keeps sparse outlines possible while never degenerating
private fun morphN(d: Double): Double = max(6.0, jsRound(34 * d))

private const val HOLD = 1.4
private const val MORPH = 0.9
private const val SEG = HOLD + MORPH

// This state was tuned in inkform, which paints it through a blur + threshold
// "goo" filter; we draw plain circles instead, since `ctx.filter` and SVG
// filter refs are not safe to rely on across Chrome / Safari / Firefox. The dot
// GEOMETRY is identical either way — the threshold just yields a hard edge
// where a plain fill has an antialiased one, so these dots read a touch softer
// than inkform's. Don't "correct" for that by shrinking the radius: it makes
// the mark genuinely smaller than the tuning, and diverges from the goldens.

internal fun frameMorph(size: Double, t: Double, o: Map<String, Double>): OrbFrame {
    val k = CYCLE.size
    val tc = t % (SEG * k)
    val ki = floor(tc / SEG).toInt()
    val local = tc - ki * SEG
    val m = if (local > HOLD) smoothE((local - HOLD) / MORPH) else 0.0
    val sprd = o["spread"] ?: 1.0

    // blend the two shape PATHS at m, then measure the blended outline
    val pA = CYCLE[ki]
    val pB = CYCLE[(ki + 1) % k]
    val bigM = 160
    val ptsX = DoubleArray(bigM)
    val ptsY = DoubleArray(bigM)
    val a2 = DoubleArray(2)
    val b2 = DoubleArray(2)
    for (i in 0 until bigM) {
        val f = i.toDouble() / bigM
        pA.at(f, a2)
        pB.at(f, b2)
        ptsX[i] = (a2[0] + (b2[0] - a2[0]) * m) * sprd
        ptsY[i] = (a2[1] + (b2[1] - a2[1]) * m) * sprd
    }
    val lens = DoubleArray(bigM)
    var total = 0.0
    for (i in 0 until bigM) {
        val ax = ptsX[i]
        val ay = ptsY[i]
        val bx = ptsX[(i + 1) % bigM]
        val by = ptsY[(i + 1) % bigM]
        val l = hypot(bx - ax, by - ay)
        lens[i] = l
        total += l
    }

    // dot radius depends ONLY on rDot (the size knob); the count sets the
    // gaps. Formed shapes breathe a little (uniform pulse).
    val n = morphN(o["iconD"] ?: 1.0).toInt()
    val re = (o["rDot"] ?: 0.021) * 1.35 * sprd
    val pulse = 1 + 0.02 * sin(local * 3.1)

    val dots = ArrayList<Dot>(n)
    val c2 = size / 2
    var seg = 0
    var acc = 0.0
    for (k2 in 0 until n) {
        val target = (k2.toDouble() / n) * total
        while (acc + lens[seg] < target && seg < bigM - 1) {
            acc += lens[seg]
            seg++
        }
        val ax = ptsX[seg]
        val ay = ptsY[seg]
        val bx = ptsX[(seg + 1) % bigM]
        val by = ptsY[(seg + 1) % bigM]
        val f = if (lens[seg] != 0.0) min(1.0, (target - acc) / lens[seg]) else 0.0
        val x = (ax + (bx - ax) * f) * pulse
        val y = (ay + (by - ay) * f) * pulse
        dots.add(
            Dot(
                x = c2 + x * size,
                y = c2 + y * size,
                z = 0.0,
                r = max(0.35, re * size),
                white = 0.1,
            )
        )
    }
    return finalizeFrame(dots, emptyList(), o["rMin"] ?: 0.3)
}
