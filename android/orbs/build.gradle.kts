// thinking-orbs — the Kotlin/Compose port of Libraries.dev's orb engine
// (github.com/andresain123/Libraries, feat/android-compose-port; MIT, see
// LICENSE). Vendored as-is: same nine states as the desktop's orbs.
plugins {
  alias(libs.plugins.android.library)
  alias(libs.plugins.kotlin.compose)
}

android {
  namespace = "com.jakubantalik.thinkingorbs"
  compileSdk = 37
  defaultConfig { minSdk = 26 }
  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
  buildFeatures { compose = true }
}

dependencies {
  implementation(platform(libs.compose.bom))
  implementation(libs.compose.foundation)
  implementation(libs.compose.ui)
  implementation(libs.compose.runtime)
}

kotlin {
  compilerOptions {
    jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
  }
}
