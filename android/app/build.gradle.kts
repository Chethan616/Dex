plugins {
  alias(libs.plugins.android.application)
  alias(libs.plugins.kotlin.compose)
  alias(libs.plugins.kotlin.serialization)
}

// Firebase is configured per project: drop your google-services.json in
// app/ (see ../firebase/README.md). Without it the app still builds and shows
// a setup screen instead of crashing on a missing FirebaseApp.
val hasFirebaseConfig = file("google-services.json").exists()
if (hasFirebaseConfig) {
  apply(plugin = "com.google.gms.google-services")
}

// Release signing comes from ~/.gradle/gradle.properties (DEX_RELEASE_*),
// never from the repo. Without it, release builds fall back to unsigned.
val releaseStore = providers.gradleProperty("DEX_RELEASE_STORE_FILE").orNull
val releaseSigning = releaseStore != null && file(releaseStore).exists()

android {
  namespace = "com.chethan616.dex"

  signingConfigs {
    if (releaseSigning) {
      create("release") {
        storeFile = file(releaseStore!!)
        storePassword = providers.gradleProperty("DEX_RELEASE_STORE_PASSWORD").get()
        keyAlias = providers.gradleProperty("DEX_RELEASE_KEY_ALIAS").get()
        keyPassword = providers.gradleProperty("DEX_RELEASE_KEY_PASSWORD").get()
      }
    }
  }
  compileSdk = 37

  defaultConfig {
    applicationId = "com.chethan616.dex"
    minSdk = 26
    targetSdk = 36
    versionCode = 6
    versionName = "1.0.5"
    buildConfigField("boolean", "HAS_FIREBASE", hasFirebaseConfig.toString())
  }

  buildTypes {
    release {
      if (releaseSigning) signingConfig = signingConfigs.getByName("release")
      isMinifyEnabled = true
      isShrinkResources = true
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
    }
  }

  buildFeatures {
    compose = true
    buildConfig = true
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
}

kotlin {
  compilerOptions {
    jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    optIn.addAll(
      "androidx.compose.material3.ExperimentalMaterial3Api",
      "androidx.compose.material3.ExperimentalMaterial3ExpressiveApi",
      "androidx.compose.animation.ExperimentalSharedTransitionApi",
      "androidx.compose.foundation.layout.ExperimentalLayoutApi",
    )
  }
}

dependencies {
  implementation(project(":orbs"))

  implementation(libs.androidx.core.ktx)
  implementation(libs.androidx.core.splashscreen)
  implementation(libs.androidx.activity.compose)
  implementation(libs.androidx.lifecycle.runtime.compose)
  implementation(libs.androidx.lifecycle.viewmodel.compose)
  implementation(libs.androidx.navigation.compose)

  implementation(platform(libs.compose.bom))
  implementation(libs.compose.ui)
  implementation(libs.compose.ui.graphics)
  implementation(libs.compose.foundation)
  implementation(libs.compose.material3)
  implementation(libs.compose.material.icons.extended)
  implementation(libs.compose.ui.tooling.preview)
  debugImplementation(libs.compose.ui.tooling)

  implementation(libs.kotlinx.serialization.json)
  implementation(libs.kotlinx.coroutines.android)
  implementation(libs.kotlinx.coroutines.play.services)

  implementation(platform(libs.firebase.bom))
  implementation(libs.firebase.auth)
  implementation(libs.firebase.firestore)
  implementation(libs.firebase.messaging)


  implementation(libs.coil.compose)
  implementation(libs.coil.network)

  testImplementation(libs.junit)
}
