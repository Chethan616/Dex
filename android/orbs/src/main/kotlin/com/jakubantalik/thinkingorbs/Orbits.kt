// Orbits: particles on tilted orbits — the "working" state. No nucleus (the
// tuned preset runs coreless): just ghost paths and the particles doing the
// work.
//
// Hand-transcribed from src/engine/orbits.ts.

package com.jakubantalik.thinkingorbs

import kotlin.math.acos
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.sin
import kotlin.math.sqrt

internal fun frameOrbits(size: Double, t: Double, o: Map<String, Double>): OrbFrame {
    val cx = size / 2
    val cy = size / 2
    val bigR = (size / 2) * 0.82
    val pt = Projector(t * 0.12, 0.3, cx, cy, 1.0)
    val rs = radiusScale(size, o["rsPow"] ?: 0.6)

    val dots = ArrayList<Dot>()
    val orbitN = (o["orbitN"] ?: 12.0).toInt()
    val ghostN = (o["ghostN"] ?: 40.0).toInt()
    val particles = (o["particles"] ?: 3.0).toInt()
    // hoisted out of the inner loops; `o` is immutable so this is a pure
    // read-placement change, not a behavioural one
    val ghostR = o["ghostR"] ?: 0.9
    val ghostA = o["ghostA"] ?: 0.5
    val partR = o["partR"] ?: 1.2
    val partRDepth = o["partRDepth"] ?: 1.6

    // orbits: each a tilted circle — a ghost path + running particles
    for (orb in 0 until orbitN) {
        val h1 = hashD(orb.toDouble(), 1.7)
        val h2 = hashD(orb.toDouble(), 5.2)
        val h3 = hashD(orb.toDouble(), 8.9)
        val ro = bigR * (0.45 + 0.52 * h1)
        val th = h1 * 2 * Math.PI
        val phi = acos(2 * h2 - 1)
        // orbit plane basis (u, v perpendicular to normal n)
        val nx = sin(phi) * cos(th)
        val ny = cos(phi)
        val nz = sin(phi) * sin(th)
        var ux = -ny
        var uy = nx
        val uz = 0.0
        val ul = max(1e-6, sqrt(ux * ux + uy * uy))
        ux /= ul
        uy /= ul
        val vx = ny * uz - nz * uy
        val vy = nz * ux - nx * uz
        val vz = nx * uy - ny * ux
        val speed = (0.25 + 0.55 * h3) * (if (h3 > 0.5) 1.0 else -1.0)

        // ghost path
        for (k in 0 until ghostN) {
            val a = (k.toDouble() / ghostN) * 2 * Math.PI
            pt.project(
                (ux * cos(a) + vx * sin(a)) * ro,
                (uy * cos(a) + vy * sin(a)) * ro,
                (uz * cos(a) + vz * sin(a)) * ro,
            )
            val depth = (pt.pz / ro + 1) / 2
            dots.add(
                Dot(
                    x = pt.px,
                    y = pt.py,
                    z = pt.pz,
                    r = ghostR * rs,
                    white = 0.72,
                    a = ghostA * (0.4 + 0.6 * depth),
                )
            )
        }
        // the particles doing the work
        for (m in 0 until particles) {
            val a = t * speed + (m.toDouble() / particles) * 2 * Math.PI + h2 * 6
            pt.project(
                (ux * cos(a) + vx * sin(a)) * ro,
                (uy * cos(a) + vy * sin(a)) * ro,
                (uz * cos(a) + vz * sin(a)) * ro,
            )
            val depth = (pt.pz / ro + 1) / 2
            dots.add(
                Dot(
                    x = pt.px,
                    y = pt.py,
                    z = pt.pz,
                    r = (partR + partRDepth * depth) * rs,
                    white = 0.3 - 0.22 * depth,
                )
            )
        }
    }
    return finalizeFrame(dots, emptyList(), o["rMin"] ?: 0.3)
}
