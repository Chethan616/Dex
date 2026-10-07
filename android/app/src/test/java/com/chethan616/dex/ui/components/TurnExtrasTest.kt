package com.chethan616.dex.ui.components

import com.chethan616.dex.data.Block
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TurnExtrasTest {
  private fun user(seq: Long) = Block(seq = seq, kind = "user", at = seq, text = "hi")
  private fun tool(seq: Long, name: String) = Block(seq = seq, kind = "tool", at = seq, name = name)
  private fun text(seq: Long, t: String) = Block(seq = seq, kind = "text", at = seq, text = t)

  @Test fun followUpsFollowTheTools() {
    assertEquals(listOf("Cheaper days?", "Find a hotel there"), followUpsFor(listOf("mcp__remote_kiwi__search-flight")).map { it.label })
    assertEquals(listOf("Show my week", "Any conflicts?"), followUpsFor(listOf("mcp__google__calendar_list_events")).map { it.label })
    assertTrue(followUpsFor(listOf("Bash")).isEmpty())
  }

  @Test fun aSettledReplyGetsCopyAndTimeAndChips() {
    val out = withTurnExtras(listOf(user(1), tool(2, "mcp__remote_kiwi__search-flight"), text(3, "Found flights")), live = false)
    assertEquals(listOf("user", "tool", "text", "replyfoot", "chips"), out.map { it.kind })
    assertEquals(out.map { it.seq }.toSet().size, out.size)
  }

  @Test fun aLiveTurnGetsNothing() {
    val blocks = listOf(user(1), tool(2, "mcp__remote_kiwi__search-flight"), text(3, "Found"))
    assertEquals(blocks, withTurnExtras(blocks, live = true))
  }

  @Test fun onlyTheNewestTurnOffersChips() {
    val out = withTurnExtras(listOf(user(1), text(2, "a"), user(3), tool(4, "mcp__google__gmail_search"), text(5, "b")), live = false)
    assertEquals(1, out.count { it.kind == "chips" })
    assertEquals(2, out.count { it.kind == "replyfoot" })
  }
}
