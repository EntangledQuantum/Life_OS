package com.lifeos.app.data.api

import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
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

    /**
     * **The one read** (protocol 4). What changed since the cursor we hold.
     *
     * `GET /api/v1/dashboard/today` is gone — it answers `404` — and this
     * replaces it. It returned the whole day, 2,263,618 bytes of it on this
     * user's real data with 97.4% inline base64 artwork, on every poll, and it
     * could never be cached because it embedded a time-dependent "now" marker.
     * An unchanged poll here is 314 bytes, or nothing at all on a `304`.
     *
     * [since] is the opaque cursor, omitted for a cold sync. [ifNoneMatch] is
     * the `ETag` from the last response and is the difference between 314 bytes
     * and zero; a null is simply left off the request by Retrofit.
     *
     * `Response<T>` rather than `T` because `304` carries **no body**, and a
     * method returning a bare type cannot express "current, nothing enclosed".
     */
    @GET("api/v1/sync")
    suspend fun sync(
        @Query("since") since: String? = null,
        @Header("If-None-Match") ifNoneMatch: String? = null,
    ): Response<SyncEnvelopeDto>

    /**
     * **The one write.** Mutations up, authoritative results and a delta back.
     *
     * The reply carries the resulting state, so a client that has just written
     * is already current and must **not** refetch. That refetch used to cost a
     * 2.26 MB re-read of a day the client had changed one row of.
     */
    @POST("api/v1/sync/push")
    suspend fun push(@Body body: SyncPushRequestDto): Response<SyncPushResponseDto>

    /**
     * The only screen-specific network read in the app (§3.3).
     *
     * `7d` comes off the `insights` document, so this is reached only when the
     * user asks for 30d, 90d or all — one request per choice, never polled.
     */
    @GET("api/v1/analytics")
    suspend fun analytics(@Query("range") range: String): Response<AnalyticsDto>

    /*
     * There are deliberately **no per-write REST methods here any more.**
     *
     * `habits/:id/complete`, `tasks/:id/complete`, `tasks/:id/dismiss`,
     * `tasks/:id/notified`, `goals/:id/celebration-seen`, `PATCH /settings`,
     * `session/active` and `POST /study` all still exist on the server and are
     * unchanged — but every one of them now reaches it through [push], as a
     * named mutation, and their absence from this interface is the enforcement.
     *
     * Three things come free from routing writes through one endpoint, and none
     * of them is available to a client that posts to eight:
     *
     *  - **The reply carries the delta**, so a write no longer triggers a
     *    refetch of the whole day to find out what it did.
     *  - **Idempotency is real.** A persisted per-installation counter means a
     *    queue drained twice completes a habit once, instead of relying on the
     *    server noticing a duplicate.
     *  - **The life-day guard is enforced on both sides.** A day-bound mutation
     *    carries the life-day it was made in, so a write that was in flight when
     *    the clock passed 04:00 is refused rather than landing on the wrong day
     *    and silently corrupting a streak.
     *
     * `GET /api/v1/settings` is gone from here too: `settings` is one of the
     * nine documents and arrives in the delta, only when its bytes changed. That
     * is one fewer request on every single poll.
     */
}
