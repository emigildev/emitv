plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "com.emigildev.emitv"
    compileSdk {
        version = release(37)
    }

    defaultConfig {
        applicationId = "com.emigildev.emitv"
        minSdk = 28
        targetSdk = 37
        // En GitHub Actions cada compilación tiene un número que sube solo (1, 2, 3…).
        // En tu PC no existe, y se usa 1.
        val numeroCompilacion = System.getenv("GITHUB_RUN_NUMBER")?.toIntOrNull() ?: 1
        versionCode = numeroCompilacion
        versionName = "1.0.$numeroCompilacion"

    }

    // Firma de la versión definitiva. Los datos vienen de variables de entorno
    // (en GitHub Actions, de los secretos del repo): nunca están en el código.
    val archivoFirma = System.getenv("EMITV_KEYSTORE")
    signingConfigs {
        if (archivoFirma != null) {
            create("release") {
                storeFile = file(archivoFirma)
                storePassword = System.getenv("EMITV_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("EMITV_KEY_ALIAS")
                keyPassword = System.getenv("EMITV_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            if (archivoFirma != null) signingConfig = signingConfigs.getByName("release")
            optimization {
                enable = true
                packageScope = setOf("androidx.**", "kotlin.**", "kotlinx.**")
            }
        }
        debug {
            // La versión de prueba es "otra app": puede convivir con la definitiva en la misma TV
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-prueba"
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    buildFeatures {
        compose = true

    }
}

dependencies {
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.appcompat)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.tv.foundation)
    implementation(libs.androidx.tv.material)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
    debugImplementation(libs.androidx.compose.ui.tooling)
    implementation(libs.retrofit)
    implementation(libs.retrofit.kotlinx.serialization)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.media3.exoplayer)
    implementation(libs.media3.exoplayer.hls)
    implementation(libs.media3.ui)
    implementation(libs.androidx.compose.material3)
}