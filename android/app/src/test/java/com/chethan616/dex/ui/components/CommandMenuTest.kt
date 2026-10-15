package com.chethan616.dex.ui.components

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The `/` and `@` menus' text rules (CommandMenu.kt), the same as the desktop's slashCommands.ts and mentions.ts. */
class CommandMenuTest {
  @Test fun aCommandIsOnlyTheFirstWord() {
    assertEquals("", commandQuery("/"))
    assertEquals("wo", commandQuery("  /Wo"))
    assertNull(commandQuery("/workflow add one"))
    assertNull(commandQuery("find /workflow"))
  }

  @Test fun aMentionIsTheWordBeingTyped() {
    assertEquals("dr", mentionQuery("find my lease @dr"))
    assertEquals("", mentionQuery("@"))
    assertNull(mentionQuery("mail me@example"))
    assertNull(mentionQuery("@drive and more"))
  }

  @Test fun pickingPutsItInTheText() {
    assertEquals("/workflow ", withCommand("workflow"))
    assertEquals("find my lease @drive ", withMention("find my lease @dr", "drive"))
  }

  @Test fun aChosenCommandSaysWhatItNeeds() {
    val all = DEFAULT_COMMANDS.commands
    assertEquals("scrape", pendingCommand("/scrape ", all)?.name)
    assertNull(pendingCommand("/scrape vit.ac.in", all))
    assertNull(pendingCommand("/workflow ", all))
  }

  @Test fun theHintSaysWhatToAddInWords() {
    assertEquals("the site's address", argWords("/scrape <url>"))
    assertEquals("what to do", argWords("/workflow [what to do]"))
  }
}
