allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}
subprojects {
    project.evaluationDependsOn(":app")
}

gradle.projectsEvaluated {
    subprojects {
        if (project.path == ":app") return@subprojects
        val android = extensions.findByType(com.android.build.gradle.BaseExtension::class.java) ?: return@subprojects

        val appCompileSdk = project(":app").extensions
            .findByType(com.android.build.gradle.BaseExtension::class.java)
            ?.compileSdkVersion
        if (appCompileSdk != null && android.compileSdkVersion != appCompileSdk) {
            android.compileSdkVersion(appCompileSdk)
        }

        android.compileOptions.sourceCompatibility = JavaVersion.VERSION_17
        android.compileOptions.targetCompatibility = JavaVersion.VERSION_17

        tasks.withType<JavaCompile>().configureEach {
            sourceCompatibility = "17"
            targetCompatibility = "17"
        }
        // Reflection, not a typed KotlinCompile reference: some plugins (e.g. another_telephony)
        // pin their own old kotlin-gradle-plugin version via a nested buildscript{}, which can
        // load KotlinCompile/KotlinJvmOptions through a different classloader than this script's,
        // making a statically-typed tasks.withType<KotlinCompile>() silently match nothing.
        tasks.matching { it.name.contains("Kotlin") }.configureEach {
            runCatching {
                val kotlinOptions = javaClass.getMethod("getKotlinOptions").invoke(this)
                kotlinOptions.javaClass.getMethod("setJvmTarget", String::class.java).invoke(kotlinOptions, "17")
            }
        }
    }
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
