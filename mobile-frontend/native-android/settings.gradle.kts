pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "life-os-android"
include(":app")

/*
 * This is a standalone Gradle build, deliberately NOT part of the pnpm
 * workspace that owns the rest of the repository, and it never imports from
 * `apps/*` or `packages/*`. Its only contact with Life OS is HTTP.
 * See ../README.md for the isolation contract.
 */
