plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// رقم البناء من GitHub Actions حتى يُثبَّت كل إصدار فوق السابق
val buildNumber = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()

android {
    namespace = "com.asas.gamestudio"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.asas.gamestudio"
        minSdk = 26
        targetSdk = 35
        versionCode = buildNumber
        versionName = "1.0.$buildNumber"
    }

    // مفتاح توقيع ثابت: بدونه يتغير التوقيع مع كل بناء ولا يُحدَّث التطبيق فوق القديم (فتضيع الألعاب)
    signingConfigs {
        create("shared") {
            storeFile = file("studio.keystore")
            storePassword = "gamestudio"
            keyAlias = "studio"
            keyPassword = "gamestudio"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("shared")
        }
        debug {
            signingConfig = signingConfigs.getByName("shared")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
}
