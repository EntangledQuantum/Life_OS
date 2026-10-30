package com.lifeos.app.data.api

import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import com.lifeos.app.BuildConfig
import com.lifeos.app.data.TokenSource
import kotlinx.serialization.json.Json
import okhttp3.ConnectionPool
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
 *
 * **And every timeout comes from the address**, not from a constant in this
 * file. One set of numbers cannot be right for both a laptop on the same Wi-Fi
 * and a Tailscale Funnel: see [Budget], which holds the two sets and the
 * measurements behind them.
 */
object ApiClient {

    /**
     * **One connection pool for the whole app**, shared by every client this
     * object builds and by the image loader.
     *
     * Measured on the phone against the user's Funnel, three `GET /health` in
     * one process:
     *
     * | Request | Total | of which TLS |
     * |---|---|---|
     * | first, new connection | 1.09 s | 0.80 s |
     * | second, reused | 0.30 s | 0.00 s |
     * | third, reused | 0.30 s | 0.00 s |
     *
     * A reused connection is **3.6× faster**, and on a worse sample the
     * handshake was 3.58s of a 5.00s request — over 70% of it. Keep-alive
     * works perfectly through the portal proxy; the app simply was not using
     * it across its own components. `ApiClient` built one client per address,
     * `PairClaim` built its own, `ServerProbe` built its own per run and
     * `ArtLoader` built another, and an `OkHttpClient.Builder` gets a **fresh
     * `ConnectionPool` every time** — so pairing paid the handshake for the
     * probe, again for the claim, and again for the first dashboard fetch, on
     * a link where that is a second and a half each.
     *
     * The dispatcher is deliberately **not** shared. Sharing it would also
     * share OkHttp's five-requests-per-host limit, and a burst of artwork could
     * then queue the dashboard poll behind it. The handshake is the measured
     * cost; thread pools are not.
     */
    val connections = ConnectionPool(
        maxIdleConnections = 5,
        // Comfortably longer than the slowest poll interval (§7.9: 60s on You
        // for a remote server), so a quiet gap between polls does not throw
        // away the connection and buy another handshake.
        keepAliveDuration = 5,
        timeUnit = TimeUnit.MINUTES,
    )

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

    /**
     * A client for one server, with that server's budget.
     *
     * [witness] is optional and records only whether a connection was
     * established, so a timeout can be reported as "slow" rather than as
     * "wrong address" (see `TransportFailure`). It is **not** a logger.
     */
    fun okHttp(
        tokens: TokenSource,
        budget: Budget,
        witness: ConnectionWitness? = null,
    ): OkHttpClient =
        OkHttpClient.Builder()
            // Shared, so the handshake this request would otherwise pay has
            // usually already been paid by the probe or the claim.
            .connectionPool(connections)
            .connectTimeout(budget.connectSeconds, TimeUnit.SECONDS)
            .readTimeout(budget.readSeconds, TimeUnit.SECONDS)
            .writeTimeout(budget.writeSeconds, TimeUnit.SECONDS)
            .callTimeout(budget.callSeconds, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .addInterceptor(protocolHeader)
            .addInterceptor(authHeader(tokens))
            // No logging interceptor, at any build type. A request log would
            // carry the Authorization header, and the token is never logged.
            .apply { if (witness != null) eventListener(witness) }
            .build()

    fun retrofit(baseUrl: String, client: OkHttpClient): Retrofit =
        Retrofit.Builder()
            .baseUrl(normaliseBase(baseUrl))
            .client(client)
            .addConverterFactory(json.asConverterFactory(contentType))
            .build()

    /**
     * The ordinary client for an address — the poll, the drain, the refetch.
     *
     * The budget is derived here rather than passed in, so that every caller
     * that only knows an address (`AppContainer`'s per-address cache, and
     * therefore the dashboard poll, `SyncWorker`, the widget's refresh and the
     * notification reconcile) gets the right deadlines without having to know
     * that there is a choice to make.
     */
    fun api(baseUrl: String, tokens: TokenSource): LifeOsApi =
        retrofit(baseUrl, okHttp(tokens, Budget.of(baseUrl))).create(LifeOsApi::class.java)

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
 * Two kinds of input, and they must not be treated the same way.
 *
 * **A bare host** — `192.168.1.4`, `192.168.1.4:8787`, `nas.local/lifeos` — is
 * the LAN case. Nobody types a scheme for it, so `http` and port 8787 are
 * filled in. That is the forgiving path.
 *
 * **An address with a scheme typed out** is a statement of intent, and is
 * honoured exactly: its port, or the scheme's own default, and *its path*.
 * `https://sunny.example.ts.net/lifeos` is a real deployment — the API serves
 * the dashboard under a gateway prefix, which is what `X-Forwarded-Prefix`
 * exists for — and it must survive this function untouched.
 *
 * Both halves of that were wrong here. The path was dropped on the floor, and
 * `https://host/lifeos` came back as `https://host:8787`: a different port, a
 * different origin, and the prefix gone. The app could not reach a tunnelled
 * instance at all, which is the only way most people reach one from outside
 * their own Wi-Fi.
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

        // Typed a scheme: take them at their word, port and path included.
        if (hasScheme) return withScheme

        // `HttpUrl` fills in 80/443 from the scheme, so "no port was typed" has
        // to be detected on the text. Look only at the authority — a colon in a
        // path or query is not a port.
        val authority = withScheme.substringAfter("://").substringBefore('/')
        if (authority.contains(':')) return withScheme

        val path = url.encodedPath.removeSuffix("/").takeIf { it.isNotBlank() }.orEmpty()
        return "${url.scheme}://${url.host}:$DEFAULT_PORT$path"
    }
}
