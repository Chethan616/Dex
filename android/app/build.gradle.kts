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
    versionCode = 44
    versionName = "2.3.0"
    buildConfigField("boolean", "HAS_FIREBASE", hasFirebaseConfig.toString())
  }

  // Two ways DEX reaches a phone, one build each. github: the APK on GitHub
  // Releases, which updates itself from there (update/AppUpdater.kt). play:
  // the bundle for Google Play, which does the updating; Play allows no other
  // updater, so that build has none and never asks to install apps
  // (src/play/AndroidManifest.xml).
  flavorDimensions += "store"
  productFlavors {
    create("github") {
      dimension = "store"
      buildConfigField("boolean", "SELF_UPDATE", "true")
    }
    create("play") {
      dimension = "store"
      buildConfigField("boolean", "SELF_UPDATE", "false")
    }
  }

  buildTypes {
    release {
      if (releaseSigning) signingConfig = signingConfigs.getByName("release")
      isMinifyEnabled = true
      isShrinkResources = true
      // Symbol tables go into the bundle for any native library that has them.
      // Today's two don't (see zipPlayReleaseNativeSymbols below).
      ndk { debugSymbolLevel = "SYMBOL_TABLE" }
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

// Play warns when a bundle with native code comes without debug symbols. DEX's
// native code is AndroidX's (Compose's path helper, DataStore's shared counter),
// shipped already stripped, so debugSymbolLevel has nothing to extract. What
// they keep is their dynamic symbol table, the JNI entry points. This zips the
// libraries as Play Console's "Native debug symbols" upload wants them (one
// folder per ABI), next to every Play bundle; upload it with the bundle
// (App bundle explorer › the version › Downloads).
val zipPlayReleaseNativeSymbols = tasks.register<Zip>("zipPlayReleaseNativeSymbols") {
  dependsOn("mergePlayReleaseNativeLibs")
  from(layout.buildDirectory.dir("intermediates/merged_native_libs/playRelease/mergePlayReleaseNativeLibs/out/lib"))
  destinationDirectory.set(layout.buildDirectory.dir("outputs/native-debug-symbols/playRelease"))
  archiveFileName.set("native-debug-symbols.zip")
}
tasks.matching { it.name == "bundlePlayRelease" }.configureEach { finalizedBy(zipPlayReleaseNativeSymbols) }

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
  // The in-app 3D viewer: <model-viewer> in a WebView, served from assets.
  implementation(libs.androidx.webkit)
  implementation(libs.coil.network)

  testImplementation(libs.junit)
}
