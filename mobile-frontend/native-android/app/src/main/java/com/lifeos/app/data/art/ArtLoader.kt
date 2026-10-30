package com.lifeos.app.data.art

import android.content.Context
import coil3.ComponentRegistry
import coil3.ImageLoader
import coil3.decode.DataSource
import coil3.decode.ImageSource
import coil3.disk.DiskCache
import coil3.fetch.FetchResult
import coil3.fetch.Fetcher
import coil3.fetch.SourceFetchResult
import coil3.memory.MemoryCache
import coil3.network.CacheStrategy
import coil3.network.NetworkRequest
import coil3.network.NetworkResponse
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.request.Options
import coil3.svg.SvgDecoder
import com.lifeos.app.data.TokenSource
import com.lifeos.app.data.api.ApiClient
import com.lifeos.app.data.api.Budget
import com.lifeos.app.domain.ArtSvg
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okio.Buffer
import okio.FileSystem
import okio.Path.Companion.toOkioPath
import java.util.concurrent.TimeUnit

/**
 * The one image loader in the app.
 *
 * Three things about it are not negotiable, and all three are the reason it is
 * built by hand rather than left to Coil's defaults:
 *
 *  1. **It phones nowhere by itself.** Coil's network layer is replaced with
 *     this app's own OkHttp client, so an image request has the same bounded
 *     timeouts as every other request and reaches exactly the hosts an agent
 *     put in a URL — there is no CDN, no placeholder service, no telemetry and
 *     no crash reporter anywhere in this graph.
 *  2. **The token goes to the user's server and to nothing else.** A picture
 *     hosted on the user's own Life OS needs the bearer header or it comes back
 *     `401`; a picture an agent linked from somewhere else must never see it.
 *     [ArtOrigin] is the switch, and it compares scheme, host and port.
 *  3. **Nothing is ever logged.** No logging interceptor at any build type, for
 *     the same reason `ApiClient` has none: a request log carries the
 *     `Authorization` header.
 */
object ArtLoader {

    /**
     * Nothing is unbounded, ever — and a picture is not urgent.
     *
     * The connect and read deadlines come from the **request's own host**
     * (`Budget.ofHost`), applied per call, because one image request may go to
     * the user's LAN server and the next to an agent's public URL and they do
     * not deserve the same patience. [ART_MIN_READ] is the floor: a photograph
     * is bigger than a JSON payload, so 20s is kept for a LAN read where the
     * API would allow 12.
     *
     * [CALL_SECONDS] is the one that cannot vary per request — OkHttp fixes the
     * call timeout on the client — so it is the outer cap for the slowest case
     * and the per-call connect/read above do the real work.
     */
    private const val ART_MIN_READ = 20L
    private const val CALL_SECONDS = 45L

    /**
     * A fifth of the app's heap for decoded bitmaps.
     *
     * This cache is what makes the eight-second poll free: the key is short (see
     * `Art.cacheKey`), so a poll that returns the same picture is a map lookup
     * rather than a base64 walk and a bitmap decode.
     */
    private const val MEMORY_PERCENT = 0.20

    /** 48 MB on disk, so a cold start draws yesterday's art with no network. */
    private const val DISK_BYTES = 48L * 1024 * 1024

    private const val DISK_DIR = "art_images"

    fun create(context: Context, tokens: TokenSource, origin: ArtOrigin): ImageLoader =
        ImageLoader.Builder(context)
            .components(components(tokens, origin))
            .memoryCache {
                MemoryCache.Builder().maxSizePercent(context, MEMORY_PERCENT).build()
            }
            .diskCache {
                /*
                 * Under protocol 4 this is **the** copy of the user's artwork on
                 * the device, and that is a change worth stating.
                 *
                 * It used to be a convenience: every picture also arrived inline
                 * in the dashboard payload, so Room held a copy and a cold start
                 * drew art with no network by a different route. Now a picture is
                 * a URL and nothing inlines it, so an offline cold start draws
                 * the art that is in here and the emoji for anything that is
                 * not. That is the right trade — the inline copy cost 2.2 MB on
                 * every poll for bytes the client already had — and it is why
                 * this cache is generous rather than tight. The measured art for
                 * this user's whole instance is 1,670,004 bytes across 24
                 * assets, so 48 MB holds every picture they have with room for
                 * years more, and content-addressed keys mean a replaced picture
                 * adds an entry instead of invalidating one.
                 */
                DiskCache.Builder()
                    .directory(context.cacheDir.resolve(DISK_DIR).toOkioPath())
                    .maxSizeBytes(DISK_BYTES)
                    .build()
            }
            .build()

    private fun components(tokens: TokenSource, origin: ArtOrigin): ComponentRegistry =
        ComponentRegistry.Builder()
            // An agent's SVG, decoded to a bitmap. `ArtSvg` is its own model
            // type so nothing else in the app can route markup anywhere near a
            // renderer that could execute it.
            .add(ArtSvgFetcher.Factory(), ArtSvg::class)
            .add(SvgDecoder.Factory())
            .add(
                OkHttpNetworkFetcherFactory(
                    callFactory = { okHttp(tokens, origin) },
                    cacheStrategy = { ImmutableAssets },
                ),
            )
            .build()

    private fun okHttp(tokens: TokenSource, origin: ArtOrigin): OkHttpClient =
        OkHttpClient.Builder()
            // The app's one connection pool (see `ApiClient.connections`). A
            // picture from the user's own server then rides the connection the
            // dashboard poll already has, instead of paying its own handshake.
            .connectionPool(ApiClient.connections)
            .connectTimeout(Budget.REMOTE.connectSeconds, TimeUnit.SECONDS)
            .readTimeout(maxOf(Budget.REMOTE.readSeconds, ART_MIN_READ), TimeUnit.SECONDS)
            .callTimeout(CALL_SECONDS, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .addInterceptor(perHostDeadlines)
            .addInterceptor(sameOriginAuth(tokens, origin))
            // Deliberately no logging interceptor. See the note above.
            .build()

    /**
     * Tighten the deadlines for a picture on this network.
     *
     * The client is built once for the process, so the generous numbers are the
     * ones baked into it and this narrows them per call. Without it a LAN image
     * on a sleeping machine would hold a slot for 45s — the same mistake in the
     * other direction from the one `Budget` exists to fix.
     */
    private val perHostDeadlines = Interceptor { chain ->
        val budget = Budget.ofHost(chain.request().url.host)
        chain
            .withConnectTimeout(budget.connectSeconds.toInt(), TimeUnit.SECONDS)
            .withReadTimeout(maxOf(budget.readSeconds, ART_MIN_READ).toInt(), TimeUnit.SECONDS)
            .proceed(chain.request())
    }

    /**
     * Bearer auth for the user's own server, and for no other host.
     *
     * The comparison is scheme + host + port, parsed — never a prefix match on
     * the text. A configured `http://192.168.1.4:8787` must not authorise a URL
     * that merely *starts* with it, and a prefix test is exactly how a
     * lookalike host gets handed the token.
     */
    private fun sameOriginAuth(tokens: TokenSource, origin: ArtOrigin) = Interceptor { chain ->
        val request = chain.request()
        val token = if (origin.matches(request.url.toString())) tokens.token() else null
        chain.proceed(
            if (token.isNullOrBlank()) request
            else request.newBuilder().header("Authorization", "Bearer $token").build(),
        )
    }
}

/**
 * A content-addressed asset is fetched **once, ever**.
 *
 * Protocol 4 stopped inlining artwork — 2,205,542 bytes per poll, 97.4% of the
 * old payload — and replaced it with `GET /api/v1/assets/<sha256>`, served with
 * `Cache-Control: private, max-age=31536000, immutable`. A hash cannot describe
 * different bytes, so there is nothing to revalidate and not even a `304` round
 * trip to pay; RFC 8246 names exactly this as what `immutable` is for.
 *
 * Coil's default strategy would honour those headers on its own, and this is
 * deliberately not a substitute for them. It is here because the headers have to
 * survive the trip: this user reaches their server through a Tailscale Funnel
 * and a portal proxy, gzip through it already measured *slower* than none —
 * which points at buffering and at a proxy that rewrites more than it should —
 * and a stripped or rewritten `Cache-Control` would quietly turn "fetched once,
 * ever" back into a revalidation per picture per launch. On a URL whose last
 * path segment **is** the SHA-256 of the bytes, a cache hit cannot be stale, so
 * this says so locally and stops depending on anything in between.
 *
 * **Only for asset URLs.** Everything else — an agent's link to a picture on
 * some other host — goes to [CacheStrategy.DEFAULT], because an ordinary URL is
 * not a promise about its own contents and may legitimately change under its
 * own address.
 *
 * Nothing here appends a cache-buster. There is no query parameter, no
 * timestamp and no version to add: the hash in the path already is the cache
 * key, and `Art.fingerprint` keys the memory and disk caches on the URL for the
 * same reason.
 */
private object ImmutableAssets : CacheStrategy {

    override suspend fun read(
        cacheResponse: NetworkResponse,
        networkRequest: NetworkRequest,
        options: Options,
    ): CacheStrategy.ReadResult =
        if (isContentAddressed(networkRequest.url)) {
            // Serve what is on disk and make no request at all.
            CacheStrategy.ReadResult(cacheResponse)
        } else {
            CacheStrategy.DEFAULT.read(cacheResponse, networkRequest, options)
        }

    override suspend fun write(
        cacheResponse: NetworkResponse?,
        networkRequest: NetworkRequest,
        networkResponse: NetworkResponse,
        options: Options,
    ): CacheStrategy.WriteResult =
        CacheStrategy.DEFAULT.write(cacheResponse, networkRequest, networkResponse, options)

    /**
     * Is this one of the server's own immutable asset URLs?
     *
     * Matched on the path — `/api/v1/assets/<64 hex>` — and not merely on the
     * directory, because the promise being relied on is that the last segment is
     * the SHA-256 of the bytes. A path that merely looks like the route but
     * carries something else is treated as an ordinary URL, which costs a
     * revalidation and risks nothing.
     */
    private fun isContentAddressed(url: String): Boolean {
        val path = url.toHttpUrlOrNull()?.encodedPath ?: return false
        val marker = "/api/v1/assets/"
        val at = path.lastIndexOf(marker)
        if (at < 0) return false
        val hash = path.substring(at + marker.length)
        return hash.length == 64 && hash.all { it.isDigit() || it in 'a'..'f' }
    }
}

/**
 * Which origin an image request may carry the token to.
 *
 * A plain mutable mirror of the configured address, because an OkHttp
 * interceptor runs on a network thread and must not block on DataStore — and
 * `AppPreferences.baseUrl()` is a `suspend` read. The process keeps this in step
 * (see `LifeOsApp`); "Change server" therefore takes effect on images at the
 * same moment it takes effect on requests.
 */
class ArtOrigin {

    @Volatile
    private var origin: String? = null

    /** Called with whatever is in preferences, including null on a disconnect. */
    fun set(baseUrl: String?) {
        origin = baseUrl?.toHttpUrlOrNull()?.let { "${it.scheme}://${it.host}:${it.port}" }
    }

    fun matches(url: String): Boolean {
        val mine = origin ?: return false
        val parsed = url.toHttpUrlOrNull() ?: return false
        return "${parsed.scheme}://${parsed.host}:${parsed.port}" == mine
    }
}

/**
 * Hands an [ArtSvg]'s markup to the SVG decoder as bytes, and nothing else.
 *
 * `DataSource.MEMORY` because the markup arrived in the dashboard payload; there
 * is no fetch here, which is the point — the "source" of an agent's vector is a
 * string the app already has, so this cannot make a request even in principle.
 *
 * The mime type is stated rather than sniffed so that `SvgDecoder` is the only
 * decoder that can ever claim it.
 */
internal class ArtSvgFetcher(private val art: ArtSvg) : Fetcher {

    override suspend fun fetch(): FetchResult = SourceFetchResult(
        source = ImageSource(
            source = Buffer().apply { writeUtf8(art.svg) },
            fileSystem = FileSystem.SYSTEM,
        ),
        mimeType = MIME,
        dataSource = DataSource.MEMORY,
    )

    class Factory : Fetcher.Factory<ArtSvg> {
        override fun create(data: ArtSvg, options: Options, imageLoader: ImageLoader): Fetcher =
            ArtSvgFetcher(data)
    }

    private companion object {
        const val MIME = "image/svg+xml"
    }
}
