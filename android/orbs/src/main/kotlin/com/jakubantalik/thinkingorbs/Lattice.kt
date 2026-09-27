// The sphere-lattice modes: globe (searching), rubik (solving) and
// wave (listening). All draw a lat/long dot field with mode-specific
// motion, then hand off to the shared z-sorted painter.
//
// Hand-transcribed from src/engine/lattice.ts.

package com.jakubantalik.thinkingorbs

import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin

// --- the shared solver heartbeat (rubik) ------------------------------
// Rapid eased moves scramble, then replay in reverse (palindrome) so
// everything clicks back to solved, rests, repeats.

/** axis: 0 = x, 1 = y, 2 = z. */
private class Move(val axis: Int, val lo: Double, val hi: Double, val ang: Double)

private class SolveCycle(val amount: DoubleArray, val active: Int)

private fun solveCycle(time: Double, count: Int, slotDur: Double, rest: Double): SolveCycle {
    val cyc = 2 * count * slotDur + rest
    val tc = time % cyc
    val amount = DoubleArray(count)
    var active = -1
    if (tc < 2 * count * slotDur) {
        val slot = floor(tc / slotDur).toInt()
        val p = (tc - slot * slotDur) / slotDur
        val cl = min(1.0, p / 0.7)
        val ep = 1 - (1 - cl).pow(3) // machine ease-out
        if (slot < count) {
            for (i in 0 until slot) amount[i] = 1.0
            amount[slot] = ep
            active = slot
        } else {
            val u = 2 * count - 1 - slot
            for (i in 0 until u) amount[i] = 1.0
            amount[u] = 1 - ep
            active = u
        }
    }
    return SolveCycle(amount, active)
}

/**
 * Output of [applyMoves]. A mutable holder rather than a returned tuple —
 * this runs in the inner loop of `frameRubik` and a per-dot allocation is
 * avoidable; callers reuse one instance and read the fields right after
 * calling.
 */
private class MoveResult {
    @JvmField var x: Double = 0.0
    @JvmField var y: Double = 0.0
    @JvmField var z: Double = 0.0
    @JvmField var inActive: Boolean = false
}

private fun applyMoves(x0: Double, y0: Double, z0: Double, moves: List<Move>, sc: SolveCycle, out: MoveResult) {
    var x = x0
    var y = y0
    var z = z0
    var inActive = false
    for (i in moves.indices) {
        if (sc.amount[i] <= 0) continue
        val mv = moves[i]
        val coord = if (mv.axis == 0) x else if (mv.axis == 1) y else z
        if (coord < mv.lo || coord >= mv.hi) continue
        if (i == sc.active) inActive = true
        val a = mv.ang * sc.amount[i]
        val ca = cos(a)
        val sa = sin(a)
        if (mv.axis == 0) {
            val y2 = y * ca - z * sa
            z = y * sa + z * ca
            y = y2
        } else if (mv.axis == 1) {
            val x2 = x * ca + z * sa
            z = -x * sa + z * ca
            x = x2
        } else {
            val x2 = x * ca - y * sa
            y = x * sa + y * ca
            x = x2
        }
    }
    out.x = x
    out.y = y
    out.z = z
    out.inActive = inActive
}

private fun makeMoves(count: Int): List<Move> {
    val moves = ArrayList<Move>(count)
    for (i in 0 until count) {
        val axis = min(2.0, floor(hashD(i.toDouble(), 2.3) * 3)).toInt()
        val lo = -1.0 + 0.5 * min(3.0, floor(hashD(i.toDouble(), 5.9) * 4))
        val dir = if (hashD(i.toDouble(), 7.7) < 0.5) 1 else -1
        moves.add(Move(axis, lo, lo + 0.5, (dir * Math.PI) / 2))
    }
    return moves
}

// --- Globe: lat/long field, a scan meridian sweeps — searching --------

internal fun frameGlobe(size: Double, t: Double, o: Map<String, Double>): OrbFrame {
    val spin = 0.5
    val cx = size / 2
    val cy = size / 2
    val radius = (size / 2) * 0.82
    val tilt = 0.4 + 0.06 * sin(t * 0.35)
    val pt = Projector(t * spin, tilt, cx, cy, radius)
    // scan sweeps relative to the spin; scanMul scales that relative rate
    val scan = t * (spin + (1.7 - spin) * (o["scanMul"] ?: 1.0))
    val rs = radiusScale(size, o["rsPow"] ?: 0.6)
    val dimBase = o["dimBase"] ?: 1.0

    val dots = ArrayList<Dot>()
    val latRings = (o["latRings"] ?: 17.0).toInt()
    val lonDensity = o["lonDensity"] ?: 44.0
    val rBase = o["rBase"] ?: 0.6
    val rDepth = o["rDepth"] ?: 1.7
    val rBoost = o["rBoost"] ?: 1.0
    val inkFar = o["inkFar"] ?: 0.62
    val inkSpan = o["inkSpan"] ?: 0.54

    for (li in 0..latRings) {
        val lat = -Math.PI / 2 + (li.toDouble() / latRings) * Math.PI
        val cosLat = cos(lat)
        val sinLat = sin(lat)
        val lonCount = max(1.0, jsRound(abs(cosLat) * lonDensity)).toInt()
        for (lj in 0 until lonCount) {
            val lon = (lj.toDouble() / lonCount) * 2 * Math.PI
            pt.project(cosLat * cos(lon), sinLat, cosLat * sin(lon))
            val px = pt.px
            val py = pt.py
            val z = pt.pz
            val depth = (z + 1) / 2
            // the scan: a moving meridian read as a size ripple, not a shine
            val d = angleDelta(lon + t * spin, scan)
            val boost = exp(-(d * d) / 0.18) * max(0.0, z)
            dots.add(
                Dot(
                    x = px,
                    y = py,
                    z = z,
                    r = (rBase + rDepth * depth + rBoost * boost) * rs,
                    white = inkFar - inkSpan * depth,
                    // dimBase < 1 fades un-scanned dots so the meridian reads clearly
                    a = dimBase + (1 - dimBase) * min(1.0, boost),
                )
            )
        }
    }
    return finalizeFrame(dots, emptyList(), o["rMin"] ?: 0.3)
}

// --- Rubik: bands twist in quarter turns, scramble → solve — solving --

internal fun frameRubik(size: Double, t: Double, o: Map<String, Double>): OrbFrame {
    val cx = size / 2
    val cy = size / 2
    val bigR = (size / 2) * 0.82
    val pt = Projector(t * 0.55, 0.35 + 0.1 * sin(t * 0.9), cx, cy, bigR)
    val rs = radiusScale(size, o["rsPow"] ?: 0.6)
    val moveCount = (o["moveCount"] ?: 14.0).toInt()
    val moves = makeMoves(moveCount)
    val sc = solveCycle(t, moveCount, 0.42, 1.2)

    val dots = ArrayList<Dot>()
    val latRings = (o["latRings"] ?: 15.0).toInt()
    val lonDensity = o["lonDensity"] ?: 40.0
    val rBase = o["rBase"] ?: 0.6
    val rDepth = o["rDepth"] ?: 1.7
    val rActive = o["rActive"] ?: 0.3
    val inkFar = o["inkFar"] ?: 0.62
    val inkSpan = o["inkSpan"] ?: 0.54
    val moveResult = MoveResult()

    for (li in 0..latRings) {
        val lat = -Math.PI / 2 + (li.toDouble() / latRings) * Math.PI
        val cosLat = cos(lat)
        val sinLat = sin(lat)
        val lonCount = max(1.0, jsRound(abs(cosLat) * lonDensity)).toInt()
        for (lj in 0 until lonCount) {
            val lon = (lj.toDouble() / lonCount) * 2 * Math.PI
            applyMoves(cosLat * cos(lon), sinLat, cosLat * sin(lon), moves, sc, moveResult)
            pt.project(moveResult.x, moveResult.y, moveResult.z)
            val px = pt.px
            val py = pt.py
            val zr = pt.pz
            val depth = (zr + 1) / 2
            val inActive = moveResult.inActive
            // the band being turned inks a touch darker — the "hand"
            dots.add(
                Dot(
                    x = px,
                    y = py,
                    z = zr,
                    r = (rBase + rDepth * depth + (if (inActive) rActive else 0.0)) * rs,
                    white = inkFar - inkSpan * depth - (if (inActive) 0.14 else 0.0),
                )
            )
        }
    }
    return finalizeFrame(dots, emptyList(), o["rMin"] ?: 0.3)
}

// --- Wave: a waveform rolls through the rings — listening -------------

internal fun frameWave(size: Double, t: Double, o: Map<String, Double>): OrbFrame {
    val cx = size / 2
    val cy = size / 2
    // 0.76 base × 1.15 — the undulation pulls the sphere inward, so wave read
    // ~15% smaller than the other lattice modes; scaled up to match them
    val bigR = (size / 2) * 0.874
    val pt = Projector(t * 0.18, 0.38, cx, cy, 1.0)
    val rs = radiusScale(size, o["rsPow"] ?: 0.6)

    val dots = ArrayList<Dot>()
    val rings = (o["rings"] ?: 15.0).toInt()
    val lonDensity = o["lonDensity"] ?: 40.0
    val rBase = o["rBase"] ?: 0.6
    val rDepth = o["rDepth"] ?: 1.7

    for (ri in 0..rings) {
        val lat = -Math.PI / 2 + (ri.toDouble() / rings) * Math.PI
        val cosLat = cos(lat)
        val sinLat = sin(lat)
        // two waves, different tempi — organic, never quite repeating
        val w = 0.62 * sin(t * 2.1 - ri * 0.52) + 0.38 * sin(t * 1.27 + ri * 0.83)
        val rr = bigR * (0.88 + 0.105 * w)
        val lonCount = max(1.0, jsRound(abs(cosLat) * lonDensity)).toInt()
        for (lj in 0 until lonCount) {
            val lon = (lj.toDouble() / lonCount) * 2 * Math.PI
            pt.project(cosLat * cos(lon) * rr, sinLat * rr, cosLat * sin(lon) * rr)
            val px = pt.px
            val py = pt.py
            val z = pt.pz
            val depth = (z / bigR + 1) / 2
            val crest = max(0.0, w)
            dots.add(
                Dot(
                    x = px,
                    y = py,
                    z = z,
                    r = (rBase + rDepth * depth) * (1 + 0.4 * crest) * rs,
                    white = 0.66 - 0.56 * depth - 0.1 * crest,
                )
            )
        }
    }
    return finalizeFrame(dots, emptyList(), o["rMin"] ?: 0.3)
}
