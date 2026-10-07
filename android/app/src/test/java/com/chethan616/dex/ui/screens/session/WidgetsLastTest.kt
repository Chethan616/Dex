package com.chethan616.dex.ui.screens.session

import com.chethan616.dex.data.Block
import org.junit.Assert.assertEquals
import org.junit.Test

/** A turn's widgets close it, after the answer — as on the desktop. */
class WidgetsLastTest {
  private fun b(seq: Long, kind: String, echo: Boolean = false) = Block(seq = seq, kind = kind, echo = echo)
  private fun kinds(blocks: List<Block>) = widgetsLast(blocks).map { "${it.kind}${it.seq}" }

  @Test fun cardsComeAfterTheAnswerAndBeforeItsDone() {
    val turn = listOf(b(1, "user"), b(2, "text"), b(3, "tool"), b(4, "widget"), b(5, "text"), b(6, "done", echo = true))
    assertEquals(listOf("user1", "text2", "tool3", "text5", "widget4", "done6"), kinds(turn))
  }

  @Test fun aDoneCardThatCarriesTheAnswerComesFirst() {
    val turn = listOf(b(1, "user"), b(2, "widget"), b(3, "done"))
    assertEquals(listOf("user1", "done3", "widget2"), kinds(turn))
  }

  @Test fun eachTurnKeepsItsOwnCards() {
    val blocks = listOf(b(1, "user"), b(2, "widget"), b(3, "text"), b(4, "user"), b(5, "text"))
    assertEquals(listOf("user1", "text3", "widget2", "user4", "text5"), kinds(blocks))
  }
}
