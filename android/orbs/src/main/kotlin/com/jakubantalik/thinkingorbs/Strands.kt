// Braid: three strands plait around the sphere — the "weaving" state.
// Each strand runs pole to pole on a helix, and a radial breathing term
// makes them trade places, reading as the over/under of a plait.
//
// Ribbon: an undulating sash of parallel strands rides a great circle —
// the "composing" state. The tuned preset freezes the 3D tumble
// (spin 0), leaving the traveling undulation on a fixed band.
//
// The same painter also drives "breathing" (ring), via the `faceOn` flag:
// a face-on circle whose radius — not its out-of-plane offset — undulates,
// so it reads as a ring slowly morphing rather than a sash in orbit.
//
// Hand-transcribed from src/engine/braid.ts and src/engine/ribbon.ts.

package com.jakubantalik.thinkingorbs

import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

internal fun frameBraid(size: Double, t: Double, o: Map<String, Double>): OrbFrame {
    val cx = size / 2
    val cy = size / 2
    val R = (size / 2) * 0.76
    val pt = Projector(t * 0.4, 0.3, cx, cy, 1.0)
    val rs = radiusScale(size, o["rsPow"] ?: 0.6)

    val dots = ArrayList<Dot>()
    val ghostN = (o["ghostN"] ?: 150.0).toInt()
    val d = DoubleArray(3)
    for (i in 0 until ghostN) {
        fibDir(i, ghostN, d)
        pt.project(d[0] * R, d[1] * R, d[2] * R)
        val px = pt.px
        val py = pt.py
        val z = pt.pz
        val depth = (z / R + 1) / 2
        dots.add(Dot(x = px, y = py, z = z, r = 0.8 * rs, white = 0.78, a = 0.1 + 0.22 * depth))
    }

    val strandN = (o["strandN"] ?: 52.0).toInt()
    val turns = o["turns"] ?: 3.0
    val rBase = o["rBase"] ?: 1.2
    val rDepth = o["rDepth"] ?: 1.8
    // the literal 3 below is the strand count, not strandN (the per-strand dot count)
    for (s in 0 until 3) {
        val phase = (s / 3.0) * 2 * Math.PI
        for (i in 0 until strandN) {
            // u walks pole to pole; the frac() drift slides the whole strand along
            val u = (frac(i.toDouble() / strandN + t * 0.045) * 2 - 1) * 0.96
            val surf = sqrt(max(0.0, 1 - u * u))
            val endFade = min(1.0, (1 - abs(u)) / 0.1)
            val a = u * Math.PI * turns + phase
            // radial breathing: strands trade places — the over/under of a plait
            val weave = 1 + 0.075 * sin(u * Math.PI * turns * 2 + phase * 2 + t * 0.8)
            val rr = surf * R * weave
            pt.project(cos(a) * rr, u * R * weave, sin(a) * rr)
            val px = pt.px
            val py = pt.py
            val zr = pt.pz
            val depth = (zr / R + 1) / 2
            dots.add(
                Dot(
                    x = px,
                    y = py,
                    z = zr,
                    r = (rBase + rDepth * depth) * rs,
                    white = 0.55 - 0.45 * depth,
                    a = endFade * (0.45 + 0.55 * depth),
                )
            )
        }
    }
    return finalizeFrame(dots, emptyList(), o["rMin"] ?: 0.3)
}

internal fun frameRibbon(size: Double, t: Double, o: Map<String, Double>): OrbFrame {
    val cx = size / 2
    val cy = size / 2
    val R = (size / 2) * 0.78
    // spin scales the 3D tumble; spin=0 freezes the band's orientation,
    // leaving only the traveling undulation
    val spin = o["spin"] ?: 1.0
    val camTilt = 0.3
    val pt = Projector(t * 0.1 * spin, camTilt, cx, cy, 1.0)
    val rs = radiusScale(size, o["rsPow"] ?: 0.6)

    val dots = ArrayList<Dot>()
    val ghostN = (o["ghostN"] ?: 150.0).toInt()
    val d = DoubleArray(3)
    for (i in 0 until ghostN) {
        fibDir(i, ghostN, d)
        pt.project(d[0] * R, d[1] * R, d[2] * R)
        val px = pt.px
        val py = pt.py
        val z = pt.pz
        val depth = (z / R + 1) / 2
        dots.add(Dot(x = px, y = py, z = z, r = 0.8 * rs, white = 0.78, a = 0.1 + 0.22 * depth))
    }

    // o.faceOn is truthiness-tested in TypeScript (o.faceOn ? A : B); here the
    // option is a Double?, so a missing key and an explicit 0.0 must both mean
    // false.
    val faceOn = (o["faceOn"] ?: 0.0) != 0.0

    // The band plane, precessing (frozen when spin=0). The projection squashes
    // the band's great circle vertically by cos(ta + camTilt); face-on sets
    // ta = -camTilt so that term is 1 and the band reads as a true circle
    // rather than ribbon's tilted ellipse.
    val ya = t * 0.24 * spin
    val ta = if (faceOn) -camTilt else 0.55 + 0.3 * sin(t * 0.18) * spin
    val ux = cos(ya)
    val uy = 0.0
    val uz = sin(ya)
    val vx = -uz * sin(ta)
    val vy = cos(ta)
    val vz = ux * sin(ta)
    // plane normal n = u × v
    val nx = uy * vz - uz * vy
    val ny = uz * vx - ux * vz
    val nz = ux * vy - uy * vx

    // Radial lobes swell past R, so pull the base radius in by (most of) the
    // wobble amplitude. The silhouette then stays inside the frame however far
    // the deformation is pushed, while lobes keep getting deeper relative to
    // the mean radius.
    val wobMul = o["wobMul"] ?: 1.0
    val wobAmp = 0.23 * wobMul
    val baseR = if (faceOn) R / (1 + 0.85 * wobAmp) else R

    val baseLanes = o["lanes"] ?: 5.0
    val segs = (o["segs"] ?: 88.0).toInt()
    val lanes = max(1.0, jsRound(baseLanes * (o["bandMul"] ?: 1.0))).toInt()
    val rBase = o["rBase"] ?: 1.1
    val rDepth = o["rDepth"] ?: 1.7
    for (w in 0 until lanes) {
        val laneOff = (w - (lanes - 1) / 2.0) * 0.075
        val edge = abs(w - (lanes - 1) / 2.0) / max(1.0, (lanes - 1) / 2.0)
        for (k in 0 until segs) {
            val a = (k.toDouble() / segs) * 2 * Math.PI
            // the undulation: two traveling waves along the band; wobMul
            // scales the deformation — 0 is a clean band
            val wob = (0.16 * sin(a * 3 - t * 1.7 + w * 0.22) + 0.07 * sin(a * 5 + t * 1.1)) * wobMul
            // A normal-direction wobble is cancelled by the re-normalisation below:
            // the point lands back on the sphere, so the silhouette is pinned at R
            // and the deformation can only ever pull dots inward. Face-on instead
            // modulates the in-plane RADIUS, so lobes genuinely swell outward and
            // pinch inward. Ribbon keeps the original out-of-plane sash wobble.
            val radial = if (faceOn) 1.0 + wob else 1.0
            val off = if (faceOn) laneOff else laneOff + wob
            val x = ux * cos(a) + vx * sin(a) + nx * off
            val y = uy * cos(a) + vy * sin(a) + ny * off
            val z = uz * cos(a) + vz * sin(a) + nz * off
            val l = sqrt(x * x + y * y + z * z)
            val rr = baseR * radial
            pt.project((x / l) * rr, (y / l) * rr, (z / l) * rr)
            val px = pt.px
            val py = pt.py
            val zr = pt.pz
            val depth = (zr / R + 1) / 2
            dots.add(
                Dot(
                    x = px,
                    y = py,
                    z = zr,
                    r = (rBase + rDepth * depth) * (1 - 0.25 * edge) * rs,
                    white = 0.52 - 0.44 * depth + 0.18 * edge,
                    a = 0.4 + 0.6 * depth,
                )
            )
        }
    }
    return finalizeFrame(dots, emptyList(), o["rMin"] ?: 0.3)
}
