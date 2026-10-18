package com.chethan616.dex.ui.components

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The phone splits and orders triaged messages exactly as desktop/app/src/shared/triage.ts does. */
class TriageOrderTest {
  private fun item(id: String, u: Double, i: Double, state: String? = null) =
    TItem(id, id, null, null, null, null, null, u, i, null, null, null, state, null)

  @Test fun splitsAtTheMiddle() {
    assertEquals(
      listOf(Quad.Later, Quad.Quick, Quad.Plan, Quad.Now, Quad.Now),
      listOf(item("a", 2.0, 2.0), item("b", 9.0, 3.0), item("c", 3.0, 9.0), item("d", 6.0, 6.0), item("e", 5.0, 5.0)).map(::quadOf),
    )
  }

  @Test fun goesThroughTheMostPressingFirst() {
    val order = triageOrder(listOf(item("later", 2.0, 2.0), item("quick", 9.0, 3.0), item("plan", 3.0, 9.0), item("now", 6.0, 6.0), item("top", 9.0, 9.0)))
    assertEquals(listOf("top", "now", "quick", "plan", "later"), order.map { it.id })
  }

  @Test fun sitsWhereItsScoresSayInsideItsCorner() {
    assertEquals(listOf(5.0, 10.0, 5.0, 10.0), cornerRange(Quad.Now))
    assertEquals(listOf(0.0, 5.0, 0.0, 5.0), cornerRange(Quad.Later))
    assertEquals(0.8f to 0.8f, withinCorner(item("a", 9.0, 9.0)))
    assertEquals(0f to 1f, withinCorner(item("a", 5.0, 10.0)))
    assertEquals(0.5f to 0f, withinCorner(item("a", 2.5, 0.0)))
    assertEquals("Urgency 7.5 · Importance 8", scores(item("a", 7.5, 8.0)))
  }

  @Test fun sentSkippedAndSendingAreSettled() {
    assertTrue(settled(item("a", 1.0, 1.0, "sent")))
    assertTrue(settled(item("a", 1.0, 1.0, "skipped")))
    assertTrue(settled(item("a", 1.0, 1.0, "sending")))
    assertFalse(settled(item("a", 1.0, 1.0, "failed")))
    assertFalse(settled(item("a", 1.0, 1.0, "open")))
    assertFalse(settled(item("a", 1.0, 1.0)))
  }
}
