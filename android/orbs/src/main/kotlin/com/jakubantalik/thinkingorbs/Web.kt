// Web: a constellation wires itself — the "connecting" state. Nodes drift
// on the sphere under slow value noise; any pair closer than `thr` grows an
// edge, and bright packets run along randomly re-picked node pairs.
//
// Hand-transcribed from src/engine/web.ts.

package com.jakubantalik.thinkingorbs

import kotlin.math.floor
import kotlin.math.max
import kotlin.math.sin
import kotlin.math.sqrt

internal fun frameWeb(size: Double, t: Double, o: Map<String, Double>): OrbFrame {
    val cx = size / 2
    val cy = size / 2
    val R = (size / 2) * 0.8 * (o["spread"] ?: 1.0)
    // note the projector carries the radius as its scale, so node vectors stay
    // unit-length and distances below are in unit-sphere space
    val pt = Projector(t * 0.12, 0.32, cx, cy, R)
    val rs = radiusScale(size, o["rsPow"] ?: 0.6)

    val nodeN = (o["nodeN"] ?: 30.0).toInt()
    val thr = o["thr"] ?: 0.72
    val nodeR = o["nodeR"] ?: 1.4
    val nodeRDepth = o["nodeRDepth"] ?: 1.8

    // nodes: fib lattice + slow noise wander, renormalised to the surface
    val nodes = Array(nodeN) { DoubleArray(3) }
    for (i in 0 until nodeN) {
        val d = nodes[i]
        fibDir(i, nodeN, d)
        val x = d[0] + 0.3 * (vnoise(i * 0.31 + 9, t * 0.24) - 0.5) * 2
        val y = d[1] + 0.3 * (vnoise(i * 0.53 + 27, t * 0.21) - 0.5) * 2
        val z = d[2] + 0.3 * (vnoise(i * 0.77 + 55, t * 0.27) - 0.5) * 2
        val l = sqrt(x * x + y * y + z * z)
        d[0] = x / l
        d[1] = y / l
        d[2] = z / l
    }

    val lines = ArrayList<OrbLine>()
    val dots = ArrayList<Dot>()
    val lineW = max(0.6, (o["lineW"] ?: 0.8) * rs)

    // edges between close neighbours, alpha by proximity + depth
    for (i in 0 until nodeN) {
        for (j in i + 1 until nodeN) {
            val dx = nodes[i][0] - nodes[j][0]
            val dy = nodes[i][1] - nodes[j][1]
            val dz = nodes[i][2] - nodes[j][2]
            val dist = sqrt(dx * dx + dy * dy + dz * dz)
            if (dist >= thr) continue
            pt.project(nodes[i][0], nodes[i][1], nodes[i][2])
            // Projector overwrites its fields on every project() call, and this
            // is the one place a mode needs two points alive at once — capture
            // the first endpoint into locals before the second call clobbers it.
            val x1 = pt.px
            val y1 = pt.py
            val z1 = pt.pz
            pt.project(nodes[j][0], nodes[j][1], nodes[j][2])
            val x2 = pt.px
            val y2 = pt.py
            val z2 = pt.pz
            val depth = ((z1 + z2) / 2 + 1) / 2
            lines.add(
                OrbLine(
                    x1 = x1,
                    y1 = y1,
                    x2 = x2,
                    y2 = y2,
                    white = 0.42,
                    a = (1 - dist / thr) * (0.3 + 0.55 * depth),
                    w = lineW,
                )
            )
        }
    }

    for (i in 0 until nodeN) {
        pt.project(nodes[i][0], nodes[i][1], nodes[i][2])
        val px = pt.px
        val py = pt.py
        val z = pt.pz
        val depth = (z + 1) / 2
        val pulse = 1 + 0.25 * sin(t * 1.4 + i * 2.7)
        dots.add(
            Dot(
                x = px,
                y = py,
                z = z,
                r = (nodeR + nodeRDepth * depth) * pulse * rs,
                white = 0.55 - 0.45 * depth,
            )
        )
    }

    // signals: bright packets running between paired nodes
    val signals = (o["signals"] ?: 5.0).toInt()
    for (s in 0 until signals) {
        val seg = floor(t * 0.55 + s * 7.31)
        val a = floor(hashD(seg, s * 3.1 + 1.7) * nodeN).toInt()
        val b = floor(hashD(seg, s * 5.7 + 4.2) * nodeN).toInt()
        if (a == b) continue
        val f = frac(t * 0.55 + s * 7.31)
        val x = lerp(nodes[a][0], nodes[b][0], f)
        val y = lerp(nodes[a][1], nodes[b][1], f)
        val z = lerp(nodes[a][2], nodes[b][2], f)
        val l = max(1e-6, sqrt(x * x + y * y + z * z))
        pt.project(x / l, y / l, z / l)
        val px = pt.px
        val py = pt.py
        val zr = pt.pz
        val depth = (zr + 1) / 2
        dots.add(
            Dot(
                x = px,
                y = py,
                z = zr,
                r = (nodeR * 1.5 + nodeRDepth * depth) * rs,
                white = 0.05,
                a = 0.5 + 0.5 * depth,
            )
        )
    }

    return finalizeFrame(dots, lines, o["rMin"] ?: 0.3)
}
