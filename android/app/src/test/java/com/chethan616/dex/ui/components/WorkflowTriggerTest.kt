package com.chethan616.dex.ui.components

import org.junit.Assert.assertEquals
import org.junit.Test

/** The phone says a workflow's schedule exactly as the desktop does (shared/workflows.ts triggerText). */
class WorkflowTriggerTest {
  @Test fun saysTheScheduleAsAPersonWould() {
    assertEquals("When you run it", triggerText(WTrigger("manual", null, emptyList())))
    assertEquals("Every day at 7:30 am", triggerText(WTrigger("daily", "07:30", emptyList())))
    assertEquals("Weekdays at 9:00 am", triggerText(WTrigger("weekly", "09:00", listOf("fri", "mon", "tue", "wed", "thu"))))
    assertEquals("Weekends at 10:15 am", triggerText(WTrigger("weekly", "10:15", listOf("sun", "sat"))))
    assertEquals("Every Fri at 6:00 pm", triggerText(WTrigger("weekly", "18:00", listOf("fri"))))
    assertEquals("Mon, Wed at 12:00 pm", triggerText(WTrigger("weekly", "12:00", listOf("wed", "mon"))))
  }
}
