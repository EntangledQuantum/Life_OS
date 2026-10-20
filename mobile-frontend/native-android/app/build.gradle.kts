import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
}

android {
    namespace = "com.lifeos.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.lifeos.app"
        minSdk = 26
        targetSdk = 35
        // 2.0.0, not 1.5: the Expo client was signed by a key held in EAS and
        // this is a different one, so Android cannot update 1.4.0 in place —
        // installing it requires an uninstall first. A release that existing
        // users cannot take as an update is a break, and a break is what earns
        // a whole integer. Everything lives on the user's own server, so an
        // uninstall costs a re-pair and no data.
        // 2.0.1: the QR deep link and the scanner behind the button that claimed
        // it, plus the motion the 2.0.0 flattening took out. No break, no new
        // signing key, no re-pair — an ordinary patch on top of 2.0.0.
        versionCode = 201
        versionName = "2.0.1"

        // The protocol this app can read. Source of truth:
        // packages/shared/src/protocol.ts (PROTOCOL_VERSION). Copied, not imported.
        buildConfigField("int", "LIFEOS_PROTOCOL", "3")
    }

    /*
     * Release signing. `keystore.properties` is gitignored and the keystore
     * itself lives outside the repository, so a clone cannot sign — it builds
     * an unsigned release instead of failing, which is what lets CI and other
     * contributors run `assembleRelease` as a compile check.
     */
    val keystoreProperties = Properties().apply {
        val f = rootProject.file("keystore.properties")
        if (f.exists()) f.inputStream().use { load(it) }
    }
    val canSign = keystoreProperties.getProperty("storeFile") != null

    signingConfigs {
        if (canSign) {
            create("release") {
                storeFile = file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
                enableV1Signing = false
                enableV2Signing = true
                enableV3Signing = true
                enableV4Signing = false
            }
        }
    }

    buildTypes {
        debug {
            // A dev build installs alongside the user's Play-registered app
            // instead of replacing it. They test on their daily driver.
            applicationIdSuffix = ".dev"
            versionNameSuffix = "-dev"
            resValue("string", "app_name", "Life OS dev")
        }
        release {
            if (canSign) signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = false
            isShrinkResources = false
            resValue("string", "app_name", "Life OS")
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources.excludes += setOf("/META-INF/{AL2.0,LGPL2.1}")
    }

    lint {
        // lint runs and reports; it does not gate the build. See README.
        abortOnError = false
        warningsAsErrors = false
        xmlReport = true
        htmlReport = true
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

ksp {
    arg("room.schemaLocation", "$projectDir/schemas")
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.process)
    implementation(libs.androidx.activity.compose)

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.graphics)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons.extended)
    debugImplementation(libs.compose.ui.tooling)

    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.adaptive.navigation.suite)
    implementation(libs.androidx.adaptive)

    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    ksp(libs.androidx.room.compiler)

    implementation(libs.androidx.work.runtime.ktx)
    implementation(libs.androidx.glance.appwidget)
    implementation(libs.androidx.glance.material3)
    implementation(libs.androidx.datastore.preferences)
    implementation(libs.androidx.security.crypto)

    implementation(libs.coil.compose)
    implementation(libs.coil.svg)
    implementation(libs.coil.network.okhttp)

    implementation(libs.okhttp)
    implementation(libs.retrofit)
    implementation(libs.retrofit.kotlinx.serialization)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.turbine)
    testImplementation(libs.okhttp.mockwebserver)
}
