package com.lifeos.app.data.api

import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import com.lifeos.app.BuildConfig
import com.lifeos.app.data.TokenSource
import kotlinx.serialization.json.Json
import okhttp3.Interceptor
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import java.util.concurrent.TimeUnit

/**
 * One OkHttp client, one Retrofit, both rebuilt when the address changes.
 *
 * **Every timeout is set explicitly.** React Native configured OkHttp with all
 * three at zero, which meant a request to an address that drops packets — a
 * sleeping laptop, a stale LAN IP, a VPN in the way — neither resolved nor
 * rejected, and the old app sat on a spinner forever. Relying on any default
 * here is the bug coming back; nothing is unbounded.
 */
object ApiClient {

    /** §0.2: connect 5s, read 12s, call 15s. 6s for probes. */
    private const val CONNECT_SECONDS = 5L
    private const val READ_SECONDS = 12L
    private const val WRITE_SECONDS = 12L
    private const val CALL_SECONDS = 15L

    /** A probe is a thing the user is waiting on, so it gives up sooner. */
    const val PROBE_SECONDS = 6L

    val json: Json = Json {
        // A server that grows a field must not break an installed app.
        ignoreUnknownKeys = true
        isLenient = true
        explicitNulls = false
        coerceInputValues = true
    }

    private val contentType = "application/json".toMediaType()

    /**
     * The protocol header goes on every `/api/v1` routes request from one place.
     *
     * Read from `BuildConfig.LIFEOS_PROTOCOL`, which is copied from
     * `packages/shared/src/protocol.ts`. One interceptor, so there is no request
     * anywhere in the app that can forget it and get a `426` the UI cannot
     * explain.
     */
    private val protocolHeader = Interceptor { chain ->
        val request = chain.request()
        chain.proceed(
            if (request.url.encodedPath.contains("/api/v1/")) {
                request.newBuilder()
                    .header(PROTOCOL_HEADER, BuildConfig.LIFEOS_PROTOCOL.toString())
                    .build()
            } else {
                request
            },
        )
    }

    /**
     * Bearer auth on `/api/v1` routes only.
     *
     * `/health`, `/api/v1/protocol` and `/api/v1/pair/claim` are deliberately
     * reachable without it — the server screen has to be able to test
     * reachability and protocol *separately* from auth, which is the point of
     * reporting four results rather than one.
     */
    private fun authHeader(tokens: TokenSource) = Interceptor { chain ->
        val request = chain.request()
        val needsAuth = request.url.encodedPath.contains("/api/v1/") &&
            !request.url.encodedPath.contains("/api/v1/pair/claim") &&
            !request.url.encodedPath.endsWith("/api/v1/protocol")
        val token = if (needsAuth) tokens.token() else null
        chain.proceed(
            if (token.isNullOrBlank()) request
            else request.newBuilder().header("Authorization", "Bearer $token").build(),
        )
    }

    fun okHttp(tokens: TokenSource, callTimeoutSeconds: Long = CALL_SECONDS): OkHttpClient =
        OkHttpClient.Builder()
            .connectTimeout(CONNECT_SECONDS, TimeUnit.SECONDS)
            .readTimeout(READ_SECONDS, TimeUnit.SECONDS)
            .writeTimeout(WRITE_SECONDS, TimeUnit.SECONDS)
            .callTimeout(callTimeoutSeconds, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .addInterceptor(protocolHeader)
            .addInterceptor(authHeader(tokens))
            // No logging interceptor, at any build type. A request log would
            // carry the Authorization header, and the token is never logged.
            .build()

    fun retrofit(baseUrl: String, client: OkHttpClient): Retrofit =
        Retrofit.Builder()
            .baseUrl(normaliseBase(baseUrl))
            .client(client)
            .addConverterFactory(json.asConverterFactory(contentType))
            .build()

    fun api(baseUrl: String, tokens: TokenSource): LifeOsApi =
        retrofit(baseUrl, okHttp(tokens)).create(LifeOsApi::class.java)

    /** Retrofit demands a trailing slash on a base URL or it throws. */
    fun normaliseBase(baseUrl: String): String =
        if (baseUrl.endsWith("/")) baseUrl else "$baseUrl/"

    const val PROTOCOL_HEADER = "x-lifeos-protocol"

    /** The protocol this build speaks. */
    val clientProtocol: Int get() = BuildConfig.LIFEOS_PROTOCOL
}

/**
 * Normalise what a human types into an address.
 *
 * The realistic input is `192.168.1.4` or `192.168.1.4:8787` — people do not
 * type a scheme. Defaulting the scheme to `http` and the port to 8787 is what
 * makes the field forgiving without guessing anything the user did not mean.
 */
object AddressInput {
    const val DEFAULT_PORT = 8787

    fun normalise(raw: String): String? {
        val trimmed = raw.trim()
        if (trimmed.isEmpty()) return null

        // The scheme is detected on the untrimmed-of-slash text: stripping the
        // trailing slash first turns a bare "http://" into "http:/", which then
        // looks schemeless and becomes "http://http:/" — a request to a host
        // called "http". Found by a test, not by a user, which is the point.
        val hasScheme = trimmed.startsWith("http://") || trimmed.startsWith("https://")
        val body = if (hasScheme) trimmed else "http://$trimmed"
        val withScheme = body.removeSuffix("/")

        val url = withScheme.toHttpUrlOrNull() ?: return null
        // A scheme with nothing after it is not an address.
        if (url.host.isBlank()) return null
        // `HttpUrl` fills in 80/443 from the scheme, so "no port was typed" has
        // to be detected on the text rather than read back off the parse.
        val hadExplicitPort = withScheme.substringAfter("://").contains(':')
        return if (hadExplicitPort) withScheme else "${url.scheme}://${url.host}:$DEFAULT_PORT"
    }
}
