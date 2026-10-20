package com.lifeos.app.data.api

import kotlinx.serialization.json.JsonObject
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query
import retrofit2.http.Url

/**
 * Every endpoint the app touches.
 *
 * `Response<T>` throughout rather than bare `T`, because the status code is
 * load-bearing in three places: `401` clears the token, `426` blocks the app,
 * and `409` on a habit complete is success. A Retrofit method returning `T`
 * throws those away.
 */
interface LifeOsApi {

    /* ---- unauthenticated probes. Order matters: these work with no token. ---- */

    /** Reachability, and where `lan` comes from. Not under /api/v1. */
    @GET
    suspend fun health(@Url url: String): Response<HealthDto>

    /** Checked on every cold start before the first authenticated call. */
    @GET
    suspend fun protocol(@Url url: String): Response<ProtocolDto>

    /** Unauthenticated by design — a phone with no token has to be able to pair. */
    @POST
    suspend fun claimPairing(
        @Url url: String,
        @Body body: PairClaimRequest,
    ): Response<PairClaimResponse>

    /* ---- authenticated ---- */

    /** Validate the token we are holding. */
    @GET("api/v1/auth/me")
    suspend fun me(): Response<AuthMeDto>

    /** The primary read. Everything on every screen comes from this one call. */
    @GET("api/v1/dashboard/today")
    suspend fun today(): Response<DashboardTodayDto>

    /**
     * The settings the app is allowed to read and write.
     *
     * A second read rather than a field on the dashboard, because the dashboard
     * does not carry one. Fetched beside it on the same poll.
     */
    @GET("api/v1/settings")
    suspend fun settings(): Response<SettingsDto>

    /**
     * The only screen-specific network read in the app (§3.3).
     *
     * `7d` comes off the dashboard snapshot, so this is reached only when the
     * user asks for 30d, 90d or all — one request per choice, never polled.
     */
    @GET("api/v1/analytics")
    suspend fun analytics(@Query("range") range: String): Response<AnalyticsDto>

    /** `200` ok · `404` unknown · `409` already done today, which is success. */
    @POST("api/v1/habits/{id}/complete")
    suspend fun completeHabit(
        @Path("id") id: String,
        @Body body: SourceBody,
    ): Response<JsonObject>

    @POST("api/v1/habits/{id}/undo")
    suspend fun undoHabit(@Path("id") id: String): Response<JsonObject>

    @POST("api/v1/tasks/{id}/complete")
    suspend fun completeTask(
        @Path("id") id: String,
        @Body body: SourceBody,
    ): Response<JsonObject>

    /** Put it away without doing it. Distinct from done, and day-independent. */
    @POST("api/v1/tasks/{id}/dismiss")
    suspend fun dismissTask(@Path("id") id: String): Response<JsonObject>

    /**
     * The de-dupe for reminders. Posted even under DND and quiet hours —
     * skipping it means every suppressed reminder fires the instant DND ends.
     */
    @POST("api/v1/tasks/{id}/notified")
    suspend fun taskNotified(@Path("id") id: String): Response<JsonObject>

    /** The only path to `status: "achieved"`, and only on a real dismissal. */
    @POST("api/v1/goals/{id}/celebration-seen")
    suspend fun celebrationSeen(@Path("id") id: String): Response<JsonObject>

    @PATCH("api/v1/settings")
    suspend fun patchSettings(@Body body: JsonObject): Response<JsonObject>

    /** What you are doing right now — set by hand, never by a task. */
    @POST("api/v1/session/active")
    suspend fun startSession(@Body body: JsonObject): Response<JsonObject>

    @retrofit2.http.DELETE("api/v1/session/active")
    suspend fun stopSession(): Response<JsonObject>

    @POST("api/v1/study")
    suspend fun logStudy(@Body body: JsonObject): Response<JsonObject>
}
