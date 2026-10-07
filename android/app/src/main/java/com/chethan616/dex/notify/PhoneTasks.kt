package com.chethan616.dex.notify

import android.content.Context
import android.content.SharedPreferences

/**
 * The tasks you started — or followed up — from this phone. Those are the
 * ones that ride in the status bar as a live update ([LiveUpdate]); a task
 * you started at the PC, sitting in front of it, doesn't need to.
 *
 * Kept on the phone (the command's `from` already says which device asked,
 * but the session doesn't), so it works with any desktop version.
 */
object PhoneTasks {
  private const val KEEP = 100
  private var sp: SharedPreferences? = null

  fun attach(context: Context) {
    sp = context.applicationContext.getSharedPreferences("phone_tasks", Context.MODE_PRIVATE)
  }

  fun has(sessionId: String): Boolean = sp?.contains(sessionId) == true

  /** Remember [sessionId] as asked from here, and show it as a live update straight away if it's running. */
  fun mark(context: Context, sessionId: String) {
    val prefs = sp ?: return
    val edit = prefs.edit().putLong(sessionId, System.currentTimeMillis())
    val all = prefs.all
    if (all.size >= KEEP) {
      all.entries.sortedBy { (it.value as? Long) ?: 0L }.take(all.size - KEEP + 1).forEach { edit.remove(it.key) }
    }
    edit.apply()
    LiveUpdate.refresh(context)
  }
}
